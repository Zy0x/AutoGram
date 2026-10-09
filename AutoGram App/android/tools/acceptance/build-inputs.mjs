import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Explicit allowlist: never enumerate signing identities, sessions, runtime data or caches.
const required = [
  'AutoGram App/frontend/package.json',
  'AutoGram App/frontend/src-tauri/Cargo.toml',
  'AutoGram App/frontend/src-tauri/tauri.conf.json',
  'AutoGram App/crates/autogram-core/Cargo.toml',
  'AutoGram App/crates/autogram-android-bridge/Cargo.toml',
  'AutoGram App/android/build.gradle.kts',
  'AutoGram App/android/settings.gradle.kts',
  'AutoGram App/android/gradle.properties',
  'AutoGram App/android/app/build.gradle.kts',
  'AutoGram App/android/app/src/main/AndroidManifest.xml',
  'AutoGram App/database/schema.sql',
];
const optional = [
  'AutoGram App/frontend/package-lock.json',
  'AutoGram App/frontend/src-tauri/Cargo.lock',
  'AutoGram App/frontend/src-tauri/build.rs',
  'AutoGram App/crates/autogram-core/Cargo.lock',
  'AutoGram App/crates/autogram-android-bridge/Cargo.lock',
  'AutoGram App/crates/autogram-android-bridge/build.rs',
  'AutoGram App/crates/autogram-android-bridge/uniffi.toml',
  'AutoGram App/android/app/proguard-rules.pro',
  'AutoGram App/android/gradle/wrapper/gradle-wrapper.properties',
  'AutoGram App/android/build_android.ps1',
];
const directories = [
  'AutoGram App/android/app/src/main/res',
  'AutoGram App/android/tools',
  'AutoGram App/frontend/src/locales',
  'AutoGram App/database/migrations',
];
const allowedExtension = /\.(?:xml|json|sql|mjs|ps1)$/i;
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function collectAcceptanceInputs(root) {
  const missingRequired = required.filter(file => !existsSync(join(root, file)) ||
    !lstatSync(join(root, file)).isFile() || lstatSync(join(root, file)).isSymbolicLink());
  const files = new Set([...required, ...optional].filter(file => existsSync(join(root, file)) &&
    lstatSync(join(root, file)).isFile() && !lstatSync(join(root, file)).isSymbolicLink()));
  function walk(directory) {
    const path = join(root, directory);
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && allowedExtension.test(file) && !/\.test\.mjs$/.test(file)) files.add(file);
    }
  }
  directories.forEach(walk);
  const inputs = [...files].sort().map(file => ({ file, sha256: hashFile(join(root, file)) }));
  const changedDuringRead = inputs.filter(input => !existsSync(join(root, input.file)) ||
    hashFile(join(root, input.file)) !== input.sha256).map(input => input.file);
  return { inputs, changedDuringRead, missingRequired };
}
