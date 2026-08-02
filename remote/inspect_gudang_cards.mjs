import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const playwright = require('../AutoGram App/frontend/node_modules/playwright');

async function run() {
  console.log('[inspect-gudang] Connecting to CDP at http://127.0.0.1:9225...');
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9225');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('1420')) || context.pages()[0];

  console.log('[inspect-gudang] Connected to page:', page.url());
  await page.bringToFront();

  // Inspect the DOM of .td-file-card and .td-file-card-meta
  const inspectData = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.td-file-card'));
    return cards.slice(0, 6).map((card, i) => {
      const inner = card.querySelector('.td-file-card-inner');
      const thumbFull = card.querySelector('.td-file-thumb-full');
      const meta = card.querySelector('.td-file-card-meta');
      const name = card.querySelector('.td-file-card-name');
      const sub = card.querySelector('.td-file-card-sub');
      const play = card.querySelector('.td-video-play');
      const grad = card.querySelector('.td-file-thumb-grad');

      const cardRect = card.getBoundingClientRect();
      const metaRect = meta ? meta.getBoundingClientRect() : null;

      const metaStyle = meta ? window.getComputedStyle(meta) : null;
      const nameStyle = name ? window.getComputedStyle(name) : null;

      return {
        cardIndex: i,
        cardWidth: Math.round(cardRect.width),
        cardHeight: Math.round(cardRect.height),
        hasThumbFull: !!thumbFull,
        hasMeta: !!meta,
        hasName: !!name,
        nameText: name ? name.textContent.trim() : 'NO_NAME',
        subText: sub ? sub.textContent.trim() : 'NO_SUB',
        metaDisplay: metaStyle ? metaStyle.display : null,
        metaVisibility: metaStyle ? metaStyle.visibility : null,
        metaOpacity: metaStyle ? metaStyle.opacity : null,
        metaZIndex: metaStyle ? metaStyle.zIndex : null,
        metaColor: metaStyle ? metaStyle.color : null,
        metaBackground: metaStyle ? metaStyle.background : null,
        metaRect: metaRect ? { top: Math.round(metaRect.top), bottom: Math.round(metaRect.bottom), height: Math.round(metaRect.height) } : null,
        nameFontSize: nameStyle ? nameStyle.fontSize : null,
        nameColor: nameStyle ? nameStyle.color : null,
        hasGrad: !!grad,
        hasPlay: !!play
      };
    });
  });

  console.log('[inspect-gudang] Detailed Card Inspection:', JSON.stringify(inspectData, null, 2));
}

run().catch(err => console.error(err));
