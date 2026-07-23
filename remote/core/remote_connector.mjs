/**
 * CDP connector for AutoGram frontend.exe / WebView2 (Playwright connectOverCDP).
 * NEVER calls browser.close() — that kills the desktop WebView.
 *
 * Smart heal: if WebView shows "can't reach this page" (Vite was down),
 * ensure Vite then navigate to viteUrl before returning the page.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { SUITE_ROOT } from './paths.mjs';
import { log } from './logger.mjs';
import { ensureVite } from './vite_ensure.mjs';
import { healPage } from './page_heal.mjs';

const require = createRequire(import.meta.url);

export async function loadPlaywright(config) {
  const candidates = [
    path.resolve(SUITE_ROOT, '../AutoGram App/frontend/node_modules/playwright'),
    path.resolve(SUITE_ROOT, config.playwrightModule || ''),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      const mod = require(c);
      if (mod?.chromium) return mod;
    } catch {
      /* try ESM */
    }
    try {
      const mod = await import(pathToFileURL(path.join(c, 'index.js')).href);
      if (mod?.chromium) return mod;
    } catch {
      /* next */
    }
  }
  throw new Error('Playwright not found — install under AutoGram App/frontend');
}

export async function connect(config) {
  const { chromium } = await loadPlaywright(config);
  let browser;
  let lastErr;
  for (let i = 0; i < (config.retry?.maxAttempts || 5); i++) {
    try {
      browser = await chromium.connectOverCDP(config.cdpUrl, {
        timeout: config.connectTimeoutMs || 8000,
      });
      break;
    } catch (e) {
      lastErr = e;
      const delay = Math.min(
        config.retry.maxDelayMs,
        config.retry.baseDelayMs * Math.pow(2, i)
      );
      log.warn('cdp_reconnect', { attempt: i + 1, delay, err: String(e.message || e) });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  if (!browser) throw lastErr || new Error('CDP connect failed');

  // Prefer real page targets (avoid shared_worker flakiness under CDP)
  let pages = [];
  for (const c of browser.contexts()) {
    pages.push(...c.pages());
  }
  let page =
    pages.find((x) => /localhost:1420|127\.0\.0\.1:1420/i.test(x.url())) ||
    pages.find((x) => /tauri|autogram/i.test(x.url())) ||
    pages.find((x) => x.url() && !x.url().startsWith('blob:')) ||
    pages[0];
  if (!page) throw new Error('No WebView/page attached to CDP');

  await page.bringToFront().catch(() => {});
  log.info('connected', { url: page.url(), pages: pages.length });

  // Auto-heal chrome error / blank / wrong URL
  try {
    const heal = await healPage(page, config);
    if (!heal.healed) {
      log.warn('connect_heal_incomplete', heal.diagnostics);
    } else {
      log.info('connect_heal_ok', { url: heal.diagnostics.url, navigated: heal.navigated });
    }
  } catch (e) {
    log.warn('connect_heal_error', { err: String(e?.message || e) });
  }

  let beat = 0;
  const hb = setInterval(() => {
    beat += 1;
    page
      .evaluate(() => document.readyState)
      .then((s) => log.info('heartbeat', { n: beat, ready: s }))
      .catch((e) => log.warn('heartbeat_fail', { n: beat, err: String(e.message || e) }));
  }, config.heartbeatMs || 5000);

  return {
    browser,
    page,
    stopHeartbeat: () => clearInterval(hb),
    dispose: () => {
      clearInterval(hb);
      log.info('connector_dispose', { note: 'browser left open (frontend.exe)' });
    },
    /** Re-run heal (e.g. mid-suite if page died) */
    heal: () => healPage(page, config, { force: true }),
  };
}
