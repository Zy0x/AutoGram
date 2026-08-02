/**
 * diag_stream_1869.mjs — Double-click the 1869 card to open preview,
 * inspect stream state, probe HTTP range responses, monitor buffer.
 *
 * Usage:  node diag_stream_1869.mjs
 * Prereq: frontend.exe running with --remote-debugging-port=9222
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9222;
const OUT = 'F:/AutoGram/remote/reports';
fs.mkdirSync(OUT, { recursive: true });

function ts() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const log = (tag, data) => console.log(`[${ts()}][${tag}]`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));

// ─── HTTP range probe ────────────────────────────────────────────────────────
function httpRangeProbe(url, rangeHeader, maxBytes = 64 * 1024) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'Range': rangeHeader },
    }, res => {
      let size = 0;
      const chunks = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (chunks.length < 2) chunks.push(chunk.slice(0, 32));
        if (size >= maxBytes) req.destroy();
      });
      const finish = () => resolve({
        status: res.statusCode,
        contentRange: res.headers['content-range'] || null,
        contentLength: res.headers['content-length'] || null,
        contentType: res.headers['content-type'] || null,
        acceptRanges: res.headers['accept-ranges'] || null,
        bytesReceived: size,
        firstBytes: chunks[0] ? chunks[0].toString('hex').slice(0, 40) : null,
      });
      res.on('end', finish);
      res.on('error', finish);
      res.on('close', finish);
    });
    req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
    req.on('error', e => {
      if (e.message === 'timeout') reject(e);
      else resolve({ error: e.message });
    });
    req.end();
  });
}

// ─── CDP ─────────────────────────────────────────────────────────────────────
function openCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 1;
    const q = {};
    const consoleLogs = [];
    ws.on('open', () => resolve({
      cmd(method, params = {}) {
        return new Promise((res, rej) => {
          const i = id++;
          q[i] = { res, rej };
          ws.send(JSON.stringify({ id: i, method, params }));
          setTimeout(() => { if (q[i]) { delete q[i]; rej(new Error('timeout: ' + method)); } }, 20000);
        });
      },
      consoleLogs,
      close() { try { ws.close(); } catch {} }
    }));
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw);
        if (m.id && q[m.id]) {
          const { res, rej } = q[m.id]; delete q[m.id];
          m.error ? rej(new Error(m.error.message)) : res(m.result);
        }
        if (m.method === 'Runtime.consoleAPICalled') {
          const text = (m.params.args || []).map(a => a.value || a.description || '').join(' ');
          consoleLogs.push({ ts: ts(), type: m.params.type, text: text.slice(0, 500) });
        }
      } catch {}
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 8000);
  });
}

async function cdpEval(cdp, expr) {
  const r = await cdp.cmd('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    return { __eval_error: r.exceptionDetails.text || r.exceptionDetails.exception?.description };
  }
  return r.result?.value;
}

async function screenshot(cdp, name) {
  const { data } = await cdp.cmd('Page.captureScreenshot', { format: 'png' });
  const outPath = `${OUT}/${name}.png`;
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
  log('SCREENSHOT', outPath);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  log('START', 'Connecting to CDP on 127.0.0.1:9225...');
  const { execSync } = require('child_process');
  const rawJson = execSync('curl.exe -g -sS http://127.0.0.1:9225/json/list').toString();
  const targets = JSON.parse(rawJson);
  log('TARGETS', targets);
  let page = targets.find(t => t.type === 'page' && t.url.includes('1420'));
  if (!page) page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('No app page found. Targets: ' + JSON.stringify(targets));
  log('FOUND_PAGE', { title: page.title, url: page.url, ws: page.webSocketDebuggerUrl });

  const cdp = await openCDP(page.webSocketDebuggerUrl);
  await cdp.cmd('Runtime.enable');
  await cdp.cmd('Page.enable');

  // ── STEP 1: Check if preview modal already open ────────────────────────
  log('STEP', '1 - Check for existing video or open preview');

  let hasVideo = await cdpEval(cdp, `!!document.querySelector('video')`);

  if (!hasVideo) {
    // Cancel any selection first
    await cdpEval(cdp, `
      (() => {
        const cancelBtn = document.querySelector('button');
        const btns = [...document.querySelectorAll('button')];
        const cancel = btns.find(b => b.textContent.includes('Cancel') || b.textContent.includes('Batal'));
        if (cancel) cancel.click();
      })()
    `);
    await sleep(500);

    // Close any open modal
    await cdpEval(cdp, `
      (() => {
        const closeBtn = document.querySelector('.drive-preview-close, button[title*="Close"]');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await sleep(500);

    // Type 1869 into search box
    const searchRes = await cdpEval(cdp, `
      (() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const input = inputs.find(i => i.placeholder?.toLowerCase().includes('cari') || i.placeholder?.toLowerCase().includes('search') || i.placeholder?.toLowerCase().includes('ctrl'));
        if (input) {
          input.value = '1869';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return { searched: true, value: input.value };
        }
        return { searched: false, count: inputs.length };
      })()
    `);
    log('SEARCH_RES', searchRes);
    await sleep(2500);

    // Double-click the card for 1869
    const dblClickResult = await cdpEval(cdp, `
      (() => {
        const allEls = Array.from(document.querySelectorAll('*'));
        const textEl = allEls.find(el => el.children.length === 0 && (el.textContent.includes('1869') || el.textContent.includes('379') || el.textContent.includes('mp4') || el.textContent.includes('mkv')));
        const targetCard = textEl ? (textEl.closest('.td-file-card, [data-msg-id], [class*="card"]') || textEl.parentElement) : document.querySelector('.td-file-card, [data-msg-id]');
        if (!targetCard) {
          return { error: 'No file card found', totalEls: allEls.length };
        }
        targetCard.scrollIntoView({ block: 'center' });
        targetCard.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        return { dblClicked: true, textFound: textEl?.textContent, cardText: targetCard.textContent.slice(0, 60) };
      })()
    `);
    log('DBLCLICK', dblClickResult);
    await sleep(5000); // Wait for modal to open and stream to start
    hasVideo = await cdpEval(cdp, `!!document.querySelector('video')`);
  }

  if (!hasVideo) {
    // Still no video — maybe the play button needs a regular click
    log('STEP', '1b - Trying play button click');
    await cdpEval(cdp, `
      (() => {
        // Try clicking the card's play icon or overlay
        const card = document.querySelector('[data-msg-id="1869"]');
        if (card) {
          const playIcon = card.querySelector('[class*="play"], svg, .overlay, button');
          if (playIcon) { playIcon.click(); return 'play icon clicked'; }
          // Last resort: click the card itself
          card.click();
          return 'card clicked';
        }
        return 'nothing to click';
      })()
    `);
    await sleep(5000);
    hasVideo = await cdpEval(cdp, `!!document.querySelector('video')`);
  }

  await screenshot(cdp, 'diag_01_after_open');
  log('HAS_VIDEO', hasVideo);

  if (!hasVideo) {
    // Dump entire DOM structure to find what's on screen
    const domInfo = await cdpEval(cdp, `
      (() => {
        const modal = document.querySelector('.modal, [class*="modal"], [class*="preview"], [class*="Preview"]');
        if (modal) return { modalFound: true, html: modal.innerHTML.slice(0, 500) };
        // Check for iframes
        const iframes = document.querySelectorAll('iframe');
        if (iframes.length) return { iframeCount: iframes.length, src: iframes[0]?.src };
        return {
          bodyClasses: document.body.className,
          firstChildTag: document.body.firstElementChild?.tagName,
          videoCount: document.querySelectorAll('video').length,
          audioCount: document.querySelectorAll('audio').length,
        };
      })()
    `);
    log('DOM_DEBUG', domInfo);
    cdp.close();
    return;
  }

  // ── STEP 2: Video state ────────────────────────────────────────────────
  log('STEP', '2 - Video element state');
  const videoState = await cdpEval(cdp, `
    (() => {
      const v = document.querySelector('video');
      if (!v) return null;
      const buffered = [];
      try {
        for (let i = 0; i < v.buffered.length; i++)
          buffered.push({ start: v.buffered.start(i), end: v.buffered.end(i) });
      } catch {}
      return {
        src: v.src,
        currentTime: v.currentTime,
        duration: isNaN(v.duration) ? 'NaN' : v.duration,
        readyState: v.readyState,
        readyStateDesc: ['HAVE_NOTHING','HAVE_METADATA','HAVE_CURRENT_DATA','HAVE_FUTURE_DATA','HAVE_ENOUGH_DATA'][v.readyState],
        networkState: v.networkState,
        paused: v.paused,
        seeking: v.seeking,
        error: v.error ? { code: v.error.code, message: v.error.message } : null,
        buffered,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
      };
    })()
  `);
  log('VIDEO_STATE', videoState);

  // ── STEP 3: HTTP range probes ──────────────────────────────────────────
  const streamUrl = videoState?.src;
  if (streamUrl && streamUrl.startsWith('http')) {
    log('STEP', '3 - HTTP range probes on stream URL');
    log('STREAM_URL', streamUrl);

    // A: Small initial chunk
    try {
      const r = await httpRangeProbe(streamUrl, 'bytes=0-65535', 128 * 1024);
      log('RANGE_A_0_64K', r);
    } catch (e) { log('RANGE_A_ERR', e.message); }

    // B: Open-ended (check 16MB cap)
    try {
      const r = await httpRangeProbe(streamUrl, 'bytes=0-', 128 * 1024);
      log('RANGE_B_OPEN', r);
    } catch (e) { log('RANGE_B_ERR', e.message); }

    // C: Suffix (moov lookup)
    try {
      const r = await httpRangeProbe(streamUrl, 'bytes=-2097152', 2200000);
      log('RANGE_C_SUFFIX', r);
    } catch (e) { log('RANGE_C_ERR', e.message); }

    // D: If we know total from Content-Range, probe explicit tail
    const crB = (await httpRangeProbe(streamUrl, 'bytes=0-0', 1024)).contentRange;
    if (crB) {
      const totalMatch = crB.match(/\/(\d+)/);
      if (totalMatch) {
        const total = parseInt(totalMatch[1]);
        const tailStart = Math.max(0, total - 2 * 1024 * 1024);
        try {
          const r = await httpRangeProbe(streamUrl, `bytes=${tailStart}-`, 2200000);
          log('RANGE_D_TAIL', { rangeReq: `bytes=${tailStart}-`, ...r });
        } catch (e) { log('RANGE_D_ERR', e.message); }
      }
    }
  }

  // ── STEP 4: Monitor for 30 seconds ─────────────────────────────────────
  log('STEP', '4 - Monitor video for 30 seconds');
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const s = await cdpEval(cdp, `
      (() => {
        const v = document.querySelector('video');
        if (!v) return { gone: true };
        const b = [];
        try { for (let j = 0; j < v.buffered.length; j++) b.push([+v.buffered.start(j).toFixed(2), +v.buffered.end(j).toFixed(2)]); } catch {}
        return { t: +v.currentTime.toFixed(2), dur: isNaN(v.duration)?'NaN':+v.duration.toFixed(2), rs: v.readyState, ns: v.networkState, p: v.paused, buf: b, err: v.error?.code, w: v.videoWidth };
      })()
    `);
    log(`MON_${String(i).padStart(2,'0')}`, s);
  }

  await screenshot(cdp, 'diag_02_final');

  // ── STEP 5: Console and IPC ────────────────────────────────────────────
  log('STEP', '5 - Stream-related console logs');
  const streamLogs = cdp.consoleLogs.filter(l =>
    l.text.includes('stream') || l.text.includes('RANGE') || l.text.includes('REAL_HTTP') ||
    l.text.includes('buffer') || l.text.includes('moov') || l.text.includes('STREAM') ||
    l.text.includes('preview') || l.text.includes('error') || l.text.includes('Error')
  );
  log('RELEVANT_LOGS', { count: streamLogs.length, logs: streamLogs.slice(0, 30) });

  // IPC probe
  const ipc = await cdpEval(cdp, `
    (async () => {
      try {
        const inv = window.__TAURI_INTERNALS__?.invoke;
        if (!inv) return { hasTauri: !!window.__TAURI__, hasInternals: !!window.__TAURI_INTERNALS__, keys: Object.keys(window.__TAURI__ || {}).join(',') };
        const port = await inv('stream_port').catch(e => 'err:' + e.message);
        return { port };
      } catch(e) { return { error: e.message }; }
    })()
  `);
  log('TAURI_IPC', ipc);

  log('DONE', 'Complete');
  cdp.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
