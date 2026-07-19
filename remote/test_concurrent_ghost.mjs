import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const playwrightPath = path.resolve('../AutoGram App/frontend/node_modules/playwright');
const { chromium } = require(playwrightPath);

const targetPeerId = -1003214112048;
const targetTopicId = 5;
const uploadDir = 'E:/Data/Upload/Upload Fix/3D Donghua';

async function run() {
  if (!fs.existsSync(uploadDir)) {
    console.error(`Upload directory not found: ${uploadDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(uploadDir)
    .map(f => path.join(uploadDir, f))
    .filter(p => fs.statSync(p).isFile());

  console.log(`Found ${files.length} files to upload in ${uploadDir}`);

  console.log('Connecting to AutoGram WebView2 via CDP...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const contexts = browser.contexts();
  let targetPage = null;
  for (const context of contexts) {
    for (const page of context.pages()) {
      if (page.url().includes('1420') || page.url().includes('tauri')) {
        targetPage = page;
      }
    }
  }

  if (!targetPage) {
    console.error('AutoGram page not found.');
    await browser.close();
    process.exit(1);
  }

  // Ensure screenshot dirs exist
  fs.mkdirSync('reports/screenshots', { recursive: true });

  console.log('Exposing page log events...');
  targetPage.on('console', msg => {
    const text = msg.text();
    if (text.includes('[EVENT]') || text.includes('drive') || text.includes('Upload') || text.includes('Ghost') || text.includes('session')) {
      console.log(`[Browser Console] ${text}`);
    }
  });

  // Verify triggerRemoteUpload backdoor
  const hasBackdoor = await targetPage.evaluate(() => typeof window.triggerRemoteUpload === 'function');
  if (!hasBackdoor) {
    console.error('FAILED to find triggerRemoteUpload backdoor. Reloading page...');
    await targetPage.reload();
    await targetPage.waitForTimeout(3000);
  }

  // Trigger!
  console.log(`Triggering upload of ${files.length} files to channel ${targetPeerId} topic ${targetTopicId}...`);
  await targetPage.evaluate(({ paths, peerId, topicId }) => {
    window.triggerRemoteUpload(paths, peerId, topicId);
  }, { paths: files, peerId: targetPeerId, topicId: targetTopicId });

  console.log('Upload successfully triggered! Waiting for transfer state to activate...');
  await targetPage.waitForTimeout(2000);

  // Take first screenshot
  await targetPage.screenshot({ path: 'reports/screenshots/01_upload_started.png' });
  console.log('Saved screenshot 01_upload_started.png');

  // Let's locate the first video card in the explorer
  console.log('Locating first video card to test concurrent streaming...');
  const videoCard = targetPage.locator('.td-file-card.is-video').first();
  await videoCard.waitFor({ timeout: 10000 });
  
  console.log('Double clicking video card to open preview (starting ghost session)...');
  await videoCard.dblclick();

  // Wait for preview modal to appear
  const modal = targetPage.locator('.drive-preview-modal');
  await modal.waitFor({ timeout: 15000 });
  console.log('Ghost Session preview modal opened successfully!');

  // Take screenshot showing concurrent upload + preview open
  await targetPage.screenshot({ path: 'reports/screenshots/02_preview_open.png' });
  console.log('Saved screenshot 02_preview_open.png');

  // Monitor video streaming and upload progress concurrently for 15 seconds
  console.log('--- MONITORING CONCURRENT STREAM & UPLOAD ---');
  for (let i = 0; i < 5; i++) {
    await targetPage.waitForTimeout(3000);
    
    // Evaluate video element play status
    const videoStats = await targetPage.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return { found: false };
      return {
        found: true,
        currentTime: v.currentTime,
        paused: v.paused,
        readyState: v.readyState,
        src: v.src,
        duration: v.duration
      };
    });

    // Evaluate upload status
    const uploadStats = await targetPage.evaluate(() => {
      const t = window.transfer;
      if (!t) return { active: false, empty: true };
      return {
        active: t.active,
        overallPercent: t.overallPercent,
        transferredBytes: t.transferred,
        totalBytes: t.total,
        doneCount: t.items ? t.items.filter(i => i.status === 'done').length : 0,
        itemsCount: t.items ? t.items.length : 0,
      };
    });

    const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
    console.log(`[Status t=${(i+1)*3}s]`);
    if (uploadStats.empty) {
      console.log(`  Upload: (not active yet)`);
    } else {
      console.log(`  Upload: ${uploadStats.overallPercent}% | ${uploadStats.doneCount}/${uploadStats.itemsCount} done | ${mb(uploadStats.transferredBytes)} MB / ${mb(uploadStats.totalBytes)} MB | Active: ${uploadStats.active}`);
    }
    if (videoStats.found) {
      console.log(`  Video Stream: time=${videoStats.currentTime.toFixed(2)}s / ${videoStats.duration ? videoStats.duration.toFixed(2) + 's' : '?'} | readyState=${videoStats.readyState} | paused=${videoStats.paused}`);
    } else {
      console.log(`  Video Stream: (video element not found in modal yet)`);
    }
  }

  // Close the preview modal
  console.log('Closing preview modal (initiating grace period to main session)...');
  await targetPage.click('.drive-preview-close');
  await targetPage.waitForTimeout(1000);

  await targetPage.screenshot({ path: 'reports/screenshots/03_preview_closed.png' });
  console.log('Saved screenshot 03_preview_closed.png');

  // Monitor remaining upload queue until it is finished
  console.log('--- MONITORING REMAINING UPLOAD TO COMPLETION ---');
  let finished = false;
  let attempts = 0;
  while (!finished && attempts < 300) {
    await targetPage.waitForTimeout(5000);
    attempts++;

    const uploadStats = await targetPage.evaluate(() => {
      const t = window.transfer;
      if (!t) return { active: false, empty: true };
      return {
        active: t.active,
        overallPercent: t.overallPercent,
        transferredBytes: t.transferred,
        totalBytes: t.total,
        doneCount: t.items ? t.items.filter(i => i.status === 'done').length : 0,
        itemsCount: t.items ? t.items.length : 0,
        failedCount: t.items ? t.items.filter(i => i.status === 'failed').length : 0,
      };
    });

    if (!uploadStats || uploadStats.empty) {
      console.log('Waiting for active transfer state...');
      continue;
    }

    const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
    console.log(`[Upload Progress] ${uploadStats.overallPercent}% | ${uploadStats.doneCount}/${uploadStats.itemsCount} files done | ${mb(uploadStats.transferredBytes)} MB / ${mb(uploadStats.totalBytes)} MB | Active: ${uploadStats.active} | Failed: ${uploadStats.failedCount}`);

    if (!uploadStats.active && uploadStats.itemsCount > 0) {
      console.log('Upload queue completed!');
      finished = true;

      await targetPage.screenshot({ path: 'reports/screenshots/04_upload_finished.png' });
      console.log('Saved screenshot 04_upload_finished.png');

      if (uploadStats.failedCount > 0) {
        console.log(`WARNING: Finished but ${uploadStats.failedCount} files failed.`);
      } else {
        console.log('SUCCESS: All files uploaded successfully while concurrent media streaming was tested!');
      }
    }
  }

  console.log('Disconnecting CDP browser...');
  await browser.close();
}

run().catch(console.error);
