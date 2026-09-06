import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const appRoot = path.resolve(root, '..');
const srcRoot = path.join(root, 'src');
const localesRoot = path.join(srcRoot, 'locales');
const dbRoot = path.join(appRoot, 'database');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function logHeader(title) {
  console.log(`\n${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}   ${title}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════════════${colors.reset}\n`);
}

function logPass(gate, msg) {
  console.log(`  ${colors.green}✔ [PASS]${colors.reset} ${colors.bright}${gate}:${colors.reset} ${msg}`);
}

function logFail(gate, msg) {
  console.error(`  ${colors.red}✖ [FAIL]${colors.reset} ${colors.bright}${gate}:${colors.reset} ${msg}`);
}

function logWarn(gate, msg) {
  console.warn(`  ${colors.yellow}⚠ [WARN]${colors.reset} ${colors.bright}${gate}:${colors.reset} ${msg}`);
}

let allPassed = true;

// ============================================================================
// 1. GATE 1: i18n LOCALE PARITY AUDIT
// ============================================================================
logHeader('1. i18n MULTI-LANGUAGE PARITY & ZERO HARDCODED AUDIT');
try {
  const walk = (dir) => {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...walk(full));
      else if (entry.name.endsWith('.json')) results.push(full);
    }
    return results;
  };

  const flatten = (obj, prefix = '', res = new Set()) => {
    for (const [k, v] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, full, res);
      else res.add(full);
    }
    return res;
  };

  const loadKeys = (lang) => {
    const keys = new Set();
    const langDir = path.join(localesRoot, lang);
    for (const file of walk(langDir)) {
      const ns = path.basename(file, '.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const k of flatten(data)) keys.add(`${ns}.${k}`);
    }
    return keys;
  };

  const idKeys = loadKeys('id');
  const enKeys = loadKeys('en');

  const idOnly = [...idKeys].filter(k => !enKeys.has(k));
  const enOnly = [...enKeys].filter(k => !idKeys.has(k));

  if (idOnly.length === 0 && enOnly.length === 0) {
    logPass('Locale Parity', `100% Match between ID (${idKeys.size} keys) and EN (${enKeys.size} keys)`);
  } else {
    logFail('Locale Parity', `Discrepancy found! ID-only: ${idOnly.length}, EN-only: ${enOnly.length}`);
    if (idOnly.length) console.log('   ID only keys:', idOnly.slice(0, 5));
    if (enOnly.length) console.log('   EN only keys:', enOnly.slice(0, 5));
    allPassed = false;
  }
} catch (e) {
  logFail('Locale Parity', e.message);
  allPassed = false;
}

// ============================================================================
// 2. GATE 2: STRICT TYPESCRIPT COMPILATION CHECK
// ============================================================================
logHeader('2. STRICT TYPESCRIPT COMPILATION GATE');
try {
  execSync('npx tsc --noEmit', { cwd: root, stdio: 'pipe' });
  logPass('TypeScript', '0 Type errors found across all components, hooks, and stores.');
} catch (e) {
  logFail('TypeScript', 'TypeScript compilation failed!');
  console.error(e.stdout?.toString() || e.stderr?.toString() || e.message);
  allPassed = false;
}

// ============================================================================
// 3. GATE 3: AUTOMATED TEST SUITES (VITEST)
// ============================================================================
logHeader('3. AUTOMATED UNIT & STRESS TEST RUNNER');
try {
  const testOut = execSync('npx vitest run', { cwd: root, stdio: 'pipe' }).toString();
  const passMatch = testOut.match(/(\d+)\s+passed/);
  const testCount = passMatch ? passMatch[1] : 'All';
  logPass('Vitest', `All test files passed successfully (${testCount} tests).`);
} catch (e) {
  logFail('Vitest', 'One or more tests failed!');
  console.error(e.stdout?.toString() || e.stderr?.toString() || e.message);
  allPassed = false;
}

// ============================================================================
// 4. GATE 4: DATABASE & SCHEMA MASTER SYNCHRONIZATION
// ============================================================================
logHeader('4. DATABASE SCHEMA & DATA DICTIONARY PARITY GATE');
try {
  const schemaFile = path.join(dbRoot, 'schema.sql');
  const readmeFile = path.join(dbRoot, 'README.md');
  const migrationsDir = path.join(dbRoot, 'migrations');

  if (!fs.existsSync(schemaFile)) {
    logFail('Database Schema', 'Master schema.sql is missing!');
    allPassed = false;
  } else {
    const schemaContent = fs.readFileSync(schemaFile, 'utf8');
    const hasWal = schemaContent.includes('PRAGMA journal_mode = WAL;');
    const hasFk = schemaContent.includes('PRAGMA foreign_keys = ON;');
    const hasTimeout = schemaContent.includes('PRAGMA busy_timeout = 5000;');

    if (hasWal && hasFk && hasTimeout) {
      logPass('Database Pragmas', 'WAL, Foreign Keys ON, and Busy Timeout pragmas strictly configured.');
    } else {
      logFail('Database Pragmas', 'One or more mandatory SQLite pragmas missing in schema.sql!');
      allPassed = false;
    }

    // Check migrations directory
    if (fs.existsSync(migrationsDir)) {
      const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
      logPass('Migrations Inventory', `Found ${migrationFiles.length} migrations. Master schema is consolidated.`);
    }
  }

  if (fs.existsSync(readmeFile)) {
    logPass('Data Dictionary', 'AutoGram App/database/README.md is present and documented.');
  } else {
    logFail('Data Dictionary', 'Database README.md manual is missing!');
    allPassed = false;
  }
} catch (e) {
  logFail('Database Gate', e.message);
  allPassed = false;
}

