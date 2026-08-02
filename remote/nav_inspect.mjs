import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const playwright = require('../AutoGram App/frontend/node_modules/playwright');

async function run() {
  console.log('[nav-inspect] Connecting to CDP at http://127.0.0.1:9225...');
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9225');
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  await page.bringToFront();
  
  const outDir = path.join(import.meta.dirname, 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Find and click GudangDrive
  const sidebarItems = await page.locator('.td-sidebar-chat-row, [class*="sidebar"] [class*="chat"], [data-chat-id]').all();
  console.log(`[nav-inspect] Found ${sidebarItems.length} sidebar items`);

  // Find any chat containing "Gudang"
  const allChatTexts = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[class*="chat-row"], .td-sidebar-chat-row, [class*="sidebar-item"]'));
    return items.map(item => ({ text: item.textContent?.trim().slice(0, 50) ?? '', cls: item.className }));
  });
  console.log('[nav-inspect] Sidebar items found:', JSON.stringify(allChatTexts.slice(0, 10)));

  // Try clicking #GudangDrive in sidebar
  const gudangItems = await page.locator('text=#GudangDrive').all();
  console.log(`[nav-inspect] Found ${gudangItems.length} #GudangDrive items`);

  if (gudangItems.length > 0) {
    await gudangItems[0].click();
    await page.waitForTimeout(1500);
    console.log('[nav-inspect] Clicked #GudangDrive');
    await page.screenshot({ path: path.join(outDir, 'nav_gudang_initial.png') });
    
    // Check if topic list appeared
    const topics = await page.locator('[class*="topic"], .td-topic-row, [data-topic-id]').all();
    console.log(`[nav-inspect] Found ${topics.length} topic elements after click`);

    if (topics.length > 0) {
      // Click first topic
      await topics[0].click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(outDir, 'nav_gudang_topic0.png') });
      console.log('[nav-inspect] Clicked first topic');
    }
  }

  // Deep inspect current card state
  const cardData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.td-grid-row'));
    return rows.map((row, ri) => {
      const inner = row.querySelector('.td-file-card-inner');
      const meta = row.querySelector('.td-file-card-meta');
      const thumb = row.querySelector('.td-file-thumb-full');
      const thumbImg = row.querySelector('.td-file-thumb-full img');
      const grad = row.querySelector('.td-file-thumb-grad');

      const innerRect = inner ? inner.getBoundingClientRect() : null;
      const metaRect = meta ? meta.getBoundingClientRect() : null;
      const thumbRect = thumb ? thumb.getBoundingClientRect() : null;

      const thumbCS = thumb ? window.getComputedStyle(thumb) : null;
      const thumbImgCS = thumbImg ? window.getComputedStyle(thumbImg) : null;

      return {
        rowIndex: ri,
        rowStyleH: row.style.height,
        rowStyleTop: row.style.top,
        innerSize: innerRect ? { w: Math.round(innerRect.width), h: Math.round(innerRect.height) } : null,
        metaSize: metaRect ? { h: Math.round(metaRect.height), top: Math.round(metaRect.top), bottom: Math.round(metaRect.bottom) } : null,
        thumbSize: thumbRect ? { w: Math.round(thumbRect.width), h: Math.round(thumbRect.height) } : null,
        thumbInset: thumbCS ? thumbCS.inset : null,
        thumbImgObjectFit: thumbImgCS ? thumbImgCS.objectFit : null,
        thumbImgW: thumbImgCS ? thumbImgCS.width : null,
        thumbImgH: thumbImgCS ? thumbImgCS.height : null,
        thumbImgNatural: thumbImg ? { w: thumbImg.naturalWidth, h: thumbImg.naturalHeight } : null,
        hasGrad: !!grad,
        gradZIndex: grad ? window.getComputedStyle(grad).zIndex : null,
        metaZIndex: meta ? window.getComputedStyle(meta).zIndex : null,
        // Is meta visually under thumb?
        metaAboveThumbnail: metaRect && thumbRect ? metaRect.bottom <= thumbRect.bottom + 2 : null,
      };
    });
  });

  console.log('[nav-inspect] Card layout after navigation:');
  console.log(JSON.stringify(cardData, null, 2));

  // Final screenshot
  await page.screenshot({ path: path.join(outDir, 'nav_final.png') });
  console.log('[nav-inspect] Done. Screenshots saved in reports/');
}

run().catch(err => console.error(err));
