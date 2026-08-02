import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const playwright = require('../AutoGram App/frontend/node_modules/playwright');

async function run() {
  console.log('[aspect-test] Connecting to CDP...');
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];

  const cards = await page.evaluate(() => {
    const inners = Array.from(document.querySelectorAll('.td-file-card-inner'));
    return inners.slice(0, 5).map((el, i) => {
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const ratio = w / h;
      const expectedH_for_2_3 = w * 1.5;
      return {
        card: i,
        width: Math.round(w * 10) / 10,
        height: Math.round(h * 10) / 10,
        actualRatio: Math.round(ratio * 1000) / 1000,
        expectedRatio_2_3: 0.667,
        expectedHeight23: Math.round(expectedH_for_2_3 * 10) / 10,
        heightDiff: Math.round((h - expectedH_for_2_3) * 10) / 10
      };
    });
  });

  console.log('[aspect-test] Card dimensions & aspect ratio:');
  console.log(JSON.stringify(cards, null, 2));
}

run().catch(err => console.error(err));
