/**
 * Deep Media Studio probe — surface residual product bugs for auto-fix.
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
const issues = [];
const note = (sev, msg, extra) => issues.push({ sev, msg, ...extra });

await p.bringToFront().catch(() => {});
const pageErrors = [];
p.on('pageerror', (e) => pageErrors.push(String(e)));
p.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('c:' + m.text());
});

await p.evaluate(() => {
  try {
    localStorage.setItem('lastActiveTab', 'speedtest');
  } catch {}
});

let shell = await p.locator('.td-shell').count();
if (!shell) {
  await p.goto('http://localhost:1420/?deep=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });
  await sleep(5000);
  shell = await p.locator('.td-shell').count();
}

// Expand rail + sections
await p.evaluate(() => {
  document.querySelector('.td-sidebar.is-collapsed .td-rail-brand-toggle')?.click();
  document.querySelectorAll('.td-section-toggle').forEach((btn) => {
    if (btn.getAttribute('aria-expanded') === 'false') btn.click();
  });
});
await sleep(400);

const snap = await p.evaluate(() => {
  const text = document.body.innerText || '';
  const qa = (s) => [...document.querySelectorAll(s)];
  const q = (s) => document.querySelector(s);
  // drop key overlaps (clip-aware)
  const rows = qa('[data-drop-key]').map((el) => {
    const r = el.getBoundingClientRect();
    return {
      key: el.getAttribute('data-drop-key'),
      top: r.top,
      bottom: r.bottom,
      h: r.height,
      w: r.width,
      el,
    };
  });
  const virt = q('.td-chat-virtual')?.getBoundingClientRect();
  const overlaps = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const aChat = a.key.startsWith('chat:');
      const bChat = b.key.startsWith('chat:');
      if (aChat === bChat || a.h < 8 || b.h < 8) continue;
      const aNode = a.el;
      const bNode = b.el;
      if (virt && aChat && aNode.closest('.td-chat-virtual')) {
        if (a.bottom < virt.top + 2 || a.top > virt.bottom - 2) continue;
      }
      if (virt && bChat && bNode.closest('.td-chat-virtual')) {
        if (b.bottom < virt.top + 2 || b.top > virt.bottom - 2) continue;
      }
      if (a.top < b.bottom - 4 && b.top < a.bottom - 4) overlaps.push([a.key, b.key]);
    }
  }
  // accessibility-ish
  const imgsNoAlt = qa('img:not([alt])').length;
  const btnsNoName = qa('button').filter((b) => {
    const t = (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim();
    return !t;
  }).length;
  return {
    shell: !!q('.td-shell'),
    cards: qa('.td-file-card').length,
    listRows: qa('.td-list-row').length,
    connected: /Drive terhubung/i.test(text),
    status: q('.td-status-foot')?.textContent?.trim()?.slice(0, 120) || null,
    stuckDrag: /td-dnd-internal/.test(document.body.className),
    ghosts: qa('.td-drag-ghost').length,
    confirmOpen: !!q('.td-confirm-overlay'),
    recents: qa('.td-recent-chip, [data-recent] .td-recent-chip, .td-recents').length,
    shortcuts: !!q('.td-shortcuts-hint'),
    locationSearch: !!q('.td-location-search input'),
    fileSearch: !!q('.td-search'),
    overlaps: overlaps.slice(0, 8),
    dropKeys: rows.length,
    driveKeys: rows.filter((r) => r.key.startsWith('drive:')).length,
    chatKeys: rows.filter((r) => r.key.startsWith('chat:')).length,
    imgsNoAlt,
    btnsNoName,
    errorBanner: /error|gagal|failed|belum siap/i.test(text.slice(0, 1500)),
    bodyClass: document.body.className,
    rootLen: q('#root')?.innerHTML?.length || 0,
  };
});

if (!snap.shell) note('FAIL', 'no Media Studio shell');
if (!snap.cards && !snap.listRows) note('WARN', 'no media cards/list — session empty?');
if (snap.stuckDrag) note('FAIL', 'body stuck in td-dnd-internal');
if (snap.ghosts) note('FAIL', 'orphan drag ghost', { n: snap.ghosts });
if (snap.overlaps.length) note('FAIL', 'drop-key overlaps', { overlaps: snap.overlaps });
if (!snap.shortcuts) note('WARN', 'shortcuts hint missing');
if (!snap.locationSearch) note('FAIL', 'location search missing');
if (!snap.fileSearch) note('FAIL', 'file search missing');
if (snap.btnsNoName > 5) note('WARN', 'many unlabeled buttons', { n: snap.btnsNoName });

// File search filter
if (snap.cards > 0) {
  await p.locator('.td-search').first().fill('zzzz-no-file-xyz');
  await sleep(200);
  const filtered = await p.evaluate(() => document.querySelectorAll('.td-file-card').length);
  if (filtered !== 0) note('WARN', 'file search zero-filter incomplete', { filtered });
  await p.locator('.td-search').first().fill('');
  await sleep(150);
}

// Media filter pills cycle
const pills = p.locator('.td-filter-pills .td-pill');
const pillN = await pills.count();
if (pillN >= 2) {
  await pills.nth(1).click();
  await sleep(200);
  await pills.nth(0).click();
  await sleep(150);
  note('INFO', 'media pills clickable', { pillN });
} else note('WARN', 'few media pills', { pillN });

// View toggle grid/list
const listBtn = p.locator('button[title*="List"], button[aria-label*="List"], .td-icon-btn').filter({ hasText: '' });
const viewBtns = await p.evaluate(() =>
  [...document.querySelectorAll('.td-topbar button')].map((b) => ({
    title: b.getAttribute('title') || '',
    label: b.getAttribute('aria-label') || '',
    active: b.classList.contains('active'),
  }))
);
const hasGrid = viewBtns.some((b) => /grid/i.test(b.title + b.label));
const hasList = viewBtns.some((b) => /list/i.test(b.title + b.label));
if (!hasGrid || !hasList) note('WARN', 'grid/list toggle unclear', { viewBtns: viewBtns.slice(0, 8) });

// Try switch list mode
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.td-topbar button')].find((b) =>
    /list/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || '')
  );
  btn?.click();
});
await sleep(300);
const listMode = await p.evaluate(() => document.querySelectorAll('.td-list-row').length);
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.td-topbar button')].find((b) =>
    /grid/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || '')
  );
  btn?.click();
});
await sleep(200);
if (snap.cards > 0 && listMode < 1) note('WARN', 'list view produced no rows', { listMode });
else note('INFO', 'list view ok', { listMode });

// Select all + clear
await p.keyboard.press('Control+a');
await sleep(200);
const sel = await p.evaluate(
  () => document.querySelectorAll('.td-file-card.selected, .td-list-row.selected, .td-selection-strip').length
);
await p.keyboard.press('Escape');
await sleep(150);
const afterEsc = await p.evaluate(() => ({
  strip: !!document.querySelector('.td-selection-strip'),
  confirm: !!document.querySelector('.td-confirm-overlay'),
  body: document.body.className,
}));
if (snap.cards > 0 && sel < 1) note('WARN', 'Ctrl+A did not select / no bulk strip', { sel });
else note('INFO', 'selection', { sel });
if (afterEsc.confirm) note('FAIL', 'confirm stuck after Esc');

// Recent chip click if any (JS click — avoid WebView "outside viewport" flakiness)
const recentN = await p.locator('.td-recent-chip').count();
if (recentN > 0) {
  await p.evaluate(() => {
    const chip = document.querySelector('.td-recent-chip');
    chip?.scrollIntoView({ block: 'nearest' });
    if (chip instanceof HTMLElement) chip.click();
  });
  await sleep(800);
  note('INFO', 'recent chip clicked', { recentN });
} else note('INFO', 'no recent chips yet');

// DnD full path
if (snap.cards > 0) {
  await p.keyboard.press('Escape').catch(() => {});
  await p.evaluate(() => {
    document.querySelectorAll('.td-confirm-overlay button').forEach((b) => {
      if (/batal|tutup/i.test(b.textContent || '')) b.click();
    });
  });
  const box = await p.locator('.td-file-card').first().boundingBox();
  const dest = await p.evaluate(() => {
    for (const el of document.querySelectorAll('[data-drop-key^="drive:"], [data-drop-key^="chat:"]')) {
      if (el.classList.contains('active') || el.classList.contains('dnd-self')) continue;
      if (el.getAttribute('data-drop-invalid') === '1') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8) continue;
      if (el.getAttribute('data-drop-key')?.startsWith('chat:')) {
        const virt = document.querySelector('.td-chat-virtual')?.getBoundingClientRect();
        if (virt && (r.top < virt.top - 2 || r.bottom > virt.bottom + 2)) continue;
      }
      return {
        key: el.getAttribute('data-drop-key'),
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
      };
    }
    return null;
  });
  if (box && dest) {
    await p.mouse.move(box.x + box.width / 2, box.y + 36);
    await p.mouse.down();
    await p.mouse.move(box.x + 40, box.y + 50, { steps: 12 });
    await sleep(150);
    await p.mouse.move(dest.x, dest.y, { steps: 16 });
    await sleep(200);
    const live = await p.evaluate((key) => {
      const el = document.querySelector(`[data-drop-key="${key}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, dest.key);
    if (live) await p.mouse.move(live.x, live.y, { steps: 4 });
    await sleep(200);
    const hover = await p.evaluate(
      () => document.querySelector('.is-drop-over')?.getAttribute('data-drop-key')
    );
    await p.mouse.up();
    await sleep(1000);
    const dnd = await p.evaluate(() => ({
      confirm: !!document.querySelector('.td-confirm-overlay'),
      pindah: /Pindah/i.test(document.querySelector('.td-confirm-overlay')?.textContent || ''),
      lastKey: window.__lastDnDDrop?.key,
      body: document.body.className,
      ghosts: document.querySelectorAll('.td-drag-ghost').length,
    }));
    if (hover !== dest.key && dnd.lastKey !== dest.key)
      note('FAIL', 'DnD hover/drop mismatch', { hover, dest: dest.key, last: dnd.lastKey });
    if (!dnd.confirm || !dnd.pindah) note('FAIL', 'DnD confirm missing', dnd);
    else note('INFO', 'DnD confirm ok', { key: dnd.lastKey });
    if (dnd.ghosts) note('FAIL', 'ghost after drop', { n: dnd.ghosts });
    if (/td-dnd-internal/.test(dnd.body)) note('FAIL', 'stuck drag body class after drop');
    await p.keyboard.press('Escape');
    await sleep(300);
  } else note('WARN', 'skip DnD — no dest/card');
}

const serious = pageErrors.filter((e) => !/ResizeObserver|favicon|Non-Error/i.test(e));
if (serious.length) note('FAIL', 'page errors', { errors: serious.slice(0, 10) });

const summary = {
  snap,
  issues,
  fails: issues.filter((i) => i.sev === 'FAIL').length,
  warns: issues.filter((i) => i.sev === 'WARN').length,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.fails > 0 ? 1 : 0);
