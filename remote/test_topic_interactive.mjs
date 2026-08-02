import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const playwright = require('../AutoGram App/frontend/node_modules/playwright');

async function run() {
  console.log('[test-topic-interactive] Connecting to CDP at http://127.0.0.1:9225...');
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9225');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('1420')) || pages[0];

  console.log('[test-topic-interactive] Connected to page:', page.url());
  await page.bringToFront();

  // Find all clickable sidebar rows
  const chatRows = page.locator('.td-folder-row, .td-chat-item, button[data-peer-id]');
  const count = await chatRows.count();
  console.log(`[test-topic-interactive] Found ${count} sidebar chat rows`);

  for (let i = 0; i < Math.min(count, 5); i++) {
    const row = chatRows.nth(i);
    const text = (await row.textContent() || '').trim().replace(/\s+/g, ' ');
    console.log(`[test-topic-interactive] Clicking chat item ${i}: "${text.slice(0, 30)}"...`);
    await row.click();
    await page.waitForTimeout(1500);

    // Check if topics list expanded under this chat
    const topicRows = page.locator('.td-topic-row, [data-topic-id], button:has-text("Topik")');
    const topicCount = await topicRows.count();
    if (topicCount > 0) {
      console.log(`[test-topic-interactive] Found ${topicCount} sub-topics for "${text}"!`);
      const targetTopic = topicRows.first();
      console.log('[test-topic-interactive] Clicking sub-topic:', (await targetTopic.textContent()).trim());
      await targetTopic.click();
      await page.waitForTimeout(1500);
    }

    // Audit cards in current view
    const state = await page.evaluate((idx) => {
      const explorer = document.querySelector('.td-explorer');
      const virtual = document.querySelector('.td-grid-virtual');
      const rows = Array.from(document.querySelectorAll('.td-grid-row'));
      const cards = Array.from(document.querySelectorAll('.td-file-card'));
      const issues = [];

      rows.forEach((r, rIdx) => {
        const rRect = r.getBoundingClientRect();
        const next = rows[rIdx + 1];
        if (next) {
          const nRect = next.getBoundingClientRect();
          const gap = nRect.top - rRect.bottom;
          if (gap < -1) {
            issues.push(`Overlap row ${rIdx} -> ${rIdx + 1}: gap ${gap.toFixed(1)}px`);
          }
        }
      });

      cards.forEach((c, cIdx) => {
        const rect = c.getBoundingClientRect();
        const name = c.querySelector('.td-file-card-name')?.textContent.trim() || '';
        if (rect.width <= 0 || rect.height <= 0) {
          issues.push(`Card ${cIdx} (${name}) has 0 size`);
        }
      });

      return {
        chatIndex: idx,
        explorerClass: explorer ? explorer.className : 'none',
        virtualHeight: virtual ? virtual.style.height : 'none',
        totalRows: rows.length,
        totalCards: cards.length,
        issues,
        sampleCards: cards.slice(0, 4).map(c => {
          const r = c.getBoundingClientRect();
          return {
            name: c.querySelector('.td-file-card-name')?.textContent.trim().slice(0, 20) || '',
            w: Math.round(r.width),
            h: Math.round(r.height)
          };
        })
      };
    }, i);

    console.log(`[test-topic-interactive] State for item ${i}:`, JSON.stringify(state, null, 2));

    const ssPath = path.join(process.cwd(), 'reports', `audit_chat_item_${i}.png`);
    await page.screenshot({ path: ssPath, fullPage: false });
    console.log(`[test-topic-interactive] Saved screenshot to: ${ssPath}`);
  }

  console.log('[test-topic-interactive] Topic & Chat audit completed successfully!');
}

run().catch(err => {
  console.error('[test-topic-interactive] Error:', err);
  process.exit(1);
});
