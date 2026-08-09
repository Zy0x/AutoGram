import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(fs.readFileSync(new URL('./config/remote_config.json', import.meta.url), 'utf8'));

async function openSettings(page) {
  if (await page.locator('.drive-preview-modal').count()) {
    await page.keyboard.press('Escape');
  }
  const back = page.locator('.td-rail-back').first();
  if (await back.count()) await back.click();
  await page.locator('button[aria-label]').filter({ hasText: /Settings|Pengaturan/i }).first().waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  await page.locator('button[aria-label]').filter({ hasText: /Settings|Pengaturan/i }).first().click();
  await page.locator('.settings-page').waitFor({ state: 'visible', timeout: 30_000 });
}

async function inspectViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const layout = document.querySelector('.settings-layout-sidebar');
    const nav = document.querySelector('.settings-sidebar-nav');
    const content = document.querySelector('.settings-tab-content');
    const items = [...document.querySelectorAll('.settings-sidebar-nav-item')];
    const back = document.querySelector('.settings-back-button');
    const rect = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      layoutDisplay: layout ? getComputedStyle(layout).display : null,
      layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : null,
      nav: rect(nav),
      content: rect(content),
      labels: items.map((item) => item.textContent?.trim() || ''),
      backText: back?.textContent?.trim() || '',
      hasApiDebugTab: items.some((item) => /API\s*&\s*Debug|API\s*dan\s*Debug/i.test(item.textContent || '')),
    };
  });
}

async function main() {
  const connection = await connect(config);
  const { page } = connection;
  try {
    await openSettings(page);
    const results = [];
    for (const [width, height] of [[1440, 900], [768, 900], [390, 844]]) {
      results.push(await inspectViewport(page, width, height));
    }
    const passed = results.every((result) =>
      result.labels.length === 5 &&
      !result.hasApiDebugTab &&
      /Session Hub|Pusat Sesi/i.test(result.backText) &&
      result.documentWidth <= result.viewport.width + 1
    );
    const report = { passed, results };
    const reportPath = path.join(os.tmpdir(), 'autogram-settings-ui-matrix.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = passed ? 0 : 2;
  } finally {
    connection.dispose();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
