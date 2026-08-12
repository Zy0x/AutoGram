import { chromium } from 'playwright';
import path from 'path';

async function confirmAndMonitor() {
  console.log('=== CONFIRMING PREFLIGHT & MONITORING UPLOAD ===');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
  const pages = browser.contexts()[0].pages();
  const page = pages[0];

  // Find and click the confirm button: "Queue 43, skip 0" or primary modal button
  const confirmResult = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const confirmBtn = buttons.find(b => b.innerText.includes('Queue') || b.innerText.includes('Mulai') || b.innerText.includes('Unggah') || b.innerText.includes('Lanjutkan') || b.innerText.includes('Start'));
    if (confirmBtn) {
      confirmBtn.click();
      return { success: true, text: confirmBtn.innerText };
    }
    return { success: false, buttons: buttons.map(b => b.innerText) };
  });

  console.log('Confirm click result:', confirmResult);
  await page.waitForTimeout(2000);

  // Take screenshot after clicking confirm
  await page.screenshot({ path: path.join(process.cwd(), 'upload_01_started.png') });

  // Poll transfer progress
  console.log('Monitoring transfer progress in real-time...');
  let completed = false;
  let attempts = 0;
  let lastStatusText = '';

  while (!completed && attempts < 120) {
    attempts++;
    await page.waitForTimeout(2000);

    const telemetry = await page.evaluate(() => {
      const statusEl = document.querySelector('.td-status-text, [role="status"], .td-xfer-badge');
      const text = statusEl?.textContent || document.body.innerText.slice(0, 500);

      // Check transfer list items
      const items = Array.from(document.querySelectorAll('.td-xfer-item, .td-transfer-row, .td-item-row'));
      const activeQueue = Array.from(document.querySelectorAll('.td-xfer-badge, .td-progress-bar'));

      return {
        statusText: text,
        itemCount: items.length,
        hasProgress: activeQueue.length > 0,
      };
    });

    if (telemetry.statusText !== lastStatusText) {
      lastStatusText = telemetry.statusText;
      console.log(`[${attempts * 2}s] ${telemetry.statusText.replace(/\n/g, ' ')}`);
    }

    if (telemetry.statusText.includes('Selesai') || telemetry.statusText.includes('selesai') || telemetry.statusText.includes('Finished')) {
      completed = true;
    }
  }

  const finalScreenshot = path.join(process.cwd(), 'upload_02_completed.png');
  await page.screenshot({ path: finalScreenshot });
  console.log(`Final screenshot saved: ${finalScreenshot}`);

  process.exit(0);
}

confirmAndMonitor();
