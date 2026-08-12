import fs from 'fs';
import path from 'path';

const SOURCE_DIR = 'E:\\Data\\Upload\\Upload Fix\\New folder';
const TARGET_PEER_ID = -1003214112048;
const TARGET_TOPIC_ID = 9929;

async function forceResendAll43() {
  console.log('=== REAL-TIME REMOTE TEST: RESEND ALL 43 FILES (FORCE DUPLICATES INCLUDED) TO TOPIC 9929 ===');

  // 1. Fetch CDP target
  const listRes = await fetch('http://127.0.0.1:9230/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('1420')) || targets.find(t => t.type === 'page');

  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    console.error('Could not find active WebView2 page target in CDP.');
    process.exit(1);
  }

  console.log('Found page target:', pageTarget.title, pageTarget.url);

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const resolve = pending.get(data.id);
        pending.delete(data.id);
        resolve(data.result);
      }
    } catch {}
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  console.log('Connected to WebView2 CDP WebSocket!');

  function sendCDP(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await sendCDP('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value;
  }

  // 2. Configure Transfer Settings in LocalStorage
  console.log('\n⚙️ Configuring Transfer Settings:');
  console.log('  • Prevent Converting to Sticker (Auto Transcode): ON (true)');
  console.log('  • Album Group Size: 10 Media/Album');
  console.log('  • Group As Album: ON (true)');

  await evaluate(`
    (function() {
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
      return true;
    })()
  `);

  // 3. Verify Files in Source Directory
  const files = fs.readdirSync(SOURCE_DIR)
    .filter(f => f.endsWith('.webp') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
    .sort();

  console.log(`Found ${files.length} media files in source folder: ${SOURCE_DIR}`);
  const absoluteFilePaths = files.map(f => path.join(SOURCE_DIR, f));

  // 4. Trigger Upload of ALL 43 files
  console.log(`\n🚀 Triggering Upload of ${files.length} files to Group ${TARGET_PEER_ID}, Topic ${TARGET_TOPIC_ID} ...`);

  const filePathsJson = JSON.stringify(absoluteFilePaths);
  const triggerRes = await evaluate(`
    (async function() {
      if (typeof window.__autogram_runUpload !== 'function') {
        return { success: false, error: 'window.__autogram_runUpload is not available.' };
      }
      try {
        await window.__autogram_runUpload(${filePathsJson}, {
          targetFolderId: ${TARGET_PEER_ID},
          topicId: ${TARGET_TOPIC_ID},
          skipTopic: false,
        });
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err?.message || err) };
      }
    })()
  `);

  console.log('Upload trigger result:', triggerRes);

  await new Promise(r => setTimeout(r, 2500));

  // 5. Override Preflight Duplicate Choices: Click "Send all duplicates" header button!
  console.log('\n👉 Overriding duplicate choices: Clicking "Send all duplicates" chip button...');
  const overrideRes = await evaluate(`
    (function() {
      const banner = document.querySelector('.td-preflight-banner');
      if (banner) {
        const btns = Array.from(banner.querySelectorAll('button'));
        // Second button in banner is setAllDuplicates('upload')
        const sendAllBtn = btns[1] || btns.find(b => b.innerText.includes('Send all') || b.innerText.includes('Kirim semua'));
        if (sendAllBtn && sendAllBtn instanceof HTMLElement) {
          sendAllBtn.click();
          return { clicked: true, text: sendAllBtn.innerText };
        }
      }

      // Fallback: click every 'is-upload' choice button in list
      const uploadChoices = Array.from(document.querySelectorAll('.td-preflight-choice.is-upload'));
      let clicked = 0;
      uploadChoices.forEach(btn => {
        if (btn instanceof HTMLElement) {
          btn.click();
          clicked++;
        }
      });
      return { clicked: clicked > 0, count: clicked };
    })()
  `);

  console.log('Duplicate override action result:', overrideRes);

  await new Promise(r => setTimeout(r, 1500));

  // 6. Click bottom primary confirm button (Queue 43, skip 0)
  console.log('👉 Submitting Preflight Modal...');
  const confirmRes = await evaluate(`
    (function() {
      const confirmBtn = document.querySelector('.td-preflight-foot button.td-btn-primary, .td-modal-footer button.primary');
      if (confirmBtn && confirmBtn instanceof HTMLElement) {
        const text = confirmBtn.innerText;
        confirmBtn.click();
        return { success: true, text };
      }
      return { success: false };
    })()
  `);

  console.log('Preflight Modal Confirmed:', confirmRes);

  await new Promise(r => setTimeout(r, 2000));

  // 7. Monitor Upload Progress until ALL 43 files finish
  console.log('\n📊 Monitoring Live Upload Progress of ALL 43 Files...');
  for (let i = 1; i <= 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await evaluate(`
      (function() {
        const modalText = document.querySelector('.td-modal, .td-transfer-manager')?.innerText || document.body.innerText;
        const finishedMatches = modalText.match(/(\\d+)\\s*\\/\\s*43\\s+done/i) || modalText.match(/(\\d+)\\s+selesai/i);
        const doneCount = finishedMatches ? parseInt(finishedMatches[1], 10) : 0;

        const items = Array.from(document.querySelectorAll('.td-transfer-row, .td-xfer-item, [data-transfer-id]'));
        const completedItems = items.filter(el => el.textContent.includes('100%') || el.classList.contains('is-finished') || el.classList.contains('completed')).length;
        const failedItems = items.filter(el => el.classList.contains('is-failed') || el.textContent.includes('Gagal') || el.textContent.includes('Error')).length;
        const skippedItems = items.filter(el => el.textContent.includes('Skipped') || el.textContent.includes('Dilewati')).length;

        const isCompleted = modalText.includes('Completed') || modalText.includes('Selesai') || modalText.includes('43/43 done');

        return {
          doneCount: Math.max(doneCount, completedItems),
          failedItems,
          skippedItems,
          isCompleted,
          snippet: modalText.slice(0, 300).replace(/\\n/g, ' '),
        };
      })()
    `);

    console.log(`[${i * 3}s] Status: Done ${status?.doneCount || 0}/43, Failed: ${status?.failedItems || 0}, Skipped: ${status?.skippedItems || 0}. Snippet: ${status?.snippet || ''}`);

    if (status?.isCompleted || ((status?.doneCount || 0) + (status?.failedItems || 0) >= 43)) {
      console.log('\n✅ Upload of all 43 items finished!');
      break;
    }
  }

  ws.close();
  console.log('\n=== REAL-TIME REMOTE TEST FINISHED ===');
  process.exit(0);
}

forceResendAll43();
