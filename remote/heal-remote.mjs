#!/usr/bin/env node
/**
 * Smart heal: ensure Vite + (if CDP up) navigate WebView off "can't reach this page".
 * Usage:
 *   node heal-remote.mjs
 *   npm run heal   (from remote/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDirs, SUITE_ROOT } from './core/paths.mjs';
import { log } from './core/logger.mjs';
import { ensureVite } from './core/vite_ensure.mjs';
import { connect } from './core/remote_connector.mjs';
import { healPage } from './core/page_heal.mjs';

const config = JSON.parse(
  fs.readFileSync(path.join(SUITE_ROOT, 'config', 'remote_config.json'), 'utf8')
);

async function main() {
  ensureDirs();
  log.info('heal_remote_start', {});

  const vite = await ensureVite(config);
  console.log('[heal] Vite OK', vite.origin, vite.started ? '(started)' : '(already up)');

  // CDP optional — frontend may not be running yet
  let code = 0;
  try {
    const { page, dispose } = await connect(config);
    try {
      // connect() already heals; force once more for CLI clarity
      const result = await healPage(page, config, { force: false });
      console.log(
        result.healed
          ? `[heal] WebView OK url=${result.diagnostics.url}`
          : `[heal] WebView still unhealthy: ${JSON.stringify(result.diagnostics)}`
      );
      if (!result.healed) code = 2;
    } finally {
      dispose();
    }
  } catch (e) {
    console.log(
      `[heal] CDP not available (${String(e?.message || e)}) — Vite is up; start frontend.exe with ensure-remote.ps1`
    );
    // Vite-only success is still useful
    code = 0;
  }
  // CDP websocket keeps Node alive — hard exit
  process.exit(code);
}

main().catch((e) => {
  console.error('[heal] FAIL', e);
  process.exit(1);
});
