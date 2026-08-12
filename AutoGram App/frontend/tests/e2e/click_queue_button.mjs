import { chromium } from 'playwright';
import path from 'path';

async function clickQueue() {
  console.log('=== CLICKING QUEUE BUTTON ON PREFLIGHT MODAL ===');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
  const pages = browser.contexts()[0].pages();
  const page = pages[0];

  const clickRes = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const queueBtn = btns.find(b => b.innerText.includes('Queue') || b.innerText.includes('Mulai') || b.innerText.includes('Unggah') || b.innerText.includes('Send anyway') || (b.className && b.className.includes('primary') && b.closest('.td-modal')));

    if (queueBtn && queueBtn instanceof HTMLElement) {
      queueBtn.click();
      return { success: true, text: queueBtn.innerText };
    }

    // Try finding modal primary footer button directly
    const footerBtn = document.querySelector('.td-modal .td-modal-footer button.primary, [role="dialog"] button.primary, .td-dialog button.primary');
    if (footerBtn && footerBtn instanceof HTMLElement) {
      footerBtn.click();
      return { success: true, text: footerBtn.innerText, fallback: true };
    }

    return { success: false, availableButtons: btns.map(b => b.innerText) };
  });

  console.log('Click Queue Result:', clickRes);
  await page.waitForTimeout(3000);

  const screenshotPath = path.join(process.cwd(), 'after_queue_click.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot after queue click: ${screenshotPath}`);

  process.exit(0);
}

clickQueue();
