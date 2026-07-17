/**
 * Reproduce user scenario: drag file onto sidebar (recents / bottom chats).
 * Logs geometry of drop keys, hover during drag, and confirm result.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');

const b = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const p = b.contexts().flatMap((c) => c.pages())[0];
if (!p) {
  console.log(JSON.stringify({ fatal: 'NO_PAGE' }));
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (label, data) => console.log(label, JSON.stringify(data, null, 2));

await p.bringToFront().catch(() => {});
await p.evaluate(() => {
  try {
    localStorage.setItem('lastActiveTab', 'speedtest');
  } catch {}
});

// Soft ensure Media Studio
if ((await p.locator('.td-shell').count()) < 1) {
  await p.goto('http://localhost:1420/?dnd=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });
  await sleep(4500);
}

await p.keyboard.press('Escape').catch(() => {});
await p.evaluate(() => {
  document.querySelectorAll('.td-confirm-overlay button').forEach((b) => {
    if (/batal|tutup/i.test(b.textContent || '')) b.click();
  });
});
await sleep(200);

// Expand rail
await p.evaluate(() => {
  document.querySelector('.td-sidebar.is-collapsed .td-rail-brand-toggle')?.click();
});
await sleep(200);

const layoutBefore = await p.evaluate(() => {
  const qa = (s) => [...document.querySelectorAll(s)];
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      h: Math.round(r.height),
      w: Math.round(r.width),
      left: Math.round(r.left),
    };
  };
  return {
    url: location.href,
    cards: qa('.td-file-card').length,
    body: document.body.className,
    sidebar: box(q('.td-sidebar')),
    nav: box(q('.td-folder-nav')),
    virt: box(q('.td-chat-virtual')),
    recents: qa('.td-recent-chip, [data-drop-key].td-recent-chip').map((el) => ({
      key: el.getAttribute('data-drop-key'),
      text: (el.textContent || '').trim().slice(0, 40),
      ...box(el),
      cls: el.className.slice(0, 80),
    })),
    dropKeys: qa('[data-drop-key]').map((el) => ({
      key: el.getAttribute('data-drop-key'),
      ...box(el),
      invalid: el.getAttribute('data-drop-invalid'),
    })),
    chatsOpen: q('.td-section-toggle:last-of-type')?.getAttribute('aria-expanded'),
    sections: qa('.td-section-toggle').map((el) => ({
      t: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36),
      exp: el.getAttribute('aria-expanded'),
    })),
  };
});
log('LAYOUT_BEFORE', layoutBefore);

const cards = layoutBefore.cards;
if (!cards) {
  // click saved + muat
  await p.evaluate(() => {
    document.querySelector('[data-drop-key="saved:me"]')?.click();
  });
  await sleep(2500);
}

const cardBox = await p.locator('.td-file-card').first().boundingBox();
if (!cardBox) {
  log('FATAL', { msg: 'no card box' });
  process.exit(2);
}

// Start drag
const sx = cardBox.x + cardBox.width / 2;
const sy = cardBox.y + 40;
await p.mouse.move(sx, sy);
await p.mouse.down();
await p.mouse.move(sx + 30, sy + 25, { steps: 10 });
await sleep(250);

const mid = await p.evaluate(() => ({
  body: document.body.className,
  ghosts: document.querySelectorAll('.td-drag-ghost').length,
  dndLayout: !!document.querySelector('.td-folder-nav.is-dnd-layout'),
  virtH: document.querySelector('.td-chat-virtual')?.getBoundingClientRect().height,
  recentKeys: [...document.querySelectorAll('.td-recent-chip')].map((el) =>
    el.getAttribute('data-drop-key')
  ),
  dropKeyCount: document.querySelectorAll('[data-drop-key]').length,
}));
log('MID_DRAG', mid);

// Target: first recent chip that is NOT saved:me (same location cancel)
// or a drive/chat drop key visible in sidebar
const dest = await p.evaluate(() => {
  const pick = (sel) => {
    for (const el of document.querySelectorAll(sel)) {
      if (el.classList.contains('active') || el.classList.contains('dnd-self')) continue;
      if (el.getAttribute('data-drop-invalid') === '1') continue;
      const key = el.getAttribute('data-drop-key');
      if (!key || key === 'saved:me') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 6 || r.width < 6) continue;
      // visible roughly
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      return {
        key,
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        top: r.top,
        bottom: r.bottom,
        h: r.height,
        cls: el.className.slice(0, 60),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      };
    }
    return null;
  };
  return (
    pick('.td-recent-chip[data-drop-key]') ||
    pick('[data-drop-key^="drive:"]') ||
    pick('[data-drop-key^="chat:"]')
  );
});
log('DEST', dest);

if (!dest) {
  await p.mouse.up();
  log('FAIL', { msg: 'no dest' });
  process.exit(1);
}

// Move to dest slowly
await p.mouse.move(dest.x, dest.y, { steps: 20 });
await sleep(300);

// Re-snap live
const live = await p.evaluate((key) => {
  const el = document.querySelector(`[data-drop-key="${key}"]`);
  if (!el) return { missing: true };
  const r = el.getBoundingClientRect();
  const over = document.querySelector('.is-drop-over')?.getAttribute('data-drop-key');
  const pad = 14;
  const hits = [];
  for (const node of document.querySelectorAll('[data-drop-key]')) {
    const rr = node.getBoundingClientRect();
    if (
      r.x + r.width / 2 >= rr.left - pad &&
      r.x + r.width / 2 <= rr.right + pad &&
      r.y + r.height / 2 >= rr.top - pad &&
      r.y + r.height / 2 <= rr.bottom + pad
    ) {
      hits.push(node.getAttribute('data-drop-key'));
    }
  }
  return {
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    over,
    hits,
    key,
    cls: el.className,
  };
}, dest.key);
log('HOVER', live);

if (live.x && live.y) {
  await p.mouse.move(live.x, live.y, { steps: 4 });
  await sleep(200);
}

await p.mouse.up();
await sleep(1200);

const after = await p.evaluate(() => ({
  confirm: !!document.querySelector('.td-confirm-overlay'),
  text: document
    .querySelector('.td-confirm-overlay')
    ?.textContent?.replace(/\s+/g, ' ')
    .slice(0, 180),
  pindah: /Pindah/i.test(document.querySelector('.td-confirm-overlay')?.textContent || ''),
  lastDnD: window.__lastDnDDrop,
  lastMove: window.__lastMoveReq,
  body: document.body.className,
  ghosts: document.querySelectorAll('.td-drag-ghost').length,
  over: document.querySelector('.is-drop-over')?.getAttribute('data-drop-key'),
}));
log('AFTER_DROP', after);

// Second test: drag to bottom of chat list to force scroll
await p.keyboard.press('Escape').catch(() => {});
await sleep(300);

const card2 = await p.locator('.td-file-card').first().boundingBox();
await p.mouse.move(card2.x + card2.width / 2, card2.y + 40);
await p.mouse.down();
await p.mouse.move(card2.x + 40, card2.y + 40, { steps: 8 });
await sleep(150);

const scrollTest = await p.evaluate(async () => {
  const virt = document.querySelector('.td-chat-virtual');
  if (!virt) return { noVirt: true };
  const r = virt.getBoundingClientRect();
  const before = virt.scrollTop;
  // simulate pointer at bottom edge
  return {
    virtH: r.height,
    virtTop: r.top,
    virtBottom: r.bottom,
    scrollBefore: before,
    scrollHeight: virt.scrollHeight,
    clientHeight: virt.clientHeight,
    canScroll: virt.scrollHeight > virt.clientHeight + 4,
  };
});
log('SCROLL_GEOM', scrollTest);

// Move to bottom edge of virt and hold
const virtBox = await p.evaluate(() => {
  const v = document.querySelector('.td-chat-virtual');
  if (!v) return null;
  const r = v.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.bottom - 8, bottom: r.bottom, h: r.height };
});
if (virtBox && virtBox.h > 20) {
  await p.mouse.move(virtBox.x, virtBox.y, { steps: 15 });
  await sleep(800);
  const scrolled = await p.evaluate(() => {
    const v = document.querySelector('.td-chat-virtual');
    return {
      scrollTop: v?.scrollTop,
      over: document.querySelector('.is-drop-over')?.getAttribute('data-drop-key'),
    };
  });
  log('AFTER_BOTTOM_HOLD', scrolled);
}

await p.mouse.up();
await sleep(500);

const pass =
  after.confirm &&
  (after.pindah || after.lastDnD?.key) &&
  after.lastDnD?.key &&
  after.lastDnD.key !== 'saved:me';

console.log(pass ? 'PASS_USER_SCENARIO' : 'FAIL_USER_SCENARIO');
process.exit(pass ? 0 : 1);
