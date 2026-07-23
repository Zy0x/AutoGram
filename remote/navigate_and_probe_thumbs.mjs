import fs from 'node:fs';
import path from 'node:path';
import { ensureDirs, SUITE_ROOT } from './core/paths.mjs';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(
  fs.readFileSync(path.join(SUITE_ROOT, 'config', 'remote_config.json'), 'utf8')
);

async function run() {
  ensureDirs();
  console.log('[probe-thumbs] Connecting to running AutoGram instance...');
  const conn = await connect(config);
  const page = conn.page;

  console.log('[probe-thumbs] Connected! Current URL:', page.url());

  // Click Drives sidebar item
  console.log('[probe-thumbs] Navigating to Drives view...');
  await page.evaluate(() => {
    const navItems = Array.from(document.querySelectorAll('button, div, span, a'));
    const drivesItem = navItems.find(el => (el.innerText || '').trim() === 'Drives');
    if (drivesItem) drivesItem.click();
  });

  await page.waitForTimeout(3000);

  // Click Gudang drive item if present
  console.log('[probe-thumbs] Selecting Gudang drive folder...');
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('*'));
    const gudang = items.find(el => (el.innerText || '').includes('#Gudang') && el.children.length === 0);
    if (gudang) gudang.click();
  });

  await page.waitForTimeout(4000);

  // Click Seimbang pill
  await page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll('.td-thumb-pill, button, span'));
    const seimbang = pills.find(p => (p.innerText || '').trim() === 'Seimbang');
    if (seimbang) seimbang.click();
  });

  await page.waitForTimeout(5000);

  // Measure thumbnail natural dimensions across the grid
  const metrics = await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll('.td-file-card img, img'));
    const details = images.map(img => ({
      src: img.src ? img.src.slice(0, 50) + '... (len ' + img.src.length + ')' : 'none',
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      complete: img.complete,
      className: img.className
    }));

    const crisps = details.filter(d => d.naturalWidth >= 180).length;
    const blurs = details.filter(d => d.naturalWidth > 0 && d.naturalWidth < 180).length;
    const placeholders = details.filter(d => d.naturalWidth === 0).length;

    return {
      totalImages: details.length,
      crispHDCount: crisps,
      blurryMicroCount: blurs,
      loadingCount: placeholders,
      sample: details.slice(0, 20)
    };
  });

  console.log('[probe-thumbs] RESULT METRICS:', JSON.stringify(metrics, null, 2));

  const shotPath = path.join(SUITE_ROOT, 'reports', 'gudang_thumbs_verification.png');
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log('[probe-thumbs] Screenshot saved to:', shotPath);

  if (conn && conn.stopHeartbeat) conn.stopHeartbeat();
}

run().catch(err => {
  console.error('[probe-thumbs] Error:', err);
  process.exit(1);
});
