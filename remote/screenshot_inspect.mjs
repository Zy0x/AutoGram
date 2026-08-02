import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const playwright = require('../AutoGram App/frontend/node_modules/playwright');

async function run() {
  console.log('[screenshot] Connecting to CDP at http://127.0.0.1:9225...');
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9225');
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  console.log('[screenshot] Connected to page:', page.url());
  await page.bringToFront();

  // Wait a bit to ensure rendering is stable
  await page.waitForTimeout(800);

  // Take full screenshot
  const outDir = path.join(import.meta.dirname, 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  await page.screenshot({ path: path.join(outDir, 'current_state.png'), fullPage: false });
  console.log('[screenshot] Screenshot saved: current_state.png');

  // Also inspect cards in detail
  const info = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.td-file-card'));
    return cards.slice(0, 4).map((card, i) => {
      const inner = card.querySelector('.td-file-card-inner');
      const meta = card.querySelector('.td-file-card-meta');
      const name = card.querySelector('.td-file-card-name');
      const sub = card.querySelector('.td-file-card-sub');
      const thumb = card.querySelector('.td-file-thumb-full');
      const thumbImg = card.querySelector('.td-file-thumb-full img');

      const innerRect = inner ? inner.getBoundingClientRect() : null;
      const metaRect = meta ? meta.getBoundingClientRect() : null;
      const thumbRect = thumb ? thumb.getBoundingClientRect() : null;

      const innerCS = inner ? window.getComputedStyle(inner) : null;
      const metaCS = meta ? window.getComputedStyle(meta) : null;

      return {
        idx: i,
        innerSize: innerRect ? { w: Math.round(innerRect.width), h: Math.round(innerRect.height) } : null,
        metaRect: metaRect ? {
          top: Math.round(metaRect.top),
          bottom: Math.round(metaRect.bottom),
          height: Math.round(metaRect.height),
          visible: metaRect.height > 0 && metaRect.width > 0
        } : null,
        thumbRect: thumbRect ? { w: Math.round(thumbRect.width), h: Math.round(thumbRect.height) } : null,
        metaOverflow: metaCS ? metaCS.overflow : null,
        metaZIndex: metaCS ? metaCS.zIndex : null,
        metaBottom: metaCS ? metaCS.bottom : null,
        metaPosition: metaCS ? metaCS.position : null,
        innerOverflow: innerCS ? innerCS.overflow : null,
        innerAspectRatio: innerCS ? innerCS.aspectRatio : null,
        nameText: name ? name.textContent.trim().slice(0, 30) : 'NO_NAME',
        subText: sub ? sub.textContent.trim().slice(0, 30) : 'NO_SUB',
        metaInsideInner: inner && meta ? inner.contains(meta) : false,
        thumbImgSrc: thumbImg ? thumbImg.src.slice(0, 60) : null,
        thumbImgNaturalSize: thumbImg ? { w: thumbImg.naturalWidth, h: thumbImg.naturalHeight } : null,
        thumbImgStyle: thumbImg ? {
          objectFit: window.getComputedStyle(thumbImg).objectFit,
          width: window.getComputedStyle(thumbImg).width,
          height: window.getComputedStyle(thumbImg).height,
        } : null,
      };
    });
  });

  console.log('[screenshot] Card layout info:');
  console.log(JSON.stringify(info, null, 2));

  // Also check the explorer and grid layout
  const gridInfo = await page.evaluate(() => {
    const explorer = document.querySelector('.td-explorer');
    const gridRows = Array.from(document.querySelectorAll('.td-grid-row'));
    const explorerCS = explorer ? window.getComputedStyle(explorer) : null;

    return {
      explorerClass: explorer ? explorer.className : null,
      totalRows: gridRows.length,
      rowSizes: gridRows.slice(0, 3).map(r => {
        const style = r.style;
        const cs = window.getComputedStyle(r);
        return {
          styleHeight: style.height,
          styleTransform: style.transform,
          computedHeight: cs.height,
          childCount: r.children.length
        };
      })
    };
  });

  console.log('[screenshot] Grid info:');
  console.log(JSON.stringify(gridInfo, null, 2));
}

run().catch(err => console.error(err));
