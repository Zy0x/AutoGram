import fs from 'fs';
import path from 'path';

const SOURCE_DIR = 'E:\\Data\\Upload\\Upload Fix\\New folder';
const TARGET_PEER_ID = -1003214112048;
const TARGET_TOPIC_ID = 9929;

async function run() {
  console.log('=== RAW CDP TOPIC UPLOAD TEST ===');
  
  // 1. Fetch CDP target
  const listRes = await fetch('http://127.0.0.1:9230/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page');

  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    console.error('Could not find active WebView2 page target in CDP.');
    process.exit(1);
  }

  console.log('Found page target:', pageTarget.title, pageTarget.url);

  // 2. Connect via native WebSocket
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

  // 3. Configure Transfer Settings
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

  // 4. Verify Files
  const files = fs.readdirSync(SOURCE_DIR)
    .filter(f => f.endsWith('.webp') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
    .sort();

  console.log(`Found ${files.length} media files in source folder.`);
  const absoluteFilePaths = files.map(f => path.join(SOURCE_DIR, f));

  // 5. Trigger Upload to Group & Topic
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

  await new Promise(r => setTimeout(r, 2000));

  // 6. Preflight Modal click if needed
  const clickedPreflight = await evaluate(`
    (function() {
      const btns = Array.from(document.querySelectorAll('button'));
      const preflightBtn = btns.find(b => b.innerText.includes('Queue') || b.innerText.includes('skip') || (b.className && b.className.includes('primary') && b.closest('.td-modal')));
      if (preflightBtn && preflightBtn instanceof HTMLElement) {
        preflightBtn.click();
        return { clicked: true, text: preflightBtn.innerText };
      }
      return { clicked: false };
    })()
  `);

  if (clickedPreflight?.clicked) {
    console.log('Preflight modal approved:', clickedPreflight.text);
  }

  await new Promise(r => setTimeout(r, 2000));

  // 7. Monitor Upload Progress
  console.log('\n📊 Monitoring Topic Upload Progress...');
  for (let i = 1; i <= 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await evaluate(`
      (function() {
        const modalText = document.querySelector('.td-modal, .td-transfer-manager')?.innerText || document.body.innerText;
        const items = Array.from(document.querySelectorAll('.td-transfer-row, .td-xfer-item, [data-transfer-id]'));
        const completedItems = items.filter(el => el.textContent.includes('100%') || el.classList.contains('is-finished') || el.classList.contains('completed')).length;
        const failedItems = items.filter(el => el.classList.contains('is-failed') || el.textContent.includes('Gagal') || el.textContent.includes('Error') || el.textContent.includes('could not be proven')).length;

        return {
          doneCount: completedItems,
          failedCount: failedItems,
          snippet: modalText.slice(0, 250).replace(/\\n/g, ' '),
        };
      })()
    `);

    console.log(`[${i * 2}s] Done: ${status?.doneCount || 0}, Failed: ${status?.failedCount || 0}. Snippet: ${status?.snippet || ''}`);

    if ((status?.doneCount || 0) + (status?.failedCount || 0) >= 43) {
      break;
    }
  }

  ws.close();
  console.log('\n=== RAW CDP TOPIC UPLOAD TEST COMPLETED ===');
  process.exit(0);
}

run();
