/**
 * Remote Test: Media 34404 pada channel -1003214112048
 * Tujuan: Verifikasi video dapat diplay instant tanpa download full
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const TARGET_MSG_ID = 34404;
const TARGET_CHANNEL = -1003214112048;
const OUT = 'F:/AutoGram/remote/reports';
fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });

function ts() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const note = (msg) => console.log(`\x1b[36m[${ts()}] >>>\x1b[0m`, msg);
const ok   = (msg) => console.log(`\x1b[32m[${ts()}] OK\x1b[0m`, msg);
const warn = (msg) => console.log(`\x1b[33m[${ts()}] !\x1b[0m`, msg);
const errLog = (msg) => console.error(`\x1b[31m[${ts()}] X\x1b[0m`, msg);
const log  = (tag, data) => console.log(`\x1b[90m[${tag}]\x1b[0m`, data == null ? 'null' : JSON.stringify(data).slice(0, 500));

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

async function shot(cdp, name) {
  try {
    const r = await cdp.cmd('Page.captureScreenshot', { format: 'png', quality: 85 });
    if (r?.data) {
      const f = path.join(OUT, 'screenshots', name);
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      note(`Screenshot: ${name}`);
      return f;
    }
  } catch (e) { warn(`Screenshot failed: ${e.message}`); }
}

async function js(cdp, expr, awaitPromise = false) {
  try {
    const r = await cdp.cmd('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
      timeout: awaitPromise ? 20000 : 8000,
    });
    const v = r?.result?.value;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
    return v;
  } catch (e) { return { _err: e.message }; }
}

async function probeVideoState(cdp) {
  return js(cdp, `JSON.stringify((() => {
    const video = document.querySelector('video');
    if (!video) return { hasVideo: false };
    const buf = video.buffered;
    const ranges = [];
    for (let i = 0; i < buf.length; i++) ranges.push([+buf.start(i).toFixed(2), +buf.end(i).toFixed(2)]);
    const bufferedSec = ranges.reduce((s,[a,b]) => s + (b-a), 0);
    const dur = video.duration;
    const bufPct = dur > 0 && isFinite(dur) ? +(bufferedSec / dur * 100).toFixed(1) : null;
    return {
      hasVideo: true,
      readyState: video.readyState,
      paused: video.paused,
      currentTime: +video.currentTime.toFixed(3),
      duration: isFinite(dur) ? +dur.toFixed(2) : null,
      bufferedSec: +bufferedSec.toFixed(2),
      bufPct,
      ranges,
      networkState: video.networkState,
      error: video.error ? { code: video.error.code, msg: video.error.message } : null,
    };
  })()`);
}

async function main() {
  note(`=== Remote Test: Media ${TARGET_MSG_ID} (ch ${TARGET_CHANNEL}) ===`);
  note('Connecting to AutoGram CDP [::1]:9222...');

  let raw;
  try { raw = await httpGet('::1', 9222, '/json'); }
  catch(e) {
    errLog(`CDP failed: ${e.message}`);
    errLog('Pastikan AutoGram berjalan dengan --remote-debugging-port=9222');
    process.exit(1);
  }

  const targets = JSON.parse(raw);
  const page = targets.find(t => t.type === 'page' && /localhost:1420|tauri/i.test(t.url))
             ?? targets.find(t => t.type === 'page');
  if (!page) { errLog('No AutoGram page'); process.exit(1); }
  ok(`Connected: ${page.title}`);

  const cdp = await openCDP(page.webSocketDebuggerUrl);
  await cdp.cmd('Runtime.enable').catch(() => {});
  await cdp.cmd('Page.enable').catch(() => {});

  // Inject interceptors
  await js(cdp, `
    window.__test34404 = { streamLog: [], errors: [] };
    const _orig = window.fetch;
    window.fetch = function(...args) {
      const url = String(args[0]?.url ?? args[0] ?? '');
      const t0 = Date.now();
      return _orig.apply(this, args).then(r => {
        if (/stream|34404|1420/i.test(url)) window.__test34404.streamLog.push({ url: url.slice(0,100), status: r.status, ms: Date.now()-t0 });
        return r;
      }).catch(e => {
        if (/stream|34404|1420/i.test(url)) window.__test34404.streamLog.push({ url: url.slice(0,100), err: e.message });
        throw e;
      });
    };
    window.onerror = (msg,src,l,c) => window.__test34404.errors.push({ msg, src, l, c });
  `);

  // Ensure Drive view
  note('Opening Drive view...');
  await js(cdp, `JSON.stringify((() => {
    const btns = [...document.querySelectorAll('button,a,[role=button]')];
    const b = btns.find(b => /Drive/i.test(b.innerText) && b.closest('aside,nav,[class*=sidebar]'));
    if (b) { b.click(); return 'clicked'; }
    return 'not found';
  })()`);
  await sleep(1500);
  await shot(cdp, '01_drive.png');

  // Find card 34404
  note(`Finding card ${TARGET_MSG_ID}...`);
  let cardFound = await js(cdp, `JSON.stringify((() => {
    const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
    if (card) { const r = card.getBoundingClientRect(); return { found: true, inView: r.top >= 0 && r.bottom <= window.innerHeight }; }
    const all = [...document.querySelectorAll('[data-msg-id]')].map(e=>+e.dataset.msgId).sort((a,b)=>a-b);
    return { found: false, total: all.length, range: [all[0], all[all.length-1]], last5: all.slice(-5) };
  })()`);
  log('card', cardFound ?? null);

  if (!cardFound?.found) {
    note('Scrolling to find card...');
    const sr = await js(cdp, `(async () => {
      const grid = document.querySelector('[class*=grid],[class*=Grid],[class*=file-grid],[class*=media-grid],[class*=card-grid]')
                ?? document.querySelector('[class*=drive-content],[class*=DriveContent],[class*=main-content]')
                ?? document.querySelector('main,[role=main]');
      if (!grid) return JSON.stringify({ err: 'no grid' });
      for (let i = 0; i < 80; i++) {
        const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
        if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); await new Promise(r=>setTimeout(r,600)); return JSON.stringify({ found: true, i }); }
        grid.scrollBy(0, 400);
        await new Promise(r => setTimeout(r, 100));
      }
      return JSON.stringify({ found: false });
    })()`, true);
    cardFound = sr;
    log('scroll', sr);
    await shot(cdp, '02_scroll.png');
  }

  if (!cardFound?.found) {
    warn(`Card not found by scroll — trying hash navigation...`);
    await js(cdp, `window.location.hash = '/${TARGET_CHANNEL}/9/${TARGET_MSG_ID}'`);
    await sleep(3000);
    await shot(cdp, '03_hash.png');
  }

  // Wait for modal
  let modalMs = null;
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    const has = await js(cdp, `!!(document.querySelector('[class*=modal],[class*=Modal],[role=dialog]') || document.querySelector('video'))`);
    if (has) { modalMs = Date.now() - t_click; ok(`Modal in ${modalMs}ms`); break; }
  }
  if (!modalMs) warn('Modal not detected within 3s');
  await shot(cdp, '04_modal.png');

  // Wait for video element
  let videoMs = null;
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    const has = await js(cdp, `!!document.querySelector('video')`);
    if (has) { videoMs = Date.now() - t_click; ok(`Video element in ${videoMs}ms`); break; }
  }
  if (!videoMs) warn('Video element not found within 8s');

  // Monitor 30s
  note('=== Monitoring playback for 30s ===');
  const snapshots = [];
  let firstBufMs = null, playMs = null, lastState = null;

  for (let tick = 0; tick < 60; tick++) {
    await sleep(500);
    const st = await probeVideoState(cdp);
    if (!st?.hasVideo) continue;

    const elapsedSec = ((Date.now() - t_click) / 1000).toFixed(1);

    if (st.bufPct > 0 && firstBufMs === null) {
      firstBufMs = Date.now() - t_click;
      ok(`First buffer at ${firstBufMs}ms = ${st.bufPct}%`);
    }
    if (!st.paused && playMs === null) {
      playMs = Date.now() - t_click;
      ok(`PLAYBACK STARTED at ${playMs}ms! ct=${st.currentTime}s`);
    }

    if (tick % 4 === 0) {
      const status = st.paused ? 'PAUSED' : `PLAYING@${st.currentTime}s`;
      note(`t+${elapsedSec}s | ${status} | buf=${st.bufPct ?? '?'}% (${st.bufferedSec}s/${st.duration ?? '?'}s) | rs=${st.readyState}`);
    }

    snapshots.push({ t: +elapsedSec, ...st });
    lastState = st;

    if (tick === 5) await shot(cdp, '05_2s5.png');
    if (tick === 19) await shot(cdp, '06_10s.png');
    if (tick === 39) await shot(cdp, '07_20s.png');
    if (st.error) { errLog(`Video error: code=${st.error.code} ${st.error.msg}`); break; }
  }

  await shot(cdp, '08_final.png');

  const streamLog = await js(cdp, `JSON.stringify(window.__test34404?.streamLog ?? [])`);
  const errors    = await js(cdp, `JSON.stringify(window.__test34404?.errors ?? [])`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  HASIL REMOTE TEST: Media 34404');
  console.log('='.repeat(60));
  console.log(`  Modal appeared     : ${modalMs !== null ? `YES (${modalMs}ms)` : 'NO'}`);
  console.log(`  Video element      : ${videoMs !== null ? `YES (${videoMs}ms)` : 'NO'}`);
  console.log(`  First buffer       : ${firstBufMs !== null ? `${firstBufMs}ms` : 'NOT DETECTED'}`);
  console.log(`  Playback started   : ${playMs !== null ? `YES at ${playMs}ms` : 'NO (stuck/paused)'}`);
  if (lastState?.duration && lastState.duration > 0) {
    const dlPct = (lastState.bufferedSec / lastState.duration * 100).toFixed(1);
    console.log(`  Downloaded         : ${lastState.bufferedSec}s of ${lastState.duration}s (${dlPct}%)`);
    if (+dlPct < 20) ok('  PROGRESSIVE OK: <20% downloaded, not full download!');
    else warn(`  HIGH DOWNLOAD: ${dlPct}% - check if player is over-buffering`);
  }
  if (errors?.length > 0) console.log('  JS Errors:', JSON.stringify(errors));
  console.log('='.repeat(60));
  log('stream_log_sample', Array.isArray(streamLog) ? streamLog.slice(0, 5) : streamLog);

  const report = {
    target: { channel: TARGET_CHANNEL, msgId: TARGET_MSG_ID },
    timing: { modalMs, videoMs, firstBufMs, playMs },
    finalState: lastState,
    snapshots: snapshots.slice(-10),
    streamLog,
    errors,
  };
  const rp = path.join(OUT, 'test_34404_report.json');
  fs.writeFileSync(rp, JSON.stringify(report, null, 2));
  note(`Report: ${rp}`);

  cdp.close();
}

main().catch(e => { errLog(e.message); process.exit(1); });
