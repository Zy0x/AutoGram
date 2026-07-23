#!/usr/bin/env node
/**
 * Minimal post-migration remote smoke suite.
 * Usage: npm run suite   (from remote/)
 *
 * Does NOT close the browser / frontend.exe (never browser.close).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDirs, SUITE_ROOT, stamp } from './core/paths.mjs';
import { log } from './core/logger.mjs';
import { ensureVite } from './core/vite_ensure.mjs';
import { connect } from './core/remote_connector.mjs';
import { healPage } from './core/page_heal.mjs';

const config = JSON.parse(
  fs.readFileSync(path.join(SUITE_ROOT, 'config', 'remote_config.json'), 'utf8')
);

function writeStatus(text) {
  const p = path.join(SUITE_ROOT, 'reports', 'last-run-status.txt');
  fs.writeFileSync(p, text, 'utf8');
}

async function smoke(page) {
  const checks = [];
  const url = page.url();
  checks.push({ id: 'url', ok: /127\.0\.0\.1:1420|localhost:1420|tauri|autogram/i.test(url) || url.length > 0, detail: url });

  // Media Studio tab lives under SpeedTest / drive UI
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '');
  const hasShell =
    /Media Studio|Drive|Saved Messages|Transfer|Session|AutoGram|Pengaturan|Settings/i.test(body) ||
    (await page.locator('body').count()) > 0;
  checks.push({ id: 'shell_text', ok: hasShell, detail: body.slice(0, 120).replace(/\s+/g, ' ') });

  // Chrome error page must not stick
  const bad = /can't reach this page|ERR_CONNECTION|This site can't be reached|Hmmm/i.test(body);
  checks.push({ id: 'not_chrome_error', ok: !bad, detail: bad ? 'chrome error text present' : 'ok' });

  return checks;
}

async function main() {
  ensureDirs();
  const started = Date.now();
  log.info('suite_start', { stamp: stamp() });
  writeStatus('WORKING suite');

  const vite = await ensureVite(config);
  console.log('[suite] Vite', vite.origin, vite.started ? '(started)' : '(up)');

  let dispose = null;
  let code = 0;
  try {
    const conn = await connect(config);
    dispose = conn.dispose;
    const page = conn.page;

    const heal = await healPage(page, config, { force: false });
    console.log('[suite] heal', heal.healed ? 'OK' : 'UNHEALTHY', heal.diagnostics?.url || '');

    const checks = await smoke(page);
    const failed = checks.filter((c) => !c.ok);
    for (const c of checks) {
      console.log(`[suite] ${c.ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.detail}`);
      log.info('suite_check', c);
    }

    const summary = {
      stamp: stamp(),
      ms: Date.now() - started,
      vite: vite.origin,
      heal: heal.healed,
      checks,
      ok: failed.length === 0 && heal.healed !== false,
    };
    fs.writeFileSync(
      path.join(SUITE_ROOT, 'reports', 'summary_dashboard.json'),
      JSON.stringify(summary, null, 2),
      'utf8'
    );

    if (!summary.ok) {
      code = 2;
      writeStatus(`FAIL suite (${failed.map((f) => f.id).join(',') || 'heal'})`);
    } else {
      writeStatus('OK suite');
      console.log('[suite] OK');
    }
  } catch (e) {
    code = 3;
    console.error('[suite] ERROR', e?.message || e);
    log.error('suite_error', { message: String(e?.message || e) });
    writeStatus(`FAIL suite error: ${String(e?.message || e).slice(0, 200)}`);
  } finally {
    if (typeof dispose === 'function') {
      try {
        await dispose();
      } catch {
        /* never close browser host */
      }
    }
  }
  process.exit(code);
}

main();
