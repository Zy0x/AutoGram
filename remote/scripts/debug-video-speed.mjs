/**
 * Debug & fix: tombol kecepatan video (playback rate) di DrivePreviewModal.
 * Connects via CDP ke frontend.exe, navigate ke Media Studio,
 * buka preview video, lalu inspect + repair tombol rate secara langsung.
 *
 * Run: node scripts/debug-video-speed.mjs
 * dari folder: F:\AutoGram\remote\
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REMOTE_ROOT = path.resolve(__dirname, '..');              // F:\AutoGram\remote
const AUTOGRAM_ROOT = path.resolve(REMOTE_ROOT, '..');          // F:\AutoGram
const PW_PATH = path.resolve(AUTOGRAM_ROOT, 'AutoGram App/frontend/node_modules/playwright');
const require = createRequire(import.meta.url);
const { chromium } = require(PW_PATH);

const CDP_URL   = 'http://127.0.0.1:9222';
const VITE_URL  = 'http://127.0.0.1:1420';
const REPORT    = path.resolve(REMOTE_ROOT, 'reports/debug-video-speed.json');
const SHOT_DIR  = path.resolve(REMOTE_ROOT, 'reports/screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(REPORT), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const results = { steps: [], errors: [], screenshots: [] };
function log(msg, data = {}) {
  const entry = { t: new Date().toISOString(), msg, ...data };
  results.steps.push(entry);
  console.log(`[${entry.t}] ${msg}`, Object.keys(data).length ? JSON.stringify(data) : '');
}
function logErr(msg, err) {
  const entry = { t: new Date().toISOString(), msg, err: String(err?.message || err) };
  results.errors.push(entry);
  console.error(`[ERROR] ${msg}:`, err?.message || err);
}

async function shot(page, label) {
  const file = path.join(SHOT_DIR, `speed-${stamp()}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  results.screenshots.push({ label, file });
  log('screenshot', { label, file });
  return file;
}

async function getPage(browser) {
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (/1420|tauri/i.test(p.url())) return p;
  return null;
}

async function main() {
  log('start', { cdp: CDP_URL });

  // ── Connect CDP ──────────────────────────────────────────────────────────
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
    log('cdp_connected');
  } catch (e) {
    logErr('cdp_connect_failed', e);
    process.exitCode = 1;
    return;
  }

  const page = await getPage(browser);
  if (!page) { logErr('no_page', 'No WebView page found on CDP'); process.exitCode = 1; return; }
  log('page_found', { url: page.url() });

  // ── Heal jika perlu ──────────────────────────────────────────────────────
  if (!page.url().includes('1420')) {
    log('healing_navigate');
    await page.goto(VITE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
    await sleep(2000);
  }

  await shot(page, '01-initial');

  // ── Check versi yang berjalan ────────────────────────────────────────────
  const version = await page.evaluate(() =>
    document.body.textContent.match(/v\d+\.\d+\.\d+/g)?.[0] || 'unknown'
  ).catch(() => 'error');
  log('app_version', { version });

  // ── Navigasi ke Media Studio ─────────────────────────────────────────────
  log('navigating_to_media_studio');
  const studioBtn = page.locator('button, [role=button], a').filter({ hasText: /media studio|drive|speedtest/i }).first();
  const studioCount = await studioBtn.count().catch(() => 0);

  if (studioCount > 0) {
    await studioBtn.click().catch((e) => logErr('studio_click_fail', e));
    await sleep(1500);
    log('studio_clicked');
  } else {
    // Coba via sidebar nav - cari semua tombol nav
    const navBtns = await page.evaluate(() =>
      [...document.querySelectorAll('nav button, aside button, [role="navigation"] button')]
        .map(b => ({ text: b.textContent.trim(), class: b.className }))
    );
    log('nav_buttons_found', { buttons: navBtns });
    logErr('media_studio_not_found', 'No Media Studio / Drive button visible in nav');
  }

  await shot(page, '02-after-nav');

  // ── Inspect state toolbar ─────────────────────────────────────────────────
  log('inspecting_toolbar');
  const toolbarInfo = await page.evaluate(() => {
    const toolbar = document.querySelector('.drive-preview-toolbar');
    if (!toolbar) return { found: false, reason: 'no .drive-preview-toolbar' };

    const rateBtn = toolbar.querySelector('[aria-haspopup="menu"][aria-label*="Kecepatan"]') ||
                    toolbar.querySelector('.drive-tool-btn-value');
    const rateBtnByGauge = [...toolbar.querySelectorAll('.drive-tool-btn')].find(b =>
      b.querySelector('svg') && b.textContent.includes('x')
    );

    return {
      found: true,
      mediaKind: toolbar.dataset?.mediaKind,
      className: toolbar.className,
      rateBtn: rateBtn ? {
        exists: true,
        text: rateBtn.textContent.trim(),
        classes: rateBtn.className,
        ariaLabel: rateBtn.getAttribute('aria-label'),
        ariaExpanded: rateBtn.getAttribute('aria-expanded'),
        disabled: rateBtn.disabled,
        visible: rateBtn.offsetParent !== null,
      } : null,
      rateBtnByGauge: rateBtnByGauge ? {
        exists: true,
        text: rateBtnByGauge.textContent.trim(),
        classes: rateBtnByGauge.className,
      } : null,
      allBtns: [...toolbar.querySelectorAll('.drive-tool-btn')].map(b => ({
        text: b.textContent.trim().slice(0, 30),
        class: b.className,
        ariaLabel: b.getAttribute('aria-label'),
      })),
    };
  }).catch((e) => ({ found: false, reason: String(e?.message || e) }));
  log('toolbar_inspect', toolbarInfo);

  // ── Cari preview modal (mungkin belum terbuka) ────────────────────────────
  const hasModal = await page.evaluate(() => !!document.querySelector('.drive-preview-modal, .drive-preview-overlay')).catch(() => false);
  log('modal_open', { hasModal });

  if (!hasModal) {
    log('trying_to_open_video_preview');
    // Cari file card video
    const videoCard = page.locator('.td-file-card, [data-drive-file]').filter({ hasText: /\.mp4|\.mkv|\.avi|\.mov/i }).first();
    const videoCount = await videoCard.count().catch(() => 0);
    if (videoCount > 0) {
      await videoCard.dblclick().catch((e) => logErr('video_dblclick_fail', e));
      await sleep(2500);
      log('video_card_dblclicked');
    } else {
      // Coba file card manapun
      const anyCard = page.locator('.td-file-card, [data-drive-file]').first();
      const anyCount = await anyCard.count().catch(() => 0);
      if (anyCount > 0) {
        await anyCard.dblclick().catch((e) => logErr('any_card_dblclick_fail', e));
        await sleep(2500);
        log('any_card_dblclicked');
      } else {
        log('no_file_cards_visible');
      }
    }
  }

  await shot(page, '03-modal-state');

  // ── Inspect ulang setelah modal (jika terbuka) ────────────────────────────
  const modalInfo = await page.evaluate(() => {
    const modal = document.querySelector('.drive-preview-modal, .drive-preview-overlay');
    if (!modal) return { found: false };

    const toolbar = modal.querySelector('.drive-preview-toolbar') || document.querySelector('.drive-preview-toolbar');
    const video = modal.querySelector('video') || document.querySelector('video');
    const rateMenu = document.querySelector('.drive-rate-menu, .drive-quality-menu');

    // Cari tombol rate dengan lebih fleksibel
    const allToolBtns = [...(toolbar?.querySelectorAll('.drive-tool-btn') || [])];
    const rateBtnCandidates = allToolBtns.filter(b =>
      b.textContent.includes('x') || b.getAttribute('aria-label')?.includes('Kecepatan')
    );

    return {
      found: true,
      modalClass: modal.className,
      toolbar: toolbar ? {
        found: true,
        class: toolbar.className,
        mediaKind: toolbar.dataset?.mediaKind,
        isVideo: toolbar.classList.contains('is-video'),
        hasMenu: toolbar.classList.contains('has-menu'),
      } : { found: false },
      video: video ? {
        found: true,
        src: video.src?.slice(0, 80),
        readyState: video.readyState,
        playbackRate: video.playbackRate,
        paused: video.paused,
      } : { found: false },
      rateBtnCandidates: rateBtnCandidates.map(b => ({
        text: b.textContent.trim(),
        class: b.className,
        ariaLabel: b.getAttribute('aria-label'),
        ariaExpanded: b.getAttribute('aria-expanded'),
        visible: b.offsetParent !== null,
        boundingRect: b.getBoundingClientRect(),
      })),
      rateMenuOpen: !!rateMenu,
      allToolBtns: allToolBtns.map(b => b.textContent.trim().slice(0, 20)),
      styleIssues: (() => {
        const issues = [];
        // Check z-index conflicts
        const fixedMenus = [...document.querySelectorAll('.drive-quality-menu.is-fixed-popover')];
        fixedMenus.forEach(m => {
          const z = window.getComputedStyle(m).zIndex;
          if (parseInt(z) < 1000) issues.push(`rate menu z-index too low: ${z}`);
        });
        return issues;
      })(),
    };
  }).catch((e) => ({ found: false, error: String(e?.message || e) }));
  log('modal_inspect', modalInfo);

  // ── Coba klik tombol rate secara programatik ──────────────────────────────
  if (modalInfo.found && modalInfo.rateBtnCandidates?.length > 0) {
    log('attempting_rate_btn_click');
    try {
      const rateBtn = page.locator('.drive-tool-btn-value, [aria-label*="Kecepatan"]').first();
      const rateBtnCount = await rateBtn.count();
      if (rateBtnCount > 0) {
        await rateBtn.click({ force: true });
        await sleep(800);
        await shot(page, '04-after-rate-click');

        const menuVisible = await page.evaluate(() =>
          !!document.querySelector('.drive-rate-menu, .drive-quality-menu[role="menu"]')
        ).catch(() => false);
        log('rate_menu_visible_after_click', { menuVisible });

        if (menuVisible) {
          // Inspect menu position
          const menuPos = await page.evaluate(() => {
            const menu = document.querySelector('.drive-rate-menu') || document.querySelector('.drive-quality-menu[role="menu"]');
            if (!menu) return null;
            const r = menu.getBoundingClientRect();
            const cs = window.getComputedStyle(menu);
            return {
              top: r.top, left: r.left, bottom: r.bottom, right: r.right,
              width: r.width, height: r.height,
              zIndex: cs.zIndex,
              position: cs.position,
              display: cs.display,
              visibility: cs.visibility,
              overflow: cs.overflow,
              offscreen: r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth,
            };
          }).catch(() => null);
          log('rate_menu_position', menuPos);

          // Coba pilih 2x
          const opt2x = page.locator('.drive-quality-item, .drive-rate-menu button').filter({ hasText: '2x' }).first();
          if (await opt2x.count() > 0) {
            await opt2x.click({ force: true });
            await sleep(500);
            const newRate = await page.evaluate(() => document.querySelector('video')?.playbackRate).catch(() => null);
            log('rate_selected_2x', { newRate });
            await shot(page, '05-after-2x');
          }
        }
      } else {
        log('rate_btn_locator_empty');
      }
    } catch (e) {
      logErr('rate_click_failed', e);
    }
  }

  // ── Inject CSS emergency fix jika menu terblok ────────────────────────────
  log('injecting_emergency_css_fix');
  await page.evaluate(() => {
    const id = '__speed_fix__';
    if (document.getElementById(id)) return 'already_applied';
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      /* Emergency fix: force rate menu always on top and visible */
      .drive-rate-menu.is-fixed-popover {
        z-index: 99999 !important;
        position: fixed !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      /* Ensure rate btn label always visible */
      .drive-tool-btn-value .drive-tool-btn-label {
        display: inline !important;
      }
    `;
    document.head.appendChild(s);
    return 'applied';
  }).then((r) => log('css_fix_inject', { result: r })).catch((e) => logErr('css_fix_failed', e));

  await shot(page, '06-final');

  // ── Simpan report ─────────────────────────────────────────────────────────
  fs.writeFileSync(REPORT, JSON.stringify(results, null, 2));
  log('done', { report: REPORT, errors: results.errors.length });

  if (results.errors.length) {
    console.log('\n⚠️  Errors found:');
    results.errors.forEach((e) => console.log(' -', e.msg, ':', e.err));
  } else {
    console.log('\n✅ Debug selesai tanpa error.');
  }

  console.log('\n📸 Screenshots:', results.screenshots.map((s) => s.file).join('\n  '));
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
