import fs from 'node:fs';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(fs.readFileSync(new URL('./config/remote_config.json', import.meta.url), 'utf8'));
const commands = [
  ['cache_calculate_size', {}],
  ['cache_trim_disk', { targetBytes: 5 * 1024 * 1024 * 1024 }],
  ['cache_set_policy', { limitBytes: 5 * 1024 * 1024 * 1024, autoPrune: true }],
  ['cache_clear_disk', {}],
];

const connection = await connect(config);
try {
  for (const [command, args] of commands) {
    try {
      const result = await connection.page.evaluate(
        ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
        { command, args },
      );
      console.log(command, JSON.stringify(result));
    } catch (error) {
      console.error(command, String(error));
    }
  }
} finally {
  connection.dispose();
}
process.exit(0);
