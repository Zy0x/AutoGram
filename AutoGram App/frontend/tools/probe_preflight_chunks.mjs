import { chromium } from 'playwright';

(async () => {
  const timeout = setTimeout(() => {
    console.log('[AGENT_PROBE_TIMEOUT] Exiting cleanly.');
    process.exit(0);
  }, 10000);

  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
    const context = browser.contexts()[0] || browser;
    const pages = context.pages();
    if (pages.length > 0) {
      const page = pages[0];
      await page.screenshot({
        path: 'C:/Users/aliri/.gemini/antigravity/brain/26adad14-e6e1-4985-807c-da78cbe2e7e3/preflight_user_view.png',
      });
      console.log('[CDP] Screenshot saved to preflight_user_view.png');

      // Inspect report state or preflight modal content
      const modalInfo = await page.evaluate(() => {
        const dialog = document.querySelector('.td-preflight-dialog') || document.querySelector('[role="dialog"]');
        const chunkPills = Array.from(document.querySelectorAll('.td-chunk-pill-btn')).map(el => el.textContent?.trim());
        const itemRows = Array.from(document.querySelectorAll('.td-preflight-item')).slice(0, 10).map(row => {
          const name = row.querySelector('.td-preflight-name')?.textContent?.trim();
          const size = row.querySelector('.td-preflight-size')?.textContent?.trim();
          return { name, size };
        });
        return {
          hasDialog: !!dialog,
          chunkPills,
          sampleItems: itemRows,
        };
      });
      console.log('[CDP Modal Info]:', JSON.stringify(modalInfo, null, 2));
    }
    await browser.close();
  } catch (err) {
    console.error('[CDP] Error:', err.message);
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
})();
