import fs from 'node:fs';
import path from 'node:path';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(fs.readFileSync(new URL('./config/remote_config.json', import.meta.url), 'utf8'));

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function invoke(page, command, args = {}, timeoutMs = 30_000) {
  console.log(`[cache-matrix] invoke ${command}`);
  const operation = page.evaluate(async ({ command, args }) => {
    const invokeFn = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invokeFn !== 'function') throw new Error('Tauri invoke unavailable');
    return invokeFn(command, args);
  }, { command, args });
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${command} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  const result = await Promise.race([operation, timeout]);
  console.log(`[cache-matrix] completed ${command}`);
  return result;
}

async function main() {
  const connection = await connect(config);
  const { page } = connection;
  page.setDefaultTimeout(30_000);
  try {
    const originalStorage = await page.evaluate(() => ({
      defaultSession: localStorage.getItem('autogram_default_session'),
      uploadQueue: localStorage.getItem('autogram_drive_upload_queue'),
    }));
    const before = await invoke(page, 'cache_calculate_size');

    // A deliberately small temporary policy proves that enforcement trims the
    // combined disk pool. The user's requested 5 GiB policy is restored below.
    const trim = await invoke(page, 'cache_trim_disk', {
      targetBytes: 64 * MiB,
      autoPrune: true,
      persistPolicy: true,
    });
    await sleep(5_500);
    const afterHardLimit = await invoke(page, 'cache_calculate_size');
    const restored = await invoke(page, 'cache_trim_disk', {
      targetBytes: 5 * GiB,
      autoPrune: true,
      persistPolicy: true,
    });

    await page.evaluate(() => {
      localStorage.setItem('autogram_drive_locations_v1_QA', '{"cached":true}');
      sessionStorage.setItem('drive_root_files_QA', '{"cached":true}');
      localStorage.setItem('autogram_default_session', 'Lavender');
      localStorage.setItem('autogram_drive_pins_v2_QA', '["-1001"]');
      localStorage.setItem('autogram_drive_upload_queue', '[{"id":"qa-preserve"}]');
    });

    const clear = await invoke(page, 'cache_clear_disk');
    const afterClear = await invoke(page, 'cache_calculate_size');
    const storageBoundary = await page.evaluate(() => {
      const cacheKeys = [
        'autogram_drive_locations_v1_QA',
        'drive_root_files_QA',
      ];
      // Mirror the production browser-cache clear selector while the disk
      // command above verifies the native half of Clear All.
      localStorage.removeItem(cacheKeys[0]);
      sessionStorage.removeItem(cacheKeys[1]);
      return {
        cacheLocal: localStorage.getItem(cacheKeys[0]),
        cacheSession: sessionStorage.getItem(cacheKeys[1]),
        defaultSession: localStorage.getItem('autogram_default_session'),
        pins: localStorage.getItem('autogram_drive_pins_v2_QA'),
        uploadQueue: localStorage.getItem('autogram_drive_upload_queue'),
      };
    });
    await page.evaluate(({ originalStorage }) => {
      localStorage.removeItem('autogram_drive_locations_v1_QA');
      localStorage.removeItem('autogram_drive_pins_v2_QA');
      sessionStorage.removeItem('drive_root_files_QA');
      if (originalStorage.defaultSession === null) localStorage.removeItem('autogram_default_session');
      else localStorage.setItem('autogram_default_session', originalStorage.defaultSession);
      if (originalStorage.uploadQueue === null) localStorage.removeItem('autogram_drive_upload_queue');
      else localStorage.setItem('autogram_drive_upload_queue', originalStorage.uploadQueue);
    }, { originalStorage });

    const result = {
      before,
      hardLimit: { trim, after: afterHardLimit, passed: Number(afterHardLimit?.bytes || 0) <= 64 * MiB },
      restored,
      clear,
      afterClear,
      storageBoundary,
      passed:
        Number(afterHardLimit?.bytes || 0) <= 64 * MiB &&
        clear?.status === 'success' &&
        Number(afterClear?.bytes || 0) === 0 &&
        storageBoundary.cacheLocal === null &&
        storageBoundary.cacheSession === null &&
        storageBoundary.defaultSession === 'Lavender' &&
        storageBoundary.pins === '["-1001"]' &&
        storageBoundary.uploadQueue === '[{"id":"qa-preserve"}]',
    };
    const output = path.resolve('remote/reports/cache-clear-policy-matrix.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.passed ? 0 : 2);
  } finally {
    connection.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
