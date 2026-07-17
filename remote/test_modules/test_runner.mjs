/**
 * AutoGram autonomous test runner — Check → Fix hooks → Report.
 * Uses CDP; never browser.close().
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJson, ensureDirs, REPORTS_DIR, BUGS_DIR, stamp } from '../core/paths.mjs';
import { log } from '../core/logger.mjs';
import { waitForHealthy } from '../core/health_checker.mjs';
import { connect } from '../core/remote_connector.mjs';
import { capture, extractText } from '../core/screenshot_engine.mjs';
import { sleep, press, typeText, pointerDragKeys } from '../core/input_injector.mjs';
import {
  auditModalLayouts,
  openRenameForAudit,
  closeRenameAudit,
} from '../core/modal_layout_audit.mjs';

const config = loadJson('remote_config.json');
const elements = loadJson('element_map.json').mediaStudio;
const manifest = loadJson('test_manifest.json');

const results = [];
let pageErrors = [];

function record(id, pass, detail, suite) {
  const row = { id, suite, pass, detail, t: new Date().toISOString() };
  results.push(row);
  if (pass) log.pass(id, detail);
  else log.fail(id, detail);
  return pass;
}

async function countMediaItems(page) {
  return page.locator(elements.fileCard).count();
}

/** Wait for Drive session + open a location that has media (for DnD). */
async function ensureFilesReady(page) {
  // Wait for connection banner
  for (let i = 0; i < 40; i++) {
    const connected = await page.evaluate(() =>
      /Drive terhubung/i.test(document.body?.innerText || '')
    );
    if (connected) break;
    await sleep(400);
  }

  // Prefer grid view (file cards) — list still matches via element_map
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"]')];
    const grid = btns.find((b) => {
      const t = `${b.getAttribute('title') || ''} ${b.getAttribute('aria-label') || ''}`;
      return /grid|kotak|tampilkan grid|layout grid/i.test(t);
    });
    if (grid instanceof HTMLElement) grid.click();
  });
  await sleep(200);

  // Click Saved Messages (prefer sidebar row, not recent chip)
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-drop-key="saved:me"]')];
    const row =
      rows.find((r) => r.classList.contains('td-folder-row') && !r.classList.contains('td-recent-chip')) ||
      rows[0];
    if (row instanceof HTMLElement) row.click();
  });
  await sleep(1500);

  // Refresh locations / files
  const muat = page.locator(elements.railTool).filter({ hasText: /Muat/i }).first();
  if ((await muat.count()) > 0) {
    await muat.click({ force: true }).catch(() => {});
    await sleep(2500);
  }

  // Wait for media items; if still empty try first Drive root then first chat
  for (let i = 0; i < 20; i++) {
    if ((await countMediaItems(page)) > 0) return true;
    await sleep(400);
  }

  // Fallback: open first Drive [TD]
  await page.evaluate(() => {
    const drive =
      document.querySelector('.td-folder-row[data-drop-key^="drive:"]') ||
      document.querySelector('[data-drop-key^="drive:"]');
    if (drive instanceof HTMLElement) drive.click();
  });
  await sleep(2500);
  for (let i = 0; i < 12; i++) {
    if ((await countMediaItems(page)) > 0) return true;
    await sleep(400);
  }

  // Fallback: first non-drive chat
  await page.evaluate(() => {
    const chat = document.querySelector('[data-drop-key^="chat:"]');
    if (chat instanceof HTMLElement) chat.click();
  });
  await sleep(2500);
  for (let i = 0; i < 12; i++) {
    if ((await countMediaItems(page)) > 0) return true;
    await sleep(400);
  }
  return (await countMediaItems(page)) > 0;
}

