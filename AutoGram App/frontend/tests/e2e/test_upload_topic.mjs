import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const CDP_URL = 'http://127.0.0.1:9230';
const SOURCE_DIR = 'E:\\Data\\Upload\\Upload Fix\\New folder';
const TARGET_PEER_ID = -1003214112048;
const TARGET_TOPIC_ID = 9929;

async function runTopicUpload() {
  console.log('=== REAL-TIME REMOTE TOPIC ALBUM 10 UPLOAD TEST ===');
  console.log(`Target Destination: Group ID ${TARGET_PEER_ID}, Topic ID ${TARGET_TOPIC_ID}`);
  console.log(`Connecting via CDP to desktop app frontend.exe at ${CDP_URL} ...`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.error(`Failed to connect to CDP port 9230. Error: ${err.message}`);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  const page = pages[0];

  console.log('Connected to page:', await page.title());

  // 1. Verify files in source directory
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory does not exist: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(SOURCE_DIR)
    .filter(f => f.endsWith('.webp') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
    .sort();

  console.log(`Found ${files.length} media files in source folder.`);
  const absoluteFilePaths = files.map(f => path.join(SOURCE_DIR, f));

  // 2. Configure Transfer Settings in app (Prevent Sticker Conversion = true, Album Group Size = 10, Group As Album = true)
  console.log('\n⚙️ Configuring Transfer Settings:');
  console.log('  • Prevent Converting to Sticker (Auto Transcode): ON (true)');
  console.log('  • Album Group Size: 10 Media/Album');
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
  });

  // 3. Trigger upload to specific Group Peer ID and Topic ID
  console.log(`\n🚀 Triggering Upload of 43 files to Group ${TARGET_PEER_ID}, Topic ${TARGET_TOPIC_ID} ...`);

  const triggerRes = await page.evaluate(async ({ filePaths, peerId, topicId }) => {
    if (typeof window.__autogram_runUpload !== 'function') {
      return { success: false, error: 'window.__autogram_runUpload is not available.' };
    }
    try {
      await window.__autogram_runUpload(filePaths, {
        targetFolderId: peerId,
        topicId: topicId,
        skipTopic: false,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  }, { filePaths: absoluteFilePaths, peerId: TARGET_PEER_ID, topicId: TARGET_TOPIC_ID });

  console.log('Upload trigger result:', triggerRes);
  await page.waitForTimeout(2500);

  // 4. Handle Quality Preflight confirmation if modal appears
  const clickedPreflight = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const preflightBtn = btns.find(b => b.innerText.includes('Queue 43') || b.innerText.includes('skip 0') || (b.className && b.className.includes('primary') && b.closest('.td-modal')));
    if (preflightBtn && preflightBtn instanceof HTMLElement) {
      preflightBtn.click();
      return { clicked: true, text: preflightBtn.innerText };
    }
    return { clicked: false };
  });

  if (clickedPreflight.clicked) {
    console.log('Preflight modal approved with button:', clickedPreflight.text);
  }

  await page.waitForTimeout(2000);

  // 5. Monitor transfer progress
  console.log('\n📊 Monitoring Topic Upload Progress...');
  let finished = false;
  let attempts = 0;
  let lastText = '';

  while (!finished && attempts < 120) {
    attempts++;
    await page.waitForTimeout(2000);

    const status = await page.evaluate(() => {
      const modalText = document.querySelector('.td-modal, .td-transfer-manager')?.innerText || document.body.innerText;
      const finishedMatches = modalText.match(/(\d+)\/43 done/i) || modalText.match(/(\d+)\s+selesai/i);
      const doneCount = finishedMatches ? parseInt(finishedMatches[1], 10) : 0;

      const items = Array.from(document.querySelectorAll('.td-transfer-row, .td-xfer-item, [data-transfer-id]'));
      const completedItems = items.filter(el => el.textContent.includes('100%') || el.classList.contains('is-finished') || el.classList.contains('completed')).length;
      const failedItems = items.filter(el => el.classList.contains('is-failed') || el.textContent.includes('Gagal') || el.textContent.includes('Error')).length;

      const isCompleted = modalText.includes('Completed') || modalText.includes('Selesai') || modalText.includes('43/43 done');

      return {
        textSnippet: modalText.slice(0, 300).replace(/\n/g, ' '),
        doneCount: Math.max(doneCount, completedItems),
        failedItems,
        isCompleted,
      };
    });

    if (status.textSnippet !== lastText) {
      lastText = status.textSnippet;
      console.log(`[${attempts * 2}s] Progress: ${status.doneCount}/43 finished, ${status.failedItems} failed.`);
    }

    if (status.isCompleted || (status.doneCount > 0 && status.doneCount + status.failedItems >= 43)) {
      finished = true;
    }
  }

  const screenshotPath = path.join(process.cwd(), 'topic_upload_final_result.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`\nFinal screenshot saved: ${screenshotPath}`);

  process.exit(0);
}

runTopicUpload();
