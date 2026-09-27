import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readBridgeExports, scanUniFfiExports } from './parity-inventory.mjs';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(toolsDir, '../../..');

test('inventory follows extracted sidebar types and native Accounts wiring from another cwd', () => {
  const result = spawnSync(process.execPath, [resolve(toolsDir, 'parity-inventory.mjs'), '--json'], {
    cwd: toolsDir,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.changedDuringRead, []);
  const tabs = report.desktop.driveSidebarTabs;
  assert.deepEqual(tabs.map(tab => tab.id), ['saved', 'recent', 'drives', 'chats', 'home', 'pins']);
  for (const tab of tabs) {
    assert.ok(tab.file.endsWith('/Navigation/useSidebarDrop.ts'));
    const declaration = readFileSync(resolve(root, tab.file), 'utf8').split('\n')[tab.line - 1];
    assert.ok(declaration.includes(`'${tab.id}'`));
  }
  const accounts = report.android.registrations.find(route => route.screen === 'Accounts');
  assert.ok(accounts.targets.includes('AccountsScreen'));
  assert.ok(!accounts.targets.includes('NativeModuleScreen'));
  assert.ok(report.android.functions.find(fn => fn.name === 'list_session_summaries').kotlinCallSites.length > 0);
  const auth = report.android.functions.find(fn => fn.name === 'begin_phone_login');
  assert.ok(auth.file.endsWith('/auth.rs'));
  assert.equal(auth.async, true);
  assert.ok(report.android.callbackInterfaces.some(item => item.name === 'NativeAuthVault'));
  assert.ok(!report.android.functions.some(item => item.name === 'NativeAuthVault'));
  assert.ok(report.limitations.some(text => text.includes('not percentages')));
});

test('Rust export scanning separates Tokio functions and callback traits with source evidence', () => {
  const source = `#[uniffi::export]
pub fn configure_api() {}
#[uniffi::export(async_runtime = "tokio")]
/// A real async export, with an intervening attribute.
#[allow(dead_code)]
pub async fn begin_phone_login() {}
#[uniffi::export(
    async_runtime = "tokio",
)]
pub async fn poll_qr_login() {}
#[uniffi::export(callback_interface)]
pub trait NativeAuthVault { fn read(&self); }
pub async fn private_helper() {}
`;
  const report = scanUniFfiExports(source, 'auth.rs');
  assert.deepEqual(report.functions.map(item => [item.name, item.async, item.line]), [
    ['configure_api', false, 1], ['begin_phone_login', true, 3], ['poll_qr_login', true, 7],
  ]);
  assert.deepEqual(report.callbackInterfaces, [{ name: 'NativeAuthVault', file: 'auth.rs', line: 11 }]);
});

test('comment, string and nested-comment examples cannot manufacture native exports', () => {
  const source = `// #[uniffi::export] pub fn line_comment() {}
/* nested /* #[uniffi::export] pub fn nested() {} */
   #[uniffi::export] pub fn still_comment() {} */
const DOC: &str = r###"#[uniffi::export(async_runtime = "tokio")] pub async fn raw_example() {}"###;
const DOC2: &str = "#[uniffi::export] pub fn string_example() {}";
const DOC3: &[u8] = br#"#[uniffi::export] pub fn byte_example() {}"#;
#[uniffi::export(async_runtime = "tokio")]
pub async fn select_authorized_account() {}
`;
  assert.deepEqual(scanUniFfiExports(source).functions.map(item => item.name), ['select_authorized_account']);
});

test('unsupported export forms fail closed instead of silently lowering inventory counts', () => {
  assert.throws(() => scanUniFfiExports('#[uniffi::export] impl Engine {}'), /Unsupported UniFFI export form/);
  assert.throws(() => scanUniFfiExports('#[uniffi::export] pub trait Engine {}'), /Unsupported UniFFI trait/);
  assert.throws(() => scanUniFfiExports('#[uniffi::export(callback_interface)] pub fn callback() {}'), /Unsupported UniFFI trait/);
});

test('bridge discovery includes nested handwritten modules but excludes generated bindings and tests', t => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'autogram-inventory-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const bridge = resolve(workspace, 'AutoGram App/crates/autogram-android-bridge/src');
  const fixtures = {
    'lib.rs': '#[uniffi::export] pub fn initialize_auth() {}',
    'auth/login.rs': '#[uniffi::export(async_runtime = "tokio")] pub async fn begin_phone_login() {}',
    'auth/vault.rs': '#[uniffi::export(callback_interface)] pub trait NativeAuthVault {}',
    'generated/fake.rs': '#[uniffi::export] pub fn generated_export() {}',
    'bindings/fake.rs': '#[uniffi::export] pub fn binding_export() {}',
    'autogram.uniffi.rs': '#[uniffi::export] pub fn scaffold_export() {}',
    'schema_tests.rs': '#[uniffi::export] pub fn test_export() {}',
    'tests/fake.rs': '#[uniffi::export] pub fn fixture_export() {}',
    'bin/uniffi-bindgen.rs': '#[uniffi::export] pub fn generator_export() {}',
    'Generated.kt': 'fun beginPhoneLogin() {}',
  };
  for (const [file, source] of Object.entries(fixtures)) {
    const path = resolve(bridge, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  const report = readBridgeExports(workspace);
  assert.deepEqual(report.functions.map(item => item.name).sort(), ['begin_phone_login', 'initialize_auth']);
  assert.deepEqual(report.callbackInterfaces.map(item => item.name), ['NativeAuthVault']);
});
