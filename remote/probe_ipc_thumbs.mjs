import fs from 'node:fs';
import path from 'node:path';
import { SUITE_ROOT } from './core/paths.mjs';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(
  fs.readFileSync(path.join(SUITE_ROOT, 'config', 'remote_config.json'), 'utf8')
);

async function probeIPC() {
  console.log('[probeIPC] Connecting to AutoGram frontend...');
  const conn = await connect(config);
  const page = conn.page;

  const res = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.core?.invoke;
    if (!invoke) return { error: 'No Tauri invoke found' };

    try {
      // Fetch session identity or list sessions from Tauri
      const sessions = await invoke('tg_list_sessions');
      const lavender = (sessions?.data || []).find((s) => s.session === 'Lavender') || sessions?.data?.[0];
      
      const thumbRes = await invoke('tg_thumbs_batch', {
        request: {
          session: lavender?.session || 'Lavender',
          apiId: lavender?.api_id || 0,
          apiHash: lavender?.api_hash || '',
          chatId: '-1003214112048',
          messageIds: [42535, 42534, 42533, 42532],
          quality: 'seimbang'
        }
      });
      return { sessions, thumbRes };
    } catch (err) {
      return { error: String(err) };
    }
  });

  console.log('[probeIPC] Result:', JSON.stringify(res, null, 2));
  if (typeof conn.dispose === 'function') {
    await conn.dispose().catch(() => {});
  }
}

probeIPC().catch(console.error);
