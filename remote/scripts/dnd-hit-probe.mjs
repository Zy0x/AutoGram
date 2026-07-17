import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
await sleep(300);
const p =
  b
    .contexts()
    .flatMap((c) => c.pages())
    .find((x) => /1420/.test(x.url())) || b.contexts().flatMap((c) => c.pages())[0];

const box = await p.locator('.td-file-card').first().boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + 40);
await p.mouse.down();
await p.mouse.move(box.x + 40, box.y + 50, { steps: 10 });
await sleep(350);

const dest = await p.evaluate(() => {
  const list = [...document.querySelectorAll('.td-recent-chip[data-drop-key]')];
  const el =
    list.find((e) => /Donghua 3D/i.test(e.textContent || '')) ||
    list.find((e) => (e.getAttribute('data-drop-key') || '').startsWith('drive:'));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    key: el.getAttribute('data-drop-key'),
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    r: { t: r.top, b: r.bottom, l: r.left, w: r.width, h: r.height },
  };
});
console.log('DEST', dest);
await p.mouse.move(dest.x, dest.y, { steps: 14 });
await sleep(250);

const probe = await p.evaluate(({ x, y, key }) => {
  const stack = document.elementsFromPoint(x, y).slice(0, 15).map((el) => ({
    tag: el.tagName,
    cls: (el.className || '').toString().slice(0, 80),
    key: el.getAttribute?.('data-drop-key'),
    pe: getComputedStyle(el).pointerEvents,
  }));
  const geom = [];
  for (const n of document.querySelectorAll('[data-drop-key]')) {
    const r = n.getBoundingClientRect();
    if (x >= r.left - 14 && x <= r.right + 14 && y >= r.top - 14 && y <= r.bottom + 14) {
      geom.push({
        key: n.getAttribute('data-drop-key'),
        t: Math.round(r.top),
        h: Math.round(r.height),
        w: Math.round(r.width),
        pe: getComputedStyle(n).pointerEvents,
      });
    }
  }
  const chip = document.querySelector(`[data-drop-key="${key}"]`);
  const parents = [];
  let el = chip;
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    const rr = el.getBoundingClientRect();
    parents.push({
      tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 50),
      oy: s.overflowY,
      pe: s.pointerEvents,
      t: Math.round(rr.top),
      b: Math.round(rr.bottom),
      h: Math.round(rr.height),
    });
    el = el.parentElement;
  }
  return {
    stack,
    geom,
    over: document.querySelector('.is-drop-over')?.getAttribute('data-drop-key'),
    parents: parents.slice(0, 12),
  };
}, { x: dest.x, y: dest.y, key: dest.key });

console.log(JSON.stringify(probe, null, 2));
await p.mouse.up();
process.exit(0);
