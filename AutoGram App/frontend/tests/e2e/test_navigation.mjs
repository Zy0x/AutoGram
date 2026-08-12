import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = 'C:/Users/aliri/.gemini/antigravity/brain/f01b3904-ec08-4eb4-a3ae-0d1a295b88a7';
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function getBrowser() {
  const options = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const opt of options) {
    try {
      const b = await chromium.launch({ ...opt, headless: true });
      console.log('Browser launched with options:', JSON.stringify(opt));
      return b;
    } catch (e) {
      console.log('Launch failed for options', JSON.stringify(opt), e.message);
    }
  }
  throw new Error('Could not launch any browser channel');
}

async function run() {
  console.log('Connecting/launching browser to test http://localhost:1420 ...');
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGE ERROR] ${err.message}`));

  await page.goto('http://localhost:1420', { waitUntil: 'networkidle', timeout: 15000 }).catch(e => {
    console.log('Navigation notice:', e.message);
  });

  await page.waitForTimeout(2000);

  const title = await page.title();
  console.log('Page Title:', title);

  const screenshotPath1 = path.join(ARTIFACT_DIR, 'autogram_01_home.png');
  await page.screenshot({ path: screenshotPath1, fullPage: true });
  console.log('Saved screenshot:', screenshotPath1);

  // Get all buttons / clickable elements
  const buttonLocs = page.locator('button, a[href], [role="button"]');
  const count = await buttonLocs.count();
  console.log(`Found ${count} interactive navigation elements.`);

  const items = [];
  for (let i = 0; i < count; i++) {
    const text = (await buttonLocs.nth(i).innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
    const isVis = await buttonLocs.nth(i).isVisible().catch(() => false);
    if (isVis && text) {
      items.push({ index: i, text });
    }
  }

  console.log('Visible items:', items.map(it => it.text));

  // Perform click navigation on unique visible tabs/buttons
  const visited = new Set();
  let stepCount = 0;

  for (const item of items) {
    if (visited.has(item.text) || item.text.length > 40) continue;
    visited.add(item.text);
    stepCount++;

    try {
      console.log(`\n--- Step ${stepCount}: Clicking "${item.text}" ---`);
      await buttonLocs.nth(item.index).click({ timeout: 3000 });
      await page.waitForTimeout(1500);

      const shotPath = path.join(ARTIFACT_DIR, `autogram_0${stepCount + 1}_${item.text.toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`);
      await page.screenshot({ path: shotPath, fullPage: true });
      console.log(`Captured screenshot for ${item.text}: ${shotPath}`);

      const bodyTextSnippet = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      console.log(`View Content Snippet: ${bodyTextSnippet}`);
    } catch (e) {
      console.log(`Could not click "${item.text}": ${e.message}`);
    }

    if (stepCount >= 7) break;
  }

  console.log('\n--- Console Logs Captured ---');
  console.log(logs.slice(0, 10).join('\n'));

  await browser.close();
  console.log('Navigation test completed successfully.');
}

run().catch(err => {
  console.error('Error during test execution:', err);
  process.exit(1);
});
