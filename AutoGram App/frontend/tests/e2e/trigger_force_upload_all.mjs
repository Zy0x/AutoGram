import fs from 'fs';
import path from 'path';

const SOURCE_DIR = 'E:\\Data\\Upload\\Upload Fix\\New folder';
const TARGET_PEER_ID = -1003214112048;
const TARGET_TOPIC_ID = 9929;

async function forceUploadAllToTopic() {
  console.log('=== FORCE RESEND ALL 43 FILES AS 10-ALBUM GRIDS TO TOPIC 9929 ===');

  // 1. Fetch CDP target
  const listRes = await fetch('http://127.0.0.1:9230/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('1420')) || targets.find(t => t.type === 'page');

  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    console.error('Could not find active WebView2 page target in CDP.');
    process.exit(1);
  }

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

  // 2. Set Transfer Settings (Prevent Sticker Conversion = true, Album Group Size = 10)
  console.log('⚙️ Configuring Transfer Settings:');
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

  const files = fs.readdirSync(SOURCE_DIR)
    .filter(f => f.endsWith('.webp') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
    .sort();

  console.log(`Found ${files.length} files in ${SOURCE_DIR}`);
  const absoluteFilePaths = files.map(f => path.join(SOURCE_DIR, f));

  // 3. Trigger upload
  console.log(`🚀 Triggering upload to Group ${TARGET_PEER_ID}, Topic ${TARGET_TOPIC_ID} ...`);
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

  // 4. Wait for Quality Preflight Modal to render
  await new Promise(r => setTimeout(r, 2500));

  // 5. Click "Send all duplicates" / "Send anyway for all" on preflight modal header, then click primary confirm!
  console.log('👉 Overriding duplicate choices: Selecting "Send anyway" for ALL files...');
  const overrideRes = await evaluate(`
    (function() {
      // Find 'Send all duplicates' chip button
      const allBtns = Array.from(document.querySelectorAll('button'));
      const chipBtns = Array.from(document.querySelectorAll('.td-preflight-banner button.td-chip-btn, .td-preflight-banner button'));
      
      // Try chip button first
      if (chipBtns.length >= 2 && chipBtns[1] instanceof HTMLElement) {
        chipBtns[1].click();
      } else {
        // Fallback: click every individual 'Send anyway' / 'is-upload' choice button
        const uploadChoices = Array.from(document.querySelectorAll('.td-preflight-choice.is-upload'));
        uploadChoices.forEach(btn => {
          if (btn instanceof HTMLElement) btn.click();
        });
      }

      return { headerClicked: true };
    })()
  `);

  console.log('Header override action:', overrideRes);

  await new Promise(r => setTimeout(r, 1500));

  // 6. Click bottom primary confirm button (Queue 43, skip 0)
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

  console.log('Final Preflight Modal Submission:', confirmRes);

  ws.close();
  process.exit(0);
}

forceUploadAllToTopic();
