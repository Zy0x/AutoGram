/**
 * Full end-to-end auto-run:
 * 1. Open/Heal page
 * 2. Open video preview modal
 * 3. Click playback rate button
 * 4. Measure rate menu position
 * 5. Verify it is on-screen
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // Listen to console
  page.on('console', msg => {
    console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.error(`[BROWSER ERROR] ${err.message}`);
  });

  // Navigate to Vite if needed
  if (!page.url().includes('1420')) {
    console.log('Navigating to', VITE_URL);
    await page.goto(VITE_URL, { waitUntil: 'domcontentloaded' });
    await sleep(2000);
  }

  // Double check if modal is open
  let hasModal = await page.evaluate(() => !!document.querySelector('.drive-preview-modal, .drive-preview-overlay'));
  if (!hasModal) {
    console.log('Opening Media Studio...');
    const studioBtn = page.locator('button, [role=button], a').filter({ hasText: /media studio|drive|speedtest/i }).first();
    if (await studioBtn.count() > 0) {
      await studioBtn.click();
      await sleep(2000);
    }

    console.log('Opening video preview...');
    const videoCard = page.locator('.td-file-card, [data-drive-file]').filter({ hasText: /\.mp4|\.mkv|\.avi|\.mov/i }).first();
    if (await videoCard.count() > 0) {
      await videoCard.dblclick();
      await sleep(2500);
    } else {
      const anyCard = page.locator('.td-file-card, [data-drive-file]').first();
      if (await anyCard.count() > 0) {
        await anyCard.dblclick();
        await sleep(2500);
      }
    }
  }

  hasModal = await page.evaluate(() => !!document.querySelector('.drive-preview-modal, .drive-preview-overlay'));
  console.log('Modal opened:', hasModal);
  if (!hasModal) {
    console.log('Could not open preview modal.');
    return;
  }

  // Click rate button
  console.log('Clicking rate button...');
  const rateBtn = page.locator('button[aria-label*="Kecepatan"]').first();
  await rateBtn.click({ force: true, timeout: 5000 });
  await sleep(1000);

  // Analyze menu position
  const analysis = await page.evaluate(() => {
    const menu = document.querySelector('.drive-rate-menu');
    if (!menu) return { found: false };
    const r = menu.getBoundingClientRect();
    const cs = window.getComputedStyle(menu);
    const btn = document.querySelector('[aria-label*="Kecepatan"]') || document.querySelector('.drive-tool-btn-value');
    const btnR = btn?.getBoundingClientRect();

    return {
      found: true,
      menuRect: {
        top: Math.round(r.top),
        left: Math.round(r.left),
        bottom: Math.round(r.bottom),
        right: Math.round(r.right),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      btnRect: btnR ? {
        top: Math.round(btnR.top),
        bottom: Math.round(btnR.bottom),
      } : null,
      innerHeight: window.innerHeight,
      position: cs.position,
      zIndex: cs.zIndex,
      topStyle: menu.style.top,
      cssTop: cs.top,
      offScreenBottom: r.bottom > window.innerHeight,
      offScreenTop: r.top < 0,
    };
  });

  console.log('\n📊 MENU POSITION ANALYSIS:');
  console.log(JSON.stringify(analysis, null, 2));

  if (analysis.found) {
    if (analysis.offScreenBottom) {
      console.log('❌ FAIL: Menu is still off-screen bottom!');
    } else if (analysis.offScreenTop) {
      console.log('❌ FAIL: Menu is off-screen top!');
    } else {
      console.log('✅ SUCCESS: Menu is fully on-screen and positioned correctly!');
    }
  } else {
    console.log('❌ FAIL: Menu element was not found in the DOM.');
  }

  // Take a screenshot of the result
  const shotFile = path.resolve(REMOTE_ROOT, 'reports/screenshots/speed-verify-final.png');
  await page.screenshot({ path: shotFile });
  console.log('📸 Screenshot saved to:', shotFile);

  // Close menu
  await page.keyboard.press('Escape');
  console.log('Done.');
}

main().catch((e) => console.error('FATAL:', e));
