import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const app = resolve(dir, '..');
test('release acceptance cannot confuse local bridge and real cloud parity', () => {
  const result = spawnSync(process.execPath, [resolve(dir, 'runtime-readiness.mjs'), '--json', '--require-cloud-ready'],
    { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.fullCloudTestingReady, false);
  assert.equal(report.workflows.length, 8);
  assert.ok(report.workflows.every(workflow => workflow.blockers.length));
});

test('previously fabricated Android outputs cannot return to production surfaces', () => {
  const checks = [
    ['ui/drive/DrivePreviewModal.kt', /sampleCode|sampleZipEntries|mutableFloatStateOf\(0\.35f\)/],
    ['ui/drive/ZipExplorerModal.kt', /ZipEntryItem\(|berhasil/],
    ['ui/drive/FileGridItem.kt', /4K UHD|1080p 60F|NVENC|size\s*%\s*20|RAM Stream/],
    ['ui/drive/DriveToolsModal.kt', /5\.1 MB|76\.4 MB|cleanSuccess/],
    ['ui/transfer/TransferScreen.kt', /contains\("Hero"|weight\(0\.40f\)|transfer_saved_messages/],
    ['ui/transfer/TransferDetailModal.kt', /12\.4 MB\/s|DC4 Production|4 Jalur Paralel/],
    ['ui/settings/SettingsScreen.kt', /isOtpSent|actionToastMessage|berhasil/],
    ['ui/settings/SettingsApiSetupModal.kt', /mutableStateOf\("[a-f0-9]{16,}/],
    ['ui/settings/SettingsDebugLogsModal.kt', /listOf\(/],
    ['ui/studio/StudioScreen.kt', /toastMessage|berhasil/],
  ];
  for (const [file, forbidden] of checks) {
    assert.doesNotMatch(readFileSync(resolve(app, 'app/src/main/java/com/autogram/app', file), 'utf8'), forbidden, file);
  }
});
