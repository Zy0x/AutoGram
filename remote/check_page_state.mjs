import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

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
    return;
  }

  const state = await targetPage.evaluate(() => {
    // We can query the DOM or check globals
    const body = document.body.innerText;
    const transfer = window.transfer;
    return {
      url: window.location.href,
      bodySnippet: body.slice(0, 1000),
      transfer: transfer ? {
        active: transfer.active,
        overallPercent: transfer.overallPercent,
        itemsCount: transfer.items ? transfer.items.length : 0,
        doneCount: transfer.items ? transfer.items.filter(i => i.status === 'done').length : 0,
        failedCount: transfer.items ? transfer.items.filter(i => i.status === 'failed').length : 0,
      } : null
    };
  });

  console.log('Page State:');
  console.log(JSON.stringify(state, null, 2));
}

run().catch(console.error);
