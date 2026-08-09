import fs from 'node:fs';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(fs.readFileSync(new URL('./config/remote_config.json', import.meta.url), 'utf8'));
const connection = await connect(config);
try {
  await connection.page.evaluate(() => {
    localStorage.setItem('autogram_default_session', 'Lavender');
    sessionStorage.removeItem('autogram_qa_previous_default_session');
    sessionStorage.removeItem('autogram_qa_navigation_state');
    localStorage.removeItem('autogram_drive_locations_v1_QA');
    localStorage.removeItem('autogram_drive_pins_v2_QA');
    sessionStorage.removeItem('drive_root_files_QA');
    if (localStorage.getItem('autogram_drive_upload_queue') === '[{"id":"qa-preserve"}]') {
      localStorage.removeItem('autogram_drive_upload_queue');
    }
  });
} finally {
  connection.dispose();
}
process.exit(0);
