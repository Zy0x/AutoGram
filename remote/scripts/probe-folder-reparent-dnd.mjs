/**
 * Probe: drag sidebar Folder onto a Drive root (reparent).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
await sleep(600);
await p.setViewportSize({ width: 1100, height: 720 });
await sleep(300);
await p.evaluate(() => {
  if (document.querySelector('.td-sidebar.is-collapsed')) {
    document.querySelector('.td-rail-brand-toggle')?.click();
  }
  for (const b of document.querySelectorAll('button')) {
    if (/Muat/i.test(b.textContent || '')) b.click();
  }
});
await sleep(2000);

const pre = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.td-folder-row[data-drop-key^="drive:"]')];
  return rows.map((el) => ({
    key: el.getAttribute('data-drop-key'),
    cls: el.className.slice(0, 80),
    text: (el.textContent || '').trim().slice(0, 40),
    draggable: el.getAttribute('draggable'),
  }));
});
console.log('rows', JSON.stringify(pre, null, 2));

// HTML5 drag: source nested folder → target drive root
const result = await p.evaluate(async () => {
  const rows = [...document.querySelectorAll('.td-folder-row[data-drop-key^="drive:"]')];
  const nested = rows.find((r) => r.classList.contains('is-nested') || r.classList.contains('is-drive-folder'));
  const root = rows.find((r) => r.classList.contains('is-drive-root') || /Drive/.test(r.textContent || ''));
  // Prefer: any two different drive keys
  const src =
    nested ||
    rows.find((r) => (r.getAttribute('data-drop-key') || '').includes('drive:')) ||
    rows[1];
  const dst =
    root && root !== src
      ? root
      : rows.find((r) => r !== src && (r.getAttribute('data-drop-key') || '').startsWith('drive:'));
  if (!src || !dst) return { ok: false, reason: 'need 2 drive rows', n: rows.length };

  const srcKey = src.getAttribute('data-drop-key');
  const dstKey = dst.getAttribute('data-drop-key');
  const srcR = src.getBoundingClientRect();
  const dstR = dst.getBoundingClientRect();

  const fire = (el, type, x, y, dataTransfer) => {
    const ev = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      dataTransfer,
    });
    el.dispatchEvent(ev);
  };

  // Use DataTransfer polyfill-ish via DragEvent - may be null in some browsers
  const dt = new DataTransfer();
  dt.effectAllowed = 'move';
  dt.setData('text/plain', srcKey || 'folder');

  fire(src, 'dragstart', srcR.x + 20, srcR.y + 10, dt);
  await new Promise((r) => setTimeout(r, 50));

  // Check folder drag armed
  const armed = document.body.innerText.includes('Lepas di') ||
    document.querySelector('.td-dnd-hint') ||
    document.querySelector('.td-sidebar.media-dnd');

  // drag over destination
  for (let i = 0; i <= 8; i++) {
    const x = srcR.x + ((dstR.x + dstR.width / 2) - srcR.x) * (i / 8);
    const y = srcR.y + ((dstR.y + dstR.height / 2) - srcR.y) * (i / 8);
    fire(document, 'dragover', x, y, dt);
    fire(dst, 'dragover', x, y, dt);
    await new Promise((r) => setTimeout(r, 20));
  }

  const over = document.querySelector('.is-drop-over')?.getAttribute('data-drop-key');
  const mediaDnd = document.querySelector('.td-sidebar')?.classList.contains('media-dnd');
  const dropMode = document.querySelector('.td-folder-nav')?.classList.contains('is-drop-mode');

  fire(dst, 'drop', dstR.x + dstR.width / 2, dstR.y + dstR.height / 2, dt);
  fire(src, 'dragend', dstR.x, dstR.y, dt);
  await new Promise((r) => setTimeout(r, 400));

  // confirm dialog?
  const confirm = !!document.querySelector('.td-confirm, [class*="confirm"]');
  const dialogText = (document.body.innerText || '').includes('Pindah') ||
    (document.body.innerText || '').includes('induk');

  return {
    ok: !!(mediaDnd || dropMode || over || confirm || dialogText),
    srcKey,
    dstKey,
    over,
    mediaDnd,
    dropMode,
    confirm,
    dialogText,
    armed: !!armed,
  };
});

console.log(JSON.stringify(result, null, 2));
await p.screenshot({
  path: path.join(__dirname, '..', 'reports', 'screenshots', 'folder-reparent-dnd.png'),
});
await b.close().catch(() => {});
process.exit(result.ok ? 0 : 2);
