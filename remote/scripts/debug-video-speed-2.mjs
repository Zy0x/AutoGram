/**
 * Deep inspect overflow toolbar & fix tombol kecepatan yang tersembunyi di "LAIN" overflow.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REMOTE_ROOT   = path.resolve(__dirname, '..');
const AUTOGRAM_ROOT = path.resolve(REMOTE_ROOT, '..');
const PW_PATH = path.resolve(AUTOGRAM_ROOT, 'AutoGram App/frontend/node_modules/playwright');
const require = createRequire(import.meta.url);
const { chromium } = require(PW_PATH);

const CDP_URL  = 'http://127.0.0.1:9222';
const SHOT_DIR = path.resolve(REMOTE_ROOT, 'reports/screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

async function shot(page, label) {
  const file = path.join(SHOT_DIR, `fix2-${stamp()}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  console.log(`📸 ${label}: ${file}`);
  return file;
}

async function getPage(browser) {
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (/1420|tauri/i.test(p.url())) return p;
  return null;
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
  const page = await getPage(browser);
  if (!page) throw new Error('No page found');
  console.log('Connected:', page.url());

  // ── 1. Inspect toolbar overflow & tombol LAIN ────────────────────────────
  const overflowInfo = await page.evaluate(() => {
    const toolbar = document.querySelector('.drive-preview-toolbar');
    if (!toolbar) return { found: false };

    // Cari "LAIN" button (overflow toggle)
    const lainBtn = [...toolbar.querySelectorAll('button')].find(b =>
      b.textContent.trim().toLowerCase() === 'lain' ||
      b.classList.contains('drive-tool-overflow') ||
      b.getAttribute('aria-label')?.toLowerCase().includes('lain')
    );

    // Inspect semua tombol dan apakah ada yang hidden/overflow
    const allBtns = [...toolbar.querySelectorAll('.drive-tool-btn')];
    const btnDetails = allBtns.map(b => {
      const rect = b.getBoundingClientRect();
      const style = window.getComputedStyle(b);
      return {
        text: b.textContent.trim().slice(0, 25),
        class: b.className,
        ariaLabel: b.getAttribute('aria-label'),
        visible: b.offsetParent !== null,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      };
    });

    // Cek toolbar width vs scrollWidth
    const toolbarRect = toolbar.getBoundingClientRect();
    const tools = toolbar.querySelector('.drive-preview-tools');
    const toolsRect = tools?.getBoundingClientRect();

    return {
      found: true,
      toolbarWidth: Math.round(toolbarRect.width),
      toolbarScrollWidth: toolbar.scrollWidth,
      toolsWidth: toolsRect ? Math.round(toolsRect.width) : null,
      toolsScrollWidth: tools?.scrollWidth,
      lainBtn: lainBtn ? {
        exists: true,
        text: lainBtn.textContent.trim(),
        class: lainBtn.className,
        rect: lainBtn.getBoundingClientRect(),
      } : null,
      btnCount: allBtns.length,
      btnDetails,
    };
  });

  console.log('\n📊 TOOLBAR OVERFLOW ANALYSIS:');
  console.log('  Toolbar width:', overflowInfo.toolbarWidth, '/ scrollWidth:', overflowInfo.toolbarScrollWidth);
  console.log('  Tools width:', overflowInfo.toolsWidth, '/ scrollWidth:', overflowInfo.toolsScrollWidth);
  console.log('  Lain button:', overflowInfo.lainBtn ? JSON.stringify(overflowInfo.lainBtn) : 'NOT FOUND');
  console.log('\n  All buttons:');
  overflowInfo.btnDetails?.forEach((b, i) =>
    console.log(`  [${i}] "${b.text}" | visible:${b.visible} | inViewport:${b.inViewport} | display:${b.display} | rect:${JSON.stringify(b.rect)}`)
  );

  // ── 2. Inspect DrivePreviewTools component untuk overflow logic ───────────
  const overflowLogic = await page.evaluate(() => {
    // Cari semua elemen yang bisa jadi overflow container
    const overflowMenus = [...document.querySelectorAll('[class*="overflow"], [class*="more"], [class*="lain"]')];
    const hiddenBtns = [...document.querySelectorAll('.drive-tool-btn')].filter(b => {
      const r = b.getBoundingClientRect();
      return r.width === 0 || r.height === 0 || window.getComputedStyle(b).display === 'none';
    });
    return {
      overflowMenuElements: overflowMenus.map(el => ({ class: el.className, tag: el.tagName })),
      hiddenBtnCount: hiddenBtns.length,
      hiddenBtns: hiddenBtns.map(b => ({ text: b.textContent.trim(), class: b.className })),
    };
  });
  console.log('\n🔍 OVERFLOW LOGIC:', JSON.stringify(overflowLogic, null, 2));

  // ── 3. Screenshot toolbar closeup ─────────────────────────────────────────
  // Crop ke area toolbar
  const toolbarClip = await page.evaluate(() => {
    const t = document.querySelector('.drive-preview-toolbar');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });

  if (toolbarClip) {
    const file = path.join(SHOT_DIR, `fix2-${stamp()}-toolbar-closeup.png`);
    await page.screenshot({ path: file, clip: toolbarClip }).catch(() => {});
    console.log('\n📸 Toolbar closeup:', file);
  }

  // ── 4. Coba klik tombol 1x secara direct dengan koordinat eksak ────────────
  console.log('\n🖱️  Clicking rate button by exact coordinate...');
  const rateBtnRect = overflowInfo.btnDetails?.find(b => b.text.includes('1x') || b.ariaLabel?.includes('Kecepatan'));
  if (rateBtnRect) {
    const centerX = rateBtnRect.rect.x + rateBtnRect.rect.w / 2;
    const centerY = rateBtnRect.rect.y + rateBtnRect.rect.h / 2;
    console.log(`  Clicking at (${centerX}, ${centerY})`);
    await page.mouse.click(centerX, centerY);
    await sleep(600);
    await shot(page, 'after-coordinate-click');

    // Check menu
    const menuAfter = await page.evaluate(() => {
      const menu = document.querySelector('.drive-rate-menu, .drive-quality-menu[role="menu"]');
      if (!menu) return null;
      const r = menu.getBoundingClientRect();
      const cs = window.getComputedStyle(menu);
      return {
        found: true,
        display: cs.display,
        visibility: cs.visibility,
        zIndex: cs.zIndex,
        position: cs.position,
        rect: { top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) },
        offScreen: r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth,
        innerHTML: menu.innerHTML.slice(0, 200),
      };
    });
    console.log('\n📋 Menu state after click:', JSON.stringify(menuAfter, null, 2));

    if (menuAfter?.found && menuAfter.offScreen) {
      console.log('⚠️  MENU EXISTS BUT OFFSCREEN! Applying position fix...');
    } else if (!menuAfter?.found) {
      console.log('❌ Menu still not found after click. Rate btn might be inside overflow container or event blocked.');
    } else {
      console.log('✅ Menu visible!');
    }
  }

  // ── 5. Inspect rateOpen React state via window.__REACT_DEVTOOLS__ ─────────
  console.log('\n🔬 Checking React fiber state...');
  const reactState = await page.evaluate(() => {
    // Find rate button via aria
    const rateBtn = document.querySelector('[aria-label*="Kecepatan"][aria-haspopup="menu"]');
    if (!rateBtn) return { found: false, reason: 'no rate btn with aria-haspopup' };

    // Try to get React fiber
    const fiberKey = Object.keys(rateBtn).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternals'));
    if (!fiberKey) return { found: true, fiber: false };

    // Walk up fiber tree to find component state
    let fiber = rateBtn[fiberKey];
    const states = [];
    let depth = 0;
    while (fiber && depth < 20) {
      if (fiber.memoizedState) {
        let s = fiber.memoizedState;
        let si = 0;
        while (s && si < 10) {
          if (typeof s.memoizedState === 'boolean') {
            states.push({ depth, stateIndex: si, value: s.memoizedState });
          }
          s = s.next;
          si++;
        }
      }
      fiber = fiber.return;
      depth++;
    }
    return { found: true, fiberKey, statesBooleans: states };
  });
  console.log('React state:', JSON.stringify(reactState, null, 2));

  // ── 6. Coba inject click via React event dispatch ─────────────────────────
  console.log('\n⚡ Trying to trigger React onClick directly...');
  const reactClickResult = await page.evaluate(() => {
    const rateBtn = document.querySelector('[aria-label*="Kecepatan"][aria-haspopup="menu"]');
    if (!rateBtn) return 'no button found';

    // Dispatch synthetic click
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    rateBtn.dispatchEvent(clickEvent);
    return 'dispatched';
  });
  console.log('React click dispatch:', reactClickResult);
  await sleep(500);
  await shot(page, 'after-react-click');

  const menuFinal = await page.evaluate(() => {
    const m = document.querySelector('.drive-rate-menu');
    return m ? { found: true, display: window.getComputedStyle(m).display, zIndex: window.getComputedStyle(m).zIndex } : { found: false };
  });
  console.log('Menu after React dispatch:', JSON.stringify(menuFinal));

  // ── 7. Cek apakah toolbar di-scroll sehingga tombol 1x di luar viewport ──
  const scrollCheck = await page.evaluate(() => {
    const toolbar = document.querySelector('.drive-preview-toolbar');
    return {
      scrollLeft: toolbar?.scrollLeft,
      scrollWidth: toolbar?.scrollWidth,
      clientWidth: toolbar?.clientWidth,
      overflowing: toolbar ? toolbar.scrollWidth > toolbar.clientWidth : null,
    };
  });
  console.log('\n📏 Toolbar scroll state:', JSON.stringify(scrollCheck));

  console.log('\n✅ Deep inspect selesai.');
}

main().catch((e) => { console.error('FATAL:', e); process.exitCode = 1; });
