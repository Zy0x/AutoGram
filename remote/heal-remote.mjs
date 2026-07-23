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

      // Poll for live high-resolution thumbnails as MTProto downloads settle
      let cardMetrics = { totalCards: 0, hdCount: 0, microCount: 0, sample: [] };
      for (let attempt = 0; attempt < 8; attempt++) {
        await page.waitForTimeout(1000);
        cardMetrics = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('.td-file-card img, [data-testid="drive-file-card"] img'));
          const HD = cards.filter((img) => img.naturalWidth >= 200);
          const micro = cards.filter((img) => img.naturalWidth > 0 && img.naturalWidth < 100);
          return {
            totalCards: cards.length,
            hdCount: HD.length,
            microCount: micro.length,
            sample: cards.slice(0, 6).map((img) => ({
              src: img.src ? img.src.substring(0, 60) + '...' : '',
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              clientWidth: img.clientWidth,
              clientHeight: img.clientHeight,
            })),
          };
        });
        if (cardMetrics.hdCount > 0) {
          console.log(`[heal-thumbs-probe] HD thumbnails arrived at second ${attempt + 1}!`);
          break;
        }
      }
      console.log('[heal-thumbs-probe]', JSON.stringify(cardMetrics, null, 2));

      await page.screenshot({ path: path.join(SUITE_ROOT, 'reports', 'gudang_thumbs_live_heal.png') });
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
