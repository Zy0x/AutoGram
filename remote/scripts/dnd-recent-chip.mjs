import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
await sleep(400);
const pages = b
  .contexts()
  .flatMap((c) => c.pages())
  .filter((p) => {
    try {
      const u = p.url();
      return u && !u.startsWith('blob:');
    } catch {
      return false;
    }
  });
const p = pages.find((x) => /1420/.test(x.url())) || pages[0];
if (!p) {
  console.log('NO_PAGE');
  process.exit(2);
}
await p.bringToFront().catch(() => {});

for (let i = 0; i < 40; i++) {
  const n = await p.locator('.td-file-card').count();
  if (n > 0) {
    console.log('cards', n, 'at', i);
    break;
  }
  if (i === 4) {
    await p.evaluate(() => document.querySelector('[data-drop-key="saved:me"]')?.click());
  }
  if (i === 12) {
    await p.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /Muat/i.test(b.textContent || ''))?.click();
    });
  }
  await sleep(500);
}

const cards = await p.locator('.td-file-card').count();
console.log('final cards', cards);
if (!cards) {
  console.log('FAIL_NO_CARDS');
  process.exit(2);
}

const box = await p.locator('.td-file-card').first().boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + 40);
await p.mouse.down();
await p.mouse.move(box.x + 40, box.y + 50, { steps: 12 });
await sleep(450);

const mid = await p.evaluate(() => ({
  body: document.body.className,
  dndLayout: !!document.querySelector('.is-dnd-layout'),
  virtH: document.querySelector('.td-chat-virtual')?.getBoundingClientRect().height,
  chips: [...document.querySelectorAll('.td-recent-chip')].map((el) => ({
    k: el.getAttribute('data-drop-key'),
    t: (el.textContent || '').trim().slice(0, 24),
    h: Math.round(el.getBoundingClientRect().height),
    y: Math.round(el.getBoundingClientRect().top),
  })),
  folderStackH: document.querySelector('.td-dnd-folder-stack')?.getBoundingClientRect().height,
}));
console.log('MID', JSON.stringify(mid, null, 2));

const dest = await p.evaluate(() => {
  const list = [...document.querySelectorAll('.td-recent-chip[data-drop-key]')];
  const el =
    list.find((e) => /Donghua 3D/i.test(e.textContent || '')) ||
    list.find((e) => (e.getAttribute('data-drop-key') || '').startsWith('drive:')) ||
    list.find((e) => {
      const k = e.getAttribute('data-drop-key') || '';
      return k.startsWith('chat:') || k.startsWith('drive:');
    });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    key: el.getAttribute('data-drop-key'),
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    t: (el.textContent || '').trim().slice(0, 40),
  };
});
console.log('DEST', dest);

if (!dest) {
  await p.mouse.up();
  console.log('FAIL_NO_DEST');
  process.exit(1);
}

await p.mouse.move(dest.x, dest.y, { steps: 18 });
await sleep(400);
const hover = await p.evaluate(() => ({
  over: document.querySelector('.is-drop-over')?.getAttribute('data-drop-key'),
  overText: document.querySelector('.is-drop-over')?.textContent?.trim().slice(0, 40),
  overCls: document.querySelector('.is-drop-over')?.className?.slice(0, 80),
}));
console.log('HOVER', hover);
await p.mouse.up();
await sleep(1300);

const after = await p.evaluate(() => ({
  confirm: !!document.querySelector('.td-confirm-overlay'),
  text: document.querySelector('.td-confirm-overlay')?.textContent?.replace(/\s+/g, ' ').slice(0, 180),
  last: window.__lastDnDDrop,
  body: document.body.className,
  ghosts: document.querySelectorAll('.td-drag-ghost').length,
}));
console.log('AFTER', JSON.stringify(after, null, 2));

const ok =
  after.confirm &&
  after.last?.key &&
  after.last.key === dest.key &&
  after.last.key !== 'saved:me';
console.log(ok ? 'PASS_RECENT_DROP' : 'FAIL_RECENT_DROP');
await p.keyboard.press('Escape').catch(() => {});
process.exit(ok ? 0 : 1);
