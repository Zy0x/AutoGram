import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const playwright = require('../AutoGram App/frontend/node_modules/playwright');

async function run() {
  console.log('[audit-cards] Connecting to CDP at http://127.0.0.1:9225...');
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9225');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('1420')) || pages[0];

  console.log('[audit-cards] Connected to page:', page.url());
  await page.bringToFront();

  // 1. Click on "Drives" or "Drives & Media" in sidebar if available
  const drivesBtn = page.locator('button:has-text("Drives"), button:has-text("Drives & Media"), nav button:has-text("Sync")').first();
  if (await drivesBtn.count() > 0) {
    console.log('[audit-cards] Clicking sidebar item...');
    await drivesBtn.click();
    await page.waitForTimeout(1500);
  }

  // Also check if any chat / topic item can be clicked
  const chatItem = page.locator('.td-chat-item, .td-sidebar-chat, [data-peer-id]').first();
  if (await chatItem.count() > 0) {
    console.log('[audit-cards] Clicking chat item...');
    await chatItem.click();
    await page.waitForTimeout(1500);
  }

  // Audit function
  async function auditCurrentState(label) {
    const res = await page.evaluate((lbl) => {
      const explorer = document.querySelector('.td-explorer');
      const virtual = document.querySelector('.td-grid-virtual');
      const rows = Array.from(document.querySelectorAll('.td-grid-row'));
      const cards = Array.from(document.querySelectorAll('.td-file-card'));
      const listRows = Array.from(document.querySelectorAll('.td-list-row'));

      const issues = [];
      const cardDetails = [];

      // Audit rows and vertical spacing
      rows.forEach((r, idx) => {
        const rRect = r.getBoundingClientRect();
        const next = rows[idx + 1];
        if (next) {
          const nRect = next.getBoundingClientRect();
          const vGap = nRect.top - rRect.bottom;
          if (vGap < -1) {
            issues.push(`Overlap row ${idx} -> ${idx + 1}: vertical gap ${vGap.toFixed(1)}px`);
          }
        }
      });

      // Audit individual cards
      cards.forEach((card, idx) => {
        const cRect = card.getBoundingClientRect();
        const inner = card.querySelector('.td-file-card-inner');
        const innerRect = inner ? inner.getBoundingClientRect() : cRect;
        const nameEl = card.querySelector('.td-file-card-name');
        const subEl = card.querySelector('.td-file-card-sub');
        const metaEl = card.querySelector('.td-file-card-meta');

        const nameText = nameEl ? nameEl.textContent.trim() : '';

        // Check if card dimensions are zero or negative
        if (cRect.width <= 0 || cRect.height <= 0) {
          issues.push(`Card ${idx} (${nameText}) has invalid bounds: ${cRect.width}x${cRect.height}`);
        }

        // Check inner overflow
        if (inner && inner.scrollHeight > inner.clientHeight + 4) {
          issues.push(`Card ${idx} (${nameText}) inner content overflow: scrollHeight ${inner.scrollHeight}px > clientHeight ${inner.clientHeight}px`);
        }

        // Check text truncation / overlap
        if (nameEl && subEl && metaEl) {
          const nameRect = nameEl.getBoundingClientRect();
          const subRect = subEl.getBoundingClientRect();
          if (nameRect.bottom > subRect.top + 2) {
            issues.push(`Card ${idx} (${nameText}) title overlaps sublabel: title bottom ${nameRect.bottom.toFixed(1)}px > sub top ${subRect.top.toFixed(1)}px`);
          }
        }

        cardDetails.push({
          idx,
          name: nameText.slice(0, 20),
          w: Math.round(cRect.width),
          h: Math.round(cRect.height),
          innerH: Math.round(innerRect.height),
          metaH: metaEl ? Math.round(metaEl.getBoundingClientRect().height) : 0
        });
      });

      return {
        label: lbl,
        explorerClass: explorer ? explorer.className : 'none',
        virtualHeight: virtual ? virtual.style.height : 'none',
        totalRows: rows.length,
        totalCards: cards.length,
        totalListRows: listRows.length,
        issues,
        sampleCards: cardDetails.slice(0, 8)
      };
    }, label);

    console.log(`[audit-cards] State [${label}]:`, JSON.stringify(res, null, 2));

    const ssName = `audit_${label.replace(/\s+/g, '_')}.png`;
    const ssPath = path.join(process.cwd(), 'reports', ssName);
    await page.screenshot({ path: ssPath, fullPage: false });
    console.log(`[audit-cards] Saved screenshot to: ${ssPath}`);

    return res;
  }

  // Perform audit on default view
  await auditCurrentState('initial_drives');

  // Try switching zoom levels if zoom buttons are present
  const zoomBtns = page.locator('button[title*="Zoom"], button[title*="Skala"], .td-zoom-btn');
  const count = await zoomBtns.count();
  if (count > 0) {
    for (let i = 0; i < Math.min(count, 4); i++) {
      console.log(`[audit-cards] Clicking zoom button ${i + 1}...`);
      await zoomBtns.nth(i).click();
      await page.waitForTimeout(800);
      await auditCurrentState(`zoom_level_${i}`);
    }
  }

  // Try switching view mode (Grid vs List) if toggle button is present
  const viewToggleBtn = page.locator('button[title*="List"], button[title*="Grid"], button[title*="Tampilan"]').first();
  if (await viewToggleBtn.count() > 0) {
    console.log('[audit-cards] Toggling view mode...');
    await viewToggleBtn.click();
    await page.waitForTimeout(1000);
    await auditCurrentState('view_mode_toggled');
  }

  console.log('[audit-cards] Audit completed!');
}

run().catch(err => {
  console.error('[audit-cards] Error:', err);
  process.exit(1);
});
