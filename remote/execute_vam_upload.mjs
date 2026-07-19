import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const playwrightPath = path.resolve('../AutoGram App/frontend/node_modules/playwright');
const { chromium } = require(playwrightPath);

const targetFile = "E:/Data/Upload/Upload/VAM/3d anime girl gets creampie and tits play with - XNXX.COM.mp4";
const targetPeerId = -1003214112048;
const targetTopicId = 9;

async function run() {
  if (!fs.existsSync(targetFile)) {
    console.error(`Target upload file not found: ${targetFile}`);
    process.exit(1);
  }

  const stat = fs.statSync(targetFile);
  console.log(`Target file found: ${targetFile} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);

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

  console.log('Exposing page log events...');
  targetPage.on('console', msg => {
    const text = msg.text();
    if (text.includes('[EVENT]') || text.includes('drive') || text.includes('Upload') || text.includes('disconnected')) {
      console.log(`[Browser Console] ${text}`);
    }
  });

  console.log('Reloading page to load the latest backend fix and frontend assets...');
  await targetPage.reload();
  
  console.log('Waiting for active session and target channel to load in the sidebar...');
  try {
    await targetPage.waitForSelector('[data-drop-key="drive:-1003214112048"]', { timeout: 20000 });
    console.log('Target channel is loaded and visible in sidebar!');
  } catch (err) {
    console.error('Timeout waiting for target channel to load. Page text:', await targetPage.innerText('body'));
    await browser.close();
    process.exit(1);
  }

  // Ensure triggerRemoteUpload is ready
  const hasBackdoor = await targetPage.evaluate(() => typeof window.triggerRemoteUpload === 'function');
  if (!hasBackdoor) {
    console.error('FAILED to find triggerRemoteUpload backdoor.');
    await browser.close();
    process.exit(1);
  }

  // Trigger!
  console.log(`Triggering upload of 1 file to channel ${targetPeerId} topic ${targetTopicId}...`);
  await targetPage.evaluate(({ paths, peerId, topicId }) => {
    window.triggerRemoteUpload(paths, peerId, topicId);
  }, { paths: [targetFile], peerId: targetPeerId, topicId: targetTopicId });

  console.log('Upload successfully triggered! Monitoring progress...');

  // Periodically check transfer status
  let finished = false;
  let attempts = 0;
  while (!finished && attempts < 400) {
    await targetPage.waitForTimeout(5000);
    attempts++;

    const status = await targetPage.evaluate(() => {
      const t = window.transfer;
      if (!t) return { active: false, empty: true };
      return {
        active: t.active,
        overallPercent: t.overallPercent,
        transferredBytes: t.transferred,
        totalBytes: t.total,
        direction: t.direction,
        itemsCount: t.items ? t.items.length : 0,
        doneCount: t.items ? t.items.filter(i => i.status === 'done').length : 0,
        skippedCount: t.items ? t.items.filter(i => i.status === 'skipped').length : 0,
        failedCount: t.items ? t.items.filter(i => i.status === 'failed').length : 0,
      };
    }).catch(err => {
      console.log('Error evaluating transfer state:', err.message);
      return null;
    });

    if (!status) continue;
    if (status.empty) {
      console.log('Transfer state is empty, waiting...');
      continue;
    }

    const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
    console.log(`[PROGRESS] ${status.overallPercent}% | Done: ${status.doneCount} | Skipped: ${status.skippedCount} | Failed: ${status.failedCount} | Active: ${status.active}`);

    if (!status.active && status.itemsCount > 0) {
      console.log('Transfer finished active state.');
      finished = true;
      
      // Take a final screenshot
      const finalShot = path.resolve('reports/screenshots/vam_upload_result.png');
      await targetPage.screenshot({ path: finalShot });
      console.log(`Saved final result screenshot to: ${finalShot}`);
      
      if (status.failedCount > 0) {
        console.log(`WARNING: Upload finished but ${status.failedCount} files failed.`);
      } else if (status.skippedCount > 0) {
        console.log('WARNING: File was SKIPPED by the duplicate checker.');
      } else {
        console.log('SUCCESS: File uploaded successfully without errors!');
      }
    }
  }

  console.log('Finished remote execution.');
}

run().catch(console.error);
