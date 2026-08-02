import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const playwright = require('../AutoGram App/frontend/node_modules/playwright');

async function run() {
  console.log('[deep-inspect] Connecting to CDP at http://127.0.0.1:9225...');
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9225');
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  await page.bringToFront();
  await page.waitForTimeout(800);

  const data = await page.evaluate(() => {
    const explorer = document.querySelector('.td-explorer');
    const gridRows = Array.from(document.querySelectorAll('.td-grid-row'));
    const cards = Array.from(document.querySelectorAll('.td-file-card'));
    const inners = Array.from(document.querySelectorAll('.td-file-card-inner'));

    return {
      explorerClasses: explorer ? explorer.className : null,
      rowCount: gridRows.length,
      // For each row, compare inline style height vs actual rendered height
      rows: gridRows.map((row, ri) => {
        const rRect = row.getBoundingClientRect();
        const rowCards = Array.from(row.querySelectorAll('.td-file-card'));
        const rowInners = Array.from(row.querySelectorAll('.td-file-card-inner'));

        return {
          rowIndex: ri,
          inlineStyleHeight: row.style.height,
          inlineStyleTop: row.style.top,
          inlineStyleTransform: row.style.transform,
          computedHeight: Math.round(rRect.height),
          computedTop: Math.round(rRect.top),
          cardsInRow: rowCards.length,
          // Measure each inner's actual height vs inline style
          innerHeights: rowInners.slice(0, 3).map((inner, ci) => {
            const iRect = inner.getBoundingClientRect();
            const cs = window.getComputedStyle(inner);
            return {
              col: ci,
              computedWidth: Math.round(iRect.width),
              computedHeight: Math.round(iRect.height),
              aspectRatio: cs.aspectRatio,
              // overflow: hidden means meta might be clipped
              overflow: cs.overflow,
            };
          }),
        };
      }),
    };
  });

  console.log('[deep-inspect] Grid layout analysis:');
  console.log(JSON.stringify(data, null, 2));

  // Also check if there's a mismatch between virtualizer row size and actual card height
  const mismatchData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.td-grid-row'));
    const mismatches = rows.map((row, ri) => {
      const el = row;
      const inlineH = parseInt(el.style.height || '0', 10);
      const inner = el.querySelector('.td-file-card-inner');
      const innerH = inner ? Math.round(inner.getBoundingClientRect().height) : 0;

      // Check the meta strip
      const meta = el.querySelector('.td-file-card-meta');
      const metaRect = meta ? meta.getBoundingClientRect() : null;
      const innerRect = inner ? inner.getBoundingClientRect() : null;

      // Is meta strip outside inner bounds?
      const metaOverflows = metaRect && innerRect
        ? metaRect.bottom > innerRect.bottom + 2
        : false;

      return {
        row: ri,
        inlineStyleH: inlineH,
        actualInnerH: innerH,
        heightMismatch: Math.abs(inlineH - innerH),
        metaHeight: metaRect ? Math.round(metaRect.height) : 0,
        metaTopInsideCard: innerRect && metaRect ? Math.round(metaRect.top - innerRect.top) : null,
        metaOverflowsInner: metaOverflows,
      };
    });
    return mismatches;
  });

  console.log('[deep-inspect] Height mismatch analysis:');
  console.log(JSON.stringify(mismatchData, null, 2));

  // Screenshot after navigating to GudangDrive
  const outDir = path.join(import.meta.dirname, 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'deep_inspect.png') });
  console.log('[deep-inspect] Screenshot saved: deep_inspect.png');
}

run().catch(err => console.error(err));
