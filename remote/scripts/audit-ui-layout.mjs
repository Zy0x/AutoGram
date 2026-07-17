/**
 * Remote UI layout audit — multi viewport + issue list.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(__dirname, '..', 'reports', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bx(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
  };
}

async function ensureDrive(p) {
  await p.evaluate(() => {
    try {
      localStorage.setItem('lastActiveTab', 'speedtest');
    } catch {
      /* ignore */
    }
  });
  for (let i = 0; i < 25; i++) {
    if (await p.evaluate(() => !!document.querySelector('.td-shell'))) return true;
    await p.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, [role="button"]')) {
        const t = (el.textContent || '') + (el.getAttribute('title') || '');
        if (/media|drive|studio/i.test(t)) {
          el.click();
          return;
        }
      }
    });
    await sleep(400);
  }
  return !!(await p.evaluate(() => !!document.querySelector('.td-shell')));
}

async function auditViewport(p, w, h) {
  await p.setViewportSize({ width: w, height: h });
  await sleep(400);

  // Open drawer on narrow so sidebar is visible for audit
  if (w <= 900) {
    await p.evaluate(() => {
      const side = document.querySelector('.td-sidebar');
      if (side && !side.classList.contains('is-drawer-open')) {
        document.querySelector('.td-menu-btn')?.click();
      }
    });
    await sleep(300);
  }

  // Expand rail if collapsed
  await p.evaluate(() => {
    if (document.querySelector('.td-sidebar')?.classList.contains('is-collapsed')) {
      document.querySelector('.td-rail-brand-toggle')?.click();
    }
  });
  await sleep(200);

  const data = await p.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      };
    };
    const issues = [];
    const vw = innerWidth;
    const vh = innerHeight;

    const page = q('.td-page');
    const shell = q('.td-shell');
    const side = q('.td-sidebar');
    const main = q('.td-main');
    const top = q('.td-topbar');
    const tools = q('.td-topbar-tools');
    const pills = q('.td-filter-pills');
    const search = q('.td-topbar .td-search');
    const expl = q('.td-explorer');
    const row1 = q('.td-topbar-row-1');
    const row2 = q('.td-topbar-row-2');
    const rowTools = q('.td-topbar-row-tools');
    const selectAll = q('.td-chip-select-all, .td-chip-quiet');
    const brand = q('.td-sidebar-brand-text, .td-rail-brand-toggle');

    const pageB = box(page);
    const topB = box(top);
    const toolsB = box(tools);
    const pillsB = box(pills);
    const sideB = box(side);
    const mainB = box(main);
    const explB = box(expl);

    // Fill width
    if (pageB && pageB.w < vw - 24) {
      issues.push({
        id: 'page-not-full-width',
        severity: 'high',
        detail: `td-page w=${pageB.w} vw=${vw} gap=${vw - pageB.w}`,
      });
    }
    // White/empty right: main+sidebar should cover
    if (mainB && sideB && sideB.x >= 0) {
      const covered = Math.max(mainB.right, sideB.right);
      if (covered < vw - 20) {
        issues.push({
          id: 'content-right-gap',
          severity: 'high',
          detail: `content right=${covered} vw=${vw}`,
        });
      }
    } else if (mainB && mainB.right < vw - 20 && (!sideB || sideB.x < 0)) {
      if (mainB.w < vw - 24) {
        issues.push({
          id: 'main-narrow-gap',
          severity: 'high',
          detail: `main w=${mainB.w} right=${mainB.right} vw=${vw}`,
        });
      }
    }

    // Topbar height bloat
    if (topB && topB.h > Math.min(220, vh * 0.4)) {
      issues.push({
        id: 'topbar-too-tall',
        severity: 'med',
        detail: `topbar h=${topB.h} vh=${vh}`,
      });
    }

    // Tools/filters off-screen or zero
    if (!toolsB || toolsB.w < 10 || toolsB.x > vw - 20) {
      issues.push({
        id: 'tools-missing',
        severity: 'high',
        detail: `tools=${JSON.stringify(toolsB)}`,
      });
    } else if (toolsB.x < -5) {
      issues.push({ id: 'tools-off-left', severity: 'high', detail: String(toolsB.x) });
    }
    if (!pillsB || pillsB.w < 40) {
      issues.push({ id: 'filters-missing', severity: 'high', detail: JSON.stringify(pillsB) });
    } else if (pillsB.right > vw + 5) {
      // mid-clip if partially past edge without scroll parent
      const parent = q('.td-filter-pills')?.parentElement;
      const pe = parent ? getComputedStyle(parent).overflowX : '';
      if (pe !== 'auto' && pe !== 'scroll') {
        issues.push({
          id: 'filters-clipped',
          severity: 'med',
          detail: `pills.right=${pillsB.right} vw=${vw}`,
        });
      }
    }

    // Pill text mid-clip: each pill must not be cut mid-word (full box inside or scrollable)
    for (const pill of qa('.td-filter-pills .td-pill')) {
      const b = box(pill);
      const text = (pill.textContent || '').trim();
      if (b && b.right > vw + 2 && b.x < vw) {
        issues.push({
          id: 'pill-mid-clip',
          severity: 'med',
          detail: `${text} right=${b.right}`,
        });
      }
    }

    // Select-all mid-clip
    if (selectAll) {
      const b = box(selectAll);
      const label = selectAll.querySelector('.td-chip-label');
      const ld = label ? getComputedStyle(label).display : 'none';
      if (b && b.right > vw + 2 && ld !== 'none') {
        issues.push({
          id: 'select-all-clip',
          severity: 'med',
          detail: `right=${b.right} labelDisplay=${ld}`,
        });
      }
    }

    // Sidebar crushed labels when collapsed+open
    if (side) {
      const collapsed = side.classList.contains('is-collapsed');
      const drawer = side.classList.contains('is-drawer-open');
      const sw = sideB?.w || 0;
      if (collapsed && drawer && sw < 200 && sw > 0) {
        issues.push({
          id: 'drawer-crushed-width',
          severity: 'high',
          detail: `w=${sw}`,
        });
      }
      if (collapsed && !drawer && sw > 0 && sw < 90) {
        // icon rail OK
      }
      // Brand text wrapping vertically in narrow rail
      const brandEl = q('.td-sidebar-brand-text');
      if (brandEl && getComputedStyle(brandEl).display !== 'none' && sw < 100) {
        issues.push({
          id: 'brand-visible-in-narrow-rail',
          severity: 'med',
          detail: `sw=${sw}`,
        });
      }
    }

    // Explorer empty / zero height
    if (explB && explB.h < 80) {
      issues.push({
        id: 'explorer-too-short',
        severity: 'high',
        detail: `h=${explB.h}`,
      });
    }

    // Cards overflow window
    const cards = qa('.td-file-card').slice(0, 8).map((el) => {
      const b = box(el);
      return { ...b, clip: b && b.right > vw + 4 };
    });
    if (cards.some((c) => c.clip)) {
      issues.push({
        id: 'card-overflow-right',
        severity: 'low',
        detail: cards.filter((c) => c.clip).length + ' cards',
      });
    }

    // Body background not white (WebView gap)
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const htmlBg = getComputedStyle(document.documentElement).backgroundColor;

    // Section toggles
    const sections = qa('.td-section-toggle').map((t) => ({
      label: (t.textContent || '').trim().slice(0, 32),
      exp: t.getAttribute('aria-expanded'),
      ...box(t),
      inView: (() => {
        const r = t.getBoundingClientRect();
        return r.top < vh && r.bottom > 0;
      })(),
    }));

    return {
      vw,
      vh,
      issues,
      page: pageB,
      shell: box(shell),
      side: sideB,
      main: mainB,
      top: topB,
      row1: box(row1),
      row2: box(row2),
      rowTools: box(rowTools),
      tools: toolsB,
      pills: pillsB,
      pillsText: pills?.innerText?.replace(/\s+/g, ' ').slice(0, 80) || '',
      search: box(search),
      expl: explB,
      cards: cards.length,
      bodyBg,
      htmlBg,
      sideClass: side?.className || '',
      shellClass: shell?.className || '',
      sections,
      topH: topB?.h,
      explH: explB?.h,
    };
  });

  const shot = path.join(shotDir, `audit-ui-${w}x${h}.png`);
  await p.screenshot({ path: shot });
  return { ...data, shot: path.basename(shot) };
}

