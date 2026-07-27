/**
 * Deep diagnostic test for media /-1003214112048/4/42772
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
  note('Deep CDP audit for msg 42772...');
  const raw = await httpGet('::1', 9222, '/json');
  const targets = JSON.parse(raw);
  const page = targets.find(t => t.type === 'page' && /localhost:1420|tauri/i.test(t.url))
             ?? targets.find(t => t.type === 'page');

  if (!page) { err('No AutoGram page target found'); process.exit(1); }
  note(`Connected → ${page.title} [${page.url}]`);

  const cdp = await openCDP(page.webSocketDebuggerUrl);
  await cdp.cmd('Runtime.enable').catch(() => {});
  await cdp.cmd('Page.enable').catch(() => {});

  // Intercept video events
  await js(cdp, `
    window.__videoLogs = [];
    document.addEventListener('play', e => { if (e.target.tagName === 'VIDEO') window.__videoLogs.push({ event: 'play', t: Date.now() }); }, true);
    document.addEventListener('pause', e => { if (e.target.tagName === 'VIDEO') window.__videoLogs.push({ event: 'pause', t: Date.now() }); }, true);
    document.addEventListener('playing', e => { if (e.target.tagName === 'VIDEO') window.__videoLogs.push({ event: 'playing', t: Date.now() }); }, true);
    document.addEventListener('waiting', e => { if (e.target.tagName === 'VIDEO') window.__videoLogs.push({ event: 'waiting', t: Date.now() }); }, true);
    document.addEventListener('stalled', e => { if (e.target.tagName === 'VIDEO') window.__videoLogs.push({ event: 'stalled', t: Date.now() }); }, true);
    document.addEventListener('error', e => { if (e.target.tagName === 'VIDEO') window.__videoLogs.push({ event: 'error', code: e.target.error?.code, msg: e.target.error?.message, t: Date.now() }); }, true);
  `);

  // Locate card 42772
  note('Locating card 42772...');
  const locate = await js(cdp, `(async () => {
    const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
    if (card) {
      card.scrollIntoView({ behavior: 'instant', block: 'center' });
      return JSON.stringify({ found: true });
    }
    return JSON.stringify({ found: false });
  })()`, true);

  console.log('Locate:', locate);

  // Click card
  note('Opening media 42772...');
  await js(cdp, `(() => {
    const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
    if (card) card.click();
  })()`);

  await sleep(2000);
  await shot(cdp, 'deep_01_open.png');

  // Monitor over 10 seconds
  for (let sec = 1; sec <= 10; sec++) {
    await sleep(1000);
    const inspect = await js(cdp, `JSON.stringify((() => {
      const v = document.querySelector('video');
      const b = v?.buffered;
      let bufRanges = [];
      if (b) {
        for (let i = 0; i < b.length; i++) {
          bufRanges.push([Math.round(b.start(i)*10)/10, Math.round(b.end(i)*10)/10]);
        }
      }
      return {
        sec: ${sec},
        hasVideo: !!v,
        src: v?.src?.slice(0,100),
        paused: v?.paused,
        currentTime: v?.currentTime,
        duration: v?.duration,
        readyState: v?.readyState,
        networkState: v?.networkState,
        buffered: bufRanges,
        error: v?.error ? { code: v.error.code, message: v.error.message } : null,
        videoWidth: v?.videoWidth,
        videoHeight: v?.videoHeight,
        errorUI: document.querySelector('[class*=error],[class*=Error]')?.innerText?.slice(0,100) || null,
        hintUI: document.querySelector('[class*=hint],[class*=Hint]')?.innerText?.slice(0,100) || null
      };
    })())`);
    console.log(`[sec ${sec}]`, inspect);
  }

  // Attempt click play button directly if paused
  note('Attempting click play / trigger play() on video element...');
  const playTrigger = await js(cdp, `(async () => {
    const v = document.querySelector('video');
    if (v && v.paused) {
      try {
        await v.play();
        return JSON.stringify({ ok: true, played: true });
      } catch (e) {
        return JSON.stringify({ ok: false, err: e.message });
      }
    }
    return JSON.stringify({ ok: true, alreadyPlaying: !v?.paused });
  })()`, true);
  console.log('Play Trigger Result:', playTrigger);

  await sleep(2000);
  await shot(cdp, 'deep_02_after_play_trigger.png');

  const logs = await js(cdp, `JSON.stringify(window.__videoLogs ?? [])`);
  console.log('Video Event Logs:', logs);

  cdp.close();
}

main().catch(e => { err('Fatal: ' + e.message); process.exit(1); });
