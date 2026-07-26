/**
 * Test: Media /-1003214112048/42794
 * CDP via native ws — connect to FRONTEND.EXE WebView2 on [::1]:9222
 * (NOT GoogleDriveFS which hijacks 127.0.0.1:9222)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const TARGET_CHAT_ID = -1003214112048;
const TARGET_MSG_ID  = 42794;
// Frontend WebView2 listens on IPv6 [::1]:9222 (GoogleDriveFS hijacks 127.0.0.1:9222)
const CDP_HOST  = '::1';
const CDP_PORT  = 9222;
const OUT       = 'F:/AutoGram/remote/reports';
fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });

const bugs  = [];
const steps = [];

function ts() { return new Date().toISOString(); }
function log(name, data = {}) {
  const e = { name, ts: ts(), ...data };
  steps.push(e);
  const json = JSON.stringify(data);
  console.log('[TEST]', name, json.length > 400 ? json.slice(0, 400) + '…' : json);
}
function bug(id, desc, detail = {}) {
  bugs.push({ id, desc, detail, ts: ts() });
  console.error('\x1b[31m[BUG]\x1b[0m', id, desc);
}

// ─── HTTP helper (supports IPv6) ─────────────────────────────────────────────
function httpGet(host, port, urlPath) {
  return new Promise((resolve, reject) => {
    const options = { hostname: host, port, path: urlPath };
    http.get(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

// ─── CDP WebSocket helper ─────────────────────────────────────────────────────
function cdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = {};

    ws.on('open', () => {
      const session = {
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = msgId++;
            pending[id] = { res, rej };
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
              if (pending[id]) {
                delete pending[id];
                rej(new Error(`CDP timeout: ${method}`));
              }
            }, 10000);
          });
        },
        close() { try { ws.close(); } catch {} }
      };
      resolve(session);
    });

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.id && pending[msg.id]) {
          const { res, rej } = pending[msg.id];
          delete pending[msg.id];
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        }
      } catch {}
    });

    ws.on('error', reject);
    setTimeout(() => reject(new Error('CDP WS connect timeout')), 5000);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function takeScreenshot(cdp, filename) {
  try {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (r?.data) {
      fs.writeFileSync(path.join(OUT, 'screenshots', filename), Buffer.from(r.data, 'base64'));
      log('screenshot', { file: filename });
      return true;
    }
  } catch (e) { log('screenshot_fail', { file: filename, err: e.message }); }
  return false;
}

async function evalJSON(cdp, expression, awaitPromise = false) {
  try {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      timeout: awaitPromise ? 15000 : 5000,
    });
    const val = r?.result?.value;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  } catch (e) {
    return { _evalError: e.message };
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  log('start', { target: `/-1003214112048/42794`, chatId: TARGET_CHAT_ID, msgId: TARGET_MSG_ID });

  // 1. Get CDP targets from IPv6
  let targets;
  try {
    const r = await httpGet(CDP_HOST, CDP_PORT, '/json');
    targets = JSON.parse(r.body);
    log('cdp_targets', {
      count: targets.length,
      targets: targets.map(t => ({ type: t.type, title: t.title, url: (t.url ?? '').slice(0, 80) }))
    });
  } catch (e) {
    bug('CDP_001', 'Gagal koneksi ke CDP [::1]:9222', { error: e.message });
    return writeReport();
  }

  // 2. Find page target (AutoGram Tauri frontend)
  const pageTarget = targets.find(t => t.type === 'page' && /localhost:1420|tauri|autogram/i.test(t.url ?? ''))
    ?? targets.find(t => t.type === 'page')
    ?? targets[0];

  if (!pageTarget) {
    bug('CDP_002', 'Tidak ada CDP page target untuk frontend AutoGram', { targets: targets.map(t => t.url) });
    return writeReport();
  }
  log('selected_target', { title: pageTarget.title, url: pageTarget.url });

  // 3. Connect CDP WS
  let cdp;
  try {
    cdp = await cdpSession(pageTarget.webSocketDebuggerUrl);
    log('cdp_connected', { ws: pageTarget.webSocketDebuggerUrl });
  } catch (e) {
    bug('CDP_003', 'Gagal koneksi CDP WebSocket ke frontend', { error: e.message, ws: pageTarget.webSocketDebuggerUrl });
    return writeReport();
  }

  // 4. Enable domains
  await cdp.send('Runtime.enable').catch(() => {});
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('DOM.enable').catch(() => {});

  // ─── SCREENSHOT 1: Initial State ──────────────────────────────────────────
  await takeScreenshot(cdp, '01_initial.png');

  // 5. Get URL + page info
  const pageInfo = await evalJSON(cdp, `JSON.stringify({ url: location.href, pathname: location.pathname, title: document.title })`);
  log('page_info', pageInfo);

  // 6. Get body text
  const bodyText = await evalJSON(cdp, `document.body?.innerText?.slice(0, 3000).replace(/\\s+/g,' ') ?? ''`);
  log('body_text', { length: String(bodyText).length, sample: String(bodyText).slice(0, 400) });

  const hasChromeError = /can't reach|ERR_CONNECTION|This site can't be reached/i.test(String(bodyText));
  if (hasChromeError) {
    bug('PAGE_001', 'Halaman menampilkan chrome error — Vite dev server tidak running', { body: String(bodyText).slice(0, 200) });
  }

  const hasAppContent = /AutoGram|Drive|Gudang|Media|Session|Settings|Pengaturan|Tauri/i.test(String(bodyText));
  log('has_app_content', { result: hasAppContent });

  // 7. Check __TAURI__ IPC
  const tauriInfo = await evalJSON(cdp, `JSON.stringify({
    hasTauri: typeof window.__TAURI__ !== 'undefined',
    keys: typeof window.__TAURI__ !== 'undefined' ? Object.keys(window.__TAURI__) : [],
    hasInvoke: typeof window.__TAURI__?.invoke === 'function',
    hasCoreInvoke: typeof window.__TAURI__?.core?.invoke === 'function',
  })`);
  log('tauri_ipc', tauriInfo);

  if (!tauriInfo?.hasTauri) {
    bug('IPC_001', '__TAURI__ tidak tersedia di window — Tauri IPC tidak dapat digunakan', tauriInfo ?? {});
  }

  // 8. Service Worker status
  const swStatus = await evalJSON(cdp, `JSON.stringify({
    swRegistered: 'serviceWorker' in navigator,
    swState: navigator.serviceWorker?.controller?.state ?? null,
    swScriptURL: navigator.serviceWorker?.controller?.scriptURL ?? null,
  })`);
  log('service_worker', swStatus);

  // 9. Try to navigate to Drive/Gudang section
  log('nav_drive_attempt', {});
  const navResult = await evalJSON(cdp, `
    (function() {
      const btns = [...document.querySelectorAll('button, a, [role=button], [class*=sidebar],[class*=Sidebar],[class*=nav],[class*=Nav]')];
      const allTexts = btns.map(b => b.innerText?.trim().slice(0,40)).filter(Boolean);
      const target = btns.find(b => /Gudang|Drive|Media Studio|Media|Studio/i.test(b.innerText ?? ''));
      if (target) {
        target.click();
        return JSON.stringify({ clicked: true, text: target.innerText.slice(0,40), tag: target.tagName });
      }
      return JSON.stringify({ clicked: false, availableTexts: allTexts.slice(0, 20) });
    })()
  `);
  log('nav_result', navResult);

  if (!navResult?.clicked) {
    bug('NAV_001', 'Tidak ada tombol/nav untuk Drive/Gudang/Media Studio ditemukan', {
      availableTexts: navResult?.availableTexts
    });
  }

  await sleep(3000);
  await takeScreenshot(cdp, '02_after_nav.png');

  // 10. Analyze drive content
  const driveState = await evalJSON(cdp, `JSON.stringify({
    bodySnip: document.body.innerText.slice(0,1000).replace(/\\s+/g,' '),
    chatRowCount: document.querySelectorAll('[class*=chat-row],[class*=ChatRow],[class*=td-chat-row]').length,
    fileCardCount: document.querySelectorAll('[class*=file-card],[class*=FileCard],[class*=td-file-card],[class*=media-item]').length,
    modalCount: document.querySelectorAll('[class*=modal],[class*=Modal],[role=dialog]').length,
    imgCount: document.querySelectorAll('img[src^=data],[img src^=blob]').length,
    allClasses: [...new Set([...document.querySelectorAll('[class]')].map(e=>e.className.split(' ')[0]))].slice(0,40),
  })`);
  log('drive_state', driveState);

  if (driveState?.chatRowCount === 0 && driveState?.fileCardCount === 0) {
    bug('DRIVE_001', 'Tidak ada chat row maupun file card yang tampil di Drive/Gudang view', {
      bodySnip: driveState?.bodySnip?.slice(0, 300),
    });
  }

  // 11. Try IPC calls for target media
  if (tauriInfo?.hasTauri) {
    const ipcResult = await evalJSON(cdp, `(async () => {
      const invoke = window.__TAURI__?.invoke ?? window.__TAURI__?.core?.invoke;
      if (!invoke) return JSON.stringify({ error: 'no invoke fn' });
      
      const chatId = ${TARGET_CHAT_ID};
      const msgId = ${TARGET_MSG_ID};
      const results = {};
      
      // Test IPC commands relevant to media retrieval
      const cmds = [
        { name: 'get_media_thumb', args: { chat_id: chatId, message_id: msgId } },
        { name: 'get_file_thumb',  args: { chat_id: chatId, message_id: msgId } },
        { name: 'stream_media',    args: { chat_id: chatId, message_id: msgId } },
        { name: 'get_media_url',   args: { chat_id: chatId, message_id: msgId } },
        { name: 'list_chats',      args: {} },
        { name: 'list_drives',     args: {} },
        { name: 'get_sessions',    args: {} },
      ];
      
      for (const { name, args } of cmds) {
        try {
          const r = await invoke(name, args);
          const s = typeof r === 'string' ? r : JSON.stringify(r);
          results[name] = { ok: true, type: typeof r, snippet: s.slice(0, 120) };
        } catch(e) {
          results[name] = { ok: false, err: String(e).slice(0, 150) };
        }
      }
      return JSON.stringify(results);
    })()`, true);
    log('ipc_media_test', ipcResult);

    if (ipcResult && !ipcResult._evalError) {
      for (const [cmd, res] of Object.entries(ipcResult)) {
        if (res.ok) {
          log('ipc_ok', { cmd, snippet: res.snippet });
        } else {
          // Only flag as bug if error is not "unknown command"
          if (!/Unknown|unknown|not found|invalid plugin|no command|No such/i.test(res.err ?? '')) {
            bug('IPC_002', `IPC '${cmd}' gagal dengan error yang tidak diharapkan`, { cmd, error: res.err });
          } else {
            log('ipc_cmd_not_found', { cmd, err: res.err });
          }
        }
      }
    }
  }

  // 12. Try clicking first file card
  const cardInfo = await evalJSON(cdp, `JSON.stringify({
    count: document.querySelectorAll('[class*=file-card],[class*=FileCard],[class*=td-file-card]').length,
    first: (() => {
      const el = document.querySelector('[class*=file-card],[class*=FileCard],[class*=td-file-card]');
      if (!el) return null;
      return {
        className: el.className.slice(0,80),
        dataAttrs: [...el.attributes].filter(a=>a.name.startsWith('data-')).map(a=>a.name+'='+a.value).join(', '),
        hasImg: !!el.querySelector('img'),
        imgSrc: (el.querySelector('img')?.src ?? '').slice(0, 100),
      };
    })(),
  })`);
  log('file_cards', cardInfo);

  if (cardInfo?.count > 0) {
    // dblclick first card
    await evalJSON(cdp, `
      (() => {
        const card = document.querySelector('[class*=file-card],[class*=FileCard],[class*=td-file-card]');
        if (card) {
          card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      })()
    `);
    await sleep(3500);
    await takeScreenshot(cdp, '03_after_card_click.png');

    // Check preview modal
    const modalState = await evalJSON(cdp, `JSON.stringify({
      modals: document.querySelectorAll('[class*=modal],[class*=Modal],[role=dialog]').length,
      previews: document.querySelectorAll('[class*=preview],[class*=Preview]').length,
      videos: document.querySelectorAll('video').length,
      images: document.querySelectorAll('[class*=modal] img,[class*=preview] img,[role=dialog] img').length,
      video: (() => {
        const v = document.querySelector('video');
        if (!v) return null;
        return {
          src: (v.src ?? '').slice(0,150),
          currentSrc: (v.currentSrc ?? '').slice(0,150),
          readyState: v.readyState,
          networkState: v.networkState,
          paused: v.paused,
          duration: v.duration,
          error: v.error ? { code: v.error.code, msg: v.error.message } : null,
        };
      })(),
    })`);
    log('modal_state', modalState);

    if (!modalState?.modals && !modalState?.previews) {
      bug('PREVIEW_001', 'Klik pada file card tidak membuka preview modal', { cardCount: cardInfo.count });
    }
    if (modalState?.videos > 0) {
      const v = modalState.video;
      if (v?.readyState === 0) bug('VIDEO_001', 'Video readyState=0 HAVE_NOTHING — stream tidak dimulai', v);
      if (v?.networkState === 3) bug('VIDEO_002', 'Video networkState=3 NETWORK_NO_SOURCE — tidak ada sumber media', v);
      if (v?.error) bug('VIDEO_003', `Video MediaError code=${v.error.code}: ${v.error.msg}`, v);
      if (!v?.src && !v?.currentSrc) bug('VIDEO_004', 'Video elemen ada tapi src kosong', v);
      if (v?.paused && v?.readyState >= 3) log('video_loaded_paused', { readyState: v.readyState });
    }
    if (modalState?.modals > 0 && modalState?.videos === 0 && modalState?.images === 0) {
      bug('PREVIEW_002', 'Modal terbuka tapi tidak ada video atau gambar — mungkin loading error', modalState);
    }

    // Close modal
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await sleep(500);
  } else {
    log('no_file_cards', { note: 'Tidak ada file card untuk di-preview' });
  }

  // 13. Check network requests (performance API)
  const netReqs = await evalJSON(cdp, `JSON.stringify(
    performance.getEntriesByType('resource')
      .filter(e => /stream|thumb|media|tauri|1420/i.test(e.name))
      .map(e => ({ name: e.name.slice(0,130), status: e.responseStatus ?? 0, dur: Math.round(e.duration) }))
      .slice(-30)
  )`);
  log('network_media_requests', { count: Array.isArray(netReqs) ? netReqs.length : 0, entries: netReqs });

  if (Array.isArray(netReqs)) {
    const failed = netReqs.filter(e => e.status >= 400 || (e.status === 0 && e.dur < 5));
    if (failed.length > 0) {
      bug('NET_001', `${failed.length} request media gagal (status>=400 atau timeout)`, { failed });
    }
  }

  // 14. React/UI framework state
  const reactRoot = await evalJSON(cdp, `JSON.stringify((() => {
    const root = document.querySelector('#root,#app,[data-reactroot]');
    if (!root) return { found: false };
    const fKey = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    const hasReact = !!fKey;
    // check for error boundary
    const errDiv = [...document.querySelectorAll('[class*=error],[class*=Error]')].map(e => e.innerText.slice(0,100));
    return { found: true, hasReact, errorElements: errDiv.slice(0,5) };
  })()`);
  log('react_root', reactRoot);

  if (reactRoot?.errorElements?.length > 0) {
    bug('UI_001', 'Terdapat elemen error boundary / error text di halaman', { errors: reactRoot.errorElements });
  }

  // 15. Check for specific media path routing
  log('routing_check', {});
  const routeTest = await evalJSON(cdp, `JSON.stringify((() => {
    // Check if URL-based routing exists for the target path
    const hasRouter = !!(window.__reactRouterContext || window.__reactRouterHydrationData || document.querySelector('[data-router]'));
    const currentHash = location.hash;
    const currentSearch = location.search;
    const currentPath = location.pathname;
    return { hasRouter, currentHash, currentSearch, currentPath };
  })()`);
  log('route_info', routeTest);

  // 16. Attempt to navigate to specific chat in app via JS
  log('try_navigate_chat', { chatId: TARGET_CHAT_ID, msgId: TARGET_MSG_ID });
  const navigateResult = await evalJSON(cdp, `(async () => {
    // Try Tauri invoke for navigation
    try {
      const invoke = window.__TAURI__?.invoke ?? window.__TAURI__?.core?.invoke;
      if (!invoke) return JSON.stringify({ error: 'no invoke' });
      
      // Try to load/open the specific chat
      const navCmds = [
        { name: 'open_chat', args: { chat_id: ${TARGET_CHAT_ID} } },
        { name: 'select_chat', args: { chat_id: ${TARGET_CHAT_ID} } },
        { name: 'navigate_to_message', args: { chat_id: ${TARGET_CHAT_ID}, message_id: ${TARGET_MSG_ID} } },
      ];
      
      const res = {};
      for (const { name, args } of navCmds) {
        try {
          const r = await invoke(name, args);
          res[name] = { ok: true, r: String(r).slice(0, 100) };
        } catch(e) {
          res[name] = { ok: false, err: String(e).slice(0, 100) };
        }
      }
      return JSON.stringify(res);
    } catch(e) { return JSON.stringify({ error: e.message }); }
  })()`, true);
  log('navigate_result', navigateResult);

  await sleep(2000);
  await takeScreenshot(cdp, '04_final.png');

  // 17. Final console error check
  const domErrorCheck = await evalJSON(cdp, `JSON.stringify({
    errorDivs: [...document.querySelectorAll('[class*=error],[class*=Error],[class*=warning],[class*=Warning]')]
      .filter(e => e.innerText.trim().length > 0)
      .map(e => ({ class: e.className.slice(0,50), text: e.innerText.slice(0,100) }))
      .slice(0, 10),
    loadingDivs: [...document.querySelectorAll('[class*=loading],[class*=Loading],[class*=spinner],[class*=Spinner]')]
      .filter(e => e.offsetParent !== null)
      .length,
  })`);
  log('dom_errors', domErrorCheck);

  if (domErrorCheck?.errorDivs?.length > 0) {
    bug('UI_002', `Ada ${domErrorCheck.errorDivs.length} elemen error/warning yang terlihat di DOM`, { errors: domErrorCheck.errorDivs });
  }
  if (domErrorCheck?.loadingDivs > 0) {
    bug('UI_003', `Ada ${domErrorCheck.loadingDivs} elemen loading/spinner yang masih tampil — mungkin infinite loading`, {});
  }

  cdp.close();
  writeReport();
}

function writeReport() {
  const report = {
    target: { path: '/-1003214112048/42794', chatId: TARGET_CHAT_ID, msgId: TARGET_MSG_ID },
    generatedAt: ts(),
    bugsFound: bugs.length,
    bugs,
    steps,
  };
  const p = path.join(OUT, 'media_bug_report.json');
  fs.writeFileSync(p, JSON.stringify(report, null, 2));

  console.log('\n\x1b[1m══════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m  BUG REPORT — /-1003214112048/42794\x1b[0m');
  console.log('\x1b[1m══════════════════════════════════════════════\x1b[0m');
  console.log(`Bugs found: \x1b[${bugs.length > 0 ? '31' : '32'}m${bugs.length}\x1b[0m`);
  bugs.forEach((b, i) => {
    console.log(`\n  \x1b[31m[BUG ${i+1}] ${b.id}\x1b[0m`);
    console.log(`  Desc: ${b.desc}`);
    const det = JSON.stringify(b.detail);
    if (det.length < 300) console.log(`  Detail: ${det}`);
  });
  console.log(`\nReport: ${p}`);
  console.log(`Screenshots: F:\\AutoGram\\remote\\reports\\screenshots\\`);
}

main().catch(e => {
  bug('FATAL', e.message, { stack: e.stack?.slice(0, 500) });
  writeReport();
  process.exit(1);
});
