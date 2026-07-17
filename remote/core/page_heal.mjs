/**
 * Detect WebView "can't reach this page" / blank chrome-error and recover:
 * 1) ensure Vite is up
 * 2) navigate page to viteUrl
 * 3) wait for real app chrome (.td-page / body text)
 */
import { log } from './logger.mjs';
import { ensureVite, viteOrigin } from './vite_ensure.mjs';

/** Patterns for Edge/Chrome connection-error pages (EN + ID). */
const UNREACHABLE_RE =
  /can'?t\s*reach|cannot\s*reach|tidak\s*dapat\s*dijangkau|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|This\s+site\s+can'?t\s+be\s+reached|Hmmm|Unable\s+to\s+connect|took\s+too\s+long|DNS_PROBE|chrome-error|edge:\/\/|about:neterror/i;

export async function diagnosePage(page) {
  let url = '';
  let title = '';
  let bodySnippet = '';
  try {
    url = page.url() || '';
  } catch {
    url = '';
  }
  try {
    title = (await page.title().catch(() => '')) || '';
  } catch {
    title = '';
  }
  try {
    bodySnippet = await page
      .evaluate(() => {
        const t = document.body?.innerText || document.documentElement?.innerText || '';
        return String(t).slice(0, 600);
      })
      .catch(() => '');
  } catch {
    bodySnippet = '';
  }

  const hay = `${url}\n${title}\n${bodySnippet}`;
  const urlBad =
    !url ||
    url === 'about:blank' ||
    /chrome-error|chromewebdata|edge:\/\/|data:text\/html,chromewebdata/i.test(url);
  const textBad = UNREACHABLE_RE.test(hay);
  // App markers when healthy
  let hasApp = false;
  try {
    hasApp = await page.evaluate(() => {
      if (document.querySelector('.td-page, .td-shell, .app-layout, #root .app-layout')) return true;
      const t = document.body?.innerText || '';
      return /Media Studio|AutoGram|Drive terhubung|Saved Messages/i.test(t);
    });
  } catch {
    hasApp = false;
  }

  const unreachable = urlBad || textBad || !hasApp;
  return {
    unreachable: unreachable && !hasApp ? true : urlBad || textBad,
    hasApp,
    url,
    title,
    bodySnippet: bodySnippet.slice(0, 200),
  };
}

/**
 * Heal WebView page so remote tests / human see the app, not chrome error.
 * @returns {{ healed: boolean, diagnostics: object, navigated: boolean }}
 */
export async function healPage(page, config, opts = {}) {
  const force = opts.force === true;
  const maxNav = opts.maxNavAttempts ?? 3;

  let diagnostics = await diagnosePage(page);
  if (!force && diagnostics.hasApp && !diagnostics.unreachable) {
    log.info('page_heal_skip', { reason: 'app_already_healthy', url: diagnostics.url });
    return { healed: true, navigated: false, diagnostics };
  }

  log.warn('page_heal_start', diagnostics);

  // 1) Vite must answer
  await ensureVite(config, { maxWaitMs: opts.viteWaitMs ?? 45_000 });

  const origin = viteOrigin(config);
  const target = `${origin}/?heal=${Date.now()}`;

  // 2) Navigate WebView (may have been stuck on chrome-error://)
  let navigated = false;
  for (let i = 0; i < maxNav; i++) {
    try {
      await page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: opts.gotoTimeoutMs ?? 35_000,
      });
      navigated = true;
    } catch (e) {
      log.warn('page_heal_goto_fail', { attempt: i + 1, err: String(e?.message || e) });
      // Still try reload
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
        navigated = true;
      } catch {
        /* next */
      }
    }

    // Give React/Tauri a moment to paint
    await new Promise((r) => setTimeout(r, 1200));
    diagnostics = await diagnosePage(page);
    if (diagnostics.hasApp && !UNREACHABLE_RE.test(`${diagnostics.title}\n${diagnostics.bodySnippet}`)) {
      log.info('page_heal_ok', { url: diagnostics.url, attempt: i + 1 });
      return { healed: true, navigated, diagnostics };
    }
  }

  diagnostics = await diagnosePage(page);
  const healed = !!diagnostics.hasApp && !diagnostics.unreachable;
  if (!healed) {
    log.fail('page_heal', diagnostics);
  } else {
    log.info('page_heal_ok', diagnostics);
  }
  return { healed, navigated, diagnostics };
}
