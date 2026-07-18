import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const playwrightPath = path.resolve('../AutoGram App/frontend/node_modules/playwright');
const { chromium } = require(playwrightPath);

async function run() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const contexts = browser.contexts();
  let targetPage = null;
  for (const context of contexts) {
    for (const page of context.pages()) {
      if (page.url().includes('1420') || page.url().includes('tauri')) {
        targetPage = page;
      }
    }
  }

  if (!targetPage) {
    console.error('AutoGram page not found.');
    await browser.close();
    process.exit(1);
  }

  const finalShot = path.resolve('reports/screenshots/upload_success_proof.png');
  await targetPage.screenshot({ path: finalShot });
  console.log(`Saved screenshot to: ${finalShot}`);
  await browser.close();
}

run().catch(console.error);
