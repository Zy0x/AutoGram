import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts().flatMap((c) => c.pages())[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await p.evaluate(() => { try { localStorage.setItem("lastActiveTab", "speedtest"); } catch {} });
await p.reload({ waitUntil: "domcontentloaded" });
await sleep(3500);

// pick session Lavender if select exists
const selects = p.locator("select");
const sc = await selects.count();
console.log("selects", sc);
for (let i = 0; i < sc; i++) {
  const opts = await selects.nth(i).locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: (o.textContent || "").trim() })));
  console.log("opts", i, opts);
  const lav = opts.find((o) => /lavender/i.test(o.t) || /lavender/i.test(o.v));
  if (lav) {
    await selects.nth(i).selectOption(lav.v || { label: lav.t });
    console.log("selected", lav);
    await sleep(4000);
    break;
  }
}

// open saved messages
const sm = p.locator('[data-drop-key="saved:me"]').first();
if ((await sm.count()) > 0) {
  await sm.click({ force: true });
  await sleep(2500);
}
let cards = await p.locator(".td-file-card").count();
console.log("cards after saved", cards);
if (!cards) {
  // click first chat that is not empty looking
  const chats = p.locator('[data-drop-key^="chat:"]');
  const n = await chats.count();
  for (let i = 0; i < Math.min(n, 6); i++) {
    await chats.nth(i).click({ force: true }).catch(() => {});
    await sleep(2000);
    cards = await p.locator(".td-file-card").count();
    console.log("chat", i, "cards", cards);
    if (cards > 0) break;
  }
}
console.log("final cards", cards);
console.log("ui", await p.evaluate(() => document.body.innerText.slice(0, 350)));

if (!cards) process.exit(2);

// DnD
const box = await p.locator(".td-file-card").first().boundingBox();
const sx = box.x + box.width / 2;
const sy = box.y + 40;
await p.mouse.move(sx, sy);
await p.mouse.down();
await p.mouse.move(sx + 50, sy + 40, { steps: 15 });
await sleep(200);
console.log("mid", await p.evaluate(() => ({
  ghosts: document.querySelectorAll(".td-drag-ghost").length,
  body: document.body.className,
})));

const dest = await p.evaluate(() => {
  const nodes = [...document.querySelectorAll('[data-drop-key^="drive:"], [data-drop-key^="chat:"]')];
  for (const el of nodes) {
    if (el.classList.contains("dnd-self") || el.classList.contains("active")) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue;
    return { key: el.getAttribute("data-drop-key"), x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent.trim().slice(0, 40) };
  }
  return null;
});
console.log("dest", dest);
if (dest) {
  await p.mouse.move(dest.x, dest.y, { steps: 20 });
  await sleep(250);
  console.log("hover", await p.evaluate(() => ({
    over: document.querySelector(".is-drop-over")?.getAttribute("data-drop-key"),
  })));
  await p.mouse.up();
  await sleep(1500);
  console.log("after", await p.evaluate(() => ({
    confirm: !!document.querySelector(".td-confirm-overlay"),
    text: document.querySelector(".td-confirm-overlay")?.textContent?.replace(/\s+/g, " ").slice(0, 200),
    debug: window.__lastDnDDrop || null,
    ghosts: document.querySelectorAll(".td-drag-ghost").length,
    status: document.body.innerText.match(/(Seret|Drop|batal|Siap|Pindah|lokasi|Salin|Tujuan)[^\n]{0,60}/gi),
  })));
  await p.keyboard.press("Escape").catch(() => {});
  await p.evaluate(() => document.querySelectorAll(".td-confirm-overlay button").forEach((b) => { if (/batal/i.test(b.textContent || "")) b.click(); }));
} else {
  await p.mouse.up();
}
