import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = 'C:/Users/aliri/.gemini/antigravity/brain/f01b3904-ec08-4eb4-a3ae-0d1a295b88a7';
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function run() {
  console.log('\n=== REAL-TIME DRAG & DROP SIDEBAR TEST ===');
  console.log('Connecting via CDP to active desktop application frontend.exe (http://127.0.0.1:9230) ...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');

  const contexts = browser.contexts();
  const pages = contexts.flatMap(c => c.pages());
  const page = pages.find(p => p.url().includes('1420') || p.url().includes('localhost')) || pages[0];

  if (!page) {
    throw new Error('Could not find active desktop window page target!');
  }

  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(1000);

  // Find media card in grid
  const fileCards = page.locator('.td-file-card, [class*="file-card"], .td-list-row');
  const cardCount = await fileCards.count();
  console.log(`Found ${cardCount} file cards in active view.`);

  if (cardCount === 0) {
    console.log('No file cards found in active view. Navigating to Cloud Drives Telegram Storage tab first...');
    const driveTab = page.locator('button, a[href], [role="button"]').filter({ hasText: /Cloud Drives|Drives|Telegram/i }).first();
    if (await driveTab.isVisible()) {
      await driveTab.click();
      await page.waitForTimeout(2000);
    }
  }

  const targetCard = page.locator('.td-file-card, [class*="file-card"]').first();
  if (await targetCard.count() === 0) {
    console.log('No media cards available to drag.');
    return;
  }

  const cardBox = await targetCard.boundingBox();
  console.log('Source Card Bounding Box:', cardBox);

  // Find sidebar chat/drive target
  const sidebarRows = page.locator('[data-drop-key], .sidebar-btn, nav button');
  const sidebarCount = await sidebarRows.count();
  console.log(`Found ${sidebarCount} drop targets in sidebar.`);

  const targetRow = page.locator('[data-drop-key]').nth(2);
  const rowBox = await targetRow.boundingBox().catch(() => null);
  console.log('Sidebar Target Bounding Box:', rowBox);

  if (cardBox && rowBox) {
    const startX = cardBox.x + cardBox.width / 2;
    const startY = cardBox.y + cardBox.height / 2;
    const targetX = rowBox.x + rowBox.width / 2;
    const targetY = rowBox.y + rowBox.height / 2;

    console.log(`\n👉 Simulating Pointer Drag from (${startX.toFixed(0)}, ${startY.toFixed(0)}) to Sidebar (${targetX.toFixed(0)}, ${targetY.toFixed(0)}) ...`);

    // 1. Mouse down on card
    await page.mouse.move(startX, startY);
    await page.waitForTimeout(300);
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(300);

    // 2. Drag toward sidebar
    console.log('Dragging card toward sidebar...');
    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      const curX = startX + (targetX - startX) * (i / steps);
      const curY = startY + (targetY - startY) * (i / steps);
      await page.mouse.move(curX, curY);
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(1000);
    const shotPath1 = path.join(ARTIFACT_DIR, 'live_drag_hover_sidebar.png');
    await page.screenshot({ path: shotPath1 });
    console.log('Captured screenshot while hovering drag over sidebar:', shotPath1);

    // 3. Test Auto-scroll by dragging near top and bottom edge of sidebar
    const sidebarElement = page.locator('aside, nav, .td-chat-section').first();
    const sideBox = await sidebarElement.boundingBox();
    if (sideBox) {
      console.log('\n👉 Testing Drag Auto-scroll near BOTTOM edge of sidebar...');
      const bottomEdgeY = sideBox.y + sideBox.height - 25;
      await page.mouse.move(targetX, bottomEdgeY);
      await page.waitForTimeout(2000);

      const shotPath2 = path.join(ARTIFACT_DIR, 'live_drag_autoscroll_bottom.png');
      await page.screenshot({ path: shotPath2 });
      console.log('Captured screenshot during bottom edge scroll:', shotPath2);

      console.log('👉 Testing Drag Auto-scroll near TOP edge of sidebar...');
      const topEdgeY = sideBox.y + 25;
      await page.mouse.move(targetX, topEdgeY);
      await page.waitForTimeout(2000);

      const shotPath3 = path.join(ARTIFACT_DIR, 'live_drag_autoscroll_top.png');
      await page.screenshot({ path: shotPath3 });
      console.log('Captured screenshot during top edge scroll:', shotPath3);
    }

    // Release mouse
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(1000);
    console.log('Mouse released. Drag-and-drop simulation finished.');
  }

  console.log('\n=== REAL-TIME DRAG & DROP SIDEBAR TEST COMPLETE ===\n');
}

run().catch(err => {
  console.error('Error during drag and drop test:', err);
  process.exit(1);
});
