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
    ws.send(JSON.stringify({ id: 10, method: 'Console.enable' }));
    ws.send(JSON.stringify({ id: 11, method: 'Runtime.enable' }));

    setTimeout(() => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (async () => {
              try {
                const ipc = window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.core?.invoke;
                const activeSession = localStorage.getItem('autogram_drive_session') || 'Lavender';
                console.log('[PROBE] Active session:', activeSession);

                // Fetch account list via tg_list_accounts or tg_get_credentials
                let apiId = 4;
                let apiHash = '0123456789abcdef0123456789abcdef';
                try {
                  const accs = await ipc('tg_list_accounts');
                  console.log('[PROBE] Accounts:', JSON.stringify(accs));
                  if (accs?.data?.[0]) {
                    apiId = Number(accs.data[0].apiId || 4);
                    apiHash = accs.data[0].apiHash || apiHash;
                  }
                } catch (e) {
                  console.log('[PROBE] list_accounts failed:', e);
                }

                console.log('[PROBE] Invoking tg_thumbs_batch for mid 73 with session:', activeSession);
                const res = await ipc('tg_thumbs_batch', {
                  request: {
                    session: activeSession,
                    apiId: apiId,
                    apiHash: apiHash,
                    chatId: '-1004468191168',
                    messageIds: [73],
                    quality: 'jelas'
                  }
                });
                return JSON.stringify({ activeSession, res });
              } catch (e) {
                return JSON.stringify({ success: false, error: String(e), stack: e.stack });
              }
            })()
          `,
          awaitPromise: true,
          returnByValue: true
        }
      }));
    }, 300);
  });

  ws.on('message', raw => {
    const res = JSON.parse(raw);
    if (res.method === 'Console.messageAdded' || res.method === 'Runtime.consoleAPICalled') {
      const args = res.params?.args || res.params?.message?.parameters || [];
      const txt = args.map(a => a.value || a.description || '').join(' ');
      if (txt) console.log('[BROWSER CONSOLE]', txt);
    }
    if (res.id === 1) {
      const val = res.result?.result?.value;
      console.log('[RPC RESPONSE]\n', val ? JSON.stringify(JSON.parse(val), null, 2) : res);
      setTimeout(() => ws.close(), 2000);
    }
  });
}

run().catch(console.error);
