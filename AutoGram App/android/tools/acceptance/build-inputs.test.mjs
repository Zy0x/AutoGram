import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectAcceptanceInputs } from './build-inputs.mjs';

test('build-input allowlist fingerprints configuration but excludes private runtime/signing material', () => {
  const root = mkdtempSync(join(tmpdir(), 'autogram-build-input-test-'));
  function fixture(file, text) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  try {
    const manifest = 'AutoGram App/android/app/src/main/AndroidManifest.xml';
    fixture(manifest, '<manifest/>');
    fixture('AutoGram App/android/app/src/main/res/values/strings.xml', '<resources/>');
    fixture('AutoGram App/android/.signing/private.p12', 'isolated-do-not-read');
    fixture('AutoGram App/worker/sessions/private.session', 'isolated-do-not-read');
    fixture('AutoGram App/android/app/build/outputs/private.apk', 'isolated-do-not-read');
    const first = collectAcceptanceInputs(root);
    assert.ok(first.inputs.some(row => row.file.endsWith('strings.xml')));
    assert.ok(first.missingRequired.includes('AutoGram App/android/app/build.gradle.kts'));
    assert.deepEqual(first.changedDuringRead, []);
    assert.ok(first.inputs.every(row => !/private|\.signing|sessions|outputs/.test(row.file)));
    fixture(manifest, '<manifest changed="true"/>');
    const second = collectAcceptanceInputs(root);
    assert.notEqual(first.inputs.find(row => row.file === manifest).sha256,
      second.inputs.find(row => row.file === manifest).sha256);
  } finally {
    // Solely the newly created, isolated OS temporary fixture, never workspace/user data.
    rmSync(root, { recursive: true, force: true });
  }
});
