import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const MSG_ID = 34404;
const OUT = "F:/AutoGram/remote/reports";
fs.mkdirSync(path.join(OUT, "screenshots"), { recursive: true });

function ts() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const note = msg => console.log("[" + ts() + "] >>>", msg);
const ok   = msg => console.log("[" + ts() + "] OK ", msg);
const warn = msg => console.log("[" + ts() + "] !  ", msg);
const errL = msg => console.error("[" + ts() + "] X  ", msg);
const log  = (tag, d) => console.log("[" + tag + "]", d == null ? "null" : JSON.stringify(d).slice(0, 400));

function httpGet(host, port, p) {
  return new Promise((res, rej) => {
    http.get({ hostname: host, port, path: p }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(d)); }).on("error", rej);
  });
}

function openCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 1; const q = {};
    ws.on("open", () => resolve({
      cmd(m, p = {}) {
        return new Promise((res, rej) => {
          const i = id++; q[i] = { res, rej };
          ws.send(JSON.stringify({ id: i, method: m, params: p }));
          setTimeout(() => { if (q[i]) { delete q[i]; rej(new Error("timeout: " + m)); } }, 15000);
        });
      },
      close() { try { ws.close(); } catch {} }
    }));
    ws.on("message", raw => {
      try {
        const m = JSON.parse(raw);
        if (m.id && q[m.id]) { const { res, rej } = q[m.id]; delete q[m.id]; m.error ? rej(new Error(m.error.message)) : res(m.result); }
      } catch {}
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("ws timeout")), 5000);
  });
}

async function shot(cdp, name) {
  try {
    const r = await cdp.cmd("Page.captureScreenshot", { format: "png", quality: 85 });
    if (r?.data) { fs.writeFileSync(path.join(OUT, "screenshots", name), Buffer.from(r.data, "base64")); note("Screenshot: " + name); }
  } catch (e) { warn("Screenshot: " + e.message); }
}

async function js(cdp, expr, awaitP = false) {
  try {
    const r = await cdp.cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: awaitP, timeout: awaitP ? 20000 : 8000 });
    const v = r?.result?.value;
    if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } }
    return v;
  } catch (e) { return { _err: e.message }; }
}

async function videoState(cdp) {
  return js(cdp, 'JSON.stringify((() => { const v = document.querySelector("video"); if (!v) return { hasVideo: false }; const buf = v.buffered; const ranges = []; for (let i = 0; i < buf.length; i++) ranges.push([+buf.start(i).toFixed(2), +buf.end(i).toFixed(2)]); const bs = ranges.reduce((s, [a, b]) => s + (b - a), 0); const dur = v.duration; const bp = dur > 0 && isFinite(dur) ? +(bs / dur * 100).toFixed(1) : null; return { hasVideo: true, readyState: v.readyState, paused: v.paused, currentTime: +v.currentTime.toFixed(2), duration: isFinite(dur) ? +dur.toFixed(2) : null, bufferedSec: +bs.toFixed(2), bufPct: bp, networkState: v.networkState, error: v.error ? { code: v.error.code, msg: v.error.message } : null }; })())');
}

