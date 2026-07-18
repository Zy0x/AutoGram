/**
 * Script untuk mengambil screenshot sidebar dan memverifikasi perubahan status dot.
 * Run: node scripts/take-sidebar-shot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REMOTE_ROOT   = path.resolve(__dirname, '..');
const AUTOGRAM_ROOT = path.resolve(REMOTE_ROOT, '..');
const PW_PATH = path.resolve(AUTOGRAM_ROOT, 'AutoGram App/frontend/node_modules/playwright');
const require = createRequire(import.meta.url);
const { chromium } = require(PW_PATH);

const CDP_URL  = 'http://127.0.0.1:9222';
const VITE_URL = 'http://127.0.0.1:1420';

async function getPage(browser) {
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (/1420|tauri/i.test(p.url())) return p;
  return null;
}

async function main() {
  console.log('Connecting to CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
  const page = await getPage(browser);
  if (!page) throw new Error('No page found');
  console.log('Connected:', page.url());

  // Navigate to Media Studio / Drive if we are not there
  const hasSidebar = await page.evaluate(() => !!document.querySelector('.td-sidebar'));
  if (!hasSidebar) {
    console.log('Navigating to Media Studio...');
    const studioBtn = page.locator('button, [role=button], a').filter({ hasText: /media studio|drive|speedtest/i }).first();
    if (await studioBtn.count() > 0) {
      await studioBtn.click();
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Take screenshot of the sidebar area
  const sidebarClip = await page.evaluate(() => {
    const s = document.querySelector('.td-sidebar') || document.querySelector('.app-sidebar');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) + 20, height: Math.min(600, Math.round(r.height)) };
  });

  const shotFile = path.resolve(REMOTE_ROOT, 'reports/screenshots/sidebar-status-verify.png');
  fs.mkdirSync(path.dirname(shotFile), { recursive: true });

  if (sidebarClip) {
    await page.screenshot({ path: shotFile, clip: sidebarClip });
    console.log('📸 Screenshot saved to:', shotFile);
  } else {
    await page.screenshot({ path: shotFile });
    console.log('📸 Viewport screenshot saved to:', shotFile);
  }
}

main().catch((e) => console.error('FATAL:', e));
