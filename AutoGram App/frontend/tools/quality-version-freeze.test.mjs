import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const runner = readFileSync(new URL('./quality-sentinel.mjs', import.meta.url), 'utf8');
const start = runner.indexOf("logHeader('7. RELEASE VERSION & METADATA PARITY GATE');");
const end = runner.indexOf('// 8. GATE 8:', start);
assert.ok(start >= 0 && end > start, 'Version verification section must exist');
const gate = runner.slice(start, end);

function verify(overrides = {}) {
  const root = path.resolve('fixture', 'frontend');
  const appRoot = path.dirname(root);
  const srcRoot = path.join(root, 'src');
  const files = new Map([
    [path.join(root, 'package.json'), '{"version":"4.1.34"}'],
    [path.join(root, 'src-tauri', 'Cargo.toml'), '[package]\nversion = "4.1.34"'],
    [path.join(root, 'src-tauri', 'tauri.conf.json'), '{"version":"4.1.34"}'],
    [path.join(srcRoot, 'lib', 'tauri', 'githubUpdater.ts'), "export const CURRENT_APP_VERSION = '4.1.34';"],
    [path.join(appRoot, 'VERSION.md'), 'AutoGram Version: v4.1.34\n'],
    // Historical/future changelog text must never authorize an automatic bump.
    [path.join(appRoot, 'CHANGELOG.md'), '## Unreleased\n\n## v9.9.99\n']
  ]);
  for (const [file, content] of Object.entries(overrides)) files.set(path.join(root, file), content);
  const before = [...files];
  const passes = [], failures = [];
  const context = {
    root, appRoot, srcRoot, path, allPassed: true,
    fs: { readFileSync(file) { assert.ok(files.has(file), `Unexpected read: ${file}`); return files.get(file); } },
    execSync() { assert.fail('Verification must not launch a mutating synchronizer'); },
    logHeader() {}, logPass(...args) { passes.push(args); }, logFail(...args) { failures.push(args); }
  };
  vm.runInNewContext(gate, context, { timeout: 1000 });
  assert.deepEqual([...files], before, 'Verification must not alter metadata');
  return { passed: context.allPassed, passes, failures };
}

test('quality gate preserves the frozen version even with a newer changelog', () => {
  const result = verify();
  assert.equal(result.passed, true);
  assert.equal(result.passes.length, 1);
  assert.equal(result.failures.length, 0);
});

test('version mismatches fail without repairing user files', () => {
  for (const [file, content] of [
    ['src-tauri/Cargo.toml', '[package]\nversion = "4.1.35"'],
    ['src-tauri/tauri.conf.json', '{"version":"4.1.35"}'],
    ['src/lib/tauri/githubUpdater.ts', "export const CURRENT_APP_VERSION = '4.1.35';"],
    ['../VERSION.md', 'AutoGram Version: v4.1.35\n']
  ]) {
    const result = verify({ [file]: content });
    assert.equal(result.passed, false, file);
    assert.equal(result.failures.length, 1, file);
  }
});
