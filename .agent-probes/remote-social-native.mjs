import { chromium } from '../AutoGram App/frontend/node_modules/playwright/index.mjs';

const timer = setTimeout(() => {
  console.error('[AGENT_PROBE_TIMEOUT] Exiting cleanly.');
  process.exit(0);
}, 10000);

try {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('No active desktop page found on CDP port 9230');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const back = page.getByRole('button', { name: /back to autogram|kembali ke autogram/i }).first();
  if (await back.count()) {
    await back.click();
    await page.waitForTimeout(600);
  }
  const settings = page.getByRole('button', { name: /settings|pengaturan/i }).first();
  if (await settings.count()) {
    console.log('CLICK_SETTINGS', await settings.evaluate((element) => ({
      tag: element.tagName,
      text: element.textContent,
      aria: element.getAttribute('aria-label'),
    })));
    await settings.click();
    await page.waitForTimeout(700);
  }

  const storage = page.getByText(/^(storage|penyimpanan)$/i).first();
  if (await storage.count()) {
    console.log('CLICK_STORAGE', await storage.innerText());
    await storage.click();
    await page.waitForTimeout(700);
  }

  const buttons = await page.getByRole('button').allTextContents();
  const buttonDetails = await page.locator('button').evaluateAll((elements) => elements.slice(0, 40).map((element) => ({
    text: element.textContent?.trim(),
    aria: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
  })));
  const clearLabels = buttons.filter((label) => /clear.*cache|hapus.*cache|bersihkan.*cache/i.test(label));
  const clearCache = page.getByRole('button', { name: /^clear all cache$|^hapus semua cache$|^bersihkan semua cache$/i }).first();
  let cacheCleared = false;
  if (await clearCache.count()) {
    await clearCache.click();
    await page.waitForTimeout(250);
    const resetPreferences = page.getByRole('checkbox').last();
    if (await resetPreferences.count() && await resetPreferences.isChecked()) {
      await resetPreferences.uncheck();
    }
    const confirm = page.getByRole('button', { name: /yes, clear all cache|ya, hapus semua cache|bersihkan semua cache/i }).last();
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(1200);
    cacheCleared = !(await page.getByText(/confirm clear cache|konfirmasi.*cache/i).count());
  }
  console.log(JSON.stringify({
    title: await page.title(),
    url: page.url(),
    clearLabels,
    cacheCleared,
    buttonDetails,
    body: (await page.locator('body').innerText()).slice(0, 3500),
  }, null, 2));

  await browser.close();
} catch (error) {
  console.error('CDP Probe Error:', error instanceof Error ? error.message : String(error));
} finally {
  clearTimeout(timer);
  process.exit(0);
}
