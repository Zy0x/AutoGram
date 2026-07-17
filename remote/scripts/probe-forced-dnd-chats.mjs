/**
 * Force media-dnd classes + verify Chats section layout on small window.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(__dirname, '..', 'reports', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

await p.bringToFront().catch(() => {});
await sleep(800);
await p.setViewportSize({ width: 800, height: 600 });
await sleep(300);
await p.evaluate(() => document.querySelector('.td-menu-btn')?.click());
await sleep(300);
await p.evaluate(() => {
  if (document.querySelector('.td-sidebar')?.classList.contains('is-collapsed')) {
    document.querySelector('.td-rail-brand-toggle')?.click();
  }
});
await sleep(200);
await p.evaluate(() => {
  for (const t of document.querySelectorAll('.td-section-toggle')) {
    if (/chats/i.test(t.textContent || '') && t.getAttribute('aria-expanded') === 'true') {
      t.click();
    }
  }
});
await sleep(150);

const forced = await p.evaluate(() => {
  document.querySelector('.td-shell')?.classList.add('is-media-dnd');
  document.querySelector('.td-sidebar')?.classList.add('media-dnd');
  document.querySelector('.td-folder-nav')?.classList.add('is-drop-mode', 'is-dnd-layout');
  document.querySelector('.td-page')?.classList.add('is-internal-dnd');
  document.body.classList.add('td-dnd-internal');
  for (const t of document.querySelectorAll('.td-section-toggle')) {
    if (/chats/i.test(t.textContent || '')) {
      t.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    }
  }
  const stack = document.querySelector('.td-dnd-folder-stack');
  const virt = document.querySelector('.td-chat-virtual');
  const toggle = [...document.querySelectorAll('.td-section-toggle')].find((t) =>
    /chats/i.test(t.textContent || '')
  );
  return {
    mediaDnd: !!document.querySelector('.td-sidebar')?.classList.contains('media-dnd'),
    chatsExp: toggle?.getAttribute('aria-expanded'),
    stackMax: stack ? getComputedStyle(stack).maxHeight : null,
    chatVirt: virt
      ? {
          h: Math.round(virt.getBoundingClientRect().height),
          y: Math.round(virt.getBoundingClientRect().y),
        }
      : null,
    chatToggleY: toggle ? Math.round(toggle.getBoundingClientRect().y) : null,
    chatKeys: document.querySelectorAll('[data-drop-key^="chat:"]').length,
    toolsX: Math.round(document.querySelector('.td-topbar-tools')?.getBoundingClientRect().x || -1),
    pills: document.querySelector('.td-filter-pills')?.innerText?.replace(/\s+/g, ' ') || '',
  };
});
console.log('forced-dnd-classes', JSON.stringify(forced, null, 2));
await p.screenshot({ path: path.join(shotDir, 'remote-forced-dnd-chats.png') });

// Click open if still closed (React state may ignore class-only force)
await p.evaluate(() => {
  for (const t of document.querySelectorAll('.td-section-toggle')) {
    if (/chats/i.test(t.textContent || '') && t.getAttribute('aria-expanded') === 'false') {
      t.click();
    }
  }
});
await sleep(250);

const afterOpen = await p.evaluate(() => {
  const virt = document.querySelector('.td-chat-virtual');
  const toggle = [...document.querySelectorAll('.td-section-toggle')].find((t) =>
    /chats/i.test(t.textContent || '')
  );
  const stack = document.querySelector('.td-dnd-folder-stack');
  return {
    chatsExp: toggle?.getAttribute('aria-expanded'),
    toggleY: toggle ? Math.round(toggle.getBoundingClientRect().y) : null,
    virt: virt
      ? {
          h: Math.round(virt.getBoundingClientRect().height),
          y: Math.round(virt.getBoundingClientRect().y),
        }
      : null,
    chatKeys: document.querySelectorAll('[data-drop-key^="chat:"]').length,
    inViewport: toggle ? toggle.getBoundingClientRect().y < innerHeight - 20 : false,
    stackMax: stack ? getComputedStyle(stack).maxHeight : null,
    stackH: stack ? Math.round(stack.getBoundingClientRect().height) : null,
  };
});
console.log('afterOpen', JSON.stringify(afterOpen, null, 2));
await p.screenshot({ path: path.join(shotDir, 'remote-forced-dnd-chats-open.png') });

await p.evaluate(() => {
  document.querySelector('.td-shell')?.classList.remove('is-media-dnd');
  document.querySelector('.td-sidebar')?.classList.remove('media-dnd');
  document.querySelector('.td-folder-nav')?.classList.remove('is-drop-mode', 'is-dnd-layout');
  document.querySelector('.td-page')?.classList.remove('is-internal-dnd');
  document.body.classList.remove('td-dnd-internal');
});

const ok =
  afterOpen.chatsExp === 'true' &&
  (afterOpen.virt?.h || 0) > 40 &&
  afterOpen.chatKeys > 0 &&
  afterOpen.inViewport === true;
console.log(JSON.stringify({ ok, afterOpen }, null, 2));
await b.close().catch(() => {});
process.exit(ok ? 0 : 2);
