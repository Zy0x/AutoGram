/**
 * test_1869_playwright.mjs — Switch session to 'Mantan Gadis', navigate to #Gudang ~ HAnime,
 * open file_1869.mp4 preview, and verify rapid video startup & range streaming.
 */
import fs from 'node:fs';
import path from 'node:path';
import { connect } from './core/remote_connector.mjs';
import { SUITE_ROOT } from './core/paths.mjs';
import http from 'node:http';

const config = JSON.parse(
  fs.readFileSync(path.join(SUITE_ROOT, 'config', 'remote_config.json'), 'utf8')
);

function ts() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const log = (tag, data) => console.log(`[${ts()}][${tag}]`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));

async function main() {
  log('START', 'Connecting via Playwright CDP connector...');
  const { page, dispose } = await connect(config);

  try {
    log('STEP', '1 - Switch connected session if needed');
    
    // Check current selected session in dropdown
    const sessionInfo = await page.evaluate(() => {
      const select = document.querySelector('select');
      const options = select ? Array.from(select.options).map(o => o.text) : [];
      const current = select ? select.value : null;
      return { selectFound: !!select, current, options };
    });
    log('SESSION_INFO', sessionInfo);

    // If 'Lavender' is selected and 'Mantan Gadis' is available, switch to 'Mantan Gadis'
    if (sessionInfo.options.some(o => o.includes('Mantan Gadis'))) {
      log('SWITCH_SESSION', 'Switching to Mantan Gadis...');
      await page.evaluate(() => {
        const select = document.querySelector('select');
        if (select) {
          const opt = Array.from(select.options).find(o => o.text.includes('Mantan Gadis'));
          if (opt) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });
      await sleep(3000);
    }

    log('STEP', '2 - Navigate to #Gudang ~ HAnime or search 1869');
    
    // Click on topic in sidebar
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('button, div, a, span'));
      const target = items.find(el => el.textContent.includes('HAnime') || el.textContent.includes('Gudang ~ HAnime'));
      if (target) target.click();
    });

    await sleep(2000);

    // Search 1869 if search input exists
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="Search"], input[placeholder*="Cari"]');
      if (input) {
        input.value = '1869';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    await sleep(2000);
    await page.screenshot({ path: path.join(SUITE_ROOT, 'reports', 'test_1869_01_topic.png') });

    log('STEP', '3 - Find and double-click file_1869.mp4 card');
    const cardRes = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.media-card, [class*="card"], div, article'));
      const card = cards.find(c => c.textContent.includes('1869') || c.textContent.includes('379.90'));
      if (card) {
        card.scrollIntoView({ block: 'center' });
        card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        return { found: true, text: card.textContent.slice(0, 60) };
      }
      return { found: false, totalCards: cards.length };
    });
    log('CARD_CLICK', cardRes);

    await sleep(4000);
    await page.screenshot({ path: path.join(SUITE_ROOT, 'reports', 'test_1869_02_modal.png') });

    log('STEP', '4 - Monitor video buffering & range streaming progress for 30s');
    for (let i = 0; i < 15; i++) {
      const vState = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return { hasVideo: false };
        const buf = [];
        for (let j = 0; j < v.buffered.length; j++) {
          buf.push([+v.buffered.start(j).toFixed(2), +v.buffered.end(j).toFixed(2)]);
        }
        return {
          hasVideo: true,
          src: v.src,
          currentTime: +v.currentTime.toFixed(2),
          duration: isNaN(v.duration) ? 'NaN' : +v.duration.toFixed(2),
          readyState: v.readyState,
          networkState: v.networkState,
          paused: v.paused,
          buffered: buf,
          videoWidth: v.videoWidth,
          videoHeight: v.videoHeight,
          error: v.error ? v.error.code : null,
        };
      });

      log(`VIDEO_STATE_${String(i).padStart(2,'0')}`, vState);

      if (vState.hasVideo && vState.src && i === 1) {
        log('STREAM_URL', vState.src);
        if (vState.src.startsWith('http')) {
          // Direct range probe 0-64K
          try {
            const probe = await new Promise((res, rej) => {
              const req = http.request(vState.src, { method: 'GET', headers: { 'Range': 'bytes=0-65535' } }, r => {
                let size = 0;
                r.on('data', c => size += c.length);
                r.on('end', () => res({ status: r.statusCode, cr: r.headers['content-range'], size }));
              });
              req.on('error', rej);
              req.end();
            });
            log('HTTP_RANGE_0_64K', probe);
          } catch(e) { log('PROBE_ERR_1', e.message); }

          // Direct range probe suffix (last 2MB for MOOV)
          try {
            const suffixProbe = await new Promise((res, rej) => {
              const req = http.request(vState.src, { method: 'GET', headers: { 'Range': 'bytes=-2097152' } }, r => {
                let size = 0;
                r.on('data', c => size += c.length);
                r.on('end', () => res({ status: r.statusCode, cr: r.headers['content-range'], size }));
              });
              req.on('error', rej);
              req.end();
            });
            log('HTTP_RANGE_SUFFIX_2M', suffixProbe);
          } catch(e) { log('PROBE_ERR_2', e.message); }
        }
      }

      await sleep(2000);
    }

    await page.screenshot({ path: path.join(SUITE_ROOT, 'reports', 'test_1869_03_final.png') });
    log('DONE', 'Test finished');

  } finally {
    dispose();
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
