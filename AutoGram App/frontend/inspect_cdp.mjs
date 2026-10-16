import { chromium } from 'playwright';

(async () => {
  const timer = setTimeout(() => {
    console.log('[AGENT_PROBE_TIMEOUT] Exiting cleanly.');
    process.exit(0);
  }, 12000);

  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) throw new Error('No desktop page found on CDP 9230');

    // Take screenshot of current state
    await page.screenshot({ path: 'C:/Users/aliri/.gemini/antigravity/brain/26adad14-e6e1-4985-807c-da78cbe2e7e3/live_pantau_lanjutkan.png' });
    console.log('Screenshot saved to live_pantau_lanjutkan.png');

    // Inspect buttons, dialogs, banners
    const state = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).map(b => ({
        text: b.innerText?.trim(),
        className: b.className
      })).filter(b => b.text);

      const resumeBanner = document.querySelector('[role="status"]')?.innerText?.trim() || null;
      const dialog = document.querySelector('[role="dialog"]')?.innerText?.slice(0, 300) || null;

      // Active topic pill
      const activePill = document.querySelector('.td-topic-pill.active')?.innerText?.trim() || null;

      return {
        activePill,
        resumeBanner,
        dialog,
        relevantButtons: buttons.filter(b => 
          b.text.includes('Lanjutkan') || 
          b.text.includes('Abaikan') || 
          b.text.includes('Upload') || 
          b.text.includes('Queue') || 
          b.text.includes('Antrean') || 
          b.text.includes('Donghua')
        )
      };
    });

    console.log('App UI State:', JSON.stringify(state, null, 2));

    await browser.close();
  } catch (err) {
    console.error('CDP Error:', err.message);
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
})();
