/**
 * Remote CDP test: create a Drive subfolder (folder-in-folder).
 * Requires: Vite :1420 + WebView2 CDP :9222
 *
 * node test-create-subfolder.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../AutoGram App/frontend/node_modules/playwright');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
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
    console.log(JSON.stringify({ ok: false, reason: 'NO_PAGE' }));
    process.exit(1);
  }
  console.log('page', p.url());

  await p.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);
  for (let i = 0; i < 25; i++) {
    const ok = await p.evaluate(() => !!document.querySelector('.td-explorer, .td-page, .td-shell'));
    if (ok) {
      console.log('shell_ok', i);
      break;
    }
    await sleep(400);
  }

  const snap = async (label) => {
    const s = await p.evaluate(() => {
      const body = document.body.innerText || '';
      return {
        connText: document.querySelector('.td-conn')?.textContent?.trim() || null,
        menu: document.querySelector('.drive-context-menu')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 220) || null,
        dialogTitle: document.querySelector('#td-input-title, #td-dest-title')?.textContent || null,
        dialogOpen: !!document.querySelector('.td-confirm-panel'),
        error:
          document.querySelector('.td-error-banner, .td-input-error, [role="alert"]')?.textContent?.trim()?.slice(0, 200) ||
          null,
        folderLabels: [...document.querySelectorAll('.td-folder-label')]
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 20),
        toolbar: [...document.querySelectorAll('button.td-rail-btn, .td-rail-toolbar button')]
          .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 10),
        breadcrumbHint: (body.match(/Start\s*\/\s*[^\n]{1,50}/) || [])[0] || null,
      };
    });
    console.log(label, JSON.stringify(s, null, 2));
    return s;
  };

  await snap('before');
  await p.keyboard.press('Escape');
  await sleep(150);
  await p.keyboard.press('Escape');
  await sleep(150);

  // Expand Drive folders section
  await p.evaluate(() => {
    for (const t of document.querySelectorAll('.td-section-toggle')) {
      const lab = (t.textContent || '').toLowerCase();
      if (lab.includes('drive') && t.getAttribute('aria-expanded') === 'false') t.click();
    }
  });
  await sleep(400);

  // Enter first Drive folder (not Saved Messages)
  const entered = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-drop-key^="drive:"], .td-folder-row')];
    for (const row of rows) {
      const t = (row.textContent || '').replace(/\s+/g, ' ').trim();
      if (/saved messages/i.test(t)) continue;
      const key = row.getAttribute('data-drop-key') || '';
      if (key.startsWith('drive:') || /\[TD\]|Gudang/i.test(t)) {
        row.click();
        return { ok: true, text: t.slice(0, 60), key };
      }
    }
    for (const c of document.querySelectorAll('.td-recent-chip')) {
      const t = (c.textContent || '').trim();
      const key = c.getAttribute('data-drop-key') || '';
      if (key.startsWith('drive:') || /\[TD\]|Gudang/i.test(t)) {
        c.click();
        return { ok: true, via: 'chip', text: t.slice(0, 60), key };
      }
    }
    return { ok: false };
  });
  console.log('enter_folder', entered);
  await sleep(2200);
  await snap('after_enter');

  const name = `SubRemote_${Date.now().toString().slice(-6)}`;

  // Try toolbar + Sub first
  let openPath = null;
  const toolbar = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const sub = btns.find((b) => /^\s*\+\s*Sub\s*$/i.test((b.textContent || '').trim()) || /subfolder/i.test(b.getAttribute('aria-label') || ''));
    if (sub) {
      sub.click();
      return { which: 'sub', text: (sub.textContent || '').trim(), aria: sub.getAttribute('aria-label') };
    }
    const fold = btns.find((b) => /^\s*\+\s*Folder\s*$/i.test((b.textContent || '').trim()));
    if (fold) {
      fold.click();
      return { which: 'folder', text: (fold.textContent || '').trim() };
    }
    return null;
  });
  console.log('toolbar', toolbar);
  openPath = toolbar ? `toolbar:${toolbar.which}` : null;
  await sleep(700);

  let dialog = await p.evaluate(() => ({
    input: !!document.querySelector('#td-drive-input, .td-input-field'),
    dest: !!document.querySelector('#td-dest-title, .dest-picker'),
    title: document.querySelector('#td-input-title, #td-dest-title')?.textContent || null,
  }));
  console.log('dialog_after_toolbar', dialog);

  // Canvas context menu fallback
  if (!dialog.input && !dialog.dest) {
    console.log('fallback_canvas_contextmenu');
    await p.evaluate(() => {
      const exp = document.querySelector('.td-explorer');
      if (!exp) return;
      const r = exp.getBoundingClientRect();
      exp.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          view: window,
          clientX: r.left + 48,
          clientY: r.top + Math.min(120, r.height / 2),
        })
      );
    });
    await sleep(500);
    await snap('ctx_menu');
    const menuClick = await p.evaluate(() => {
      const items = [...document.querySelectorAll('.drive-context-menu button, .drive-context-menu [role="menuitem"]')];
      const all = items.map((i) => (i.textContent || '').replace(/\s+/g, ' ').trim());
      const prefer =
        items.find((i) => /subfolder di sini/i.test(i.textContent || '')) ||
        items.find((i) => /subfolder/i.test(i.textContent || '')) ||
        items.find((i) => /Buat folder/i.test(i.textContent || ''));
      if (prefer) {
        prefer.click();
        return { clicked: (prefer.textContent || '').replace(/\s+/g, ' ').trim(), all };
      }
      return { clicked: null, all };
    });
    console.log('menuClick', menuClick);
    openPath = `canvas:${menuClick.clicked || 'none'}`;
    await sleep(800);
    dialog = await p.evaluate(() => ({
      input: !!document.querySelector('#td-drive-input, .td-input-field'),
      dest: !!document.querySelector('#td-dest-title, .dest-picker'),
      title: document.querySelector('#td-input-title, #td-dest-title')?.textContent || null,
    }));
    console.log('dialog_after_menu', dialog);
  }

  // Destination picker → pick first Drive parent
  if (dialog.dest) {
    const picked = await p.evaluate(() => {
      const items = [...document.querySelectorAll('.td-dest-item, button[role="option"]')];
      const drive = items.find((i) => /TD|\[TD\]/i.test(i.textContent || '')) || items[0];
      if (!drive) return null;
      const label = (drive.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      drive.click();
      return label;
    });
    console.log('picked_parent', picked);
    openPath = `${openPath || 'dest'}|parent:${picked}`;
    await sleep(900);
  }

  // Fill create dialog
  const filled = await p.evaluate((n) => {
    const input = document.querySelector('#td-drive-input, .input-dialog input.td-input-field, .td-input-field');
    if (!input) return { ok: false };
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    desc.set.call(input, n);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      ok: true,
      title: document.querySelector('#td-input-title')?.textContent || null,
      value: input.value,
      desc: document.querySelector('.td-confirm-head-text p')?.textContent?.slice(0, 120) || null,
    };
  }, name);
  console.log('filled', filled);

  if (!filled.ok) {
    await snap('FAIL_no_input');
    console.log(
      'RESULT',
      JSON.stringify({ ok: false, reason: 'no_input_dialog', name, entered, openPath, toolbar }, null, 2)
    );
    process.exit(0);
  }

  // Confirm
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const conf = btns.find((b) => {
      const t = (b.textContent || '').trim();
      return /^(Buat subfolder|Buat folder|Buat|OK|Simpan)$/i.test(t) || /Buat subfolder|Buat folder/i.test(t);
    });
    if (conf && !/Batal|Cancel/i.test(conf.textContent || '')) {
      conf.click();
      return;
    }
    const input = document.querySelector('#td-drive-input, .td-input-field');
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
  });
  console.log('submitted', name);

  let final = null;
  for (let i = 0; i < 45; i++) {
    await sleep(800);
    final = await p.evaluate((want) => {
      const errEl = document.querySelector('.td-error-banner, .td-input-error');
      const err = errEl?.textContent?.trim()?.slice(0, 220) || null;
      const body = document.body.innerText || '';
      const statusHit = (body.match(/(Subfolder siap[^\n]{0,60}|Folder siap[^\n]{0,60}|Membuat subfolder[^\n]{0,40}|Membuat folder[^\n]{0,40}|Cannot create[^\n]{0,80}|Gagal[^\n]{0,80}|terputus[^\n]{0,60}|batas channel[^\n]{0,60})/i) || [])[0] || null;
      const labels = [...document.querySelectorAll('.td-folder-label')].map((el) =>
        (el.textContent || '').replace(/\s+/g, ' ').trim()
      );
      const found = labels.some((l) => l.includes(want));
      const dialogOpen = !!document.querySelector('#td-drive-input');
      const breadcrumb = (body.match(/Start\s*\/\s*[^\n]{1,60}/) || [])[0] || null;
      return { err, statusHit, found, labels: labels.slice(0, 20), dialogOpen, breadcrumb, want };
    }, name);
    console.log(
      `wait[${i}] found=${final.found} status=${final.statusHit || '-'} err=${(final.err || '').slice(0, 70)}`
    );
    if (final.found) break;
    if (final.err && !/Memuat|loading/i.test(final.err)) break;
    if (final.statusHit && /siap|Cannot|Gagal|terputus|batas/i.test(final.statusHit) && !/Membuat/.test(final.statusHit)) {
      break;
    }
  }

  const after = await snap('after_create');
  const result = {
    ok: !!(final && final.found),
    name,
    entered,
    openPath,
    toolbar,
    final,
    folderLabels: after.folderLabels,
    error: final?.err || after.error,
  };
  console.log('RESULT', JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
