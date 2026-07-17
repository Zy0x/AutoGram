import path from 'node:path';
import fs from 'node:fs';
import { SHOTS_DIR, ensureDirs, stamp } from './paths.mjs';
import { log } from './logger.mjs';

ensureDirs();

export async function capture(page, label = 'shot') {
  ensureDirs();
  const safe = String(label).replace(/[^\w.-]+/g, '_').slice(0, 80);
  const file = path.join(SHOTS_DIR, `${stamp()}_${safe}.png`);
  try {
    await page.screenshot({ path: file, fullPage: false });
    log.info('screenshot', { file });
    return file;
  } catch (e) {
    log.warn('screenshot_fail', { err: String(e.message || e) });
    return null;
  }
}

/** Lightweight “OCR”: extract body text for assertions */
export async function extractText(page, max = 4000) {
  return page.evaluate((n) => (document.body?.innerText || '').slice(0, n), max);
}
