/**
 * Visual layout audit for Drive modals (rename, confirm, dest, tools, preview).
 * Detects the "vertical strip" bug: panel taller than wide with 1-glyph text columns.
 *
 * Usage (from suite or standalone):
 *   import { auditModalLayouts, openRenameProbe } from './modal_layout_audit.mjs'
 */
import { log } from './logger.mjs';

/**
 * Inspect all visible dialog panels in the page.
 * @returns {{ pass: boolean, issues: object[], panels: object[] }}
 */
export async function auditModalLayouts(page) {
  const report = await page.evaluate(() => {
    const panels = [
      ...document.querySelectorAll(
        [
          '.td-confirm-panel',
          '.td-tools-panel',
          '.td-xfer-settings-modal',
          '.drive-preview-modal',
          '.modal-panel',
          '.modal-content',
          '[data-dialog-layout="card"]',
          '[role="dialog"]',
        ].join(', ')
      ),
    ];

    const issues = [];
    const details = [];

    for (const el of panels) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      // Skip off-screen / zero-opacity
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        continue;
      }

      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const ratio = rect.height / Math.max(1, rect.width);
      const writingMode = style.writingMode || '';
      const flexDir = style.flexDirection || '';

      // Vertical-strip heuristic: very tall + narrow (the bug screenshot)
      const isStrip =
        rect.width < 160 ||
        (ratio > 2.2 && rect.width < Math.min(360, vw * 0.45)) ||
        (rect.height > vh * 0.85 && rect.width < vw * 0.35);

      // Sample text nodes for one-char-per-line wrapping
      let verticalTextScore = 0;
      const texts = [...el.querySelectorAll('h2, p, label, .td-confirm-desc, .td-confirm-head-text')];
      for (const t of texts.slice(0, 8)) {
        const r = t.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const lines = Math.max(1, Math.round(r.height / 16));
        // If height suggests many lines but width is tiny → stacked glyphs
        if (r.width < 24 && lines > 4) verticalTextScore += 2;
        if (r.width < 48 && lines > 8) verticalTextScore += 2;
      }

      // Head must be horizontal row: icon + text + close
      const head = el.querySelector('.td-confirm-head');
      let headOk = true;
      if (head) {
        const hs = getComputedStyle(head);
        if (hs.flexDirection === 'column' && head.children.length >= 2) {
          // column head can still be OK for some designs; flag only if narrow
          if (rect.width < 280) headOk = false;
        }
        const children = [...head.children].map((c) => c.getBoundingClientRect());
        if (children.length >= 2) {
          // Icons and title should share roughly same vertical band (horizontal layout)
          const tops = children.map((c) => c.top);
          const spread = Math.max(...tops) - Math.min(...tops);
          if (spread > 80 && rect.width > 200) {
            // large vertical spread with wide panel = stacked layout ok if intentional
          }
          if (spread > 40 && rect.width < 200) headOk = false;
        }
      }

      const item = {
        tag: el.tagName,
        testid: el.getAttribute('data-testid') || null,
        className: String(el.className || '').slice(0, 120),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        ratio: Math.round(ratio * 100) / 100,
        writingMode,
        flexDir,
        isStrip,
        verticalTextScore,
        headOk,
      };
      details.push(item);

      if (isStrip) {
        issues.push({
          code: 'vertical_strip',
          message: `Dialog panel looks like a tall thin strip (${item.width}×${item.height})`,
          ...item,
        });
      }
      if (verticalTextScore >= 2) {
        issues.push({
          code: 'vertical_text',
          message: 'Text nodes appear as 1-glyph columns (broken wrap)',
          ...item,
        });
      }
      if (/vertical-rl|vertical-lr|sideways/i.test(writingMode)) {
        issues.push({
          code: 'writing_mode_vertical',
          message: `writing-mode=${writingMode}`,
          ...item,
        });
      }
      if (!headOk) {
        issues.push({
          code: 'head_not_horizontal',
          message: 'Confirm head is not a horizontal row',
          ...item,
        });
      }
      // Card dialogs should not fill nearly full viewport height unless dest-picker/tools
      const isTallOk =
        /dest-picker|td-tools|preview|xfer-settings|modal-content/i.test(item.className);
      if (!isTallOk && rect.height > vh * 0.75 && rect.width < vw * 0.5) {
        issues.push({
          code: 'unexpected_full_height',
          message: `Card dialog too tall (${item.height}px ≈ ${Math.round((rect.height / vh) * 100)}% viewport)`,
          ...item,
        });
      }
    }

    return {
      pass: issues.length === 0,
      issues,
      panels: details,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });

  if (report.pass) {
    log.pass('modal_layout_audit', { panels: report.panels.length });
  } else {
    log.fail('modal_layout_audit', report.issues);
  }
  return report;
}

