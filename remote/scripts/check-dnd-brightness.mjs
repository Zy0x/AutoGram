/**
 * CDP: compare sidebar brightness idle vs drag (media-dnd).
 * node scripts/check-dnd-brightness.mjs
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

async function main() {
  fs.mkdirSync(shotDir, { recursive: true });
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
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
  await p.bringToFront().catch(() => {});
  await p.evaluate(() => {
    try {
      localStorage.setItem('lastActiveTab', 'speedtest');
    } catch {}
  });

  for (let i = 0; i < 25; i++) {
    const ok = await p.evaluate(() => !!document.querySelector('.td-shell'));
    if (ok) break;
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
  await sleep(2000);

  await p.evaluate(() => {
    for (const t of document.querySelectorAll('.td-section-toggle')) {
      if (t.getAttribute('aria-expanded') === 'false') t.click();
    }
    const rows = [...document.querySelectorAll('[data-drop-key="saved:me"]')];
    const sm = rows.find((el) => el.classList.contains('td-folder-row')) || rows[0];
    if (sm instanceof HTMLElement) sm.click();
  });
  await sleep(1500);
  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('button.td-rail-tool')) {
      if (/Muat/i.test(btn.textContent || '')) btn.click();
    }
  });
  await sleep(2500);

  const measure = (label) =>
    p.evaluate((lab) => {
      const side = document.querySelector('.td-sidebar');
      const shell = document.querySelector('.td-shell');
      const main = document.querySelector('.td-main');
      const cs = side ? getComputedStyle(side) : null;
      const rows = [...document.querySelectorAll('.td-folder-row')].slice(0, 4).map((r) => {
        const s = getComputedStyle(r);
        return {
          opacity: s.opacity,
          filter: s.filter,
          bg: s.backgroundColor,
          border: s.borderTopWidth + ' ' + s.borderTopStyle,
          cls: (r.className || '').toString().slice(0, 100),
        };
      });
      return {
        label: lab,
        mediaDnd: !!side?.classList.contains('media-dnd'),
        isMediaDndShell: !!shell?.classList.contains('is-media-dnd'),
        sidebar: cs
          ? {
              bg: cs.backgroundColor,
              opacity: cs.opacity,
              filter: cs.filter,
              boxShadow: (cs.boxShadow || '').slice(0, 120),
            }
          : null,
        mainOpacity: main ? getComputedStyle(main).opacity : null,
        rows,
        hasHint: !!document.querySelector('.td-dnd-hint'),
        cards: document.querySelectorAll('.td-file-card, .td-file-list-item').length,
        connected: /Drive terhubung/i.test(document.body?.innerText || ''),
      };
    }, label);

  const idle = await measure('idle');
  await p.screenshot({ path: path.join(shotDir, 'remote-check-idle.png') });

  // Force classes (same as live drag UI hooks)
  await p.evaluate(() => {
    document.querySelector('.td-shell')?.classList.add('is-media-dnd');
    document.querySelector('.td-sidebar')?.classList.add('media-dnd');
    document.querySelector('.td-folder-nav')?.classList.add('is-drop-mode', 'is-dnd-layout');
    document.body.classList.add('td-dnd-internal');
    document.querySelectorAll('.td-folder-row, [data-drop-key]').forEach((el) => {
      el.classList.add('dnd-ready');
    });
  });
  await sleep(250);
  const forced = await measure('forced-dnd');
  await p.screenshot({ path: path.join(shotDir, 'remote-check-dnd-forced.png') });

  // Real drag if cards
  let real = null;
  const nCards = await p.locator('.td-file-card, .td-file-list-item').count();
  if (nCards > 0) {
    await p.evaluate(() => {
      document.querySelector('.td-shell')?.classList.remove('is-media-dnd');
      document.querySelector('.td-sidebar')?.classList.remove('media-dnd');
      document.querySelector('.td-folder-nav')?.classList.remove('is-drop-mode', 'is-dnd-layout');
      document.body.classList.remove('td-dnd-internal');
      document.querySelectorAll('.dnd-ready').forEach((el) => el.classList.remove('dnd-ready'));
    });
    await sleep(150);
    const box = await p.locator('.td-file-card, .td-file-list-item').first().boundingBox();
    if (box) {
      await p.mouse.move(box.x + box.width / 2, box.y + 40);
      await p.mouse.down();
      await p.mouse.move(box.x + 50, box.y + 70, { steps: 10 });
      await sleep(200);
      await p.mouse.move(90, 380, { steps: 18 });
      await sleep(600);
      real = await measure('real-drag');
      await p.screenshot({ path: path.join(shotDir, 'remote-check-dnd-live.png') });
      await p.mouse.up();
      await p.keyboard.press('Escape').catch(() => {});
    }
  }

  await p.evaluate(() => {
    document.querySelector('.td-shell')?.classList.remove('is-media-dnd');
    document.querySelector('.td-sidebar')?.classList.remove('media-dnd');
    document.querySelector('.td-folder-nav')?.classList.remove('is-drop-mode', 'is-dnd-layout');
    document.body.classList.remove('td-dnd-internal');
    document
      .querySelectorAll('.dnd-ready, .is-drop-over, .dnd-self, .is-drop-invalid')
      .forEach((el) => {
        el.classList.remove('dnd-ready', 'is-drop-over', 'dnd-self', 'is-drop-invalid');
      });
  });

  const sameBrightness =
    idle.sidebar?.opacity === '1' &&
    forced.sidebar?.opacity === '1' &&
    idle.mainOpacity === '1' &&
    forced.mainOpacity === '1' &&
    (real ? real.sidebar?.opacity === '1' && real.mainOpacity === '1' : true);

  const out = {
    ok: true,
    sameBrightness,
    idle,
    forced,
    real,
    shots: {
      idle: 'reports/screenshots/remote-check-idle.png',
      forced: 'reports/screenshots/remote-check-dnd-forced.png',
      live: real ? 'reports/screenshots/remote-check-dnd-live.png' : null,
    },
  };
  fs.writeFileSync(
    path.join(__dirname, '..', 'reports', 'remote-dnd-brightness-check.json'),
    JSON.stringify(out, null, 2)
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
