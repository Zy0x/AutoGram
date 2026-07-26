/**
 * Navigate directly to media /-1003214112048/42794
 * Find card data-msg-id=42794, scroll to it, click, observe stream behavior
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const TARGET_MSG_ID = 42794;
const OUT = 'F:/AutoGram/remote/reports';
fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });

function ts() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const log = (tag, data = {}) => console.log(`[${tag}]`, JSON.stringify(data).slice(0, 500));
const note = (msg) => console.log('\x1b[36m>>>\x1b[0m', msg);
const err  = (msg) => console.error('\x1b[31m[ERR]\x1b[0m', msg);

// ─── HTTP ─────────────────────────────────────────────────────────────────────
function httpGet(host, port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: host, port, path: urlPath }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// ─── CDP ─────────────────────────────────────────────────────────────────────
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

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  note('Connecting to frontend.exe CDP via [::1]:9222');

  const raw = await httpGet('::1', 9222, '/json');
  const targets = JSON.parse(raw);
  const page = targets.find(t => t.type === 'page' && /localhost:1420|tauri/i.test(t.url))
             ?? targets.find(t => t.type === 'page');

  if (!page) { err('No AutoGram page target found'); process.exit(1); }
  note(`Connected → ${page.title} [${page.url}]`);

  const cdp = await openCDP(page.webSocketDebuggerUrl);
  await cdp.cmd('Runtime.enable').catch(() => {});
  await cdp.cmd('Page.enable').catch(() => {});

  // ─── 1. Collect console errors in real time ───────────────────────────────
  const consoleErrors = [];
  const networkFails  = [];
  const streamEvents  = [];

  // Inject error & fetch interceptor
  await js(cdp, `
    window.__testErrors = [];
    window.__streamLog  = [];
    const _origFetch = window.fetch;
    window.fetch = function(...args) {
      const url = String(args[0]?.url ?? args[0] ?? '');
      return _origFetch.apply(this, args).then(r => {
        if (/stream|42794|ipc\\.localhost/i.test(url)) {
          window.__streamLog.push({ url: url.slice(0,150), status: r.status, ok: r.ok, t: Date.now() });
        }
        return r;
      }).catch(e => {
        if (/stream|42794|ipc\\.localhost/i.test(url)) {
          window.__streamLog.push({ url: url.slice(0,150), error: e.message, t: Date.now() });
        }
        throw e;
      });
    };
    window.onerror = (msg, src, l, c, err) => { window.__testErrors.push({ msg, src, l, c }); };
  `);

  // ─── 2. Initial state ─────────────────────────────────────────────────────
  await shot(cdp, 'nav01_start.png');

  const bodyNow = await js(cdp, `document.body.innerText.slice(0,200).replace(/\\s+/g,' ')`);
  note(`Current page: ${bodyNow}`);

  // ─── 3. Make sure we're in Drive view ─────────────────────────────────────
  note('Ensuring Drive/#Gudang is open...');
  const driveNav = await js(cdp, `JSON.stringify((() => {
    const btns = [...document.querySelectorAll('button,a,[role=button]')];
    const driveBtn = btns.find(b => /Drive/i.test(b.innerText) && b.closest('aside,nav,[class*=sidebar]'));
    if (driveBtn) { driveBtn.click(); return { clicked: 'drive', text: driveBtn.innerText.slice(0,30) }; }
    return { clicked: false };
  })()`);
  log('drive_nav', driveNav);
  await sleep(1500);

  // ─── 4. Find card with data-msg-id=42794 ─────────────────────────────────
  note('Looking for data-msg-id=42794 in current DOM...');
  const findCard = await js(cdp, `JSON.stringify((() => {
    const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
    if (card) {
      const rect = card.getBoundingClientRect();
      return { found: true, inView: rect.top >= 0 && rect.bottom <= window.innerHeight, rect: { top: rect.top, bottom: rect.bottom, left: rect.left }, className: card.className.slice(0,80), dataAttrs: [...card.attributes].filter(a=>a.name.startsWith('data-')).map(a=>a.name+'='+a.value).join(', ') };
    }
    // Count all cards
    const all = document.querySelectorAll('[data-msg-id]');
    const ids = [...all].map(e=>+e.dataset.msgId).sort((a,b)=>a-b);
    return { found: false, totalCards: all.length, minId: ids[0], maxId: ids[ids.length-1], sampleIds: ids.slice(0,10) };
  })())`.replace('${TARGET_MSG_ID}', TARGET_MSG_ID));
  log('find_card', findCard);

  // ─── 5. Scroll to 42794 if not visible ────────────────────────────────────
  if (!findCard?.found) {
    note('Card 42794 not in DOM yet — scrolling grid to find it...');

    // Try scrolling the grid container to find it
    const scrollResult = await js(cdp, `(async () => {
      // Find the scrollable grid container
      const grid = document.querySelector('[class*=grid],[class*=Grid],[class*=file-grid],[class*=media-grid],[class*=card-grid]')
                ?? document.querySelector('[class*=drive-content],[class*=DriveContent],[class*=main-content]')
                ?? document.querySelector('main,[role=main]');

      if (!grid) return JSON.stringify({ err: 'no grid container found' });

      let found = false;
      let attempts = 0;
      const maxAttempts = 50;
      const scrollStep = 600;

      while (!found && attempts < maxAttempts) {
        const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
        if (card) { found = true; break; }
        grid.scrollBy(0, scrollStep);
        await new Promise(r => setTimeout(r, 150));
        attempts++;
      }

      const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 600));
        const rect = card.getBoundingClientRect();
        return JSON.stringify({ found: true, attempts, rect: { top: rect.top, bottom: rect.bottom } });
      }
      return JSON.stringify({ found: false, attempts, scrolledTo: grid.scrollTop });
    })()`.replace(/\${TARGET_MSG_ID}/g, TARGET_MSG_ID), true);
    log('scroll_result', scrollResult);

    await shot(cdp, 'nav02_after_scroll.png');
  } else if (!findCard.inView) {
    note('Card found but not in viewport — scrolling into view...');
    await js(cdp, `
      const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    `.replace('${TARGET_MSG_ID}', TARGET_MSG_ID));
    await sleep(800);
    await shot(cdp, 'nav02_scrolled.png');
  }

  // ─── 6. Verify card is now in DOM ─────────────────────────────────────────
  const cardCheck = await js(cdp, `JSON.stringify((() => {
    const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
    if (!card) return { found: false };
    const rect = card.getBoundingClientRect();
    return {
      found: true,
      inView: rect.top >= 0 && rect.bottom <= window.innerHeight,
      rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
      className: card.className,
      isVideo: card.classList.contains('is-video'),
      hasThumb: card.classList.contains('has-thumb'),
      dataAttrs: [...card.attributes].filter(a=>a.name.startsWith('data-')).map(a=>a.name+'='+a.value).join(', '),
      thumbSrc: card.querySelector('img')?.src?.slice(0,80) ?? null,
      filename: card.querySelector('[class*=name],[class*=title],[class*=filename]')?.innerText?.slice(0,60) ?? null,
    };
  })())`.replace('${TARGET_MSG_ID}', TARGET_MSG_ID));
  log('card_42794', cardCheck);
  note(`Card 42794: found=${cardCheck?.found} inView=${cardCheck?.inView} isVideo=${cardCheck?.isVideo}`);

  await shot(cdp, 'nav03_card_visible.png');

  if (!cardCheck?.found) {
    err('Card 42794 not found even after scroll. Grid may be virtualized with different chunk size.');

    // Try alternative: use ipc.localhost to navigate
    note('Trying ipc.localhost navigation...');
    const ipcNav = await js(cdp, `(async () => {
      try {
        const r = await fetch('http://ipc.localhost/navigate_to_msg?chat_id=-1003214112048&msg_id=42794');
        return JSON.stringify({ status: r.status, ok: r.ok });
      } catch(e) {
        return JSON.stringify({ error: e.message });
      }
    })()`, true);
    log('ipc_nav_attempt', ipcNav);

    // Try to click on file in list if present
    const listClick = await js(cdp, `JSON.stringify((() => {
      const rows = [...document.querySelectorAll('[data-msg-id]')];
      const target = rows.find(r => r.dataset.msgId == '${TARGET_MSG_ID}');
      if (target) { target.click(); return { clicked: true }; }
      return { clicked: false, available: rows.length };
    })())`.replace('${TARGET_MSG_ID}', TARGET_MSG_ID));
    log('list_click', listClick);
    await sleep(2000);
    await shot(cdp, 'nav03b_ipc_attempt.png');
  }

  // ─── 7. Click/DblClick the card ───────────────────────────────────────────
  if (cardCheck?.found) {
    note(`Clicking card 42794 (isVideo=${cardCheck?.isVideo}, hasThumb=${cardCheck?.hasThumb})...`);

    // Record performance mark
    await js(cdp, `window.__clickTime = Date.now(); performance.mark('click_42794_start');`);

    // Dispatch dblclick
    const clickResult = await js(cdp, `JSON.stringify((() => {
      const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
      if (!card) return { err: 'card gone' };
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return { dispatched: true, tag: card.tagName, class: card.className.slice(0,60) };
    })())`.replace('${TARGET_MSG_ID}', TARGET_MSG_ID));
    log('click_dispatched', clickResult);

    await sleep(500);

    // Also try pointer events
    await js(cdp, `
      const card = document.querySelector('[data-msg-id="${TARGET_MSG_ID}"]');
      if (card) {
        card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      }
    `.replace('${TARGET_MSG_ID}', TARGET_MSG_ID));

    await sleep(3000);
    await shot(cdp, 'nav04_after_click.png');

    // ─── 8. Observe modal + video state ───────────────────────────────────
    note('Checking preview modal and video state...');
    const modalInfo = await js(cdp, `JSON.stringify((() => {
      const modal = document.querySelector('[class*=preview-modal],[class*=PreviewModal],[class*=drive-preview],[role=dialog]');
      const videos = [...document.querySelectorAll('video')];
      const v = videos[0];
      return {
        modalOpen: !!modal,
        modalClass: modal?.className?.slice(0,80) ?? null,
        videoCount: videos.length,
        video: v ? {
          src: (v.src ?? '').slice(0, 200),
          currentSrc: (v.currentSrc ?? '').slice(0, 200),
          readyState: v.readyState,
          readyStateText: ['HAVE_NOTHING','HAVE_METADATA','HAVE_CURRENT_DATA','HAVE_FUTURE_DATA','HAVE_ENOUGH_DATA'][v.readyState] ?? '?',
          networkState: v.networkState,
          networkStateText: ['EMPTY','IDLE','LOADING','NO_SOURCE'][v.networkState] ?? '?',
          paused: v.paused,
          duration: v.duration,
          currentTime: v.currentTime,
          buffered: v.buffered.length > 0 ? v.buffered.end(0) : 0,
          error: v.error ? { code: v.error.code, message: v.error.message } : null,
          autoplay: v.autoplay,
          loop: v.loop,
        } : null,
        visibleText: modal?.innerText?.slice(0,200)?.replace(/\\s+/g,' ') ?? null,
        filenameInModal: document.querySelector('[class*=preview] [class*=name],[class*=modal] [class*=filename],[class*=preview] h2,[class*=preview] h3')?.innerText?.slice(0,100) ?? null,
      };
    })()`);
    log('modal_state', modalInfo);

    // ─── 9. Analyze Video State ───────────────────────────────────────────
    if (modalInfo?.video) {
      const v = modalInfo.video;
      console.log('\n\x1b[1m=== VIDEO STATE for 42794 ===\x1b[0m');
      console.log(`  src:          ${v.src}`);
      console.log(`  currentSrc:   ${v.currentSrc}`);
      console.log(`  readyState:   ${v.readyState} (${v.readyStateText})`);
      console.log(`  networkState: ${v.networkState} (${v.networkStateText})`);
      console.log(`  paused:       ${v.paused}`);
      console.log(`  duration:     ${v.duration}`);
      console.log(`  error:        ${JSON.stringify(v.error)}`);

      if (v.error) err(`VIDEO ERROR: code=${v.error.code} — ${v.error.message}`);
      if (v.readyState === 0) err('VIDEO readyState=0 HAVE_NOTHING — tidak ada data sama sekali');
      if (v.networkState === 3) err('VIDEO networkState=3 NETWORK_NO_SOURCE — tidak ada sumber');
      if (v.networkState === 0) err('VIDEO networkState=0 NETWORK_EMPTY — belum dimulai');
    }

    // ─── 10. Monitor stream fetch calls ───────────────────────────────────
    await sleep(3000); // wait for stream attempts
    await shot(cdp, 'nav05_stream_observe.png');

    const streamLog = await js(cdp, `JSON.stringify(window.__streamLog ?? [])`);
    const errors = await js(cdp, `JSON.stringify(window.__testErrors ?? [])`);
    log('stream_log', streamLog);
    log('js_errors', errors);

    // ─── 11. Check IPC calls from network timing ───────────────────────────
    const ipcCalls = await js(cdp, `JSON.stringify(
      performance.getEntriesByType('resource')
        .filter(e => /42794|ipc\\.localhost|stream/i.test(e.name))
        .map(e => ({
          url: e.name.slice(0,150),
          status: e.responseStatus ?? 0,
          dur: Math.round(e.duration),
          initiator: e.initiatorType,
        }))
    )`);
    log('ipc_network', ipcCalls);

    if (Array.isArray(ipcCalls)) {
      console.log('\n\x1b[1m=== IPC/STREAM CALLS for 42794 ===\x1b[0m');
      ipcCalls.forEach(e => {
        const ok = e.status >= 200 && e.status < 300;
        const sym = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
        console.log(`  ${sym} [${e.status||'0'}] ${e.dur}ms  ${e.url}`);
      });
    }

    // ─── 12. Check if there's an error state in UI ───────────────────────
    const uiError = await js(cdp, `JSON.stringify((() => {
      const errEls = [...document.querySelectorAll('[class*=error],[class*=Error],[class*=failed],[class*=Failed]')]
        .filter(e => e.offsetParent !== null && e.innerText.trim());
      const loadEls = [...document.querySelectorAll('[class*=loading],[class*=Loading],[class*=spinner],[class*=Spinner]')]
        .filter(e => e.offsetParent !== null);
      const retryBtns = [...document.querySelectorAll('button')].filter(b => /retry|coba|ulang|reload/i.test(b.innerText));
      return {
        errorElements: errEls.map(e => ({ class: e.className.slice(0,50), text: e.innerText.slice(0,100) })),
        loadingCount: loadEls.length,
        retryButtons: retryBtns.map(b => b.innerText.slice(0,40)),
      };
    })()`);
    log('ui_error_check', uiError);

    // ─── 13. Check stream server directly ────────────────────────────────
    note('Probing stream server at :58006 directly...');
    // Get the stream key from whatever was in network calls
    let streamKey = null;
    if (Array.isArray(ipcCalls)) {
      const streamCall = ipcCalls.find(e => /stream\/g42794/.test(e.url));
      if (streamCall) {
        const m = streamCall.url.match(/stream\/(g42794[^/]+)/);
        streamKey = m?.[1];
      }
    }
    log('stream_key', { key: streamKey });

    if (streamKey) {
      const streamCheck = await js(cdp, `(async () => {
        try {
          const r = await fetch('http://127.0.0.1:58006/stream/${streamKey}/status');
          const t = await r.text().catch(() => '');
          return JSON.stringify({ status: r.status, ok: r.ok, body: t.slice(0,200) });
        } catch(e) {
          return JSON.stringify({ error: e.message });
        }
      })()`.replace('${streamKey}', streamKey), true);
      log('stream_server_status', streamCheck);

      const resumeCheck = await js(cdp, `(async () => {
        try {
          const r = await fetch('http://127.0.0.1:58006/stream/${streamKey}/resume', { method: 'POST' });
          const t = await r.text().catch(() => '');
          return JSON.stringify({ status: r.status, body: t.slice(0,200) });
        } catch(e) { return JSON.stringify({ error: e.message }); }
      })()`.replace('${streamKey}', streamKey), true);
      log('stream_resume_attempt', resumeCheck);
    }

    // ─── 14. Screenshot FINAL ─────────────────────────────────────────────
    await sleep(2000);
    await shot(cdp, 'nav06_final.png');

    // ─── 15. Close modal ──────────────────────────────────────────────────
    await cdp.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});

    // Final summary
    console.log('\n\x1b[1m╔══════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[1m║  DIRECT NAVIGATION to /-1003214112048/42794 ║\x1b[0m');
    console.log('\x1b[1m╚══════════════════════════════════════════╝\x1b[0m');
    console.log(`Modal open:      ${modalInfo?.modalOpen}`);
    console.log(`Video present:   ${modalInfo?.videoCount > 0}`);
    console.log(`Filename:        ${modalInfo?.filenameInModal ?? '(not found)'}`);
    if (modalInfo?.video) {
      const v = modalInfo.video;
      console.log(`Video readyState: ${v.readyState} (${v.readyStateText})`);
      console.log(`Video networkState: ${v.networkState} (${v.networkStateText})`);
      console.log(`Video error:     ${JSON.stringify(v.error)}`);
      console.log(`Video src:       ${v.src}`);
    }
    if (uiError?.errorElements?.length > 0) {
      console.log(`\n\x1b[31mUI Errors:\x1b[0m`);
      uiError.errorElements.forEach(e => console.log(`  - ${e.text}`));
    }
  }

  cdp.close();
  note('Done. Screenshots in: F:\\AutoGram\\remote\\reports\\screenshots\\nav0*.png');
}

main().catch(e => {
  err('FATAL: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
