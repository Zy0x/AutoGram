/**
 * Small-window media-dnd: Drives section must stay visible (not crushed by Chats).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const pages = b.contexts().flatMap((c) => c.pages());
const p =
  pages.find((x) => {
    try {
      return /1420|localhost/.test(x.url());
    } catch {
      return false;
    }
  }) || pages[0];
if (!p) process.exit(1);

await p.bringToFront().catch(() => {});
await sleep(600);
await p.setViewportSize({ width: 800, height: 600 });
await sleep(300);
await p.evaluate(() => document.querySelector('.td-menu-btn')?.click());
await sleep(350);
await p.evaluate(() => {
  if (document.querySelector('.td-sidebar.is-collapsed')) {
    document.querySelector('.td-rail-brand-toggle')?.click();
  }
  for (const btn of document.querySelectorAll('button')) {
    if (/Muat/i.test(btn.textContent || '')) btn.click();
  }
});
await sleep(1800);

const layout = await p.evaluate(async () => {
  document.querySelector('.td-shell')?.classList.add('is-media-dnd');
  document.querySelector('.td-sidebar')?.classList.add('media-dnd');
  document.querySelector('.td-folder-nav')?.classList.add('is-drop-mode', 'is-dnd-layout');
  document.body.classList.add('td-dnd-internal');
  for (const t of document.querySelectorAll('.td-section-toggle')) {
    if (t.getAttribute('aria-expanded') === 'false') t.click();
  }
  await new Promise((r) => setTimeout(r, 250));
  const nav = document.querySelector('.td-folder-nav');
  if (nav) nav.scrollTop = 0;

  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      y: Math.round(r.y),
      h: Math.round(r.height),
      bottom: Math.round(r.bottom),
      visible: r.height > 8 && r.bottom > 40 && r.top < innerHeight - 8,
    };
  };
  const drivesToggle = [...document.querySelectorAll('.td-section-toggle')].find((t) =>
    /drives/i.test(t.textContent || '')
  );
  const chatsToggle = [...document.querySelectorAll('.td-section-toggle')].find((t) =>
    /chats/i.test(t.textContent || '')
  );
  const stack = document.querySelector('.td-dnd-folder-stack');
  const virt = document.querySelector('.td-chat-virtual');
  const driveRows = [
    ...document.querySelectorAll(
      '.td-dnd-folder-stack .td-folder-row, .td-dnd-folder-stack [data-drop-key^="drive:"]'
    ),
  ];
  return {
    vh: innerHeight,
    drivesToggle: {
      text: drivesToggle?.textContent?.trim().slice(0, 24),
      exp: drivesToggle?.getAttribute('aria-expanded'),
      ...box(drivesToggle),
    },
    chatsToggle: {
      text: chatsToggle?.textContent?.trim().slice(0, 24),
      exp: chatsToggle?.getAttribute('aria-expanded'),
      ...box(chatsToggle),
    },
    stack: box(stack),
    stackMinH: stack ? getComputedStyle(stack).minHeight : null,
    stackFlex: stack ? getComputedStyle(stack).flex : null,
    virt: box(virt),
    virtMinH: virt ? getComputedStyle(virt).minHeight : null,
    driveRowCount: driveRows.length,
    driveRowsVisible: driveRows.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 8 && r.top < innerHeight && r.bottom > 0;
    }).length,
    sampleDrives: driveRows.slice(0, 6).map((el) => ({
      t: (el.textContent || '').trim().slice(0, 32),
      y: Math.round(el.getBoundingClientRect().y),
      h: Math.round(el.getBoundingClientRect().height),
    })),
  };
});

console.log(JSON.stringify(layout, null, 2));
await p.screenshot({
  path: path.join(__dirname, '..', 'reports', 'screenshots', 'dnd-drives-visible.png'),
});

await p.evaluate(() => {
  document.querySelector('.td-shell')?.classList.remove('is-media-dnd');
  document.querySelector('.td-sidebar')?.classList.remove('media-dnd');
  document.querySelector('.td-folder-nav')?.classList.remove('is-drop-mode', 'is-dnd-layout');
  document.body.classList.remove('td-dnd-internal');
});

const ok =
  !!layout.drivesToggle?.visible &&
  (layout.stack?.h || 0) >= 100 &&
  layout.driveRowsVisible > 0 &&
  !!layout.chatsToggle?.visible;

console.log('ok', ok);
await b.close().catch(() => {});
process.exit(ok ? 0 : 2);
