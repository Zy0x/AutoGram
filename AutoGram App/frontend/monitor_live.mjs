import { chromium } from 'playwright';

(async () => {
  const timer = setTimeout(() => {
    console.log('[AGENT_PROBE_TIMEOUT] Exiting cleanly.');
    process.exit(0);
  }, 10000);

  try {
    console.log('Connecting to CDP...');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
    console.log('Connected.');
    
    // Find the main app page
    const pages = browser.contexts()[0]?.pages() || [];
    console.log(`Found ${pages.length} pages.`);
    const page = pages.find(p => p.url().includes('1420') && !p.url().includes('sw.js')) || pages[0];
    if (!page) throw new Error('No target page found');

    console.log(`Using page: ${page.url()}`);

    const state = await page.evaluate(() => {
      const activePill = document.querySelector('.td-topic-pill.active')?.innerText?.trim();
      const breadcrumb = document.querySelector('.td-topbar-left')?.innerText?.trim();

      const tm = document.querySelector('.tm-panel, [class*="TransferManager"]');
      const tmText = tm ? tm.innerText : null;

      const dialog = document.querySelector('div[role="dialog"]');
      const dialogText = dialog ? dialog.innerText : null;

      const toasts = Array.from(document.querySelectorAll('[class*="toast"], [class*="status"], .tm-status'))
        .map(t => t.innerText.trim()).filter(Boolean);

      return {
        activePill,
        breadcrumb,
        hasTransferManager: !!tm,
        tmText,
        hasDialog: !!dialog,
        dialogText,
        toasts,
      };
    });

    console.log('UI State:', JSON.stringify(state, null, 2));

    try {
      await page.screenshot({ path: 'C:/Users/aliri/.gemini/antigravity/brain/26adad14-e6e1-4985-807c-da78cbe2e7e3/live_monitoring_now2.png', timeout: 4000 });
      console.log('Screenshot saved.');
    } catch (e) {
      console.warn('Screenshot error or timeout:', e.message);
    }

    await browser.close();
  } catch (err) {
    console.error('CDP Error:', err.message);
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
})();
