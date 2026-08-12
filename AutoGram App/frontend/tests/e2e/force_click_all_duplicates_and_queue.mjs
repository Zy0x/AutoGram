async function forceClickAllAndQueue() {
  console.log('=== FORCING ALL DUPLICATES TO BE SENT (QUEUE 43, SKIP 0) ===');

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

  // 1. Click "Send all duplicates" chip button on banner
  const clickSendAllRes = await evaluate(`
    (function() {
      const banner = document.querySelector('.td-preflight-banner');
      if (banner) {
        const chipBtns = Array.from(banner.querySelectorAll('button'));
        if (chipBtns.length >= 2 && chipBtns[1] instanceof HTMLElement) {
          chipBtns[1].click();
          return { success: true, clicked: chipBtns[1].innerText };
        }
      }

      // Fallback: click all 'is-upload' buttons
      const choices = Array.from(document.querySelectorAll('.td-preflight-choice.is-upload'));
      choices.forEach(b => { if (b instanceof HTMLElement) b.click(); });
      return { success: choices.length > 0, count: choices.length };
    })()
  `);

  console.log('Click "Send all duplicates" banner button result:', clickSendAllRes);

  await new Promise(r => setTimeout(r, 1000));

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

  console.log('Click Primary Confirm Result:', confirmRes);

  ws.close();
  process.exit(0);
}

forceClickAllAndQueue();
