import { chromium } from 'playwright';

(async () => {
  const timeout = setTimeout(() => {
    console.log('[AGENT_PROBE_TIMEOUT] Exiting cleanly.');
    process.exit(0);
  }, 30000);

  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      const timingResult = await page.evaluate(async () => {
        // Let's check how long runQualityPreflight takes if we invoke it via Tauri IPC:
        const internals = window.__TAURI_INTERNALS__;
        if (!internals || !internals.invoke) return { error: 'no internals' };

        // Get the paths from the current preflight dialog if possible, or probe
        const firstPill = document.querySelector('.td-chunk-pill-btn');
        return {
          hasInternals: true,
        };
      });
      console.log('Result:', timingResult);
    }
    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
})();
