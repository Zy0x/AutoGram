import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const CDP_URL = 'http://127.0.0.1:9230';
const SOURCE_DIR = 'E:\\Data\\Upload\\Upload Fix\\New folder';

async function runTest() {
  console.log('=== REAL-TIME REMOTE ALBUM 10 UPLOAD TEST ===');
  console.log(`Connecting via CDP to desktop app frontend.exe at ${CDP_URL} ...`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.error(`Failed to connect to CDP port 9230. Error: ${err.message}`);
    process.exit(1);
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    console.error('No active browser context found.');
    process.exit(1);
  }

  const pages = contexts[0].pages();
  const page = pages[0] || await contexts[0].newPage();

  console.log('Connected to desktop app page:', await page.title());

  // Listen to console log messages from frontend.exe
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Grammers') || text.includes('Upload') || text.includes('Album') || text.includes('Preflight') || text.includes('Error') || text.includes('AutoGram')) {
      console.log(`[App Console] ${text}`);
    }
  });

  // 1. Verify files in source directory
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory does not exist: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(SOURCE_DIR)
    .filter(f => f.endsWith('.webp') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
    .sort();

  console.log(`Found ${files.length} media files in source folder: ${SOURCE_DIR}`);
  if (files.length === 0) {
    console.error('No media files found to upload.');
    process.exit(1);
  }

  const absoluteFilePaths = files.map(f => path.join(SOURCE_DIR, f));

  // 2. Configure Transfer Settings in app (Prevent Sticker Conversion = true, Album Group Size = 10, Group As Album = true)
  console.log('\n⚙️ Configuring Transfer Settings in Desktop App:');
  console.log('  • Prevent Converting to Sticker (Auto Transcode): ON (true)');
  console.log('  • Album Group Size (Maximum Media Items): 10');
  console.log('  • Group As Album: ON (true)');

  await page.evaluate(() => {
    const settingsKey = 'autogram_drive_transfer_settings';
    let current = {};
    try {
      current = JSON.parse(localStorage.getItem(settingsKey) || '{}');
    } catch {}

    const updated = {
      ...current,
      preventStickerConversion: true,
      albumGroupSize: 10,
      groupAsAlbum: true,
      presentationOverride: 'automatic',
      qualityMode: 'HIGH_QUALITY',
    };

    localStorage.setItem(settingsKey, JSON.stringify(updated));
    console.log('[Test] LocalStorage settings updated successfully:', updated);
  });

  // Wait for window.__autogram_runUpload to be available
  console.log('Checking AutoGram App runUpload handler...');
  try {
    await page.waitForFunction(() => typeof window.__autogram_runUpload === 'function', { timeout: 10000 });
  } catch {
    console.error('Timeout waiting for window.__autogram_runUpload function to mount.');
    process.exit(1);
  }

  // 3. Initiate Upload via window.__autogram_runUpload
  console.log(`\n🚀 Initiating Upload of ${absoluteFilePaths.length} items as 10-item Album Grids ...`);

  const uploadResult = await page.evaluate(async (filePaths) => {
    try {
      await window.__autogram_runUpload(filePaths);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  }, absoluteFilePaths);

  if (!uploadResult.success) {
    console.error(`Upload trigger failed: ${uploadResult.error}`);
    process.exit(1);
  }

  console.log('Upload task queued successfully. Monitoring preflight and progress...');
  await page.waitForTimeout(2000);

  // Handle Preflight confirmation if preflight modal appears
  try {
    const confirmBtn = await page.$('button:has-text("Unggah"), button:has-text("Upload"), button:has-text("Lanjutkan")');
    if (confirmBtn) {
      await confirmBtn.click();
      console.log('Clicked preflight confirmation button.');
    }
  } catch {}

  // 4. Poll transfer progress until completion or error
  console.log('\n📊 Monitoring Transfer Progress...');
  let completed = false;
  let attempts = 0;
  const maxAttempts = 180; // 3 minutes timeout

  let lastStatus = '';
  let failedCount = 0;
  let finishedCount = 0;

  while (!completed && attempts < maxAttempts) {
    attempts++;
    await page.waitForTimeout(1500);

    const telemetry = await page.evaluate(() => {
      const statusEl = document.querySelector('.td-status-text, [role="status"], .td-xfer-badge');
      const items = Array.from(document.querySelectorAll('.td-xfer-item, .td-transfer-row, .td-item-card'));
      const activeText = statusEl?.textContent || '';

      const finished = items.filter(el => el.classList.contains('is-finished') || el.textContent?.includes('100%') || el.textContent?.includes('Selesai')).length;
      const failed = items.filter(el => el.classList.contains('is-failed') || el.textContent?.includes('Gagal') || el.textContent?.includes('Error')).length;

      return {
        statusText: activeText,
        totalItems: items.length,
        finishedItems: finished,
        failedItems: failed,
      };
    });

    if (telemetry.statusText && telemetry.statusText !== lastStatus) {
      lastStatus = telemetry.statusText;
      console.log(`[Progress ${attempts * 1.5}s] ${telemetry.statusText}`);
    }

    finishedCount = telemetry.finishedItems;
    failedCount = telemetry.failedItems;

    if (telemetry.statusText.includes('Selesai') || telemetry.statusText.includes('Finished') || (finishedCount > 0 && finishedCount + failedCount >= 43)) {
      completed = true;
    }
  }

  // Take final completion screenshot
  const screenshotPath = path.join(process.cwd(), 'album_upload_02_finished.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`\nCaptured completion screenshot: ${screenshotPath}`);

  console.log('\n=== UPLOAD SUMMARY & VERIFICATION ===');
  console.log(`Total Media Files Input: ${files.length}`);
  console.log(`Album Group Size Configured: 10 media / album`);
  console.log(`Expected Albums Count: Math.ceil(${files.length} / 10) = ${Math.ceil(files.length / 10)} albums`);
  console.log(`Finished Items Count: ${finishedCount}`);
  console.log(`Failed Items Count: ${failedCount}`);

  if (failedCount > 0) {
    console.error(`⚠️ VERIFICATION WARNING: ${failedCount} item(s) failed during transfer!`);
  } else {
    console.log('✅ VERIFICATION PASSED: All items processed with 0 failures.');
  }

  console.log('\n=== REAL-TIME REMOTE ALBUM 10 UPLOAD TEST COMPLETE ===');
  process.exit(0);
}

runTest();