async function main() {
  fs.mkdirSync(shotDir, { recursive: true });
  const b = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
  const pages = b.contexts().flatMap((c) => c.pages());
  const p =
    pages.find((x) => {
      try {
        return /1420|localhost/.test(x.url());
      } catch {
        return false;
      }
    }) || pages[0];
  if (!p) {
    console.log(JSON.stringify({ ok: false, reason: 'no page' }));
    process.exit(1);
  }
  console.log('url', p.url());
  await p.bringToFront().catch(() => {});
  const ready = await ensureDrive(p);
  if (!ready) {
    console.log(JSON.stringify({ ok: false, reason: 'no drive shell' }));
    process.exit(1);
  }
  await sleep(1000);
  // try load media
  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (/Muat/i.test(btn.textContent || '')) btn.click();
    }
  });
  await sleep(1500);

  const viewports = [
    [1280, 800],
    [1100, 700],
    [900, 600],
    [800, 600],
    [640, 700],
  ];
  const results = [];
  for (const [w, h] of viewports) {
    const r = await auditViewport(p, w, h);
    results.push({ w, h, ...r });
    console.log(
      `\n=== ${w}x${h} topH=${r.topH} explH=${r.explH} issues=${r.issues.length} ===`
    );
    for (const iss of r.issues) {
      console.log(`  [${iss.severity}] ${iss.id}: ${iss.detail}`);
    }
    console.log('  pills:', r.pillsText, 'tools', r.tools);
  }

  // Aggregate unique issues
  const byId = {};
  for (const r of results) {
    for (const iss of r.issues) {
      if (!byId[iss.id]) byId[iss.id] = { ...iss, viewports: [] };
      byId[iss.id].viewports.push(`${r.w}x${r.h}`);
    }
  }

  const report = {
    ok: Object.keys(byId).length === 0,
    generatedAt: new Date().toISOString(),
    issueSummary: byId,
    results: results.map((r) => ({
      w: r.w,
      h: r.h,
      topH: r.topH,
      explH: r.explH,
      issues: r.issues,
      pillsText: r.pillsText,
      sideClass: r.sideClass,
      shot: r.shot,
      pageW: r.page?.w,
      mainW: r.main?.w,
    })),
  };

  const out = path.join(__dirname, '..', 'reports', 'ui-layout-audit.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('\nSUMMARY', JSON.stringify(report.issueSummary, null, 2));
  console.log('ok', report.ok, 'file', out);
  await b.close().catch(() => {});
  process.exit(report.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
