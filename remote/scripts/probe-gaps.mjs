import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');
const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const p = b.contexts().flatMap((c) => c.pages())[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.bringToFront().catch(() => {});
await p.evaluate(() => {
  try {
    localStorage.setItem('lastActiveTab', 'speedtest');
  } catch {}
});
let shell = await p.locator('.td-shell').count();
if (!shell) {
  await p.goto('http://localhost:1420/?g=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await sleep(4500);
}
const gaps = await p.evaluate(() => {
  const text = document.body.innerText || '';
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  return {
    url: location.href,
    shell: !!q('.td-shell'),
    cards: qa('.td-file-card').length,
    hasEmpty: !!q('.td-empty, .td-explorer-empty'),
    hasRecent: !!q('.td-recent, [data-recent]'),
    hasSelectAll: /Pilih semua/i.test(text),
    hasBulk: !!q('.td-selection-strip'),
    filterPills: qa('.td-pill').length,
    status: q('.td-status-foot')?.textContent?.trim()?.slice(0, 100) || null,
    connected: /Drive terhubung/i.test(text),
    topHints: /Ctrl\+K|Ctrl\+A|Esc/i.test(text),
    topbar: qa('.td-topbar button')
      .map((b) => (b.getAttribute('title') || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 20),
    errors: text.match(/error|gagal|belum siap|Session/gi)?.slice(0, 10) || [],
  };
});
console.log(JSON.stringify(gaps, null, 2));
process.exit(0);
