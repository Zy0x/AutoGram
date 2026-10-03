import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReadinessReport } from './runtime-readiness.mjs';
import { readBridgeExports, scanUniFfiExports } from './parity-inventory.mjs';

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
  for (const id of ['phone_otp_2fa', 'qr_login', 'account_switch']) {
    const workflow = report.workflows.find(item => item.id === id);
    assert.deepEqual(workflow.missingExports, [], id);
    assert.equal(workflow.acceptanceStatus, 'unverified');
    assert.ok(workflow.presentExports.some(item => item.async && item.file.endsWith('/auth.rs')), id);
    assert.ok(workflow.blockers.every(blocker => blocker.startsWith('Unverified')));
  }
});

test('readiness and parity share the real export inventory; callbacks are not callable contracts', () => {
  const bridge = readBridgeExports();
  const report = buildReadinessReport(bridge);
  for (const workflow of report.workflows) {
    assert.deepEqual(workflow.presentExports.map(item => item.name),
      bridge.functions.filter(item => workflow.requiredExports.includes(item.name)).map(item => item.name));
  }
  const callbacksOnly = scanUniFfiExports('#[uniffi::export(callback_interface)] pub trait begin_phone_login {}');
  assert.ok(buildReadinessReport(callbacksOnly).workflows[0].missingExports.includes('begin_phone_login'));
});

test('even all native declarations cannot satisfy missing real-device acceptance evidence', () => {
  const required = [...new Set(buildReadinessReport({ functions: [] }).workflows.flatMap(item => item.requiredExports))];
  const source = required.map(name => `#[uniffi::export(async_runtime = "tokio")]\npub async fn ${name}() {}`).join('\n');
  const report = buildReadinessReport(scanUniFfiExports(source));
  assert.ok(report.workflows.every(item => item.missingExports.length === 0));
  assert.ok(report.workflows.every(item => item.blockers.length > 0 && item.acceptanceStatus === 'unverified'));
  assert.equal(report.fullCloudTestingReady, false);
});

test('importing the shared scanners does not run either CLI', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    'await import("./parity-inventory.mjs"); await import("./runtime-readiness.mjs");'],
  { cwd: dir, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
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

test('bilingual guidance distinguishes real cloud downloads from legacy transfer records', () => {
  for (const locale of ['values', 'values-en']) {
    const resources = name => readFileSync(resolve(app, `app/src/main/res/${locale}/${name}.xml`), 'utf8');
    const workspace = resources('workspace');
    const integrity = resources('runtime_integrity');
    const string = (xml, name) => {
      const match = xml.match(new RegExp(`<string name="${name}">([^<]*)</string>`));
      assert.ok(match, `${locale}/${name}`);
      return match[1];
    };
    const downloads = string(resources('strings'), 'cloud_download_title');
    assert.ok(string(workspace, 'workspace_scope_required').includes('Cloud Drives'));
    assert.ok(string(workspace, 'transfer_native_scope').includes(downloads));
    assert.ok(string(integrity, 'real_queue_scope').includes(downloads));
    assert.doesNotMatch(string(workspace, 'capability_auth_gap'), /belum diekspos|not yet exposed/);
    assert.doesNotMatch(string(workspace, 'accounts_empty_description'), /saat tersedia|when it is available/);
    assert.doesNotMatch(string(workspace, 'workspace_scope_required'), /perlu diintegrasikan|require integration/);
  }
});
