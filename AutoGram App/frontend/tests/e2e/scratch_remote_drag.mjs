import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const outDir = 'C:/Users/aliri/.gemini/antigravity/brain/572b7008-943f-4dab-b135-b00512c13856/scratch';
fs.mkdirSync(outDir, { recursive: true });

async function run() {
  console.log('Connecting to AutoGram Tauri WebView2 via CDP 9225...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => p.url().includes('1420') || p.url().includes('localhost') || p.url().includes('tauri')) || pages[0];

  if (!page) {
    console.error('No active page found in WebView2!');
    await browser.close();
    process.exit(1);
  }

  // Trigger media drag start via evaluate
  await page.evaluate(() => {
    const card = document.querySelector('.td-recent-chip, .td-file-card, img');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const downEvt = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: 1
    });
    card.dispatchEvent(downEvt);
  });

  const nav = page.locator('.td-folder-nav').first();
  const nBox = await nav.boundingBox();

  if (nBox) {
    const targetX = nBox.x + nBox.width / 2;
    const targetY = nBox.y + nBox.height - 15;

    console.log(`Dispatching pointermove & mousemove to nav bottom edge (${targetX}, ${targetY})...`);

    // Dispatch mousemove to edge
    for (let i = 0; i < 5; i++) {
      await page.evaluate(({ x, y }) => {
        const pMove = new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          buttons: 1
        });
        const mMove = new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          buttons: 1
        });
        document.dispatchEvent(pMove);
        document.dispatchEvent(mMove);
      }, { x: targetX, y: targetY });
      await page.waitForTimeout(100);
    }

    const getScrolls = () => page.evaluate(() => ({
      navScroll: document.querySelector('.td-folder-nav')?.scrollTop || 0,
      chatScroll: document.querySelector('.td-chat-virtual')?.scrollTop || 0,
    }));

    const s0 = await getScrolls();
    await page.waitForTimeout(300);
    const s1 = await getScrolls();
    await page.waitForTimeout(300);
    const s2 = await getScrolls();

    console.log('Live CDP Drag Test Results (With Event Dispatch):', { s0, s1, s2 });
  }

  await browser.close();
  console.log('CDP Test Complete!');
}

run().catch((err) => {
  console.error('CDP Run Error:', err);
  process.exit(1);
});
