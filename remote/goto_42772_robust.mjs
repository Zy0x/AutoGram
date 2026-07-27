/**
 * Robust target script with full MouseEvent dispatch for media 42772
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
  note('Connecting to frontend CDP...');
  const raw = await httpGet('::1', 9222, '/json');
  const targets = JSON.parse(raw);
  const page = targets.find(t => t.type === 'page' && /localhost:1420|tauri/i.test(t.url))
             ?? targets.find(t => t.type === 'page');

  if (!page) { err('No AutoGram page target found'); process.exit(1); }
  note(`Connected → ${page.title} [${page.url}]`);

  const cdp = await openCDP(page.webSocketDebuggerUrl);
  await cdp.cmd('Runtime.enable').catch(() => {});
  await cdp.cmd('Page.enable').catch(() => {});

  // Full MouseEvent dispatch on card 42772
  note('Dispatching full MouseEvent sequence on card 42772...');
  const openRes = await js(cdp, `JSON.stringify((() => {
    const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
    if (!card) return { err: 'card 42772 not found' };
    
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

    const playBtn = card.querySelector('button, [class*=play], svg');
    if (playBtn) {
      playBtn.dispatchEvent(new MouseEvent('click', opts));
      playBtn.dispatchEvent(new MouseEvent('dblclick', opts));
    }
    return { ok: true, x, y };
  })())`);
  console.log('Open Result:', openRes);

  await sleep(3000);
  await shot(cdp, 'play_01_modal_opened.png');

  // Monitor video playback state for 15 seconds
  note('Auditing video playback state over 15s...');
  for (let i = 1; i <= 15; i++) {
    await sleep(1000);
    const audit = await js(cdp, `JSON.stringify((() => {
      const v = document.querySelector('video');
      const modal = document.querySelector('[class*=preview-modal],[class*=drive-preview],[role=dialog]');
      const b = v?.buffered;
      let buf = [];
      if (b) {
        for (let j = 0; j < b.length; j++) buf.push([Math.round(b.start(j)*10)/10, Math.round(b.end(j)*10)/10]);
      }
      return {
        sec: ${i},
        modalOpen: !!modal,
        videoFound: !!v,
        src: v?.src?.slice(0,120),
        paused: v?.paused,
        currentTime: Math.round((v?.currentTime || 0) * 10) / 10,
        duration: Math.round((v?.duration || 0) * 10) / 10,
        readyState: v?.readyState,
        networkState: v?.networkState,
        buffered: buf,
        error: v?.error ? { code: v.error.code, msg: v.error.message } : null,
        hint: document.querySelector('[class*=stream-label],[class*=hint]')?.innerText?.slice(0,80) || null,
        errorMsg: document.querySelector('[class*=error-msg],[class*=drive-error]')?.innerText?.slice(0,100) || null
      };
    })())`);
    console.log(`[sec ${i}]`, audit);
  }

  await shot(cdp, 'play_02_final.png');
  cdp.close();
}

main().catch(e => { err('Fatal: ' + e.message); process.exit(1); });
