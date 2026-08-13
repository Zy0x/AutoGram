import fs from 'fs';
import path from 'path';

const SOURCE_DIR = 'E:\\Data\\Upload\\Upload Fix\\New Folder 2';
const TARGET_PEER_ID = -1003214112048;
const TARGET_TOPIC_ID = 9929;

async function runFreshRemoteUploadTest() {
  console.log('=== REAL-TIME REMOTE E2E TEST: UPLOAD NEW FOLDER 2 (FRESH CODEBASE) ===');
  console.log(`Source Folder: ${SOURCE_DIR}`);
  console.log(`Target Destination: Group ID ${TARGET_PEER_ID}, Topic ID ${TARGET_TOPIC_ID}`);

  // 1. Fetch CDP target
  const listRes = await fetch('http://127.0.0.1:9230/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('1420')) || targets.find(t => t.type === 'page');

  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    console.error('Could not find active WebView2 page target in CDP.');
    process.exit(1);
  }

  console.log('Connected to page target:', pageTarget.title, pageTarget.url);

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

  // 2. Configure Transfer Settings
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

  // 3. Scan files
  const files = fs.readdirSync(SOURCE_DIR)
    .filter(f => f.endsWith('.webp') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
    .sort();

  console.log(`Found ${files.length} media files in source folder.`);
  const absoluteFilePaths = files.map(f => path.join(SOURCE_DIR, f));

  // 4. Trigger upload
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

  // 5. Handle Quality Preflight Modal: select "Send all duplicates" if preflight opens
  console.log('👉 Handling Quality Preflight Modal...');
  const preflightRes = await evaluate(`
    (function() {
      const banner = document.querySelector('.td-preflight-banner');
      if (banner) {
        const chipBtns = Array.from(banner.querySelectorAll('button'));
        if (chipBtns.length >= 2 && chipBtns[1] instanceof HTMLElement) {
          chipBtns[1].click();
        }
      }

      const uploadChoices = Array.from(document.querySelectorAll('.td-preflight-choice.is-upload'));
      uploadChoices.forEach(b => { if (b instanceof HTMLElement) b.click(); });

      const confirmBtn = document.querySelector('.td-preflight-foot button.td-btn-primary, .td-modal-footer button.primary');
      if (confirmBtn && confirmBtn instanceof HTMLElement) {
        const text = confirmBtn.innerText;
        confirmBtn.click();
        return { success: true, text };
      }

      const anyQueueBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Queue') || b.innerText.includes('skip'));
      if (anyQueueBtn && anyQueueBtn instanceof HTMLElement) {
        const text = anyQueueBtn.innerText;
        anyQueueBtn.click();
        return { success: true, text };
      }

      return { success: false };
    })()
  `);

  console.log('Preflight submission result:', preflightRes);

  await new Promise(r => setTimeout(r, 2000));

  // 6. Monitor live progress
  console.log('\n📊 Monitoring Live Upload Progress...');
  for (let i = 1; i <= 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await evaluate(`
      (function() {
        const modalText = document.querySelector('.td-modal, .td-transfer-manager')?.innerText || document.body.innerText;
        const finishedMatches = modalText.match(/(\\d+)\\s*\\/\\s*10\\s+done/i) || modalText.match(/(\\d+)\\s+selesai/i);
        const doneCount = finishedMatches ? parseInt(finishedMatches[1], 10) : 0;

        const items = Array.from(document.querySelectorAll('.td-transfer-row, .td-xfer-item, [data-transfer-id]'));
        const completedItems = items.filter(el => el.textContent.includes('100%') || el.classList.contains('is-finished') || el.classList.contains('completed')).length;
        const failedItems = items.filter(el => el.classList.contains('is-failed') || el.textContent.includes('Gagal') || el.textContent.includes('Error')).length;

        const isCompleted = modalText.includes('Completed') || modalText.includes('Selesai') || modalText.includes('10/10 done');

        return {
          doneCount: Math.max(doneCount, completedItems),
          failedItems,
          isCompleted,
          snippet: modalText.slice(0, 250).replace(/\\n/g, ' '),
        };
      })()
    `);

    console.log(`[${i * 2}s] Status: ${status?.doneCount || 0}/10 finished, ${status?.failedItems || 0} failed. Snippet: ${status?.snippet || ''}`);

    if (status?.isCompleted || ((status?.doneCount || 0) + (status?.failedItems || 0) >= 10)) {
      console.log('\n✅ Frontend Transfer Manager finished!');
      break;
    }
  }

  // 7. Audit Rust Backend SQLite Record
  console.log('\n🔍 AUDITING RUST BACKEND SQLITE TRANSFERS...');
  const dbAudit = await evaluate(`
    (async function() {
      if (window.__TAURI_INTERNALS__) {
        try {
          const list = await window.__TAURI_INTERNALS__.invoke('studio_list_transfers', {});
          const latest = list && list.length ? list[0] : null;
          return latest;
        } catch (e) {
          return { error: String(e) };
        }
      }
      return null;
    })()
  `);

  console.log('\n=== BACKEND AUDIT RESULT ===');
  if (dbAudit && !dbAudit.error) {
    console.log(`Transfer ID: ${dbAudit.transferId}`);
    console.log(`State: ${dbAudit.state}`);
    console.log(`Done Count: ${dbAudit.doneCount}`);
    console.log(`Failed Count: ${dbAudit.failedCount}`);
    console.log('Items Detail:');
    if (Array.isArray(dbAudit.items)) {
      dbAudit.items.forEach(item => {
        console.log(`  [Item ${item.index + 1}] file="${path.basename(item.path)}" -> Message ID: /${item.messageId} (state: ${item.state}, err: ${item.error})`);
      });
    }
  } else {
    console.log('Backend DB Audit query result:', dbAudit);
  }

  ws.close();
  console.log('\n=== REMOTE E2E UPLOAD TEST COMPLETED ===');
  process.exit(0);
}

runFreshRemoteUploadTest();
