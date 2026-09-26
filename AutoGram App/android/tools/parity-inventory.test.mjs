import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
  assert.ok(report.limitations.some(text => text.includes('not percentages')));
});
