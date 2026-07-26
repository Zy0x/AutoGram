/**
 * Test direct navigation and playback for media /-1003214112048/4/42772
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const TARGET_MSG_ID = 42772;
const OUT = 'F:/AutoGram/remote/reports';
fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const note = (msg) => console.log('\x1b[36m>>>\x1b[0m', msg);
const err  = (msg) => console.error('\x1b[31m[ERR]\x1b[0m', msg);

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
          setTimeout(() => { if (q[i]) { delete q[i]; rej(new Error('timeout: ' + method)); } }, 12000);
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

async function shot(cdp, name) {
  try {
    const r = await cdp.cmd('Page.captureScreenshot', { format: 'png', quality: 90 });
    if (r?.data) {
      const f = path.join(OUT, 'screenshots', name);
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      note(`Screenshot: ${name}`);
    }
  } catch (e) { err(`Screenshot failed: ${e.message}`); }
}

async function js(cdp, expr, awaitPromise = false) {
  try {
    const r = await cdp.cmd('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
      timeout: awaitPromise ? 15000 : 6000,
    });
    const v = r?.result?.value;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
    return v;
  } catch (e) { return { _err: e.message }; }
}

async function main() {
  note('Connecting to frontend.exe CDP via [::1]:9222 for msg 42772...');
  const raw = await httpGet('::1', 9222, '/json');
  const targets = JSON.parse(raw);
  const page = targets.find(t => t.type === 'page' && /localhost:1420|tauri/i.test(t.url))
             ?? targets.find(t => t.type === 'page');

  if (!page) { err('No AutoGram page target found'); process.exit(1); }
  note(`Connected → ${page.title} [${page.url}]`);

  const cdp = await openCDP(page.webSocketDebuggerUrl);
  await cdp.cmd('Runtime.enable').catch(() => {});
  await cdp.cmd('Page.enable').catch(() => {});

  await js(cdp, `
    window.__streamLog = [];
    const _origFetch = window.fetch;
    window.fetch = function(...args) {
      const url = String(args[0]?.url ?? args[0] ?? '');
      return _origFetch.apply(this, args).then(r => {
        if (/stream|42772|ipc\\.localhost/i.test(url)) {
          window.__streamLog.push({ url: url.slice(0,150), status: r.status, ok: r.ok, t: Date.now() });
        }
        return r;
      }).catch(e => {
        if (/stream|42772|ipc\\.localhost/i.test(url)) {
          window.__streamLog.push({ url: url.slice(0,150), error: e.message, t: Date.now() });
        }
        throw e;
      });
    };
  `);

  await shot(cdp, '42772_01_start.png');

  // Scroll grid to find card 42772
  note('Searching and scrolling to card 42772...');
  const findCard = await js(cdp, `(async () => {
    const grid = document.querySelector('[class*=grid],[class*=Grid],[class*=file-grid],[class*=media-grid]')
              ?? document.querySelector('[class*=drive-content],[class*=main-content]')
              ?? document.querySelector('main');
    let attempts = 0;
    while (attempts < 60) {
      const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
      if (card) {
        card.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = card.getBoundingClientRect();
        return JSON.stringify({ found: true, attempts, msgId: ${TARGET_MSG_ID}, top: rect.top, className: card.className });
      }
      if (grid) grid.scrollBy(0, 500);
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    return JSON.stringify({ found: false, attempts });
  })()`.replace(/\${TARGET_MSG_ID}/g, TARGET_MSG_ID), true);

  console.log('Find Card Result:', findCard);
  await sleep(1000);
  await shot(cdp, '42772_02_card_found.png');

  // Click card
  note('Clicking card 42772...');
  const clickRes = await js(cdp, `JSON.stringify((() => {
    const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
    if (!card) return { err: 'card not found' };
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return { clicked: true, text: card.innerText.slice(0,80) };
  })())`.replace('${TARGET_MSG_ID}', TARGET_MSG_ID));
  console.log('Click Result:', clickRes);

  await sleep(3000);
  await shot(cdp, '42772_03_after_click.png');

  // Check modal & video
  const modalInfo = await js(cdp, `JSON.stringify((() => {
    const modal = document.querySelector('[class*=preview-modal],[class*=PreviewModal],[class*=drive-preview],[role=dialog]');
    const v = document.querySelector('video');
    return {
      modalOpen: !!modal,
      fileName: document.querySelector('[class*=filename],[class*=name],h2,h3')?.innerText?.slice(0,100),
      video: v ? {
        src: v.src,
        currentSrc: v.currentSrc,
        readyState: v.readyState,
        networkState: v.networkState,
        paused: v.paused,
        duration: v.duration,
        currentTime: v.currentTime,
        error: v.error ? { code: v.error.code, message: v.error.message } : null
      } : null
    };
  })()`);
  console.log('Modal Info:', modalInfo);

  // Monitor network calls
  await sleep(4000);
  await shot(cdp, '42772_04_observe.png');

  const streamLog = await js(cdp, `JSON.stringify(window.__streamLog ?? [])`);
  console.log('Stream Log:', streamLog);

  const ipcCalls = await js(cdp, `JSON.stringify(
    performance.getEntriesByType('resource')
      .filter(e => /42772|ipc\\.localhost|stream/i.test(e.name))
      .map(e => ({
        url: e.name.slice(0,150),
        status: e.responseStatus ?? 0,
        dur: Math.round(e.duration)
      }))
  )`);
  console.log('IPC/Network Calls:', ipcCalls);

  cdp.close();
}

main().catch(e => { err('Fatal: ' + e.message); process.exit(1); });
