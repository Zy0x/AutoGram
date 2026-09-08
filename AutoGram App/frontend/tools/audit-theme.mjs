import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const srcRoot = path.join(root, 'src');

function walk(dir, predicate) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'target') {
        output.push(...walk(full, predicate));
      }
    } else if (predicate(full)) {
      output.push(full);
    }
  }
  return output;
}

const componentFiles = walk(srcRoot, (f) => /\.(tsx|jsx)$/.test(f) && !f.endsWith('.test.tsx') && !f.endsWith('.test.ts'));

let totalViolations = 0;
let scannedCount = componentFiles.length;
const violationsByFile = new Map();

for (const file of componentFiles) {
  const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, idx) => {
    // Check if line is whitelisted (current line or preceding line)
    if (line.includes('THEME-AUDIT-EXCEPTION:') || (idx > 0 && lines[idx - 1].includes('THEME-AUDIT-EXCEPTION:'))) {
      return;
    }

    // Check for raw unadapted inline background colors (e.g. style={{ background: '#...' }})
    const inlineHexBg = /style=\{\{[^}]*(background|backgroundColor):\s*['"][^'"]*#[0-9a-fA-F]{3,8}/i.test(line);
    // Check for hardcoded inline hex border
    const inlineHexBorder = /style=\{\{[^}]*borderColor:\s*['"][^'"]*#[0-9a-fA-F]{3,8}/i.test(line);

    if (inlineHexBg || inlineHexBorder) {
      // Check if it's already using CSS var fallback or dynamic palette token
      if (line.includes('var(--') || line.includes('palette.') || line.includes('activePalette') || line.includes('color_accent') || line.includes('previewColors')) {
        return;
      }
      totalViolations++;
      if (!violationsByFile.has(rel)) violationsByFile.set(rel, []);
      violationsByFile.get(rel).push({ line: idx + 1, content: line.trim() });
    }
  });
}

console.log('\n════════════════════════════════════════════════════════════════');
console.log('                 AUTOGRAM THEME AUDIT SCANNER                   ');
console.log('════════════════════════════════════════════════════════════════\n');
console.log(`Passed: ${scannedCount} components scanned`);
console.log(`Failed: ${totalViolations} static colors detected\n`);

if (totalViolations > 0) {
  console.error('[THEME LEAKAGE DETECTED] The following files contain forbidden static color patterns without whitelist annotations:');
  for (const [file, items] of violationsByFile.entries()) {
    console.error(`\n  File: ${file}`);
    items.slice(0, 5).forEach((v) => {
      console.error(`    Line ${v.line}: ${v.content}`);
    });
    if (items.length > 5) {
      console.error(`    ... and ${items.length - 5} more`);
    }
  }
  process.exit(1);
} else {
  console.log('✔ [SUCCESS] 0 static theme leakage detected! All components comply with the Central Theme Token Contract.\n');
  process.exit(0);
}
