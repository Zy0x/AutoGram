import { chromium } from 'playwright';

(async () => {
  const timeout = setTimeout(() => {
    console.log('[AGENT_PROBE_TIMEOUT] Exiting cleanly.');
    process.exit(0);
  }, 15000);

  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      // Click on Kloter 2 button
      await page.locator('.td-chunk-pill-btn', { hasText: 'Kloter 2' }).click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: 'C:/Users/aliri/.gemini/antigravity/brain/26adad14-e6e1-4985-807c-da78cbe2e7e3/kloter_2_view.png',
      });
      console.log('Kloter 2 screenshot saved.');

      // Check the size text of the first 5 items in Kloter 2
      const items = await page.evaluate(() => {
        const rows = document.querySelectorAll('.td-preflight-item');
        return Array.from(rows).slice(0, 5).map(r => {
          return {
            text: r.textContent?.replace(/\s+/g, ' ').trim()
          };
        });
      });
      console.log('Kloter 2 items:', JSON.stringify(items, null, 2));
    }
    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
})();
