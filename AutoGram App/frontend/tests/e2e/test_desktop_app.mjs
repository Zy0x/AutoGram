import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = 'C:/Users/aliri/.gemini/antigravity/brain/f01b3904-ec08-4eb4-a3ae-0d1a295b88a7';
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function run() {
  console.log('\n=== REAL-TIME VISUAL AUTOMATION TEST ON DESKTOP ===');
  console.log('Connecting via CDP to active desktop application frontend.exe (http://127.0.0.1:9230) ...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');

  const contexts = browser.contexts();
  const pages = contexts.flatMap(c => c.pages());
  const page = pages.find(p => p.url().includes('1420') || p.url().includes('localhost')) || pages[0];

  if (!page) {
    throw new Error('Could not find active desktop window page target!');
  }

  // Bring window to front
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2000);

  const title = await page.title();
  console.log('Active Desktop Window Title:', title);

  const buttonLocs = page.locator('button, a[href], [role="button"], .sidebar-btn, nav button');
  const count = await buttonLocs.count();
  console.log(`Found ${count} clickable UI elements in active desktop window.`);

  const items = [];
  for (let i = 0; i < count; i++) {
    const text = (await buttonLocs.nth(i).innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
    const isVis = await buttonLocs.nth(i).isVisible().catch(() => false);
    if (isVis && text) {
      items.push({ index: i, text });
    }
  }

  const targetsToClick = [
    'Cloud Drives Telegram Storage',
    'AutoGram',
    'Lavender (@lv_drr)',
    'New Drive',
    'Recent 6'
  ];

  let step = 0;
  for (const targetText of targetsToClick) {
    const matched = items.find(it => it.text.toLowerCase().includes(targetText.toLowerCase()));
    if (!matched) continue;
    step++;

    console.log(`\n👉 [VISUAL STEP ${step}/5] Clicking "${matched.text}" on your desktop screen...`);
    try {
      // Hover first to show mouse pointer highlight
      await buttonLocs.nth(matched.index).hover().catch(() => {});
      await page.waitForTimeout(800);

      // Perform real click
      await buttonLocs.nth(matched.index).click({ force: true, timeout: 5000 });
      console.log(`✅ Action performed! Waiting 3 seconds so you can see the screen update live...`);

      // Generous delay so user can clearly see the live visual update on their monitor
      await page.waitForTimeout(3000);

      const shotPath = path.join(ARTIFACT_DIR, `live_visual_step_${step}_${targetText.toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`);
      await page.screenshot({ path: shotPath });
      console.log(`Screenshot recorded: ${shotPath}`);
    } catch (e) {
      console.log(`Notice during click on "${matched.text}":`, e.message);
    }
  }

  console.log('\n=== REAL-TIME VISUAL AUTOMATION FINISHED ===\n');
}

run().catch(err => {
  console.error('Error during visual automation:', err);
  process.exit(1);
});
