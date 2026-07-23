import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwright = require('F:/AutoGram/AutoGram App/frontend/node_modules/playwright');

async function main() {
  console.log('[direct-probe] Connecting directly to http://127.0.0.1:9222...');
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('1420')) || context.pages()[0];
  console.log('[direct-probe] Connected to page:', page.url());

  const domInfo = await page.evaluate(() => {
    const thumbs = Array.from(document.querySelectorAll('.td-file-card img')).map(img => ({
      src: img.src ? img.src.slice(0, 40) + '...' : '',
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      complete: img.complete
    }));
    const qualityPills = Array.from(document.querySelectorAll('.td-thumb-pill')).map(p => ({
      text: p.innerText,
      active: p.classList.contains('active')
    }));
    return {
      imgCount: thumbs.length,
      qualityPills,
      sample: thumbs.slice(0, 10)
    };
  });

  console.log('[direct-probe] Thumbs Resolution:', JSON.stringify(domInfo, null, 2));

  const screenshotPath = 'F:/AutoGram/remote/reports/direct_probe.png';
  await page.screenshot({ path: screenshotPath });
  console.log('[direct-probe] Screenshot saved to', screenshotPath);
}

main().catch(err => {
  console.error('[direct-probe] Error:', err.message);
  process.exit(1);
});