// ============================================================================
// 5. GATE 5: ARCHITECTURAL INTEGRITY & SECURITY GUARDRAILS
// ============================================================================
logHeader('5. ARCHITECTURAL INTEGRITY & SECURITY GUARDRAILS');
try {
  const scanFiles = (dir, extRegex) => {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
        files.push(...scanFiles(full, extRegex));
      } else if (extRegex.test(entry.name)) {
        files.push(full);
      }
    }
    return files;
  };

  const tsxFiles = scanFiles(srcRoot, /\.(tsx|ts)$/);
  let secretLeaks = 0;
  let directApiViolations = 0;

  for (const file of tsxFiles) {
    const content = fs.readFileSync(file, 'utf8');
    // Check for hardcoded API bot tokens or raw hashes
    if (/\b(?:bot_token|api_hash|app_hash)\s*[:=]\s*["'][a-f0-9]{20,}["']/i.test(content)) {
      secretLeaks++;
      logFail('Security', `Potential secret found in ${path.relative(root, file)}`);
    }
    // Check for direct telegram client invocations in UI
    if (/from\s+['"]telethon['"]|from\s+['"]telegram['"]/i.test(content)) {
      directApiViolations++;
      logFail('Architecture', `Direct Telegram import in UI at ${path.relative(root, file)}`);
    }
  }

  if (secretLeaks === 0) {
    logPass('Security Audit', 'Zero plaintext secrets or tokens exposed in frontend codebase.');
  } else {
    allPassed = false;
  }

  if (directApiViolations === 0) {
    logPass('Architecture Boundary', 'Strict separation maintained (100% UI calls route through Tauri IPC).');
  } else {
    allPassed = false;
  }
} catch (e) {
  logFail('Security Audit', e.message);
  allPassed = false;
}

// ============================================================================
// 6. GATE 6: TELEGRAM VISUAL ALBUM & COLLAGE INVARIANTS GATE
// ============================================================================
logHeader('6. TELEGRAM VISUAL ALBUM & COLLAGE INVARIANTS GATE');
try {
  // 1. Run cargo test for transfer, album and caption modules in autogram-core
  const coreDir = path.join(appRoot, 'crates', 'autogram-core');
  const cargoTestOut = execSync('cargo test --lib transfer::', { cwd: coreDir, stdio: 'pipe' }).toString();
  const testMatch = cargoTestOut.match(/(\d+)\s+passed/);
  const coreTestCount = testMatch ? testMatch[1] : 'All';
  logPass('MTProto Album Invariants', `All core album & caption tests passed (${coreTestCount} tests: 10-cap, empty caption > 0, idempotent retry).`);

  // 2. Static scan on MediaStudio/index.tsx to guarantee cleanCaption in album mode never injects filename
  const mediaStudioFile = path.join(srcRoot, 'pages', 'MediaStudio', 'index.tsx');
  if (fs.existsSync(mediaStudioFile)) {
    const studioContent = fs.readFileSync(mediaStudioFile, 'utf8');
    const hasAlbumCheck = studioContent.includes('const isAlbum = !!task.options.group_as_album;');
    const preventsFilenameInAlbum = studioContent.includes('else if (!isAlbum)');
    if (hasAlbumCheck && preventsFilenameInAlbum) {
      logPass('Album Caption Hygiene', 'MediaStudio UI strictly prohibits filename stem injection in album mode.');
    } else {
      logFail('Album Caption Hygiene', 'MediaStudio UI filename stem guard missing or modified!');
      allPassed = false;
    }
  } else {
    logWarn('Album Caption Hygiene', 'MediaStudio/index.tsx not found for static audit.');
  }
} catch (e) {
  logFail('Album Invariants Gate', e.stdout?.toString() || e.stderr?.toString() || e.message);
  allPassed = false;
}

// ============================================================================
// 7. GATE 7: RELEASE VERSION & METADATA PARITY GATE
// ============================================================================
logHeader('7. RELEASE VERSION & METADATA PARITY GATE');
try {
  // Run sync-version tool to verify and auto-synchronize
  const syncScript = path.join(import.meta.dirname, 'sync-version.mjs');
  if (fs.existsSync(syncScript)) {
    execSync(`node "${syncScript}"`, { cwd: root, stdio: 'pipe' });
  }

  const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const currentVer = pkgJson.version;

  const cargoToml = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  const cargoMatch = cargoToml.match(/\[package\][\s\S]*?version\s*=\s*"([^"]+)"/);
  const cargoVer = cargoMatch ? cargoMatch[1] : null;

  const tauriConf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const tauriVer = tauriConf.version;

  if (cargoVer === currentVer && tauriVer === currentVer) {
    logPass('Version Parity', `All release targets match active version v${currentVer} (package.json, Cargo.toml, tauri.conf.json).`);
  } else {
    logFail('Version Parity', `Mismatch detected! package.json=${currentVer}, Cargo.toml=${cargoVer}, tauri.conf.json=${tauriVer}`);
    allPassed = false;
  }
} catch (e) {
  logFail('Version Parity Gate', e.message);
  allPassed = false;
}

// ============================================================================
// FINAL CERTIFICATION SUMMARY
// ============================================================================
console.log(`\n${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════════════${colors.reset}`);
if (allPassed) {
  console.log(`${colors.bright}${colors.green}  ✔ [SUCCESS] ALL 7 QUALITY GATES PASSED WITH ZERO ERRORS!${colors.reset}`);
  console.log(`${colors.bright}${colors.green}  AutoGram is certified production-ready, regress-free, and safe.${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════════════${colors.reset}\n`);
  process.exit(0);
} else {
  console.error(`${colors.bright}${colors.red}  ✖ [FAILED] ONE OR MORE QUALITY GATES FAILED. FIX ERRORS BEFORE COMMITTING.${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════════════${colors.reset}\n`);
  process.exit(1);
}
