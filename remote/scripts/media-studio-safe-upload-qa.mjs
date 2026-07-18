/**
 * Remote Media Studio safety QA. Attaches to existing Tauri CDP and never calls browser.close().
 * Uploads only generated QA fixtures, records exact message IDs, then deletes only those IDs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve('AutoGram App/frontend/node_modules/playwright'));

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const targetPeerId = Number(process.env.AUTOGRAM_QA_PEER || -1003214112048);
const targetTopicId = Number(process.env.AUTOGRAM_QA_TOPIC || 5);
const fixtureDir = process.env.AUTOGRAM_QA_FIXTURES;
const reportPath = path.resolve('remote/reports/media-studio-safe-upload-qa.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (/1420|tauri/i.test(page.url())) return page;
    }
  }
  return null;
}

async function transferSnapshot(page) {
  return page.evaluate(() => {
    const transfer = window.transfer;
    if (!transfer) return null;
    return {
      active: !!transfer.active,
      overallPercent: Number(transfer.overallPercent || 0),
      items: (transfer.items || []).map((item) => ({
        index: item.index,
        name: item.name,
        status: item.status,
        messageId: Number(item.messageId || 0),
        error: item.error || null,
      })),
      banner: transfer.banner || null,
    };
  });
}

async function main() {
  if (!fixtureDir || !fs.existsSync(fixtureDir)) {
    throw new Error('AUTOGRAM_QA_FIXTURES harus menunjuk folder fixture dummy');
  }
  const files = fs.readdirSync(fixtureDir)
    .map((name) => path.join(fixtureDir, name))
    .filter((file) => fs.statSync(file).isFile())
    .sort();
  if (files.length !== 10) throw new Error(`Expected exactly 10 fixtures, got ${files.length}`);

  const browser = await chromium.connectOverCDP(CDP, { timeout: 20_000 });
  const page = await getPage(browser);
  if (!page) throw new Error('AutoGram WebView page not found');
  await page.waitForFunction(() => typeof window.triggerRemoteUpload === 'function', null, { timeout: 30_000 });

  const report = {
    startedAt: new Date().toISOString(),
    peerId: targetPeerId,
    topicId: targetTopicId,
    files: files.map((file) => path.basename(file)),
    snapshots: [],
    messageIds: [],
    cleanup: null,
  };
  await page.evaluate(
    ({ paths, peerId, topicId }) => window.triggerRemoteUpload(paths, peerId, topicId),
    { paths: files, peerId: targetPeerId, topicId: targetTopicId }
  );

  const deadline = Date.now() + 12 * 60_000;
  let seenActive = false;
  let final = null;
  while (Date.now() < deadline) {
    await sleep(1_000);
    const snapshot = await transferSnapshot(page);
    if (!snapshot) continue;
    if (snapshot.active) seenActive = true;
    if (report.snapshots.length === 0 || Date.now() % 5_000 < 1_100) {
      report.snapshots.push({ at: new Date().toISOString(), ...snapshot });
    }
    if (seenActive && !snapshot.active && snapshot.items.length >= files.length) {
      final = snapshot;
      break;
    }
  }
  if (!final) throw new Error('Transfer did not reach terminal state before timeout');

  const relevant = final.items.slice(-files.length);
  report.final = final;
  // Only delete messages that this run definitively committed. A skipped item may
  // point at an older duplicate and must never be included in destructive QA cleanup.
  report.messageIds = relevant
    .filter((item) => item.status === 'done')
    .map((item) => item.messageId)
    .filter((id) => id > 0);
  report.order = relevant.map((item) => ({ name: item.name, messageId: item.messageId }));
  report.passed =
    relevant.length === files.length &&
    relevant.every((item) => item.status === 'done' && item.messageId > 0) &&
    report.messageIds.every((id, index, ids) => index === 0 || id > ids[index - 1]);

  // Cleanup is scoped to the exact IDs produced by this run.
  if (report.messageIds.length) {
    await page.waitForFunction(
      () => typeof window.triggerRemoteDeleteMessages === 'function',
      null,
      { timeout: 10_000 }
    );
    await sleep(3_000); // wait for the Rust lease to release and warm session to restart
    let cleanupError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        report.cleanup = await page.evaluate(
          ({ ids, peerId }) => window.triggerRemoteDeleteMessages(ids, peerId),
          { ids: report.messageIds, peerId: targetPeerId }
        );
        cleanupError = null;
        break;
      } catch (error) {
        cleanupError = error;
        await sleep(1_500 * (attempt + 1));
      }
    }
    if (cleanupError) throw cleanupError;
  }

  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ passed: report.passed, messageIds: report.messageIds, cleanup: report.cleanup })}\n`);
  process.exit(report.passed ? 0 : 2);
}

main().catch((error) => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: String(error?.stack || error) }, null, 2));
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exit(1);
});
