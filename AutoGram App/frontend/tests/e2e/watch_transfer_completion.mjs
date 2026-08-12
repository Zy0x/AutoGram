import { chromium } from 'playwright';
import path from 'path';

async function watchProgress() {
  console.log('=== WATCHING TRANSFER COMPLETION ===');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
  const pages = browser.contexts()[0].pages();
  const page = pages[0];

  let done = false;
  let attempts = 0;

  let prevDone = 0;
  let prevFail = 0;

  while (!done && attempts < 180) { // Max 3 minutes
    attempts++;
    await page.waitForTimeout(2000);

    const info = await page.evaluate(() => {
      const modalText = document.querySelector('.td-modal, .td-transfer-manager')?.innerText || document.body.innerText;
      const doneMatches = modalText.match(/(\d+)\/43 done/i) || modalText.match(/(\d+)\s+selesai/i);
      const finishedCount = doneMatches ? parseInt(doneMatches[1], 10) : 0;

      // Count finished items from list
      const items = Array.from(document.querySelectorAll('.td-transfer-row, .td-xfer-item, [data-transfer-id]'));
      const finishedItems = items.filter(el => el.textContent.includes('100%') || el.classList.contains('is-finished') || el.classList.contains('completed')).length;
      const failedItems = items.filter(el => el.classList.contains('is-failed') || el.textContent.includes('Gagal') || el.textContent.includes('Error')).length;

      const isFinishedText = modalText.includes('Selesai') || modalText.includes('Finished') || modalText.includes('43/43');

      return {
        modalTextSnippet: modalText.slice(0, 300).replace(/\n/g, ' '),
        finishedCount: Math.max(finishedCount, finishedItems),
        failedItems,
        isFinishedText,
      };
    });

    if (info.finishedCount !== prevDone || info.failedItems !== prevFail || attempts % 5 === 0) {
      prevDone = info.finishedCount;
      prevFail = info.failedItems;
      console.log(`[${attempts * 2}s] Progress: ${info.finishedCount}/43 finished, ${info.failedItems} failed. Summary: ${info.modalTextSnippet}`);
    }

    if (info.isFinishedText || (info.finishedCount > 0 && info.finishedCount + info.failedItems >= 43)) {
      done = true;
    }
  }

  const finalPath = path.join(process.cwd(), 'transfer_43_final_result.png');
  await page.screenshot({ path: finalPath });
  console.log(`\nFinal completion screenshot saved to: ${finalPath}`);
  console.log(`Total Completed: ${prevDone}/43, Total Failures: ${prevFail}`);

  process.exit(0);
}

watchProgress();
