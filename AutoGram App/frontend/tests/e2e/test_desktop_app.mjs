import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = 'C:/Users/aliri/.gemini/antigravity/brain/f01b3904-ec08-4eb4-a3ae-0d1a295b88a7';
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function run() {
  console.log('Connecting via CDP to running desktop app frontend.exe (http://127.0.0.1:9230) ...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');

  const contexts = browser.contexts();
  const pages = contexts.flatMap(c => c.pages());
  console.log(`Found ${pages.length} active WebView pages in frontend.exe:`, pages.map(p => p.url()));

  const page = pages.find(p => p.url().includes('1420') || p.url().includes('localhost')) || pages[0];
  if (!page) {
    throw new Error('No page target found in frontend.exe!');
  }

  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(1500);

  const title = await page.title();
  console.log('Desktop Application Window Title:', title);

  const screenshot1 = path.join(ARTIFACT_DIR, 'desktop_frontend_01_app_window.png');
  await page.screenshot({ path: screenshot1 });
  console.log('Captured screenshot of actual desktop app:', screenshot1);

  // Check Tauri IPC state in desktop window
  const tauriAvailable = await page.evaluate(() => {
    return {
      hasTauri: typeof window.__TAURI_INTERNALS__ !== 'undefined' || typeof window.__TAURI__ !== 'undefined',
      url: window.location.href,
      userAgent: navigator.userAgent
    };
  });
  console.log('Desktop App Environment:', tauriAvailable);

  // Perform navigation inside the desktop app window
  const buttonLocs = page.locator('button, a[href], [role="button"], .sidebar-btn, nav button');
  const count = await buttonLocs.count();
  console.log(`Found ${count} clickable elements inside frontend.exe UI.`);

  const items = [];
  for (let i = 0; i < count; i++) {
    const text = (await buttonLocs.nth(i).innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
    const isVis = await buttonLocs.nth(i).isVisible().catch(() => false);
    if (isVis && text) {
      items.push({ index: i, text });
    }
  }

  console.log('Interactive Elements in Desktop App:', items.map(it => it.text));

  // Perform navigation clicks in desktop app
  const visited = new Set();
  let step = 0;
  for (const item of items) {
    if (visited.has(item.text) || item.text.length > 40) continue;
    visited.add(item.text);
    step++;

    console.log(`\n[Desktop Navigation Step ${step}] Clicking "${item.text}" inside frontend.exe ...`);
    try {
      await buttonLocs.nth(item.index).click({ timeout: 3000 });
      await page.waitForTimeout(2000);

      const shotPath = path.join(ARTIFACT_DIR, `desktop_frontend_0${step + 1}_${item.text.toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`);
      await page.screenshot({ path: shotPath });
      console.log(`Captured desktop app screenshot for "${item.text}":`, shotPath);

      const snippet = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      console.log(`UI State Snippet: ${snippet}`);
    } catch (err) {
      console.log(`Click action failed for "${item.text}":`, err.message);
    }

    if (step >= 6) break;
  }

  console.log('\nDesktop App CDP control test complete.');
  // Keep desktop app open (do not terminate browser)
}

run().catch(err => {
  console.error('Error controlling desktop app:', err);
  process.exit(1);
});
