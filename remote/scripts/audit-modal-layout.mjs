#!/usr/bin/env node
/**
 * Standalone modal layout audit (rename strip bug).
 *   cd remote && node scripts/audit-modal-layout.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUITE_ROOT, ensureDirs, SHOTS_DIR, stamp } from '../core/paths.mjs';
import { connect } from '../core/remote_connector.mjs';
import {
  auditModalLayouts,
  openRenameForAudit,
  closeRenameAudit,
} from '../core/modal_layout_audit.mjs';
import { capture } from '../core/screenshot_engine.mjs';

const config = JSON.parse(
  fs.readFileSync(path.join(SUITE_ROOT, 'config', 'remote_config.json'), 'utf8')
);

async function main() {
  ensureDirs();
  const { page, dispose } = await connect(config);
  let mode = 'synthetic';
  try {
    const opened = await openRenameForAudit(page);
    mode = opened.mode;
    await new Promise((r) => setTimeout(r, 300));
    await capture(page, `modal_layout_${stamp()}`);
    const report = await auditModalLayouts(page);
    const out = path.join(SUITE_ROOT, 'reports', `modal-layout-audit-${stamp()}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    console.log(report.pass ? '[PASS] modal layout OK' : '[FAIL] modal layout issues');
    console.log('report:', out);
    process.exit(report.pass ? 0 : 2);
  } finally {
    await closeRenameAudit(page, mode);
    dispose();
    // CDP keeps process alive
    process.exit(process.exitCode || 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