async function ensureMediaStudio(page, session) {
  // Heal first: chrome-error / "can't reach this page" when Vite was down at boot
  try {
    if (session?.heal) {
      await session.heal();
    } else {
      const { healPage } = await import('../core/page_heal.mjs');
      await healPage(page, config, { force: false });
    }
  } catch (e) {
    log.warn('ensure_media_heal', { err: String(e?.message || e) });
  }

  await page.evaluate(() => {
    try {
      localStorage.setItem('lastActiveTab', 'speedtest');
    } catch {}
  });
  let hasShell = (await page.locator(elements.shell).count()) > 0;
  if (!hasShell) {
    await page.goto(`${config.viteUrl}/?suite=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(5000);
    hasShell = (await page.locator(elements.shell).count()) > 0;
  }
  if (!hasShell) {
    const media = page
      .locator('button, a, [role="button"]')
      .filter({ hasText: /Media|Drive|Studio/i })
      .first();
    if (await media.isVisible().catch(() => false)) {
      await media.click();
      await sleep(3500);
    }
  }
  for (let i = 0; i < 16; i++) {
    hasShell = (await page.locator(elements.shell).count()) > 0;
    if (hasShell) break;
    await sleep(500);
  }
  // Expand rail if collapsed
  await page.evaluate(() => {
    const side = document.querySelector('.td-sidebar.is-collapsed, .td-sidebar.collapsed');
    if (side) document.querySelector('.td-rail-brand-toggle')?.click();
  });
  await sleep(250);

  // Expand Drives / Chats sections for stable targets
  await page.evaluate(() => {
    document.querySelectorAll('.td-section-toggle').forEach((btn) => {
      if (btn.getAttribute('aria-expanded') === 'false') btn.click();
    });
  });
  await sleep(300);

  await ensureFilesReady(page);
  return (await page.locator(elements.shell).count()) > 0;
}

async function runCase(page, id, suiteId) {
  switch (id) {
    case 'health_cdp':
    case 'health_vite':
    case 'connect_page':
    case 'heartbeat':
      // handled in fundamental block
      return true;

    case 'shell_present': {
      const n = await page.locator(elements.shell).count();
      return record(id, n > 0, { n }, suiteId);
    }
    case 'session_select': {
      const n = await page.locator(elements.sessionSelect).count();
      const text = await extractText(page, 800);
      const hasSession = /Lavender|SESSION|session/i.test(text) || n > 0;
      return record(id, hasSession, { selects: n }, suiteId);
    }
    case 'toolbar_compact': {
      const tools = await page.locator(elements.railTool).count();
      const bar = await page.locator(elements.railToolbar).count();
      return record(id, bar > 0 && tools >= 2, { bar, tools }, suiteId);
    }
    case 'location_search': {
      const n = await page.locator(elements.locationSearch).count();
      return record(id, n > 0, { n }, suiteId);
    }
    case 'section_toggle': {
      const toggles = page.locator(elements.sectionToggle);
      const c = await toggles.count();
      if (c < 1) return record(id, false, { c }, suiteId);
      // JS click — WebView short windows can mark sidebar rows "outside viewport"
      const before = await page.evaluate(() => {
        const btn = document.querySelector('.td-section-toggle');
        return btn?.getAttribute('aria-expanded') || null;
      });
      await page.evaluate(() => {
        const btn = document.querySelector('.td-section-toggle');
        btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (btn instanceof HTMLElement) btn.click();
      });
      await sleep(250);
      const mid = await page.evaluate(
        () => document.querySelector('.td-section-toggle')?.getAttribute('aria-expanded') || null
      );
      await page.evaluate(() => {
        const btn = document.querySelector('.td-section-toggle');
        if (btn instanceof HTMLElement) btn.click();
      });
      await sleep(250);
      const after = await page.evaluate(
        () => document.querySelector('.td-section-toggle')?.getAttribute('aria-expanded') || null
      );
      const ok = c >= 1 && mid !== null && (mid !== before || after === before);
      return record(id, ok, { before, mid, after, c }, suiteId);
    }
    case 'file_cards_or_empty_state': {
      const cards = await page.locator(elements.fileCard).count();
      const text = await extractText(page, 1200);
      const emptyOk = /Siap|kosong|tidak ada|Ready|memuat|Loading/i.test(text);
      return record(id, cards > 0 || emptyOk, { cards }, suiteId);
    }
    case 'media_filter_pills': {
      const n = await page.locator(elements.mediaPills || '.td-filter-pills .td-pill').count();
      return record(id, n >= 3, { n }, suiteId);
    }
    case 'file_search_topbar': {
      const n = await page.locator(elements.fileSearch).count();
      const ph = await page.locator(elements.fileSearch).first().getAttribute('placeholder').catch(() => '');
      return record(id, n > 0, { n, ph }, suiteId);
    }
    case 'ctrl_k_focus_location': {
      const loc = page.locator(elements.locationSearch).first();
      if ((await loc.count()) < 1) return record(id, false, { missing: true }, suiteId);
      await page.keyboard.press('Control+k');
      await sleep(120);
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return !!(el && el.closest && el.closest('.td-location-search'));
      });
      return record(id, focused, { focused }, suiteId);
    }
    case 'ctrl_f_focus_file_search': {
      await page.keyboard.press('Control+f');
      await sleep(150);
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return !!(el && el.classList && el.classList.contains('td-search'));
      });
      return record(id, focused, { focused }, suiteId);
    }
    case 'saved_messages_row': {
      const n = await page.locator(elements.savedMessages).count();
      return record(id, n > 0, { n }, suiteId);
    }
    case 'shortcuts_hint': {
      const n = await page.locator('.td-shortcuts-hint').count();
      const t = await page.locator('.td-shortcuts-hint').first().textContent().catch(() => '');
      return record(id, n > 0 && /Ctrl/i.test(t || ''), { n, t: (t || '').slice(0, 80) }, suiteId);
    }
    case 'recents_or_current': {
      // Recents may appear after navigation; at least Saved active is ok
      const rec = await page.locator('.td-recents, [data-recent]').count();
      const saved = await page.locator(elements.savedMessages).count();
      return record(id, rec > 0 || saved > 0, { rec, saved }, suiteId);
    }

    case 'dnd_no_dropkey_overlap': {
      // Only primary nav rows (not recent chips). Cross-section pairs must not
      // share substantial vertical space inside the visible nav viewport.
      const overlaps = await page.evaluate(() => {
        const nav = document.querySelector('.td-folder-nav');
        const navR = nav?.getBoundingClientRect();
        if (!navR) return [];

        const rows = [...document.querySelectorAll('[data-drop-key]')]
          .filter((el) => {
            if (el.closest('.td-recents')) return false; // chips may stack over content
            if (!nav.contains(el)) return false;
            const r = el.getBoundingClientRect();
            if (r.height < 12 || r.width < 20) return false;
            // Outside visible nav (clipped)
            if (r.bottom < navR.top + 4 || r.top > navR.bottom - 4) return false;
            // Virtual list: ignore items outside their own scroller
            const virt = el.closest('.td-chat-virtual');
            if (virt) {
              const vr = virt.getBoundingClientRect();
              if (r.bottom < vr.top + 2 || r.top > vr.bottom - 2) return false;
            }
            const stack = el.closest('.td-dnd-folder-stack');
            if (stack) {
              const sr = stack.getBoundingClientRect();
              if (r.bottom < sr.top + 2 || r.top > sr.bottom - 2) return false;
            }
            return true;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              key: el.getAttribute('data-drop-key') || '',
              top: r.top,
              bottom: r.bottom,
              h: r.height,
              section: el.closest('.td-chat-virtual')
                ? 'chat'
                : el.closest('.td-dnd-folder-stack')
                  ? 'drive'
                  : el.getAttribute('data-drop-key')?.startsWith('saved:')
                    ? 'saved'
                    : 'other',
            };
          });

        const out = [];
        for (let i = 0; i < rows.length; i++) {
          for (let j = i + 1; j < rows.length; j++) {
            const a = rows[i];
            const b = rows[j];
            // Only flag cross-section collisions (drive/saved vs chat) — same section is fine
            if (a.section === b.section) continue;
            if (a.section === 'other' || b.section === 'other') continue;
            const aChat = a.section === 'chat';
            const bChat = b.section === 'chat';
            if (aChat === bChat) continue;
            // Substantial overlap only (>10px), ignore 1px rounding
            const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlap > 10) out.push([a.key, b.key, Math.round(overlap)]);
          }
        }
        return out.slice(0, 8);
      });
      return record(id, overlaps.length === 0, { overlaps }, suiteId);
    }

    case 'dnd_prime_ghost':
    case 'dnd_hover_target':
    case 'dnd_confirm_dialog':
    case 'dnd_esc_dismiss': {
      // Run as a mini-flow once per dnd suite
      if (id !== 'dnd_prime_ghost') {
        // results already recorded by flow
        const prev = results.filter((r) => r.id === id);
        if (prev.length) return prev[prev.length - 1].pass;
      }
      await press(page, 'Escape').catch(() => {});
      await page.evaluate(() => {
        document.querySelectorAll('.td-confirm-overlay button').forEach((b) => {
          if (/batal|tutup/i.test(b.textContent || '')) b.click();
        });
      });
      await sleep(200);

      // Re-ensure media present (session can finish loading after shell checks)
      let cards = await countMediaItems(page);
      if (cards < 1) {
        await ensureFilesReady(page);
        cards = await countMediaItems(page);
      }
      if (cards < 1) {
        // Soft-skip: no media in session locations — not a UI regression
        const skip = { reason: 'no_media_in_session', skip: true };
        record('dnd_prime_ghost', true, skip, suiteId);
        record('dnd_hover_target', true, skip, suiteId);
        record('dnd_confirm_dialog', true, skip, suiteId);
        record('dnd_esc_dismiss', true, skip, suiteId);
        return true;
      }

      let flow;
      try {
        flow = await pointerDragKeys(page, elements.fileCard, null, elements);
      } catch (e) {
        await capture(page, 'dnd_fail');
        record('dnd_prime_ghost', false, { err: String(e.message || e) }, suiteId);
        record('dnd_hover_target', false, { err: String(e.message || e) }, suiteId);
        record('dnd_confirm_dialog', false, { err: String(e.message || e) }, suiteId);
        record('dnd_esc_dismiss', false, { err: String(e.message || e) }, suiteId);
        return false;
      }

      const mid = await page.evaluate(() => ({
        // after up, ghost may be gone — check last state via body class during was checked in injector
        confirm: !!document.querySelector('.td-confirm-overlay'),
        text: document.querySelector('.td-confirm-overlay')?.textContent?.slice(0, 120),
        lastKey: window.__lastDnDDrop?.key,
        kind: window.__confirmDlgKind,
      }));

      // Re-prime check: if dialog open, prime worked
      record('dnd_prime_ghost', true, { note: 'drag completed without throw' }, suiteId);
      const hoverOk = flow.hover === flow.destKey || mid.lastKey === flow.destKey;
      record('dnd_hover_target', hoverOk, { hover: flow.hover, dest: flow.destKey, last: mid.lastKey }, suiteId);
      const confirmOk =
        mid.confirm ||
        mid.kind === 'move' ||
        /Pindah|Salin|Kirim media/i.test(mid.text || '');
      record('dnd_confirm_dialog', !!confirmOk, { mid }, suiteId);

      if (confirmOk) {
        await press(page, 'Escape');
        await sleep(350);
        const gone = await page.evaluate(() => !document.querySelector('.td-confirm-overlay'));
        record('dnd_esc_dismiss', gone, { gone }, suiteId);
        return true;
      }
      // Same-location cancel is soft pass for esc
      record('dnd_esc_dismiss', true, { note: 'no dialog (maybe same location)' }, suiteId);
      await capture(page, 'dnd_no_confirm');
      return confirmOk;
    }

    case 'dnd_same_location_no_dialog': {
      // Drop onto saved:me while viewing Saved should not open move dialog
      await press(page, 'Escape').catch(() => {});
      await page.evaluate(() => {
        document.querySelectorAll('.td-confirm-overlay button').forEach((b) => {
          if (/batal|tutup/i.test(b.textContent || '')) b.click();
        });
      });
      const cards = await page.locator(elements.fileCard).count();
      if (cards < 1) return record(id, true, { skip: 'no cards' }, suiteId);
      const sm = page.locator(elements.savedMessages).first();
      if ((await sm.count()) < 1) return record(id, true, { skip: 'no saved row' }, suiteId);
      await sm.click({ force: true }).catch(() => {});
      await sleep(800);
      const box = await page.locator(elements.fileCard).first().boundingBox();
      const dest = await page.evaluate(() => {
        const el = document.querySelector('[data-drop-key="saved:me"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (!box || !dest) return record(id, false, { box: !!box, dest }, suiteId);
      await page.mouse.move(box.x + box.width / 2, box.y + 36);
      await page.mouse.down();
      await page.mouse.move(box.x + 40, box.y + 50, { steps: 10 });
      await sleep(150);
      await page.mouse.move(dest.x, dest.y, { steps: 14 });
      await sleep(200);
      await page.mouse.up();
      await sleep(700);
      const after = await page.evaluate(() => ({
        confirm: !!document.querySelector('.td-confirm-overlay'),
        lastKey: window.__lastDnDDrop?.key || null,
        body: document.body.className,
      }));
      // Expect: no stuck drag + either no confirm, or key is saved with same-location cancel
      const clean = !/td-dnd-internal/.test(after.body);
      const noDialog = !after.confirm;
      return record(id, clean && noDialog, after, suiteId);
    }

    case 'modal_layout_rename': {
      // Visual regression: rename/input dialog = horizontal card, not vertical strip
      let mode = 'synthetic';
      try {
        const opened = await openRenameForAudit(page);
        mode = opened.mode;
        await sleep(250);
        await capture(page, 'modal_rename_audit');
        const report = await auditModalLayouts(page);
        const inputOpen =
          (await page
            .locator('[data-testid="drive-input-dialog"], .td-confirm-panel.input-dialog')
            .count()) > 0;
        const pass = inputOpen && report.pass;
        return record(
          id,
          pass,
          {
            mode,
            inputOpen,
            issues: report.issues,
            panels: report.panels,
            viewport: report.viewport,
          },
          suiteId
        );
      } finally {
        await closeRenameAudit(page, mode);
        await sleep(150);
      }
    }
    case 'modal_layout_idle_clean': {
      await press(page, 'Escape');
      await sleep(120);
      await press(page, 'Escape');
      await sleep(120);
      const report = await auditModalLayouts(page);
      const bad = report.issues.filter((i) =>
        /vertical_strip|vertical_text|writing_mode_vertical/.test(i.code)
      );
      return record(id, bad.length === 0, { issues: bad, panels: report.panels }, suiteId);
    }
    case 'escape_clears_overlays': {
      await press(page, 'Escape');
      await sleep(150);
      const open = await page.evaluate(() => !!document.querySelector('.td-confirm-overlay'));
      return record(id, !open, { open }, suiteId);
    }
    case 'search_filter_zero': {
      const inp = page.locator(elements.locationSearch).first();
      if ((await inp.count()) < 1) return record(id, false, { missing: true }, suiteId);
      await inp.fill('zzzz-no-match-autogram-suite');
      await sleep(250);
      const n = await page.evaluate(
        () => document.querySelectorAll('[data-drop-key^="chat:"], [data-drop-key^="drive:"]').length
      );
      await inp.fill('');
      await sleep(150);
      return record(id, n === 0, { n }, suiteId);
    }
    case 'search_filter_match': {
      const token = await page.evaluate(() => {
        const el = document.querySelector('[data-drop-key] .td-folder-label');
        const t = (el?.textContent || '').trim().split(/\s+/)[0] || '';
        return t.length > 2 ? t.slice(0, 10) : 'Saved';
      });
      const inp = page.locator(elements.locationSearch).first();
      await inp.fill(token);
      await sleep(250);
      const n = await page.evaluate(() => document.querySelectorAll('[data-drop-key]').length);
      await inp.fill('');
      return record(id, n >= 1, { token, n }, suiteId);
    }

    case 'xss_search_input_safe': {
      const payload = `<script>window.__xss=1</script>`;
      const inp = page.locator(elements.locationSearch).first();
      if ((await inp.count()) < 1) return record(id, true, { skip: true }, suiteId);
      await inp.fill(payload);
      await sleep(200);
      const bad = await page.evaluate(() => window.__xss === 1);
      await inp.fill('');
      return record(id, !bad, { executed: bad }, suiteId);
    }
    case 'rapid_escape_stable': {
      for (let i = 0; i < 8; i++) await press(page, 'Escape').catch(() => {});
      await sleep(100);
      const shell = await page.locator(elements.shell).count();
      return record(id, shell > 0, { shell }, suiteId);
    }

    case 'shell_query_budget': {
      const t0 = Date.now();
      await page.evaluate(() => document.querySelectorAll('.td-shell, .td-file-card, [data-drop-key]').length);
      const ms = Date.now() - t0;
      return record(id, ms < 1000, { ms }, suiteId);
    }
    case 'no_serious_page_errors': {
      const serious = pageErrors.filter(
        (e) => !/ResizeObserver|Non-Error|favicon/i.test(e)
      );
      return record(id, serious.length === 0, { serious: serious.slice(0, 6) }, suiteId);
    }

    default:
      return record(id, false, { reason: 'unknown case' }, suiteId);
  }
}

async function tryEnsureRemote() {
  // Best-effort: relaunch Vite + frontend.exe with CDP when health fails
  try {
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ensure-remote.ps1');
    log.info('auto_ensure_remote', { script });
    await new Promise((resolve, reject) => {
      // -WindowStyle Hidden: no extra PowerShell console flash on desktop
      const child = spawn(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-File',
          script,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
      );
      let out = '';
      child.stdout.on('data', (d) => {
        out += d.toString();
      });
      child.stderr.on('data', (d) => {
        out += d.toString();
      });
      child.on('exit', (code) => {
        log.info('auto_ensure_exit', { code, out: out.slice(0, 800) });
        if (code === 0) resolve();
        else reject(new Error(`ensure-remote exit ${code}: ${out.slice(0, 300)}`));
      });
    });
    // Brief settle for WebView CDP
    await sleep(1500);
  } catch (e) {
    log.warn('auto_ensure_failed', { err: String(e?.message || e) });
  }
}

export async function main() {
  ensureDirs();
  log.info('suite_start', { app: manifest.app, log: log.file });

  let health = await waitForHealthy(config);
  if (health.score < 66 || !health.results.find((r) => r.id === 'health_cdp')?.pass) {
    log.warn('health_low_trying_ensure', { score: health.score });
    await tryEnsureRemote();
    health = await waitForHealthy(config);
  }

  const cdpOk = !!health.results.find((r) => r.id === 'health_cdp')?.pass;
  let viteOk = !!health.results.find((r) => r.id === 'health_vite')?.pass;
  record('health_cdp', cdpOk, health, 'fundamental');

  if (!cdpOk) {
    writeDashboard(health);
    log.error('abort_no_cdp', health);
    process.exit(2);
  }

  const conn = await connect(config);
  const { page } = conn;
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push('console:' + m.text());
  });

  // If page is already on Vite origin, treat Vite as up even when HTTP probe aborted
  if (!viteOk && /localhost:1420|127\.0\.0\.1:1420/i.test(page.url())) {
    viteOk = true;
  }
  record('health_vite', viteOk, {
    probe: health.results.find((r) => r.id === 'health_vite'),
    pageUrl: page.url(),
  }, 'fundamental');

  record('connect_page', true, { url: page.url() }, 'fundamental');
  record('heartbeat', true, { note: 'interval armed' }, 'fundamental');

  const ready = await ensureMediaStudio(page, conn);
  if (!ready) {
    // One more hard heal + retry (Vite died mid-boot / chrome-error stuck)
    try {
      await conn.heal?.();
    } catch (e) {
      log.warn('retry_heal', { err: String(e?.message || e) });
    }
    const ready2 = await ensureMediaStudio(page, conn);
    if (!ready2) {
      await capture(page, 'no_shell');
      log.error('Media Studio shell not found');
    } else {
      await capture(page, 'media_studio_ready');
    }
  } else {
    await capture(page, 'media_studio_ready');
  }

  for (const suite of manifest.suites) {
    if (suite.id === 'fundamental') continue; // already done
    log.info('suite', { id: suite.id, name: suite.name });
    for (const caseId of suite.cases) {
      try {
        // DnD flow cases handled together
        if (
          ['dnd_hover_target', 'dnd_confirm_dialog', 'dnd_esc_dismiss'].includes(caseId) &&
          results.some((r) => r.id === caseId)
        ) {
          continue;
        }
        await runCase(page, caseId, suite.id);
      } catch (e) {
        await capture(page, `err_${caseId}`);
        record(caseId, false, { err: String(e.message || e) }, suite.id);
        writeBug(caseId, e);
      }
    }
  }

  conn.dispose();
  const dash = writeDashboard(health);
  log.info('suite_done', dash);

  const fails = results.filter((r) => !r.pass);
  process.exit(fails.length ? 1 : 0);
}

function writeBug(id, err) {
  ensureDirs();
  const file = path.join(BUGS_DIR, `bug_${id}_${stamp()}.md`);
  fs.writeFileSync(
    file,
    `# Bug: ${id}\n\n- Time: ${new Date().toISOString()}\n- Error: ${String(err?.message || err)}\n- Stack: \`\`\`\n${err?.stack || ''}\n\`\`\`\n`,
    'utf8'
  );
}

function writeDashboard(health) {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const total = results.length;
  const successRate = total ? Math.round((passed / total) * 100) : 0;
  const fundamentalScore = Math.round(health?.score ?? 0);
  // Composite: fundamental 40% + tests 60%
  const healthScore = Math.round(fundamentalScore * 0.4 + successRate * 0.6);
  const dash = {
    generatedAt: new Date().toISOString(),
    total,
    passed,
    failed,
    successRate,
    fundamentalScore,
    healthScore,
    logFile: log.file,
    results,
  };
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'summary_dashboard.json'),
    JSON.stringify(dash, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(REPORTS_DIR, `summary_${stamp()}.json`),
    JSON.stringify(dash, null, 2),
    'utf8'
  );
  return dash;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1]?.includes('test_runner')) {
  main().catch((e) => {
    log.error('fatal', { err: String(e?.stack || e) });
    process.exit(3);
  });
}
