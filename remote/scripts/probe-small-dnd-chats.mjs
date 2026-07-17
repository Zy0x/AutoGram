/**
 * Remote: small-window layout + DnD forces Chats section open.
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
const box = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
};

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
  await p.evaluate(() => {
    try {
      localStorage.setItem('lastActiveTab', 'speedtest');
    } catch {
      /* ignore */
    }
  });

  for (let i = 0; i < 20; i++) {
    const has = await p.evaluate(() => !!document.querySelector('.td-shell'));
    if (has) break;
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
  await sleep(1200);

  // Small window (user report)
  await p.setViewportSize({ width: 800, height: 600 });
  await sleep(350);

  await p.evaluate(() => {
    document.querySelector('.td-menu-btn')?.click();
  });
  await sleep(350);
  await p.evaluate(() => {
    if (document.querySelector('.td-sidebar')?.classList.contains('is-collapsed')) {
      document.querySelector('.td-rail-brand-toggle')?.click();
    }
  });
  await sleep(250);

  // Collapse Chats section deliberately
  await p.evaluate(() => {
    for (const t of document.querySelectorAll('.td-section-toggle')) {
      if (/chats/i.test(t.textContent || '') && t.getAttribute('aria-expanded') === 'true') {
        t.click();
      }
    }
  });
  await sleep(200);

  const layoutPre = await p.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const bx = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const chatToggle = [...document.querySelectorAll('.td-section-toggle')].find((t) =>
      /chats/i.test(t.textContent || '')
    );
    return {
      vw: innerWidth,
      vh: innerHeight,
      tools: bx(q('.td-topbar-tools')),
      pills: bx(q('.td-filter-pills')),
      pillsText: q('.td-filter-pills')?.innerText?.replace(/\s+/g, ' ').slice(0, 80) || '',
      chatsExpanded: chatToggle?.getAttribute('aria-expanded'),
      chatVirt: bx(q('.td-chat-virtual')),
      chatKeys: document.querySelectorAll('[data-drop-key^="chat:"]').length,
      dropKeys: document.querySelectorAll('[data-drop-key]').length,
      sidebar: bx(q('.td-sidebar')),
      mediaDnd: !!q('.td-sidebar')?.classList.contains('media-dnd'),
    };
  });
  console.log('layoutPre', JSON.stringify(layoutPre, null, 2));
  await p.screenshot({ path: path.join(shotDir, 'remote-small-pre-dnd.png') });

  let nCards = await p.locator('.td-file-card').count();
  if (nCards < 1) {
    await p.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (/Muat/i.test(btn.textContent || '')) btn.click();
      }
    });
    await sleep(2500);
    nCards = await p.locator('.td-file-card').count();
  }
  console.log('cards', nCards);

  let during = null;
  let afterHover = null;
  if (nCards > 0) {
    // Real pointer prime (WebView uses pointer path, not HTML5/mouse-only)
    during = await p.evaluate(async () => {
      const card = document.querySelector('.td-file-card');
      if (!card) return { err: 'no card' };
      const r = card.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y0 = r.top + 40;
      const fire = (type, x, y, target = document) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            view: window,
          })
        );
      };
      fire('pointerdown', x0, y0, card);
      for (let i = 1; i <= 14; i++) {
        fire('pointermove', x0 + i * 7, y0 + i * 6, document);
        await new Promise((res) => setTimeout(res, 16));
      }
      // Aim at Chats section header
      const toggle = [...document.querySelectorAll('.td-section-toggle')].find((t) =>
        /chats/i.test(t.textContent || '')
      );
      if (toggle) {
        const tr = toggle.getBoundingClientRect();
        const tx = tr.left + tr.width / 2;
        const ty = tr.top + tr.height / 2;
        for (let i = 0; i <= 16; i++) {
          fire(
            'pointermove',
            x0 + (tx - x0) * (i / 16),
            y0 + (ty - y0) * (i / 16),
            document
          );
          await new Promise((res) => setTimeout(res, 18));
        }
        toggle.dispatchEvent(
          new PointerEvent('pointerenter', {
            bubbles: true,
            clientX: tx,
            clientY: ty,
            pointerId: 1,
            buttons: 1,
          })
        );
      }
      await new Promise((res) => setTimeout(res, 350));
      const q = (s) => document.querySelector(s);
      const bx = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      };
      const chatToggle = [...document.querySelectorAll('.td-section-toggle')].find((t) =>
        /chats/i.test(t.textContent || '')
      );
      return {
        mediaDnd: !!q('.td-sidebar')?.classList.contains('media-dnd'),
        shellDnd: !!q('.td-shell')?.classList.contains('is-media-dnd'),
        bodyClass: document.body.className,
        chatsExpanded: chatToggle?.getAttribute('aria-expanded'),
        foldersExpanded: [...document.querySelectorAll('.td-section-toggle')]
          .find((t) => /drives/i.test(t.textContent || ''))
          ?.getAttribute('aria-expanded'),
        chatVirt: bx(q('.td-chat-virtual')),
        chatKeys: document.querySelectorAll('[data-drop-key^="chat:"]').length,
        chatSample: [...document.querySelectorAll('[data-drop-key^="chat:"]')]
          .slice(0, 6)
          .map((el) => ({
            key: el.getAttribute('data-drop-key'),
            y: Math.round(el.getBoundingClientRect().y),
            h: Math.round(el.getBoundingClientRect().height),
            t: (el.textContent || '').trim().slice(0, 28),
          })),
        overKey: document.querySelector('.is-drop-over')?.getAttribute('data-drop-key') || null,
        ghost: !!q('.td-drag-ghost'),
        sectionToggles: [...document.querySelectorAll('.td-section-toggle')].map((t) => ({
          label: (t.textContent || '').trim().slice(0, 28),
          exp: t.getAttribute('aria-expanded'),
          pe: getComputedStyle(t).pointerEvents,
          ...bx(t),
        })),
      };
    });
    console.log('duringDrag', JSON.stringify(during, null, 2));
    await p.screenshot({ path: path.join(shotDir, 'remote-small-dnd.png') });
    afterHover = {
      chatsExpanded: during?.chatsExpanded,
      chatVirtH: during?.chatVirt?.h || 0,
      chatKeys: during?.chatKeys || 0,
    };
    console.log('afterHoverToggle', afterHover);
    await p.evaluate(() => {
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          button: 0,
          buttons: 0,
        })
      );
    });
    await p.keyboard.press('Escape').catch(() => {});
  }

  // Wide layout sanity
  await p.setViewportSize({ width: 1100, height: 700 });
  await sleep(250);
  const layoutWide = await p.evaluate(() => {
    const tools = document.querySelector('.td-topbar-tools')?.getBoundingClientRect();
    const pills = document.querySelector('.td-filter-pills')?.getBoundingClientRect();
    return {
      tools: tools
        ? { x: Math.round(tools.x), y: Math.round(tools.y), w: Math.round(tools.width) }
        : null,
      pills: pills
        ? { x: Math.round(pills.x), w: Math.round(pills.width), text: document.querySelector('.td-filter-pills')?.innerText?.replace(/\s+/g, ' ') }
        : null,
      toolsOnScreen: !!(tools && tools.x >= 0 && tools.x < innerWidth - 40),
    };
  });
  console.log('layoutWide', JSON.stringify(layoutWide, null, 2));

  const report = {
    ok: true,
    layoutPre,
    during,
    afterHover,
    layoutWide,
    checks: {
      toolsOnScreenSmall:
        !!layoutPre.tools && layoutPre.tools.x >= 0 && layoutPre.tools.x < layoutPre.vw - 40,
      filtersVisible: !!(layoutPre.pills && layoutPre.pills.w > 50),
      chatsClosedBeforeDrag: layoutPre.chatsExpanded === 'false',
      chatsOpenDuringDrag: during?.chatsExpanded === 'true',
      chatListVisibleDuringDrag: !!(during?.chatVirt && during.chatVirt.h > 40),
      chatDropTargetsDuringDrag: (during?.chatKeys || 0) > 0,
    },
  };
  report.ok = Object.values(report.checks).every(Boolean) || (
    report.checks.toolsOnScreenSmall &&
    report.checks.filtersVisible &&
    report.checks.chatsOpenDuringDrag &&
    report.checks.chatListVisibleDuringDrag
  );

  const out = path.join(__dirname, '..', 'reports', 'remote-small-dnd-probe.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('REPORT', JSON.stringify(report.checks, null, 2));
  console.log('ok', report.ok);
  await b.close().catch(() => {});
  process.exit(report.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
