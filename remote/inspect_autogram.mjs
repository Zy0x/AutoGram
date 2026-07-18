import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const playwrightPath = path.resolve('../AutoGram App/frontend/node_modules/playwright');
const { chromium } = require(playwrightPath);

async function run() {
  console.log('Connecting to AutoGram WebView2 via CDP...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const contexts = browser.contexts();
  console.log('Contexts count:', contexts.length);
  
  let targetPage = null;
  for (const context of contexts) {
    const pages = context.pages();
    for (const page of pages) {
      console.log('Page URL:', page.url());
      if (page.url().includes('1420') || page.url().includes('tauri')) {
        targetPage = page;
      }
    }
  }

  if (!targetPage) {
    console.log('AutoGram page not found. Pages:');
    for (const context of contexts) {
      for (const page of context.pages()) {
        console.log('  -', page.url());
      }
    }
    return;
  }

  console.log('Found AutoGram page:', targetPage.url());
  const title = await targetPage.title();
  console.log('Page Title:', title);

  const screenshotPath = path.resolve('reports/screenshots/current_app.png');
  await targetPage.screenshot({ path: screenshotPath });
  console.log('Saved screenshot to:', screenshotPath);
  
  // Read some inner text
  const bodyText = await targetPage.innerText('body');
  console.log('Body Text Snippet (first 400 chars):');
  console.log(bodyText.slice(0, 400));
}

run().catch(console.error);
