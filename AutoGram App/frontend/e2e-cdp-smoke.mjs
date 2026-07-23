/**
 * Remote CDP smoke test against running frontend.exe (WebView2 :9222)
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = 'F:/AutoGram/remote';
fs.mkdirSync(OUT, { recursive: true });

function snip(s, n = 600) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
}

const results = { steps: [], ok: true };

function step(name, data) {
  results.steps.push({ name, ...data, at: Date.now() });
  console.log(JSON.stringify({ name, ...data }));
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const pages = browser.contexts().flatMap((c) => c.pages());
step('connect', { pages: pages.map((p) => p.url()) });

const page =
  pages.find((p) => p.url().includes('1420') || p.url().includes('localhost')) ||
  pages[0];
if (!page) {
  step('fail', { error: 'no page' });
  process.exit(1);
}

await page.waitForTimeout(1500);
const title = await page.title();
const body0 = await page.locator('body').innerText().catch(() => '');
step('boot', { title, body: snip(body0, 400) });
await page.screenshot({ path: path.join(OUT, '01-boot.png') });

// Click Drives / Media Studio / speedtest nav
const candidates = [
  page.getByRole('button', { name: /Drives/i }),
  page.getByRole('button', { name: /Media/i }),
  page.locator('button.sidebar-btn').filter({ hasText: /Drive|Media|Studio/i }),
];
let clicked = false;
const tDrive = Date.now();
for (const loc of candidates) {
  if ((await loc.count()) > 0) {
    await loc.first().click({ timeout: 5000 });
    clicked = true;
    break;
  }
}
if (!clicked) {
  // try any sidebar button by index (Drives often 3rd)
  const btns = page.locator('.sidebar-btn, button.sidebar-btn, nav button');
  const n = await btns.count();
  step('nav_buttons', {
    count: n,
    texts: await btns.allTextContents().catch(() => []),
  });
  for (let i = 0; i < n; i++) {
    const t = (await btns.nth(i).innerText()).toLowerCase();
    if (t.includes('drive') || t.includes('media') || t.includes('studio')) {
      await btns.nth(i).click();
      clicked = true;
      break;
    }
  }
}
await page.waitForTimeout(3000);
const drivesMs = Date.now() - tDrive;
const body1 = await page.locator('body').innerText().catch(() => '');
const cardCount = await page
  .locator('.td-file-card, [class*="file-card"]')
  .count()
  .catch(() => 0);
const thumbCount = await page
  .locator('.td-file-card img, img[src^="data:image"], img[src^="blob:"]')
  .count()
  .catch(() => 0);
const chatCount = await page
  .locator('.td-chat-row, [class*="chat-row"], .chat-row')
  .count()
  .catch(() => 0);
step('drives', {
  clicked,
  drivesMs,
  cardCount,
  thumbCount,
  chatCount,
  body: snip(body1, 700),
  pass_3s: drivesMs <= 3500,
});
await page.screenshot({ path: path.join(OUT, '02-drives.png') });

// Session select if present
const sessionSelect = page.locator('select').first();
if ((await sessionSelect.count()) > 0) {
  const opts = await sessionSelect.locator('option').allTextContents();
  step('sessions', { options: opts });
  if (opts.length >= 2) {
    const t0 = Date.now();
    await sessionSelect.selectOption({ index: 1 });
    await page.waitForTimeout(2500);
    const t1 = Date.now() - t0;
    const body2 = await page.locator('body').innerText().catch(() => '');
    step('session_switch', {
      ms: t1,
      pass_3s: t1 <= 3500,
      body: snip(body2, 400),
    });
    await page.screenshot({ path: path.join(OUT, '03-session-switch.png') });
    // switch back
    await sessionSelect.selectOption({ index: 0 });
    await page.waitForTimeout(2000);
  }
}

// Open first media card if any
const card = page.locator('.td-file-card').first();
if ((await card.count()) > 0) {
  const t0 = Date.now();
  await card.dblclick({ timeout: 5000 }).catch(async () => {
    await card.click();
  });
  await page.waitForTimeout(3000);
  const ms = Date.now() - t0;
  const modal = page.locator('.drive-preview-modal, [class*="preview"]');
  const modalVisible = (await modal.count()) > 0;
  const video = page.locator('video');
  const hasVideo = (await video.count()) > 0;
  let readyState = null;
  if (hasVideo) {
    readyState = await video.first().evaluate((v) => v.readyState).catch(() => null);
  }
  step('preview_open', {
    ms,
    pass_3s: ms <= 3500,
    modalVisible,
    hasVideo,
    readyState,
  });
  await page.screenshot({ path: path.join(OUT, '04-preview.png') });
  // close modal Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
} else {
  step('preview_open', { skipped: true, reason: 'no cards' });
}

// Console errors
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.waitForTimeout(300);
// pull existing via evaluate
const consoleHint = await page
  .evaluate(() => performance.now())
  .catch(() => 0);
step('perf_now', { consoleHint });

fs.writeFileSync(path.join(OUT, 'e2e-report.json'), JSON.stringify(results, null, 2));
console.log('REPORT', path.join(OUT, 'e2e-report.json'));
// don't close browser — would close the app WebView
process.exit(0);
