/**
 * Remote measure: open #Gudang Drive, count thumbs in first 3s (cold thumbs cache).
 */
import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'F:/AutoGram/remote';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes('1420'));
if (!page) {
  console.error('NO_PAGE');
  process.exit(1);
}

await page.waitForTimeout(1200);

// Ensure Drives
const drivesBtn = page.getByRole('button', { name: /Drives|Media/i }).first();
if (await drivesBtn.count()) {
  await drivesBtn.click().catch(() => {});
  await page.waitForTimeout(800);
}

// Click first Drive [TD] labeled Gudang
const t0 = Date.now();
const gudang = page.locator('button, .td-folder-row, [class*="folder"], [class*="drive"]').filter({ hasText: /#Gudang/ }).first();
if (!(await gudang.count())) {
  // fallback: any text #Gudang
  await page.getByText(/#Gudang/).first().click({ timeout: 8000 });
} else {
  await gudang.click({ timeout: 8000 });
}

// Sample thumbs at 1s, 2s, 3s, 5s
const samples = [];
for (const wait of [1000, 2000, 3000, 5000]) {
  const elapsed = Date.now() - t0;
  if (elapsed < wait) await page.waitForTimeout(wait - elapsed);
  const cards = await page.locator('.td-file-card').count();
  const thumbs = await page.locator('.td-file-card img[src^="data:"], .td-file-card img[src^="blob:"], .td-file-card img[src*="http"]').count();
  const loading = await page.locator('.td-file-card .spin, .td-file-card [class*="load"]').count().catch(() => 0);
  samples.push({ at_ms: Date.now() - t0, cards, thumbs, loading });
  console.log(JSON.stringify(samples[samples.length - 1]));
}

await page.screenshot({ path: `${OUT}/07-gudang-thumbs.png` });

// Photo preview in this folder if any
const photo = page.locator('.td-file-card').filter({ hasText: /\.jpg|\.png|photo_/i }).first();
let photoPreview = null;
if (await photo.count()) {
  const p0 = Date.now();
  await photo.dblclick();
  await page.waitForTimeout(2500);
  const hasMedia = (await page.locator('.drive-preview-modal img, .drive-preview-modal video').count()) > 0;
  photoPreview = { ms: Date.now() - p0, hasMedia, pass: Date.now() - p0 <= 3500 };
  console.log(JSON.stringify({ photo_preview: photoPreview }));
  await page.screenshot({ path: `${OUT}/08-gudang-photo.png` });
  await page.keyboard.press('Escape');
}

const at3 = samples.find((s) => s.at_ms >= 2800 && s.at_ms <= 3500) || samples[2];
const report = {
  samples,
  at_3s: at3,
  thumb_ratio_3s: at3 && at3.cards ? at3.thumbs / at3.cards : 0,
  pass_cards_fast: samples[0]?.cards > 0 && samples[0].at_ms <= 3000,
  pass_thumbs_partial: (at3?.thumbs || 0) >= Math.min(6, Math.floor((at3?.cards || 0) * 0.3)),
  photoPreview,
  ok: true,
};
fs.writeFileSync(`${OUT}/e2e-gudang-report.json`, JSON.stringify(report, null, 2));
console.log('REPORT', JSON.stringify(report, null, 2));
process.exit(0);
