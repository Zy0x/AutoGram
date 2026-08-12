async function forceSendAnywayAndConfirm() {
  console.log('=== FORCING "SEND ANYWAY" FOR ALL DUPLICATES & CONFIRMING ===');

  const listRes = await fetch('http://127.0.0.1:9230/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page');

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

  // 1. Click "Send all duplicates" / "Kirim semua duplikat" chip button
  const clickHeaderRes = await evaluate(`
    (function() {
      const chipBtns = Array.from(document.querySelectorAll('.td-preflight-banner button.td-chip-btn, .td-preflight-banner button'));
      // The second button in banner is 'send_all_duplicates'
      const sendAllBtn = chipBtns[1] || chipBtns.find(b => b.innerText.includes('Send all') || b.innerText.includes('Kirim semua') || b.innerText.includes('upload'));
      if (sendAllBtn && sendAllBtn instanceof HTMLElement) {
        sendAllBtn.click();
        return { success: true, text: sendAllBtn.innerText };
      }
      return { success: false, buttons: chipBtns.map(b => b.innerText) };
    })()
  `);

  console.log('Clicked "Send all duplicates" header button:', clickHeaderRes);

  await new Promise(r => setTimeout(r, 1500));

  // 2. Click the primary confirm button (Queue 43, skip 0)
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

  console.log('Final Confirm Action Result:', confirmRes);

  ws.close();
  process.exit(0);
}

forceSendAnywayAndConfirm();
