/** Remote QA for quota-bounded Media Studio preview seeking. Never closes CDP browser. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve('AutoGram App/frontend/node_modules/playwright'));
const reportPath = path.resolve('remote/reports/preview-random-seek-qa.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bytesFromLabel(label) {
  const match = String(label || '').match(/([\d.]+)\s*(KB|MB|GB)/i);
  if (!match) return 0;
  const unit = match[2].toUpperCase();
  const scale = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024;
  return Number(match[1]) * scale;
}

async function appPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (/1420|tauri/i.test(page.url())) return page;
    }
  }
  return null;
}

async function rangeProbe(page, url, start, length) {
  return page.evaluate(async ({ src, offset, size }) => {
    const response = await fetch(src, {
      cache: 'no-store',
      headers: { Range: `bytes=${offset}-${offset + size - 1}` },
    });
    const body = await response.arrayBuffer();
    const headers = Object.fromEntries([...response.headers.entries()]);
    return { status: response.status, bytes: body.byteLength, headers };
  }, { src: url, offset: start, size: length });
}

async function ensureVideoLocation(page) {
  const visibleVideos = page.locator('[data-drive-file="1"].is-video:visible');
  if (await visibleVideos.count()) return;

  // A desktop restart can restore a lightweight/cached location before the
  // last media topic. Prefer the known video-heavy recent location, then scan
  // other recent locations without mutating Telegram data.
  const recents = page.locator('.td-recent-chip:visible');
  const count = await recents.count();
  const candidates = [];
  for (let index = 0; index < count; index++) {
    const label = (await recents.nth(index).innerText().catch(() => '')).trim();
    candidates.push({ index, label, preferred: /VAM\s*3D/i.test(label) });
  }
  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred));

  for (const candidate of candidates.slice(0, 5)) {
    await recents.nth(candidate.index).click().catch(() => undefined);
    try {
      await visibleVideos.first().waitFor({ state: 'visible', timeout: 8_000 });
      return;
    } catch {
      // Continue to the next read-only location.
    }
  }
}

async function main() {
  const directRangeProbe = process.env.PREVIEW_QA_DIRECT_PROBE !== '0';
  const report = { startedAt: new Date().toISOString(), passed: false, directRangeProbe };
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 20_000 });
  const page = await appPage(browser);
  if (!page) throw new Error('AutoGram WebView page not found');

  page.on('console', msg => console.log(`[PAGE LOG] [${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.error(`[PAGE ERROR] ${err.message}`));
  page.on('requestfailed', request => console.warn(`[PAGE REQ FAILED] ${request.url()} - ${request.failure()?.errorText}`));
  page.on('request', request => {
    if (request.url().includes('/stream/')) {
      console.log(`[PAGE REQ] ${request.method()} ${request.url()} range: ${request.headers()['range'] || 'none'}`);
    }
  });
  page.on('response', response => {
    if (response.url().includes('/stream/')) {
      console.log(`[PAGE RES] ${response.status()} ${response.url()} content-range: ${response.headers()['content-range'] || 'none'}`);
    }
  });


  await page.keyboard.press('Escape').catch(() => undefined);
  const videoCardsCount = await page.locator('[data-drive-file="1"].is-video:visible').count().catch(() => 0);
  if (videoCardsCount === 0) {
    const isConnected = () => page.evaluate(() =>
      /Drive terhubung|\d+\s*ms\s*[·•]\s*(Sangat\s+)?Kuat/i.test(document.body.innerText || '')
    );
    if (!(await isConnected())) {
      const loadButton = page.getByRole('button', { name: /^Muat$/i }).first();
      if (await loadButton.isVisible().catch(() => false)) {
        await loadButton.click().catch(() => undefined);
      }
      await page.waitForFunction(() =>
        /Drive terhubung|\d+\s*ms\s*[·•]\s*(Sangat\s+)?Kuat/i.test(document.body.innerText || ''),
        null,
        { timeout: 15_000 }
      ).catch(() => undefined);
    }
  }

  await ensureVideoLocation(page);
  const cards = page.locator('[data-drive-file="1"].is-video:visible');
  const count = await cards.count();
  if (!count) throw new Error('No visible video card for preview QA');
  let chosen = cards.first();
  let chosenSize = 0;
  for (let index = 0; index < count; index++) {
    const card = cards.nth(index);
    const size = bytesFromLabel(await card.locator('.td-file-card-size').innerText().catch(() => ''));
    if (size > chosenSize) {
      chosen = card;
      chosenSize = size;
    }
  }
  report.card = {
    messageId: await chosen.getAttribute('data-msg-id'),
    title: await chosen.getAttribute('title'),
    declaredBytes: Math.round(chosenSize),
  };
  if (chosenSize < 50 * 1024 * 1024) throw new Error('QA requires a visible video >= 50 MB');

  await chosen.dblclick();
  const video = page.locator('.drive-preview-modal video').first();
  await video.waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForFunction(() => {
    const element = document.querySelector('.drive-preview-modal video');
    return element && element.currentSrc && Number.isFinite(element.duration) && element.duration > 1;
  }, null, { timeout: 60_000 });

  const meta = await video.evaluate((element) => ({
    src: element.currentSrc || element.src,
    duration: element.duration,
    readyState: element.readyState,
  }));
  report.video = meta;

  const head = await rangeProbe(page, meta.src, 0, 64 * 1024);
  const contentRange = head.headers['content-range'] || '';
  const total = Number(contentRange.split('/')[1] || chosenSize || 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error(`Missing total size: ${contentRange}`);
  const farOffset = Math.floor(total * 0.72);
  const far = directRangeProbe
    ? await rangeProbe(page, meta.src, farOffset, 256 * 1024)
    : null;
  report.range = { total, farOffset, head, far };

  const targetTime = meta.duration * 0.72;
  await video.evaluate((element, target) => {
    element.currentTime = target;
    void element.play().catch(() => undefined);
  }, targetTime);

  const seekStarted = Date.now();
  await page.waitForFunction((target) => {
    const element = document.querySelector('.drive-preview-modal video');
    if (!element || element.seeking || element.readyState < 2) return false;
    if (Math.abs(element.currentTime - target) > 3) return false;
    for (let index = 0; index < element.buffered.length; index++) {
      if (target >= element.buffered.start(index) - 1 && target <= element.buffered.end(index) + 1) {
        return true;
      }
    }
    return false;
  }, targetTime, { timeout: 45_000 });

  const finalVideo = await video.evaluate((element) => ({
    currentTime: element.currentTime,
    duration: element.duration,
    readyState: element.readyState,
    buffered: Array.from({ length: element.buffered.length }, (_, index) => [
      element.buffered.start(index), element.buffered.end(index),
    ]),
  }));
  // Probe an already-filled byte. In UI-only timing mode this avoids fetching
  // an unrelated VBR byte estimate after the real browser seek has completed.
  const finalProbe = await rangeProbe(page, meta.src, directRangeProbe ? farOffset : 0, 64 * 1024);
  const filled = Number(finalProbe.headers['x-autogram-filled'] || far?.headers?.['x-autogram-filled'] || 0);
  report.seek = {
    targetTime,
    elapsedMs: Date.now() - seekStarted,
    filledBytes: filled,
    filledRatio: total > 0 ? filled / total : null,
    finalVideo,
  };

  report.passed =
    (!far || (far.status === 206 && far.bytes === 256 * 1024)) &&
    filled > 0 &&
    filled < total * 0.35 &&
    Math.abs(finalVideo.currentTime - targetTime) <= 3;

  await page.keyboard.press('Escape').catch(() => undefined);
  await sleep(500);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ passed: report.passed, card: report.card, seek: report.seek })}\n`);
  process.exit(report.passed ? 0 : 2);
}

main().catch(async (error) => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: String(error?.stack || error) }, null, 2));
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exit(1);
});
