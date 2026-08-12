import path from 'path';

async function fetchTopicMessagesInfo() {
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

  // Fetch recent transfers from database to see exact items and message IDs
  const res = await evaluate(`
    (async function() {
      if (window.__TAURI_INTERNALS__) {
        try {
          const list = await window.__TAURI_INTERNALS__.invoke('studio_list_transfers', {});
          return list;
        } catch (e) {
          return { error: String(e) };
        }
      }
      return null;
    })()
  `);

  console.log('=== TRANSFERS RECORD IN DB ===');
  if (Array.isArray(res)) {
    res.slice(0, 3).forEach(job => {
      console.log(`\nJob ID: ${job.transferId} (State: ${job.state}, Done: ${job.doneCount}, Failed: ${job.failedCount})`);
      if (job.items) {
        job.items.forEach(i => {
          console.log(`  Item ${i.index + 1}: ${path.basename(i.path || '')} -> msgId: /${i.messageId} (state: ${i.state}, err: ${i.error})`);
        });
      }
    });
  }

  ws.close();
  process.exit(0);
}

fetchTopicMessagesInfo();
