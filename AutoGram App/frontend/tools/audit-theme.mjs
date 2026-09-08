import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const srcRoot = path.join(root, 'src');

function walk(dir, predicate) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'target', '.git'].includes(entry.name)) {
        output.push(...walk(full, predicate));
      }
    } else if (predicate(full)) {
      output.push(full);
    }
  }
  return output;
}

const componentFiles = walk(srcRoot, (f) => /\.(tsx|jsx)$/.test(f) && !f.endsWith('.test.tsx') && !f.endsWith('.test.ts'));
const cssFiles = walk(srcRoot, (f) => f.endsWith('.css'));

let totalViolations = 0;
const violationsByFile = new Map();

function addViolation(relFile, line, content, reason) {
  totalViolations++;
  if (!violationsByFile.has(relFile)) {
    violationsByFile.set(relFile, []);
  }
  violationsByFile.get(relFile).push({ line, content: content.trim(), reason });
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: SCAN TSX & JSX COMPONENT FILES
// ─────────────────────────────────────────────────────────────────────────────
for (const file of componentFiles) {
  const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, idx) => {
    // Whitelist check (current line or preceding line)
    if (line.includes('THEME-AUDIT-EXCEPTION:') || (idx > 0 && lines[idx - 1].includes('THEME-AUDIT-EXCEPTION:'))) {
      return;
    }

    // Check for inline static hex colors on background or border
    const inlineHexBg = /style=\{\{[^}]*(background|backgroundColor):\s*['"][^'"]*#[0-9a-fA-F]{3,8}/i.test(line);
    const inlineHexBorder = /style=\{\{[^}]*borderColor:\s*['"][^'"]*#[0-9a-fA-F]{3,8}/i.test(line);

    if (inlineHexBg || inlineHexBorder) {
      // Allow dynamic theme token consumption or CSS variable fallbacks
      if (
        line.includes('var(--') ||
        line.includes('palette.') ||
        line.includes('activePalette') ||
        line.includes('color_accent') ||
        line.includes('previewColors') ||
        line.includes('transparent')
      ) {
        return;
      }
      addViolation(rel, idx + 1, line, 'Static inline style color without CSS variable fallback or whitelist annotation');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: SCAN CSS STYLESHEET FILES
// ─────────────────────────────────────────────────────────────────────────────
// Target rogue UI selectors identified in PRD R1/R4 and visual audit
const TARGET_ROGUE_SELECTORS = [
  'td-sidebar-logo',
  'td-sidebar-tab-btn',
  'td-tab-badge',
  'td-tag-badge',
  'td-sort-scope',
  'ag-forwarder-tab-btn',
  'ag-forwarder-tab',
  'ag-forwarder-badge',
  'ms-action-chip',
  'td-tools-panel',
  'td-tools-title-icon',
  'td-tools-sidebar-tab',
  'td-switch-row',
  'td-xfer-footer',
  'td-settings-card',
  'td-chip-btn',
  'td-remote-sub-info-banner',
  'td-remote-triplet-popover-item',
  'td-preflight-banner',
  'td-preview-tab-pill',
  'td-ai-complexity-badge',
  'td-ai-bullet',
  'td-db-table-item',
  'td-db-columns-badge',
  'custom-account-select',
  'td-zip-preflight',
  'td-zip-cat-btn',
  'td-zip-cat-check',
  'td-zip-index-card',
  'td-zip-options',
  'startup-option-card',
  'channel-option-card',
  'settings-sidebar-nav-item',
  'settings-switch',
  'how-to-get-btn',
  'ag-launcher-session-card',
  'ag-launcher-header',
  'td-remote-upload-panel',
  'td-remote-head-icon',
  'td-remote-tab',
  'td-remote-unified-panel',
  'td-remote-triplet-col',
  'td-remote-mode-pill',
  'td-remote-engine-pill',
  'td-remote-dest-card',
  'td-remote-paste-action',
  'td-remote-url-input',
  'tm-panel',
  'tm-head',
  'tm-dir-badge',
  'td-storage-popover-card',
  'td-storage-splash-pill',
  'td-cat-count',
  'td-popover-close-btn',
  'td-tools-input',
  'td-col-header',
  'td-col-sort-icon',
  'td-confirm-btn',
  'td-hybrid-hero-presets',
  'td-hero-preset-card',
  'td-summary-card',
  'td-hybrid-check-row',
  'td-encoder-tile',
  'td-drag-ghost',
  'td-drag-ghost-stack',
  'td-drop-overlay',
  'td-drop-overlay-icon',
  'drive-quality-menu',
  'drive-preview-toolbar',
  'local-download-panel',
];

const ROGUE_SELECTOR_REGEX = new RegExp(`\\.(${TARGET_ROGUE_SELECTORS.join('|')})`, 'i');

// Hardcoded accent colors that override theme palettes
const HARDCODED_ACCENT_COLORS_REGEX = /#(3b82f6|1d4ed8|38bdf8|2563eb|0284c7|0ea5e9|60a5fa|93c5fd|a855f7|6366f1)\b/i;

// Hardcoded blue/cyan/purple accent rgba colors
const HARDCODED_ACCENT_RGBA_REGEX = /rgba?\(\s*(59\s*,\s*130\s*,\s*246|56\s*,\s*189\s*,\s*248|37\s*,\s*99\s*,\s*235|29\s*,\s*78\s*,\s*216|36\s*,\s*129\s*,\s*204|14\s*,\s*165\s*,\s*233|2\s*,\s*132\s*,\s*199|168\s*,\s*85\s*,\s*247|99\s*,\s*102\s*,\s*241)/i;

for (const file of cssFiles) {
  const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  let currentSelector = '';

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    // Track multi-line and single-line selector context
    if (!trimmed.includes('{') && !trimmed.includes('}') && !trimmed.includes(';') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
      if (trimmed.length > 0 && !currentSelector.includes('{')) {
        currentSelector = (currentSelector + ' ' + trimmed).trim();
      }
    } else if (trimmed.includes('{')) {
      const pre = trimmed.slice(0, trimmed.indexOf('{')).trim();
      currentSelector = currentSelector ? `${currentSelector} ${pre}`.trim() : pre;
    } else if (trimmed.includes('}')) {
      currentSelector = '';
    }

    // Whitelist check (line or preceding line)
    if (line.includes('THEME-AUDIT-EXCEPTION:') || (idx > 0 && lines[idx - 1].includes('THEME-AUDIT-EXCEPTION:'))) {
      return;
    }

    // Skip CSS variable definition lines (--token: #...)
    if (/^\s*--[a-zA-Z0-9_-]+\s*:/.test(line)) {
      return;
    }

    // Skip rules that already consume CSS variables (var(--...))
    if (line.includes('var(--')) {
      return;
    }

    const isTargetSelector = ROGUE_SELECTOR_REGEX.test(currentSelector) || ROGUE_SELECTOR_REGEX.test(line);
    const hasColorProperty = /(background|background-color|background-image|color|border|border-color|box-shadow)\s*:/i.test(line);
    const hasHexColor = /#[0-9a-fA-F]{3,8}\b/i.test(line);
    const hasRgbColor = /rgba?\([^)]+\)/i.test(line);

    // Skip neutral scrims / overlays (e.g. rgba(0,0,0,...) or rgba(255,255,255,...))
    const isNeutralScrim = /rgba?\(\s*(0|255)\s*,\s*(0|255)\s*,\s*(0|255)\s*(,\s*[0-9.]+%?\s*)?\)/.test(line);

    // Skip connection status dots & indicator states
    const isStatusIndicator = /(\.td-rail-conn-dot|\.excellent|\.good|\.fair|\.poor|\.disconnected|\.is-drop-over|\.is-complete|\.is-paused)/i.test(currentSelector) ||
                              /(\.td-rail-conn-dot|\.excellent|\.good|\.fair|\.poor|\.disconnected|\.is-drop-over|\.is-complete|\.is-paused)/i.test(line);

    // Skip neutral text colors (#ffffff, #94a3b8, #cbd5e1, #e2e8f0, #f8fafc) on UI selectors
    const isNeutralText = /(^|\s)color\s*:\s*(#ffffff|#fff|#94a3b8|#64748b|#cbd5e1|#e2e8f0|#f8fafc|transparent)\b/i.test(line);

    // RULE A: Target rogue UI selectors must not specify un-bridged hardcoded accent colors
    if (isTargetSelector && hasColorProperty && (hasHexColor || hasRgbColor)) {
      if (!isNeutralScrim && !isStatusIndicator && !isNeutralText) {
        if (HARDCODED_ACCENT_COLORS_REGEX.test(line) || HARDCODED_ACCENT_RGBA_REGEX.test(line)) {
          addViolation(rel, idx + 1, line, `Static color on target UI selector [${currentSelector || 'inline rule'}] without CSS variable`);
          return;
        }
      }
    }

    // RULE B: Rogue !important static accent overrides that break theme cascade
    if (isTargetSelector && line.includes('!important') && hasColorProperty && (HARDCODED_ACCENT_COLORS_REGEX.test(line) || HARDCODED_ACCENT_RGBA_REGEX.test(line))) {
      if (!isStatusIndicator && !isNeutralText && !isNeutralScrim) {
        addViolation(rel, idx + 1, line, `Rogue !important static color on UI selector [${currentSelector || 'inline rule'}] breaks theme cascade`);
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTING & CERTIFICATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════════');
console.log('                 AUTOGRAM THEME AUDIT SCANNER                   ');
console.log('════════════════════════════════════════════════════════════════\n');
console.log(`Passed: ${componentFiles.length} components scanned`);
console.log(`Passed: ${cssFiles.length} stylesheets scanned (${cssFiles.map((f) => path.basename(f)).join(', ')})`);
console.log(`Failed: ${totalViolations} static colors detected (Exit code ${totalViolations === 0 ? 0 : 1})\n`);

if (totalViolations > 0) {
  console.error('[THEME LEAKAGE DETECTED] The following files contain forbidden static color patterns:');
  for (const [file, items] of violationsByFile.entries()) {
    console.error(`\n  File: ${file} (${items.length} violations)`);
    items.forEach((v) => {
      console.error(`    Line ${v.line} [${v.reason}]:`);
      console.error(`      ${v.content}`);
    });
  }
  process.exit(1);
} else {
  console.log('✔ [SUCCESS] 0 static theme leakage detected! All components and stylesheets comply with the Central Theme Token Contract.\n');
  process.exit(0);
}
