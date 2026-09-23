#!/usr/bin/env node
/**
 * Read-only source inventory. Node built-ins only; run from any working directory.
 * Usage: node parity-inventory.mjs [--json | --summary]
 * Counts are surface counts, never feature-parity percentages or runtime proof.
 * Parsers cover this repository's explicit declarations, not arbitrary ASTs,
 * macro expansion, computed routes, build cfg selection, or transitive reachability.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const timeout = setTimeout(() => {
  console.error('[AGENT_PROBE_TIMEOUT] Inventory exceeded 10 seconds.');
  process.exit(1);
}, 10_000);
timeout.unref();
const paths = {
  app: 'AutoGram App/frontend/src/App.tsx',
  sidebar: 'AutoGram App/frontend/src/components/layout/Sidebar.tsx',
  forwarder: 'AutoGram App/frontend/src/pages/ForwarderWorkspace/index.tsx',
  driveSidebar: 'AutoGram App/frontend/src/components/drive/Navigation/DriveSidebarIndex.tsx',
  activity: 'AutoGram App/android/app/src/main/java/com/autogram/app/MainActivity.kt',
  screens: 'AutoGram App/android/app/src/main/java/com/autogram/app/navigation/Screen.kt',
};
const scopes = {
  desktopUi: 'AutoGram App/frontend/src',
  desktopBackend: 'AutoGram App/frontend/src-tauri/src',
  androidUi: 'AutoGram App/android/app/src/main/java/com/autogram/app',
  androidBridge: 'AutoGram App/crates/autogram-android-bridge/src',
  sharedCore: 'AutoGram App/crates/autogram-core/src',
};
const sources = new Map();
const ignored = new Set(['node_modules', 'target', 'build', 'dist', 'generated', 'bindings', 'uniffi', 'bin', '__tests__', 'tests']);
const slash = value => value.replaceAll('\\', '/');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = items => [...new Set(items)];
function walk(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .sort((a, b) => compare(a.name, b.name))
    .flatMap(entry => {
      if (entry.isSymbolicLink() || ignored.has(entry.name)) return [];
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return walk(path);
      if (!['.ts', '.tsx', '.js', '.jsx', '.rs', '.kt', '.kts'].includes(extname(path))) return [];
      if (/(?:\.(?:test|spec|d)\.[^.]+|\/tests?\.rs)$/.test(path)) return [];
      return [path];
    });
}
function read(file) {
  if (!sources.has(file)) sources.set(file, readFileSync(join(root, file), 'utf8'));
  return sources.get(file);
}
function evidence(file, index) {
  return { file, line: read(file).slice(0, index).split('\n').length };
}
function matches(file, pattern, content = commentsMasked(read(file))) {
  return [...content.matchAll(pattern)].map(match => ({ match, ...evidence(file, match.index) }));
}
// Preserve offsets/newlines. Quoted strings are skipped while masking comments.
// This is a bounded lexical helper, not a language parser (see limitations).
const lexicalTokens = /"""[\s\S]*?"""|"(?:\\[\s\S]|[^"\\])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g;
const blank = value => value.replace(/[^\r\n]/g, ' ');
function commentsMasked(text) {
  return text.replace(lexicalTokens, token => token.startsWith('//') || token.startsWith('/*') ? blank(token) : token);
}
function structureMasked(text) {
  return text.replace(lexicalTokens, blank);
}
function closing(text, start, open, close) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    if (text[i] === close && --depth === 0) return i;
  }
  throw new Error(`Unclosed ${open} at offset ${start}; inventory parser needs updating.`);
}
function requireItems(items, label) {
  if (!items.length) throw new Error(`No ${label} found; refusing a misleading empty inventory.`);
  return items;
}
function stateUnion(file, stateName) {
  const pattern = new RegExp(`\\[${stateName},[^\\]]+\\]\\s*=\\s*useState<([^>]+)>`, 'g');
  return requireItems(matches(file, pattern).flatMap(row =>
    [...row.match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => ({ id: m[1], file, line: row.line }))
  ), `${stateName} values in ${file}`);
}
function appPages() {
  return requireItems(matches(paths.app, /const\s+(\w+)\s*=\s*lazy\w*\([\s\S]*?import\(['"](\.\/pages\/[^'"]+)['"]\)/g)
    .map(({ match, file, line }) => ({
      component: match[1], importPath: match[2], file, line,
      renderSites: matches(file, new RegExp(`<${match[1]}\\b`, 'g')).map(({ file, line }) => ({ file, line })),
    })), 'lazy App page imports');
}
function tauriCommands(files) {
  return requireItems(files.flatMap(file => {
    const text = commentsMasked(read(file));
    const structure = structureMasked(read(file));
    return matches(file, /tauri::generate_handler!\s*\[/g, text).flatMap(({ match }) => {
      const start = match.index + match[0].lastIndexOf('[');
      const end = closing(structure, start, '[', ']');
      let offset = start + 1;
      return text.slice(start + 1, end).split(',').flatMap(part => {
        const index = offset + part.search(/\S/);
        offset += part.length + 1;
        const command = part.trim();
        if (!command) return [];
        if (!/^(?:[A-Za-z_]\w*::)*[A-Za-z_]\w*$/.test(command)) {
          throw new Error(`Unsupported Tauri registration in ${file}: update parser before counting.`);
        }
        return [{ name: command.split('::').at(-1), symbol: command, ...evidence(file, index) }];
      });
    });
  }), 'Tauri registrations');
}
function androidRoutes() {
  const declarations = requireItems(matches(paths.screens, /(?:data\s+)?object\s+(\w+)\s*:\s*Screen\(\s*"([^"]+)"/g)
    .map(({ match, file, line }) => ({ screen: match[1], route: match[2], file, line })), 'Android route declarations');
  const text = commentsMasked(read(paths.activity));
  const structure = structureMasked(read(paths.activity));
  const registrations = requireItems(matches(paths.activity, /composable\(\s*Screen\.(\w+)\.route\s*\)\s*\{/g)
    .map(({ match, file, line }) => {
      const start = match.index + match[0].lastIndexOf('{');
      const body = text.slice(start + 1, closing(structure, start, '{', '}'));
      const declaration = declarations.find(item => item.screen === match[1]);
      if (!declaration) throw new Error(`Undeclared Android route ${match[1]}`);
      return { screen: match[1], route: declaration.route, file, line,
        targets: unique([...body.matchAll(/\b([A-Z]\w*)\s*\(/g)].map(m => m[1])) };
    }), 'Android NavHost registrations');
  return { declarations, registrations,
    declaredButNotRegistered: declarations.filter(d => !registrations.some(r => r.screen === d.screen)) };
}
function bridgeExports(files, androidFiles) {
  const exports = [];
  const callbacks = [];
  for (const file of files) {
    for (const { match, line } of matches(file, /#\[uniffi::export(?:\(([^\]]*)\))?\]\s*pub\s+(?:(async)\s+)?(fn|trait)\s+(\w+)/g)) {
      const record = { name: match[4], file, line };
      if (match[3] === 'trait') callbacks.push(record);
      else {
        const kotlinName = record.name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        const kotlinCallSites = androidFiles.flatMap(path => matches(path, new RegExp(`\\b${kotlinName}\\s*\\(`, 'g'))
          .map(({ file, line }) => ({ file, line })));
        exports.push({ ...record, kotlinName, kotlinCallSites });
      }
    }
    const attributes = matches(file, /#\[uniffi::export(?:\([^\]]*\))?\]/g).length;
    if (attributes !== exports.filter(e => e.file === file).length + callbacks.filter(e => e.file === file).length) {
      throw new Error(`Unsupported UniFFI export form in ${file}; inventory parser needs updating.`);
    }
  }
  return { functions: requireItems(exports, 'UniFFI exported functions'), callbackInterfaces: callbacks };
}
function markerCandidates(file, scope) {
  const raw = read(file);
  const clean = commentsMasked(raw);
  const patterns = [
    ['annotation', /\b(?:TODO|FIXME|HACK|XXX|mock\w*|stub\w*|dummy|simulat\w*|not[ _-]implemented|no[ -]op)\b/gi, raw],
    ['sample-identifier', /\b(?:sample\w+|fake\w+|placeholder[A-Z]\w*)\b/g, clean],
    ['empty-callback', /\bon\w*\s*(?::[^=\n]+)?=\s*\{\s*(?:(?:[\w,\s]+)->\s*)?\}/g, clean],
    ['empty-js-handler', /\b(?:on\w+|\w+Handler)\s*[:=]\s*(?:\{\s*)?\([^)]*\)\s*=>\s*\{\s*\}/g, clean],
    ['empty-rust-result', /\bOk\(\s*(?:Vec::new\(\)|vec!\[\])\s*\)/g, clean],
    ['success-message-assignment', /\b\w*(?:[Mm]essage|[Tt]oast)\s*=\s*"[^"\n]*(?:berhasil|success)[^"\n]*"/gi, clean],
  ];
  const found = new Map();
  for (const [kind, pattern, content] of patterns) {
    for (const { line } of matches(file, pattern, content)) {
      // Do not print source snippets: source can contain credential literals.
      found.set(`${kind}:${line}`, { scope, kind, file, line });
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line || compare(a.kind, b.kind));
}
function inventory() {
  const filesByScope = Object.fromEntries(Object.entries(scopes).map(([key, path]) => [key, walk(path)]));
  for (const file of Object.values(filesByScope).flat()) read(file);
  const sidebarItems = requireItems(matches(paths.sidebar, /\{\s*id:\s*'([^']+)'[^\n]*labelKey:\s*'([^']+)'/g)
    .map(({ match, file, line }) => ({ id: match[1], labelKey: match[2], file, line })), 'sidebar catalog items');
  const sidebarRenderSites = filesByScope.desktopUi.flatMap(file => matches(file, /<Sidebar\b/g)
    .map(({ file, line }) => ({ file, line })));
  const driveSidebarTabs = requireItems(matches(paths.driveSidebar, /type\s+SidebarTab\s*=([^;]+);/g)
    .flatMap(({ match, file, line }) => [...match[1].matchAll(/'([^']+)'/g)]
      .map(m => ({ id: m[1], file, line }))), 'Drive sidebar tab values');
  const driveSidebarRenderSites = filesByScope.desktopUi.flatMap(file => matches(file, /<DriveSidebar\b/g)
    .map(({ file, line }) => ({ file, line })));
  const desktop = { appModes: stateUnion(paths.app, 'appMode'), appPages: appPages(), sidebarItems,
    sidebarRenderSites, driveSidebarTabs, driveSidebarRenderSites,
    forwarderTabs: stateUnion(paths.forwarder, 'activeTab'),
    tauriCommands: tauriCommands(filesByScope.desktopBackend) };
  const android = { ...androidRoutes(), ...bridgeExports(filesByScope.androidBridge, filesByScope.androidUi) };
  const markers = Object.entries(filesByScope).flatMap(([scope, files]) => files.flatMap(file => markerCandidates(file, scope)));
  const markerCountsByScope = Object.fromEntries(Object.keys(scopes).map(scope => [scope, markers.filter(m => m.scope === scope).length]));
  const counts = {
    desktopAppDeclaredModes: desktop.appModes.length,
    desktopAppPageImports: desktop.appPages.length,
    desktopAppRenderedPageComponents: desktop.appPages.filter(p => p.renderSites.length).length,
    desktopSidebarCatalogItems: sidebarItems.length,
    desktopSidebarRenderSites: sidebarRenderSites.length,
    desktopDriveSidebarDeclaredTabs: driveSidebarTabs.length,
    desktopDriveSidebarRenderSites: driveSidebarRenderSites.length,
    desktopForwarderTabs: desktop.forwarderTabs.length,
    tauriRegistrationEntries: desktop.tauriCommands.length,
    tauriUniqueCommandNames: unique(desktop.tauriCommands.map(c => c.name)).length,
    androidDeclaredRoutes: android.declarations.length,
    androidRegisteredRoutes: android.registrations.length,
    androidGenericModuleRoutes: android.registrations.filter(r => r.targets.includes('NativeModuleScreen')).length,
    androidExportedBridgeFunctions: android.functions.length,
    androidBridgeCallbackInterfaces: android.callbackInterfaces.length,
    androidBridgeFunctionsWithKotlinCallSites: android.functions.filter(f => f.kotlinCallSites.length).length,
    markerCandidateLocations: markers.length,
  };
  const sourceFiles = [...sources.entries()].sort(([a], [b]) => compare(a, b)).map(([file, text]) => ({
    file, sha256: createHash('sha256').update(text).digest('hex'),
    physicalLines: text ? text.split('\n').length - Number(text.endsWith('\n')) : 0,
  }));
  const changedDuringRead = sourceFiles.filter(source =>
    createHash('sha256').update(readFileSync(join(root, source.file), 'utf8')).digest('hex') !== source.sha256
  ).map(source => source.file);
  return { schemaVersion: 1, basis: 'static-source-evidence', counts, markerCountsByScope,
    limitations: [
      'Counts are not percentages, feature equivalence, runtime success, or build verification.',
      'App modes include declared values; inspect renderSites and App guards for reachability.',
      'Sidebar catalog entries are not active pages; render-site evidence is reported separately.',
      'Tauri counts use explicit generate_handler registrations, not command annotations or plugin commands.',
      'Android routes are explicit Screen and MainActivity composable declarations; generic targets remain visible.',
      'UniFFI counts use Rust export attributes, never generated Kotlin wrapper counts; call sites are lexical evidence only.',
      'Markers are review candidates: empty callbacks/results can be legitimate; fixtures without markers can be missed.',
      'Test files, generated bindings, cache/build directories, and symlinks are excluded; inline Rust tests are included.',
      'Bounded lexical extraction does not evaluate cfg, macros, alias imports, computed routes, or full ASTs.',
      'Source hashes describe this working tree including uncommitted changes; concurrent edits may invalidate the snapshot.',
    ], scopes, sourceFiles, changedDuringRead, desktop, android, markers };
}
function render(report, summaryOnly) {
  const rows = ['AutoGram desktop / Android source inventory (counts only)', ''];
  for (const [name, count] of Object.entries(report.counts)) rows.push(`${name}: ${count}`);
  rows.push('', `Marker candidates by scope: ${JSON.stringify(report.markerCountsByScope)}`);
  rows.push(`Concurrent source changes detected: ${report.changedDuringRead.length}`);
  if (!summaryOnly) {
    const section = (title, items, label) => {
      rows.push('', title);
      for (const item of items) rows.push(`- ${label(item)} (${item.file}:${item.line})`);
    };
    section('App modes (declared)', report.desktop.appModes, r => r.id);
    section('App pages (imported and rendered)', report.desktop.appPages, r => `${r.component}: ${r.renderSites.length} render sites`);
    section('Sidebar catalog (check render-site count before claiming active navigation)', report.desktop.sidebarItems, r => r.id);
    section('Drive sidebar tabs (declared; availability depends on sidebar state)', report.desktop.driveSidebarTabs, r => r.id);
    section('Forwarder workspace tabs', report.desktop.forwarderTabs, r => r.id);
    section('Registered Tauri commands', report.desktop.tauriCommands, r => r.symbol);
    section('Android NavHost routes', report.android.registrations, r => `${r.route} -> ${r.targets.join(', ')}`);
    section('UniFFI exports', report.android.functions, r => `${r.name}: ${r.kotlinCallSites.length} Kotlin call sites`);
    section('No-op / mock review candidates (not defect verdicts)', report.markers, r => `${r.scope}/${r.kind}`);
  }
  rows.push('', 'Limitations:', ...report.limitations.map(item => `- ${item}`));
  return rows.join('\n');
}

try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`Usage: node "${slash(relative(process.cwd(), fileURLToPath(import.meta.url)))}" [--json | --summary]\nRead-only; no dependencies, network, generated files, or parity percentages.`);
  } else {
    if (args.length > 1 || args.some(arg => !['--json', '--summary'].includes(arg))) throw new Error('Use --json, --summary, or no arguments.');
    const report = inventory();
    console.log(args[0] === '--json' ? JSON.stringify(report, null, 2) : render(report, args[0] === '--summary'));
    if (report.changedDuringRead.length) process.exitCode = 2;
  }
} catch (error) {
  console.error(`Inventory failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
