import { chromium } from 'playwright';

(async () => {
  console.log('Testing page WS with connectOverCDP...');
  try {
    const listRes = await fetch('http://127.0.0.1:9230/json/list');
    const targets = await listRes.json();
    const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('1420')) || targets.find(t => t.type === 'page');
    console.log('Page WS URL:', pageTarget.webSocketDebuggerUrl);

    const browser = await chromium.connectOverCDP(pageTarget.webSocketDebuggerUrl, { timeout: 4000 });
    console.log('SUCCESS! Connected to page WS.');
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      console.log('Page Title:', await page.title());
    }
    await browser.close();
  } catch (e) {
    console.log('FAILED:', e.message);
  }
})();
