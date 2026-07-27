import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
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
          (() => {
            const body = document.body ? document.body.innerText.slice(0, 500) : 'NO BODY';
            const modal = document.querySelector('.drive-preview-modal, .drive-preview-backdrop');
            const items = Array.from(document.querySelectorAll('*'))
              .filter(el => (el.className || '').toString().includes('card') || (el.className || '').toString().includes('item') || (el.className || '').toString().includes('row'))
              .slice(0, 10)
              .map(el => ({ tag: el.tagName, cls: el.className, txt: (el.textContent || '').slice(0, 40) }));
            return JSON.stringify({ bodySnippet: body, hasModal: !!modal, items });
          })()
        `,
        returnByValue: true
      }
    }));
  });
  ws.on('message', raw => {
    const res = JSON.parse(raw);
    console.log('DOM State:', JSON.parse(res.result?.value || '{}'));
    ws.close();
  });
}

run();
