import fs from 'node:fs';
import path from 'node:path';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(fs.readFileSync(new URL('./config/remote_config.json', import.meta.url), 'utf8'));

async function openSettings(page) {
  if (await page.locator('.settings-page').count()) return;
  while (await page.locator('.drive-preview-modal').count()) {
    const close = page.locator('.drive-preview-modal .drive-preview-close').last();
    if (await close.count()) await close.click({ force: true });
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  const back = page.locator('.td-rail-back').first();
  if (await back.count()) await back.click({ force: true });
  const button = page.locator('button[aria-label]').filter({ hasText: /Settings|Pengaturan/i }).first();
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  await button.click();
  await page.locator('.settings-page').waitFor({ state: 'visible', timeout: 30_000 });
}

const connection = await connect(config);
const { page } = connection;
try {
  await page.evaluate(() => {
    localStorage.removeItem('autogram_drive_locations_v1_QA');
    localStorage.removeItem('autogram_drive_pins_v2_QA');
    sessionStorage.removeItem('drive_root_files_QA');
    if (localStorage.getItem('autogram_drive_upload_queue') === '[{"id":"qa-preserve"}]') {
      localStorage.removeItem('autogram_drive_upload_queue');
    }
  });
  await openSettings(page);
  const storageTab = page.locator('.settings-sidebar-nav-item').filter({
    hasText: /Storage|Cache|Penyimpanan/i,
  }).first();
  await storageTab.click();

  const clearButton = page.getByRole('button', { name: /Clear All Cache|Hapus Semua Cache/i }).first();
  await clearButton.waitFor({ state: 'visible', timeout: 20_000 });
  await clearButton.click();

  const confirm = page.getByRole('button', { name: /Yes, Clear All Cache|Ya, Hapus Semua Cache/i }).first();
  await confirm.waitFor({ state: 'visible', timeout: 10_000 });
  await confirm.click();

  const result = page.locator('.settings-cache-result.is-success');
  await result.waitFor({ state: 'visible', timeout: 45_000 });
  const report = await page.evaluate(() => {
    const status = document.querySelector('.settings-cache-result.is-success');
    const transfer = [...document.querySelectorAll('*')].find((element) =>
      /Transfer Database|Database Transfer/i.test(element.textContent || ''),
    );
    return {
      statusText: status?.textContent?.replace(/\s+/g, ' ').trim() || '',
      statusRole: status?.getAttribute('role') || '',
      transferDatabaseSectionPresent: Boolean(transfer),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  report.passed = Boolean(report.statusText) && report.statusRole === 'status' &&
    report.transferDatabaseSectionPresent && !report.horizontalOverflow;
  const output = path.resolve(new URL('./reports/clear-all-ui.json', import.meta.url).pathname.slice(1));
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 2);
} catch (error) {
  console.error(error);
  process.exit(1);
} finally {
  connection.dispose();
}
