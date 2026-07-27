import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

function httpGetIPv6(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '::1', port, path, family: 6 }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function run() {
  const json = await httpGetIPv6(9222, '/json');
  const targets = JSON.parse(json);
  const target = targets.find(t => t.url.includes('localhost:1420') && t.type === 'page');
  if (!target) {
    console.error('AutoGram page target not found!');
    process.exit(1);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          (() => {
            const allCards = Array.from(document.querySelectorAll('[data-msg-id], [data-drive-file]'));
            const card73 = document.querySelector('[data-msg-id="73"]');
            const summary = allCards.map(el => {
              const id = el.getAttribute('data-msg-id');
              const img = el.querySelector('img');
              return {
                id,
                hasImg: !!img,
                imgSrc: img ? img.src.slice(0, 80) : null,
                isPlaceholder: img ? img.classList.contains('td-thumb-is-placeholder') : false,
                text: (el.textContent || '').slice(0, 60).replace(/\\s+/g, ' ')
              };
            });
            return JSON.stringify({
              url: window.location.href,
              totalCards: allCards.length,
              card73: card73 ? {
                id: card73.getAttribute('data-msg-id'),
                html: card73.outerHTML.slice(0, 400),
                imgSrc: card73.querySelector('img')?.src.slice(0, 100),
                isPlaceholder: card73.querySelector('img')?.classList.contains('td-thumb-is-placeholder')
              } : null,
              cards: summary.slice(0, 20)
            });
          })()
        `,
        returnByValue: true
      }
    }));
  });

  ws.on('message', raw => {
    const res = JSON.parse(raw);
    const val = res.result?.result?.value;
    if (val) {
      console.log('CDP DOM Result:\n', JSON.stringify(JSON.parse(val), null, 2));
    } else {
      console.log('Raw CDP response:\n', JSON.stringify(res, null, 2));
    }
    ws.close();
  });
}

run().catch(console.error);
