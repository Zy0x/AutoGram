#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const toolsDir = import.meta.dirname;
const frontendDir = path.resolve(toolsDir, '..');
const appRootDir = path.resolve(frontendDir, '..');
const repoRootDir = path.resolve(appRootDir, '..');

// 1. Determine the latest authoritative version
const packageJsonPath = path.join(frontendDir, 'package.json');
const changelogPath = path.join(appRootDir, 'CHANGELOG.md');

if (!fs.existsSync(packageJsonPath)) {
  console.error('[sync-version] Error: package.json not found at', packageJsonPath);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
let targetVersion = (packageJson.version || '').trim();

// Check CHANGELOG.md top version header: e.g. "## v3.9.67 — ..."
if (fs.existsSync(changelogPath)) {
  const changelogContent = fs.readFileSync(changelogPath, 'utf8');
  const match = changelogContent.match(/##\s+v?([0-9]+\.[0-9]+\.[0-9]+)/);
  if (match && match[1]) {
    const changelogVer = match[1].trim();
    // Compare versions (semver style)
    const parse = (v) => v.split('.').map(n => parseInt(n, 10) || 0);
    const [pMaj, pMin, pPat] = parse(targetVersion);
    const [cMaj, cMin, cPat] = parse(changelogVer);
    const isChangelogNewer =
      cMaj > pMaj ||
      (cMaj === pMaj && cMin > pMin) ||
      (cMaj === pMaj && cMin === pMin && cPat > pPat);

    if (isChangelogNewer) {
      targetVersion = changelogVer;
      packageJson.version = targetVersion;
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
      console.log(`[sync-version] package.json updated to v${targetVersion} from CHANGELOG.md`);
    }
  }
}

if (!targetVersion) {
  console.error('[sync-version] Error: could not determine target version.');
  process.exit(1);
}

console.log(`\n======================================================`);
console.log(`  AutoGram LiveDev Version Synchronizer: v${targetVersion}`);
console.log(`======================================================`);

// 2. Sync Cargo.toml
const cargoTomlPath = path.join(frontendDir, 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoTomlPath)) {
  let content = fs.readFileSync(cargoTomlPath, 'utf8');
  // Match version = "..." under [package]
  const updated = content.replace(
    /(\[package\][\s\S]*?version\s*=\s*")[^"]+(")/,
    `$1${targetVersion}$2`
  );
  if (updated !== content) {
    fs.writeFileSync(cargoTomlPath, updated, 'utf8');
    console.log(`  ✔ src-tauri/Cargo.toml -> ${targetVersion}`);
  } else {
    console.log(`  ✔ src-tauri/Cargo.toml already at ${targetVersion}`);
  }
}

// 3. Sync tauri.conf.json
const tauriConfPath = path.join(frontendDir, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
  try {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    if (tauriConf.version !== targetVersion) {
      tauriConf.version = targetVersion;
      fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');
      console.log(`  ✔ src-tauri/tauri.conf.json -> ${targetVersion}`);
    } else {
      console.log(`  ✔ src-tauri/tauri.conf.json already at ${targetVersion}`);
    }
  } catch (err) {
    console.warn(`  ⚠ Warning: failed to update tauri.conf.json: ${err.message}`);
  }
}

// 4. Sync githubUpdater.ts
const updaterPath = path.join(frontendDir, 'src', 'lib', 'tauri', 'githubUpdater.ts');
if (fs.existsSync(updaterPath)) {
  let content = fs.readFileSync(updaterPath, 'utf8');
  const updated = content.replace(
    /export const CURRENT_APP_VERSION = '[^']+';/,
    `export const CURRENT_APP_VERSION = '${targetVersion}';`
  );
  if (updated !== content) {
    fs.writeFileSync(updaterPath, updated, 'utf8');
    console.log(`  ✔ githubUpdater.ts (CURRENT_APP_VERSION) -> ${targetVersion}`);
  } else {
    console.log(`  ✔ githubUpdater.ts already at ${targetVersion}`);
  }
}

// 5. Sync VERSION.md
const versionMdPath = path.join(appRootDir, 'VERSION.md');
if (fs.existsSync(versionMdPath)) {
  let content = fs.readFileSync(versionMdPath, 'utf8');
  const updated = content.replace(
    /^AutoGram Version: v[^\r\n]+/m,
    `AutoGram Version: v${targetVersion}`
  );
  if (updated !== content) {
    fs.writeFileSync(versionMdPath, updated, 'utf8');
    console.log(`  ✔ VERSION.md -> v${targetVersion}`);
  } else {
    console.log(`  ✔ VERSION.md already at v${targetVersion}`);
  }
}

console.log(`======================================================\n`);
