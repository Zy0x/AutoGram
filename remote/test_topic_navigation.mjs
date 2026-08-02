import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const playwright = require('../AutoGram App/frontend/node_modules/playwright');

async function run() {
  console.log('[test-topic] Connecting to CDP at http://127.0.0.1:9225...');
  const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9225');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('1420')) || pages[0];

  console.log('[test-topic] Connected to page:', page.url());
  await page.bringToFront();

  // Find groups/channels in the sidebar index
  console.log('[test-topic] Searching for groups/chats in sidebar...');
  
  // Get all chat/group elements in sidebar
  const groupElements = page.locator('.td-chat-item, button[data-peer-id], .td-sidebar-chat, div[role="button"]:has-text("Group"), div[role="button"]:has-text("Gudang")');
  const groupCount = await groupElements.count();
  console.log(`[test-topic] Found ${groupCount} group/chat items in sidebar`);

  let targetGroup = null;
  if (groupCount > 0) {
    // Pick first group or Gudang item
    targetGroup = groupElements.first();
    const groupName = await targetGroup.textContent();
    console.log('[test-topic] Clicking group:', groupName.trim().slice(0, 40));
    await targetGroup.click();
    await page.waitForTimeout(1500);
  }

  // Look for topics under the active group
  const topicElements = page.locator('.td-topic-item, [data-topic-id], button:has-text("Topik"), .td-topic-row');
  const topicCount = await topicElements.count();
  console.log(`[test-topic] Found ${topicCount} topic items`);

  if (topicCount > 0) {
    // Click second topic or first topic
    const targetTopic = topicCount > 1 ? topicElements.nth(1) : topicElements.first();
    const topicName = await targetTopic.textContent();
    console.log('[test-topic] Switching to topic:', topicName.trim().slice(0, 40));
    await targetTopic.click();
    await page.waitForTimeout(2000);
  } else {
    console.log('[test-topic] No sub-topics found under group, testing main group files view.');
  }

  // Perform card layout audit on topic view
  const topicAudit = await page.evaluate(() => {
    const explorer = document.querySelector('.td-explorer');
    const virtual = document.querySelector('.td-grid-virtual');
    const rows = Array.from(document.querySelectorAll('.td-grid-row'));
    const cards = Array.from(document.querySelectorAll('.td-file-card'));

    const issues = [];
    const cardData = [];

    rows.forEach((r, idx) => {
      const rRect = r.getBoundingClientRect();
      const next = rows[idx + 1];
      if (next) {
        const nRect = next.getBoundingClientRect();
        const gap = nRect.top - rRect.bottom;
        if (gap < -1) {
          issues.push(`Overlap row ${idx} -> ${idx + 1}: gap ${gap.toFixed(1)}px`);
        }
      }
    });

    cards.forEach((card, idx) => {
      const cRect = card.getBoundingClientRect();
      const name = card.querySelector('.td-file-card-name')?.textContent.trim() || '';
      
      if (cRect.width <= 0 || cRect.height <= 0) {
        issues.push(`Card ${idx} (${name}) has invalid bounds: ${cRect.width}x${cRect.height}`);
      }

      cardData.push({
        idx,
        name: name.slice(0, 25),
        w: Math.round(cRect.width),
        h: Math.round(cRect.height)
      });
    });

    return {
      title: document.title,
      url: window.location.href,
      explorerClass: explorer ? explorer.className : 'none',
      virtualHeight: virtual ? virtual.style.height : 'none',
      totalRows: rows.length,
      totalCards: cards.length,
      issues,
      cards: cardData.slice(0, 10)
    };
  });

  console.log('[test-topic] Topic Audit Results:', JSON.stringify(topicAudit, null, 2));

  // Save screenshot of topic view
  const ssPath = path.join(process.cwd(), 'reports', 'audit_topic_group_view.png');
  await page.screenshot({ path: ssPath, fullPage: false });
  console.log('[test-topic] Saved screenshot to:', ssPath);
}

run().catch(err => {
  console.error('[test-topic] Error:', err);
  process.exit(1);
});
