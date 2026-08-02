import WebSocket from 'ws';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpCmd(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    const handler = msg => {
      const res = JSON.parse(msg);
      if (res.id === id) {
        ws.removeListener('message', handler);
        if (res.error) reject(res.error);
        else resolve(res.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const res = await fetch('http://127.0.0.1:9225/json/list');
  const data = await res.json();
  const page = data.find(t => t.type === 'page' && t.url.includes('1420'));
  if (!page) {
    console.error('Page target not found');
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  const info = await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const els = Array.from(document.querySelectorAll('*'));
        const texts = els
          .filter(e => e.children.length === 0 && e.textContent.trim().length > 0)
          .map(e => e.textContent.trim())
          .filter((t, i, a) => a.indexOf(t) === i);
        return {
          title: document.title,
          url: window.location.href,
          sampleTexts: texts.slice(0, 80)
        };
      })()
    `,
    returnByValue: true
  });

  console.log('DOM Inspection:', JSON.stringify(info.result.value, null, 2));
  ws.close();
}

main();
