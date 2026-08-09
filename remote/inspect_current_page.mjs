import fs from 'node:fs';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(fs.readFileSync(new URL('./config/remote_config.json', import.meta.url), 'utf8'));
const connection = await connect(config);
try {
  const state = await connection.page.evaluate(() => ({
    url: location.href,
    body: (document.body?.innerText || '').slice(-2500),
    success: document.querySelector('.settings-cache-result.is-success')?.textContent || '',
    error: document.querySelector('.settings-cache-result.is-error')?.textContent || '',
    modal: document.querySelector('[role="dialog"]')?.textContent || '',
    driveSession: localStorage.getItem('autogram_drive_session'),
    defaultSession: localStorage.getItem('autogram_default_session'),
    targetPeer: localStorage.getItem('autogram_drive_peer_v2_Mantan%20Gadis'),
  }));
  console.log(JSON.stringify(state, null, 2));
} finally {
  connection.dispose();
}
process.exit(0);
