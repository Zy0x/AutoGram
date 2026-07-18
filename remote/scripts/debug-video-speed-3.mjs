/**
 * Quick check: window dimensions vs menu position in Tauri WebView
 */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPage(browser) {
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (/1420|tauri/i.test(p.url())) return p;
  return null;
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
  const page = await getPage(browser);
  if (!page) throw new Error('No page found');
  console.log('Connected:', page.url());

  // Check window dimensions
  const dims = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollY: window.scrollY,
    scrollX: window.scrollX,
    documentHeight: document.documentElement.scrollHeight,
    documentWidth: document.documentElement.scrollWidth,
  }));
  console.log('\n📐 Window/Document dimensions:');
  console.log(JSON.stringify(dims, null, 2));

  // Click rate button and inspect placement logic
  const rateBtn = page.locator('[aria-label*="Kecepatan"][aria-haspopup="menu"]').first();
  await rateBtn.click({ force: true });
  await sleep(400);

  const menuAnalysis = await page.evaluate(() => {
    const menu = document.querySelector('.drive-rate-menu');
    if (!menu) return { found: false };
    const r = menu.getBoundingClientRect();
    const cs = window.getComputedStyle(menu);
    const rateBtn = document.querySelector('[aria-label*="Kecepatan"]');
    const btnR = rateBtn?.getBoundingClientRect();
    return {
      found: true,
      menu: {
        top: Math.round(r.top), left: Math.round(r.left),
        bottom: Math.round(r.bottom), right: Math.round(r.right),
        w: Math.round(r.width), h: Math.round(r.height),
        zIndex: cs.zIndex, position: cs.position,
        offScreenBottom: r.bottom > window.innerHeight,
        offScreenTop: r.top < 0,
      },
      btn: btnR ? {
        top: Math.round(btnR.top), bottom: Math.round(btnR.bottom),
        left: Math.round(btnR.left), right: Math.round(btnR.right),
      } : null,
      spaceBelow: window.innerHeight - (btnR?.bottom || 0) - 12,
      spaceAbove: (btnR?.top || 0) - 12,
      innerHeight: window.innerHeight,
      expectedTop_below: (btnR?.bottom || 0) + 6,
      expectedTop_above: Math.max(8, (btnR?.top || 0) - 280 - 6),
    };
  });
  
  console.log('\n📍 Menu placement analysis:');
  console.log(JSON.stringify(menuAnalysis, null, 2));

  if (menuAnalysis.found) {
    console.log('\n🔴 DIAGNOSIS:');
    if (menuAnalysis.menu.offScreenBottom) {
      console.log('  → Menu is BELOW VIEWPORT! bottom:', menuAnalysis.menu.bottom, '> innerHeight:', dims.innerHeight);
      console.log('  → spaceBelow:', menuAnalysis.spaceBelow, '/ spaceAbove:', menuAnalysis.spaceAbove);
      console.log('  → placeMenuNear chose: below (top:', menuAnalysis.menu.top, ')');
      console.log('  → Expected top if below:', menuAnalysis.expectedTop_below);
      console.log('  → Expected top if above:', menuAnalysis.expectedTop_above);
      console.log('\n  REAL FIX NEEDED: placeMenuNear must account for ACTUAL menu height not estimated 280px');
      console.log('  OR: Use clamp to keep menu.bottom <= innerHeight');
    } else {
      console.log('  → Menu appears within viewport ✅');
    }
  }

  // Close menu
  await page.keyboard.press('Escape');
  await sleep(200);
  
  console.log('\n✅ Done.');
}

main().catch((e) => { console.error('FATAL:', e); process.exitCode = 1; });