/**
 * Open rename dialog via synthetic UI (context-free): inject a minimal panel
 * matching production markup for layout-only checks when no file is selected.
 * Prefer real rename open from suite when files exist.
 */
export async function openSyntheticInputDialog(page) {
  await page.evaluate(() => {
    // Remove previous probe
    document.getElementById('remote-synth-input-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'remote-synth-input-dialog';
    overlay.className = 'td-confirm-overlay';
    overlay.setAttribute('data-dialog-kind', 'rename');
    overlay.innerHTML = `
      <div class="td-confirm-panel input-dialog" role="dialog" aria-modal="true"
           data-testid="drive-input-dialog" data-dialog-layout="card">
        <header class="td-confirm-head">
          <span class="td-confirm-icon input" aria-hidden></span>
          <div class="td-confirm-head-text">
            <h2 id="td-input-title">Ubah nama file</h2>
            <p class="td-confirm-desc">Nama ditampilkan di Drive (caption pesan Telegram).</p>
          </div>
          <button type="button" class="td-confirm-close" aria-label="Tutup">×</button>
        </header>
        <div class="td-input-body">
          <label class="td-input-label" for="td-drive-input">Nama baru</label>
          <input id="td-drive-input" class="td-input-field" type="text" value="contoh-file.jpg" />
        </div>
        <footer class="td-confirm-foot">
          <button type="button" class="td-confirm-btn ghost">Batal</button>
          <button type="button" class="td-confirm-btn primary">Simpan</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);
  });
}

export async function closeSyntheticInputDialog(page) {
  await page.evaluate(() => {
    document.getElementById('remote-synth-input-dialog')?.remove();
  });
}

/**
 * Open real rename if a file card exists; else synthetic.
 */
export async function openRenameForAudit(page) {
  const opened = await page.evaluate(() => {
    const card =
      document.querySelector('.td-file-card') ||
      document.querySelector('.td-list-row[data-drive-file]');
    if (!card) return false;
    // Try context menu path is hard; double-click doesn't rename.
    // Use keyboard F2 after select.
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  if (opened) {
    await page.keyboard.press('F2').catch(() => {});
    await page.waitForTimeout?.(400);
    // Playwright sleep via evaluate delay
    await new Promise((r) => setTimeout(r, 450));
    const has = await page.locator('[data-testid="drive-input-dialog"], .td-confirm-panel.input-dialog').count();
    if (has > 0) return { mode: 'real' };
  }
  await openSyntheticInputDialog(page);
  await new Promise((r) => setTimeout(r, 100));
  return { mode: 'synthetic' };
}

export async function closeRenameAudit(page, mode) {
  if (mode === 'synthetic') {
    await closeSyntheticInputDialog(page);
    return;
  }
  await page.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  // Force remove leftover
  await page.evaluate(() => {
    document.querySelectorAll('.td-confirm-overlay').forEach((el) => {
      if (el.querySelector('.input-dialog, [data-testid="drive-input-dialog"]')) el.remove();
    });
  });
}
