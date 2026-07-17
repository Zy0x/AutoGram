import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(__dirname, '..', 'reports', 'screenshots');
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

await sleep(600);
await p.setViewportSize({ width: 1200, height: 750 });
await sleep(250);
await p.evaluate(() => {
  if (!document.querySelector('.td-sidebar.is-collapsed')) {
    document.querySelector('.td-rail-brand-toggle')?.click();
  }
});
await sleep(300);
const coll = await p.evaluate(() => ({
  chatVirt: !!document.querySelector('.td-chat-virtual'),
  chatKeys: document.querySelectorAll('[data-drop-key^="chat:"]').length,
  sideW: Math.round(document.querySelector('.td-sidebar').getBoundingClientRect().width),
  brand: document.querySelector('.td-sidebar-brand-text')
    ? getComputedStyle(document.querySelector('.td-sidebar-brand-text')).display
    : null,
}));
console.log('collapsed-rail', coll);
await p.screenshot({ path: path.join(shotDir, 'audit-after-fix-collapsed.png') });

await p.evaluate(() => {
  if (document.querySelector('.td-sidebar.is-collapsed')) {
    document.querySelector('.td-rail-brand-toggle')?.click();
  }
});
await sleep(200);
await p.setViewportSize({ width: 800, height: 600 });
await sleep(200);
await p.evaluate(() => document.querySelector('.td-menu-btn')?.click());
await sleep(300);
const brand = await p.evaluate(() => {
  const el = document.querySelector('.td-sidebar-brand-text');
  if (!el) return null;
  const s = getComputedStyle(el);
  return { display: s.display, flexDir: s.flexDirection, text: el.innerText };
});
console.log('drawer-brand', brand);
await p.screenshot({ path: path.join(shotDir, 'audit-after-fix-drawer.png') });

const ok = coll.sideW === 72 && !coll.chatVirt && coll.chatKeys === 0;
console.log(JSON.stringify({ ok, coll, brand }, null, 2));
await b.close().catch(() => {});
process.exit(ok ? 0 : 2);
