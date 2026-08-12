import path from 'path';

async function capture() {
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

  const state = await evaluate(`
    (function() {
      const modals = Array.from(document.querySelectorAll('.td-modal, .td-dialog, [role="dialog"]')).map(el => el.innerText);
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean);
      const body = document.body.innerText.slice(0, 1000);
      return { modals, buttons, body };
    })()
  `);

  console.log('=== APP SCREEN STATE ===');
  console.log('Modals open:', state?.modals);
  console.log('Visible buttons:', state?.buttons?.slice(0, 15));

  ws.close();
  process.exit(0);
}

capture();