async function main() {
  note("=== Remote Test: Media " + MSG_ID + " ===");
  const raw = await httpGet("::1", 9222, "/json");
  const targets = JSON.parse(raw);
  const page = targets.find(t => t.type === "page" && /localhost:1420|tauri/i.test(t.url)) ?? targets.find(t => t.type === "page");
  if (!page) { errL("No page"); process.exit(1); }
  ok("Connected: " + page.title);

  const cdp = await openCDP(page.webSocketDebuggerUrl);
  await cdp.cmd("Runtime.enable").catch(() => {});
  await cdp.cmd("Page.enable").catch(() => {});

  await shot(cdp, "01_start.png");

  // Click Batal to clear selection mode
  note("Clearing selection mode via Batal...");
  const batal = await js(cdp, 'JSON.stringify((() => { const b = [...document.querySelectorAll("button,[role=button]")].find(b => /batal|cancel/i.test(b.innerText || b.textContent || "")); if (b) { b.click(); return { ok: true, text: b.innerText }; } return { found: false }; })())');
  log("batal", batal ?? null);
  await sleep(600);
  await shot(cdp, "02_after_batal.png");

  // Scroll to find card if needed
  let coords = await js(cdp, 'JSON.stringify((() => { const c = document.querySelector("[data-msg-id=\"' + MSG_ID + '\"]"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())');
  log("coords1", coords ?? null);

  if (!coords || coords._err) {
    note("Card not in DOM, scrolling...");
    await js(cdp, '(async () => { const g = document.querySelector("[class*=drive-content],[class*=DriveContent],[class*=main-content],main,[role=main]"); if (!g) return; for (let i = 0; i < 80; i++) { if (document.querySelector("[data-msg-id=\"' + MSG_ID + '\"]")) break; g.scrollBy(0, 400); await new Promise(r => setTimeout(r, 100)); } })();', true);
    await sleep(800);
    coords = await js(cdp, 'JSON.stringify((() => { const c = document.querySelector("[data-msg-id=\"' + MSG_ID + '\"]"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())');
    log("coords2", coords ?? null);
  }

  // CDP mouse click (bypasses React selection state)
  const t_click = Date.now();
  if (coords && coords.x) {
    note("CDP mouse click at (" + Math.round(coords.x) + ", " + Math.round(coords.y) + ")");
    await cdp.cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
    await sleep(50);
    await cdp.cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
  } else {
    warn("No coords — fallback JS click");
    await js(cdp, '(() => { const c = document.querySelector("[data-msg-id=\"' + MSG_ID + '\"]"); if (c) c.click(); })()');
  }

  // Detect modal
  let modalMs = null;
  for (let i = 0; i < 30; i++) {
    await sleep(150);
    const has = await js(cdp, '!!(document.querySelector("[class*=modal],[class*=Modal],[class*=preview],[class*=Preview],[role=dialog]") || document.querySelector("video"))');
    if (has) { modalMs = Date.now() - t_click; ok("Modal in " + modalMs + "ms"); break; }
  }
  if (!modalMs) warn("No modal in 4.5s");
  await shot(cdp, "03_modal.png");

  let videoMs = null;
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    const has = await js(cdp, '!!document.querySelector("video")');
    if (has) { videoMs = Date.now() - t_click; ok("Video element in " + videoMs + "ms"); break; }
  }
  if (!videoMs) warn("No video within 8s");

  // 30s monitoring
  note("=== 30s monitoring ===");
  const snaps = [];
  let firstBufMs = null, playMs = null, lastSt = null;

  for (let tick = 0; tick < 60; tick++) {
    await sleep(500);
    const st = await videoState(cdp);
    if (!st?.hasVideo) continue;
    const elapsed = ((Date.now() - t_click) / 1000).toFixed(1);
    if (st.bufPct > 0 && firstBufMs === null) { firstBufMs = Date.now() - t_click; ok("First buffer " + firstBufMs + "ms = " + st.bufPct + "%"); }
    if (!st.paused && playMs === null) { playMs = Date.now() - t_click; ok("PLAYING at " + playMs + "ms, ct=" + st.currentTime + "s"); }
    if (tick % 4 === 0) note("t+" + elapsed + "s | " + (st.paused ? "PAUSED" : "PLAYING@" + st.currentTime + "s") + " | buf=" + (st.bufPct ?? "?") + "% (" + st.bufferedSec + "s/" + (st.duration ?? "?") + "s) rs=" + st.readyState);
    snaps.push({ t: +elapsed, ...st });
    lastSt = st;
    if (tick === 5) await shot(cdp, "04_2s5.png");
    if (tick === 19) await shot(cdp, "05_10s.png");
    if (tick === 39) await shot(cdp, "06_20s.png");
    if (st.error) { errL("Video error: " + JSON.stringify(st.error)); break; }
  }
  await shot(cdp, "07_final.png");

  console.log("");
  console.log("=".repeat(55));
  console.log("  HASIL REMOTE TEST: Media " + MSG_ID);
  console.log("=".repeat(55));
  console.log("  Modal            :", modalMs != null ? "YES " + modalMs + "ms" : "NO");
  console.log("  Video element    :", videoMs != null ? "YES " + videoMs + "ms" : "NO");
  console.log("  First buffer     :", firstBufMs != null ? firstBufMs + "ms" : "NOT DETECTED");
  console.log("  Playback started :", playMs != null ? "YES at " + playMs + "ms" : "NO");
  if (lastSt?.duration && lastSt.duration > 0) {
    const dlPct = (lastSt.bufferedSec / lastSt.duration * 100).toFixed(1);
    console.log("  Downloaded       :", lastSt.bufferedSec + "s of " + lastSt.duration + "s (" + dlPct + "%)");
    if (+dlPct < 20) ok("  PROGRESSIVE OK: <20% = instant streaming confirmed!");
    else warn("  HIGH: " + dlPct + "% buffered");
  }
  console.log("=".repeat(55));

  const rp = path.join(OUT, "test_34404_report.json");
  fs.writeFileSync(rp, JSON.stringify({ timing: { modalMs, videoMs, firstBufMs, playMs }, finalState: lastSt, snaps: snaps.slice(-5) }, null, 2));
  note("Report: " + rp);
  cdp.close();
}

main().catch(e => { errL(e.message); process.exit(1); });
