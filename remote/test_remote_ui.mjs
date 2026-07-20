import fs from 'node:fs';
import path from 'node:path';
import { connect } from './core/remote_connector.mjs';
import { SUITE_ROOT } from './core/paths.mjs';

const config = JSON.parse(
  fs.readFileSync(path.join(SUITE_ROOT, 'config', 'remote_config.json'), 'utf8')
);

async function run() {
  console.log("Connecting to remote CDP...");
  const { page, dispose } = await connect(config);
  try {
    // 1. Initial State Screenshot
    console.log("Taking initial screenshot...");
    await page.screenshot({ path: 'reports/screenshots/01_drive_initial.png' });

    // 2. Open Remote Upload Modal
    console.log("Clicking Remote URL button...");
    const remoteBtn = page.locator('button[title="Remote Upload (URL)"]');
    await remoteBtn.click();
    await page.waitForTimeout(1000);

    // 3. Take Modal Screenshot (for color/contrast verification)
    console.log("Taking modal screenshot...");
    await page.screenshot({ path: 'reports/screenshots/02_remote_modal.png' });

    // 4. Fill URL
    console.log("Filling remote URL...");
    await page.fill('#td-remote-url', 'https://igapkwa02.b-cdn.net/InstaPro2-ADC.apk');
    await page.waitForTimeout(500);

    // 5. Submit Upload
    console.log("Submitting remote upload...");
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // 6. Monitor progress
    console.log("Waiting for upload to start/complete...");
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `reports/screenshots/03_upload_progress_${i}.png` });
      console.log(`Saved progress screenshot ${i}...`);
    }

    console.log("E2E Remote test execution completed successfully!");
  } catch (err) {
    console.error("Error during E2E test execution:", err);
  } finally {
    dispose();
  }
}

run().catch(console.error);
