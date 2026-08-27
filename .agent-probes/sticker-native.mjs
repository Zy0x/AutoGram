import { chromium } from '../AutoGram App/frontend/node_modules/playwright/index.mjs';

const timer = setTimeout(() => {
  console.error('[AGENT_PROBE_TIMEOUT] Exiting cleanly.');
  process.exit(0);
}, 10000);

try {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('No active desktop page found on CDP port 9230');

  const hub = page.getByRole('button', { name: /back to session hub|kembali ke hub sesi/i }).first();
  if (await hub.count()) {
    await hub.click();
    await page.waitForTimeout(500);
  }

  const lavenderCard = page.locator('div').filter({ hasText: 'Lavender (@lv_drr)' }).filter({
    has: page.getByRole('button', { name: /cloud drives/i }),
  }).last();
  const cloudDrives = lavenderCard.getByRole('button', { name: /cloud drives/i }).first();
  if (await cloudDrives.count()) {
    await cloudDrives.click();
    await page.waitForTimeout(1200);
  }

  const gudang = page.getByText(/^#Gudang$/).last();
  if (await gudang.count()) {
    await gudang.click();
    await page.waitForTimeout(900);
  }
  const topic = page.locator('button[title="Anime NSFW"]').first();
  if (await topic.count()) {
    await topic.click();
    await page.waitForTimeout(1800);
  }

  const body = await page.locator('body').innerText();
  const filterButtons = await page.locator('button').evaluateAll((elements) => elements
    .map((element) => ({
      text: element.textContent?.replace(/\s+/g, ' ').trim() || '',
      title: element.getAttribute('title'),
      aria: element.getAttribute('aria-label'),
    }))
    .filter((entry) => /^(All|Media|Files|Links|GIFs|Audio|Stickers)\b/i.test(entry.text)));

  const stickers = page.getByRole('button', { name: /stickers/i }).first();
  if (await stickers.count()) {
    await stickers.click();
    await page.waitForTimeout(700);
  }

  const stickerBody = await page.locator('body').innerText();
  const allFilter = page.getByRole('button', { name: /filter: all media types/i }).first();
  if (await allFilter.count()) {
    await allFilter.click();
    await page.waitForTimeout(600);
  }
  const allBody = await page.locator('body').innerText();
  console.log(JSON.stringify({
    locationEvidence: body.match(/Anime NSFW|#Gudang/g)?.slice(0, 8) || [],
    filterButtons,
    stickerCards: (stickerBody.match(/STICKER/g) || []).length,
    allViewStickerCards: (allBody.match(/STICKER/g) || []).length,
    stickerViewTail: stickerBody.slice(-1800),
  }, null, 2));

  await browser.close();
} catch (error) {
  console.error('CDP Probe Error:', error instanceof Error ? error.message : String(error));
} finally {
  clearTimeout(timer);
  process.exit(0);
}
