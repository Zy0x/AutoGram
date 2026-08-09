import fs from 'node:fs';
import path from 'node:path';
import { connect, loadPlaywright } from './core/remote_connector.mjs';

const config = JSON.parse(fs.readFileSync(new URL('./config/remote_config.json', import.meta.url), 'utf8'));
const TARGET_MESSAGE_ID = 1618;
const TARGET_PEER_ID = '-1003319619788';
const TARGET_FILE_FRAGMENT = '7388384354787349504';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openTarget(page) {
  if (await page.locator('.settings-page').count()) {
    await page.locator('.settings-back-button').first().click();
    await sleep(500);
  }
  while (await page.locator('.drive-preview-modal').count()) {
    const close = page.locator('.drive-preview-modal .drive-preview-close').last();
    if (await close.count()) await close.click({ force: true });
    else await page.keyboard.press('Escape');
    await sleep(150);
  }
  if (await page.locator('.td-tools-panel').count()) {
    await page.locator('.td-tools-close').first().click({ force: true });
    await sleep(200);
  }
  const openModal = page.locator('.drive-preview-modal').first();
  if ((await openModal.count()) && (await openModal.innerText()).includes(TARGET_FILE_FRAGMENT)) {
    await page.locator('.drive-preview-modal video').waitFor({ state: 'attached', timeout: 45_000 });
    return;
  }
  if (await page.locator('.drive-preview-modal').count()) {
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  const currentSession = await page.locator('.td-sidebar-session .td-modern-select-value').first().innerText().catch(() => '');
  if (!(await page.locator('.td-explorer').count()) || !/Mantan Gadis/i.test(currentSession)) {
    await page.evaluate((peerId) => {
      const original = {
        defaultSession: localStorage.getItem('autogram_default_session'),
        startupBehavior: localStorage.getItem('autogram_startup_behavior'),
        appMode: localStorage.getItem('autogram_app_mode'),
      };
      sessionStorage.setItem('autogram_qa_navigation_state', JSON.stringify(original));
      localStorage.setItem('autogram_default_session', 'Mantan Gadis');
      localStorage.setItem('autogram_drive_session', 'Mantan Gadis');
      localStorage.setItem('autogram_startup_behavior', 'drives');
      localStorage.setItem('autogram_app_mode', 'drives');
      localStorage.setItem(
        'autogram_drive_peer_v2_Mantan%20Gadis',
        JSON.stringify({ kind: 'chat', id: Number(peerId) }),
      );
      location.reload();
    }, TARGET_PEER_ID);
    await page.waitForTimeout(2_500);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.locator('.td-explorer').waitFor({ state: 'visible', timeout: 45_000 });
    await page.locator('.td-sidebar-session .td-modern-select-value').filter({ hasText: /Mantan Gadis/i }).waitFor({
      state: 'visible',
      timeout: 45_000,
    });
    await sleep(750);
  }

  const exactLocation = page.locator(`[data-peer-id="${TARGET_PEER_ID}"]`).first();
  if (await exactLocation.count()) {
    await exactLocation.click();
  } else {
    const locationSearch = page.locator('.td-location-search input').first();
    if (await locationSearch.count()) {
      await locationSearch.fill('myanmar');
      await sleep(750);
    }
    const recent = page.getByText(/myanmar/i).first();
    const foundBySearch = await recent.waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (foundBySearch) {
      await recent.click();
    } else {
      await page.evaluate((peerId) => {
        sessionStorage.setItem(
          'autogram_qa_previous_default_session',
          localStorage.getItem('autogram_default_session') || '',
        );
        localStorage.setItem('autogram_drive_session', 'Mantan Gadis');
        // Startup precedence intentionally prefers the default account. Use a
        // temporary QA default so a cold reload stays on the target session;
        // it is restored immediately after the explorer mounts.
        localStorage.setItem('autogram_default_session', 'Mantan Gadis');
        localStorage.setItem(
          'autogram_drive_peer_v2_Mantan%20Gadis',
          JSON.stringify({ kind: 'chat', id: Number(peerId) })
        );
        location.reload();
      }, TARGET_PEER_ID);
      await page.waitForTimeout(2_000);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      if (!(await page.locator('.td-explorer').count())) {
        const launchButtons = page.locator('button').filter({ hasText: /cloud drives|open drives|buka drive/i });
        await launchButtons.first().waitFor({ state: 'visible', timeout: 30_000 });
        await launchButtons.first().click();
      }
      await page.locator('.td-explorer').waitFor({ state: 'visible', timeout: 45_000 });
      await page.evaluate(() => {
        const previous = sessionStorage.getItem('autogram_qa_previous_default_session');
        if (previous) localStorage.setItem('autogram_default_session', previous);
        else localStorage.removeItem('autogram_default_session');
        sessionStorage.removeItem('autogram_qa_previous_default_session');
      });
    }
  }

  const search = page.locator('.td-search input, input[placeholder*="Search files"], input[placeholder*="Cari file"]').first();
  if (await search.count()) {
    // Numeric search triggers the app's scoped driveGetFile fallback when the
    // virtualized initial page has not loaded this Telegram message yet.
    await search.fill(String(TARGET_MESSAGE_ID));
    await sleep(1_500);
  }

  const card = page.locator(`[data-msg-id="${TARGET_MESSAGE_ID}"]`).first();
  await card.waitFor({ state: 'visible', timeout: 45_000 });
  console.log(JSON.stringify({
    phase: 'target-card',
    text: await card.innerText(),
    peerId: await card.getAttribute('data-peer-id'),
    className: await card.getAttribute('class'),
  }));
  await card.dblclick();
  await sleep(500);
  console.log(JSON.stringify({
    phase: 'after-open',
    modalCount: await page.locator('.drive-preview-modal').count(),
    videoCount: await page.locator('.drive-preview-modal video').count(),
    imageCount: await page.locator('.drive-preview-modal img').count(),
    bodyTail: (await page.locator('body').innerText()).slice(-1200),
  }));
  const video = page.locator('.drive-preview-modal video');
  await video.waitFor({ state: 'attached', timeout: 45_000 });
  await video.evaluate((element) => {
    element.muted = true;
    void element.play().catch(() => {});
  });
}

async function sampleVideo(page, second) {
  return page.evaluate((sampleSecond) => {
    const video = document.querySelector('.drive-preview-modal video');
    if (!(video instanceof HTMLVideoElement)) return { second: sampleSecond, found: false };
    const buffered = [];
    for (let index = 0; index < video.buffered.length; index += 1) {
      buffered.push([video.buffered.start(index), video.buffered.end(index)]);
    }
    return {
      second: sampleSecond,
      found: true,
      src: video.currentSrc || video.src,
      paused: video.paused,
      currentTime: video.currentTime,
      duration: video.duration,
      readyState: video.readyState,
      networkState: video.networkState,
      buffered,
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
    };
  }, second);
}

async function probeRanges(page, streamUrl) {
  return page.evaluate(async (url) => {
    const probes = [
      ['head', 'bytes=0-65535'],
      ['tail', 'bytes=-65536'],
    ];
    const output = [];
    for (const [label, range] of probes) {
      const started = performance.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(url, {
          headers: { Range: range },
          cache: 'no-store',
          signal: controller.signal,
        });
        const bytes = await response.arrayBuffer();
        output.push({
          label,
          range,
          status: response.status,
          contentRange: response.headers.get('content-range'),
          acceptRanges: response.headers.get('accept-ranges'),
          length: bytes.byteLength,
          elapsedMs: Math.round(performance.now() - started),
        });
      } catch (error) {
        output.push({
          label,
          range,
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Math.round(performance.now() - started),
        });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    return output;
  }, streamUrl);
}

async function main() {
  if (process.env.STATE_ONLY === '1') {
    const { chromium } = await loadPlaywright(config);
    const browser = await chromium.connectOverCDP(config.cdpUrl, { timeout: 8_000 });
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((candidate) => candidate.url().includes('localhost:1420')) || pages[0];
    console.log(JSON.stringify({
      modalCount: await page.locator('.drive-preview-modal').count(),
      videoCount: await page.locator('.drive-preview-modal video').count(),
      modalText: (await page.locator('.drive-preview-modal').first().innerText().catch(() => '')).slice(0, 1200),
    }, null, 2));
    process.exit(0);
  }
  const connection = await connect(config);
  const { page } = connection;
  page.setDefaultTimeout(30_000);
  try {
    await openTarget(page);
    const samples = [];
    for (let second = 1; second <= 20; second += 1) {
      await sleep(1_000);
      samples.push(await sampleVideo(page, second));
    }
    console.log(JSON.stringify({ phase: 'video-samples', samples }, null, 2));
    const streamUrl = samples.find((sample) => sample.src)?.src;
    const ranges = streamUrl ? await probeRanges(page, streamUrl) : [];
    const firstAdvancingSample = samples.find((sample) => sample.readyState >= 2 && sample.currentTime > 0);
    const maxCurrentTime = Math.max(0, ...samples.map((sample) => Number(sample.currentTime) || 0));
    const result = {
      target: { peerId: TARGET_PEER_ID, messageId: TARGET_MESSAGE_ID },
      samples,
      ranges,
      startupSecond: firstAdvancingSample?.second ?? null,
      maxCurrentTime,
      passed: Boolean(firstAdvancingSample && firstAdvancingSample.second <= 10) &&
        maxCurrentTime >= 5 &&
        ranges.every((probe) => probe.status === 206 && probe.length > 0),
    };
    const suffix = process.env.REPORT_SUFFIX ? `-${process.env.REPORT_SUFFIX}` : '';
    const outputPath = path.resolve(`remote/reports/large-media-preview-matrix${suffix}.json`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 2;
  } finally {
    await page.evaluate(() => {
      const navigationRaw = sessionStorage.getItem('autogram_qa_navigation_state');
      if (navigationRaw) {
        const original = JSON.parse(navigationRaw);
        const restore = (key, value) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
        restore('autogram_default_session', original.defaultSession);
        restore('autogram_startup_behavior', original.startupBehavior);
        restore('autogram_app_mode', original.appMode);
        sessionStorage.removeItem('autogram_qa_navigation_state');
      }
      const previous = sessionStorage.getItem('autogram_qa_previous_default_session');
      if (previous !== null) {
        if (previous) localStorage.setItem('autogram_default_session', previous);
        else localStorage.removeItem('autogram_default_session');
        sessionStorage.removeItem('autogram_qa_previous_default_session');
      }
    }).catch(() => {});
    connection.dispose();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
