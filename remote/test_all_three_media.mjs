import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const TARGET_MEDIAS = [
  { msgId: 42791, label: '/-1003214112048/42791' },
  { msgId: 42794, label: '/-1003214112048/42794' },
  { msgId: 42772, label: '/-1003214112048/4/42772' }
];

const OUT = 'F:/AutoGram/remote/reports';
fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(host, port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: host, port, path: urlPath }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function openCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 1;
    const q = {};
    ws.on('open', () => resolve({
      cmd(method, params = {}) {
        return new Promise((res, rej) => {
          const i = id++;
          q[i] = { res, rej };
          ws.send(JSON.stringify({ id: i, method, params }));
          setTimeout(() => { if (q[i]) { delete q[i]; rej(new Error('timeout: ' + method)); } }, 15000);
        });
      },
      close() { try { ws.close(); } catch {} }
    }));
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw);
        if (m.id && q[m.id]) {
          const { res, rej } = q[m.id]; delete q[m.id];
          m.error ? rej(new Error(m.error.message)) : res(m.result);
        }
      } catch {}
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 5000);
  });
}

async function js(cdp, expr, awaitPromise = false) {
  try {
    const r = await cdp.cmd('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise
    });
    if (r?.exceptionDetails) {
      return { ok: false, error: r.exceptionDetails.text };
    }
    const val = r?.result?.value;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function shot(cdp, name) {
  try {
    const r = await cdp.cmd('Page.captureScreenshot', { format: 'png', quality: 90 });
    if (r?.data) {
      const f = path.join(OUT, 'screenshots', name);
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      console.log(`>>> Screenshot saved: ${name}`);
    }
  } catch (e) {
    console.error(`Screenshot failed: ${e.message}`);
  }
}

async function run() {
  console.log('>>> Probing CDP targets at ::1:9222...');
  let rawJson = '';
  try {
    rawJson = await httpGet('::1', 9222, '/json');
  } catch {
    rawJson = await httpGet('127.0.0.1', 9222, '/json');
  }

  const targets = JSON.parse(rawJson);
  const target = targets.find(t => t.url.includes('localhost:1420') || t.title.includes('AutoGram'));
  if (!target || !target.webSocketDebuggerUrl) {
    console.error('AutoGram CDP target not found in:', targets);
    process.exit(1);
  }

  console.log('>>> Connected to target:', target.title, `[${target.url}]`);
  const cdp = await openCDP(target.webSocketDebuggerUrl);
  await cdp.cmd('Runtime.enable').catch(() => {});
  await cdp.cmd('Page.enable').catch(() => {});

  const summary = [];

  for (const item of TARGET_MEDIAS) {
    console.log(`\n==================================================`);
    console.log(`>>> TESTING MEDIA: ${item.label} (ID: ${item.msgId})`);
    console.log(`==================================================`);

    // Close any open modal
    await js(cdp, `
      (() => {
        const closeBtn = document.querySelector('.drive-preview-close, button[title*="Tutup"], button[aria-label*="Close"]');
        if (closeBtn) { closeBtn.click(); return true; }
        const backdrop = document.querySelector('.drive-preview-backdrop');
        if (backdrop) { backdrop.click(); return true; }
        return false;
      })()
    `);
    await sleep(600);

    // Smart Virtual Scroll Search for card matching msgId
    let openRes = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      openRes = await js(cdp, `JSON.stringify((() => {
        const idStr = String(${item.msgId});
        const card = Array.from(document.querySelectorAll('[data-msg-id], [data-file-id], .td-file-card, .drive-grid-card, .drive-list-row'))
          .find(el => {
            const attrMsg = el.getAttribute('data-msg-id') || '';
            const attrFile = el.getAttribute('data-file-id') || '';
            const txt = el.textContent || '';
            return attrMsg.includes(idStr) || attrFile.includes(idStr) || txt.includes(idStr);
          });

        if (!card) {
          // Scroll container to reveal virtualized elements
          const container = document.querySelector('[class*="scroll"], .td-explorer-scroll') || window;
          if (container.scrollBy) {
            container.scrollBy(0, ${attempt % 2 === 0 ? 500 : -300});
          }
          return { ok: false, reason: 'card ${item.msgId} not in DOM yet (scrolling...)' };
        }

        card.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = card.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };

        card.dispatchEvent(new PointerEvent('pointerdown', opts));
        card.dispatchEvent(new MouseEvent('mousedown', opts));
        card.dispatchEvent(new PointerEvent('pointerup', opts));
        card.dispatchEvent(new MouseEvent('mouseup', opts));
        card.dispatchEvent(new MouseEvent('click', opts));
        card.dispatchEvent(new MouseEvent('dblclick', opts));

        return { ok: true, x, y };
      })())`);

      if (openRes && openRes.ok) break;
      await sleep(400);
    }

    if (!openRes || !openRes.ok) {
      console.error(`ERROR: Could not find card for ${item.msgId}:`, openRes?.reason);
      summary.push({ label: item.label, status: 'FAILED_TO_FIND_CARD' });
      continue;
    }

    console.log(`>>> Triggered open for card ${item.msgId} at (${openRes.x.toFixed(1)}, ${openRes.y.toFixed(1)})`);

    const startTime = Date.now();
    let firstPlayTimeMs = null;
    let finalAudit = null;

    // Audit video playback over 10 seconds
    for (let sec = 1; sec <= 10; sec++) {
      await sleep(1000);
      const audit = await js(cdp, `
        (() => {
          const modal = document.querySelector('.drive-preview-backdrop, .drive-preview-modal');
          const v = document.querySelector('video');
          const hint = document.querySelector('.drive-preview-hint, .drive-preview-status')?.textContent || null;
          const err = document.querySelector('.drive-preview-error, [class*="error"]')?.textContent || null;
          
          if (v) {
            v.muted = true;
            if (v.paused) {
              void v.play().catch(() => undefined);
            }
          }

          if (!v) {
            return { sec: ${sec}, modalOpen: !!modal, videoFound: false, hint, errorMsg: err };
          }
          return {
            sec: ${sec},
            modalOpen: !!modal,
            videoFound: true,
            src: v.src || null,
            paused: v.paused,
            currentTime: Math.round(v.currentTime * 10) / 10,
            duration: Math.round(v.duration * 10) / 10,
            readyState: v.readyState,
            networkState: v.networkState,
            buffered: Array.from({length: v.buffered.length}, (_, i) => [
              Math.round(v.buffered.start(i) * 10) / 10,
              Math.round(v.buffered.end(i) * 10) / 10
            ]),
            error: v.error ? { code: v.error.code, message: v.error.message } : null,
            hint,
            errorMsg: err
          };
        })()
      `);

      console.log(`[${item.label} sec ${sec}]`, audit);

      if (audit?.videoFound && audit?.readyState >= 2 && !firstPlayTimeMs) {
        firstPlayTimeMs = Date.now() - startTime;
        console.log(`>>> FAST START DETECTED! First play ready in ${firstPlayTimeMs}ms!`);
      }
      finalAudit = audit;
    }

    await shot(cdp, `batch_test_${item.msgId}.png`);

    const isSuccess = finalAudit?.videoFound && finalAudit?.readyState === 4 && finalAudit?.currentTime > 0;
    summary.push({
      label: item.label,
      msgId: item.msgId,
      status: isSuccess ? 'PASSED' : 'FAILED',
      timeToFirstPlayMs: firstPlayTimeMs,
      finalReadyState: finalAudit?.readyState,
      currentTime: finalAudit?.currentTime,
      duration: finalAudit?.duration,
      buffered: JSON.stringify(finalAudit?.buffered),
      error: finalAudit?.errorMsg || finalAudit?.error ? JSON.stringify(finalAudit?.error) : null
    });
  }

  console.log(`\n==================================================`);
  console.log(`>>> BATCH TEST SUMMARY REPORT`);
  console.log(`==================================================`);
  console.table(summary);

  cdp.close();
}

run();
