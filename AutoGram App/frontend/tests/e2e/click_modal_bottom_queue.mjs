import path from 'path';

async function clickBottomQueue() {
  console.log('=== CLICKING BOTTOM MODAL ACTION BUTTON ===');
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

  const clickRes = await evaluate(`
    (function() {
      const btns = Array.from(document.querySelectorAll('button'));
      const bottomBtn = btns.find(b => b.innerText.includes('Queue ') || b.innerText.includes('skip '));
      if (bottomBtn && bottomBtn instanceof HTMLElement) {
        bottomBtn.click();
        return { success: true, text: bottomBtn.innerText };
      }
      const primaryBtn = document.querySelector('.td-modal-footer button.primary, [role="dialog"] .primary');
      if (primaryBtn && primaryBtn instanceof HTMLElement) {
        primaryBtn.click();
        return { success: true, text: primaryBtn.innerText };
      }
      return { success: false, buttons: btns.map(b => b.innerText) };
    })()
  `);

  console.log('Click Bottom Queue Result:', clickRes);
  ws.close();
  process.exit(0);
}

clickBottomQueue();
