import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

function httpGet(host, port, path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: host, port, path }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function run() {
  const json = await httpGet('::1', 9222, '/json');
  const targets = JSON.parse(json);
  const target = targets.find(t => t.url.includes('localhost:1420'));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.on('open', () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          JSON.stringify(
            Array.from(document.querySelectorAll('[data-msg-id], [data-drive-file]')).map(el => ({
              msgId: el.getAttribute('data-msg-id'),
              text: (el.textContent || '').slice(0, 50).replace(/\\s+/g, ' ')
            }))
          )
        `,
        returnByValue: true
      }
    }));
  });
  ws.on('message', raw => {
    const res = JSON.parse(raw);
    const val = JSON.parse(res.result?.value || '[]');
    console.log('Found cards in DOM:', val);
    ws.close();
  });
}

run();
