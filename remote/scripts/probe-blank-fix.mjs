/**
 * Probe blank black screen + force reload after DriveExplorer fix.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(__dirname, '../reports/screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const b = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const pages = b.contexts().flatMap((c) => c.pages());
const p =
  pages.find((x) => /1420|tauri/i.test(x.url())) ||
  pages[0];
if (!p) {
  console.log(JSON.stringify({ fatal: 'NO_PAGE' }));
  process.exit(2);
}

const pageErrors = [];
const consoles = [];
p.on('pageerror', (e) => pageErrors.push(String(e?.stack || e).slice(0, 600)));
p.on('console', (m) => {
  if (m.type() === 'error') consoles.push(m.text().slice(0, 400));
});

const served = await p.evaluate(async () => {
  const r = await fetch('/src/components/media-drive/DriveExplorer.tsx?bust=' + Date.now());
  const t = await r.text();
  const snipMatch = t.match(/const displayed[\s\S]{0,280}/);
  return {
    status: r.status,
    hasPowerImport: t.includes('drivePower') || t.includes('filterAndSortDriveFilesPower'),
    hasPowerCall: t.includes('filterAndSortDriveFilesPower'),
    bareCallCount: (t.match(/filterAndSortDriveFiles\(/g) || []).length,
    powerCallCount: (t.match(/filterAndSortDriveFilesPower\(/g) || []).length,
    snippet: snipMatch ? snipMatch[0].slice(0, 280) : '',
  };
});

await p.goto('http://localhost:1420/?fix=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
await new Promise((r) => setTimeout(r, 4500));

const after = await p.evaluate(() => ({
  rootKids: document.getElementById('root')?.childElementCount ?? -1,
  hasShell: !!document.querySelector('.td-shell'),
  hasPage: !!document.querySelector('.td-page'),
  hasMain: !!document.querySelector('.td-main, main'),
  bodyText: (document.body?.innerText || '').slice(0, 400),
  bg: getComputedStyle(document.body).backgroundColor,
}));

const shot = path.join(shotDir, 'blank-black-fixed.png');
await p.screenshot({ path: shot, fullPage: false });

console.log(
  JSON.stringify(
    {
      served,
      after,
      pageErrors,
      consoles: consoles.slice(-20),
      shot,
      ok: after.hasShell || after.hasPage || after.rootKids > 0,
    },
    null,
    2
  )
);
process.exit(after.hasShell || after.rootKids > 0 ? 0 : 1);
