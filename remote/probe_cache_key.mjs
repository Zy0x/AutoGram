import fs from 'node:fs';
import path from 'node:path';
import { SUITE_ROOT } from './core/paths.mjs';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(
  fs.readFileSync(path.join(SUITE_ROOT, 'config', 'remote_config.json'), 'utf8')
);

async function probeCacheKey() {
  console.log('[probeCacheKey] Connecting...');
  const conn = await connect(config);
  const page = conn.page;

  const res = await page.evaluate(async () => {
    const cards = Array.from(document.querySelectorAll('.td-file-card'));
    const imgInfo = cards.slice(0, 5).map(card => {
      const img = card.querySelector('img');
      return {
        title: card.getAttribute('title'),
        imgSrc: img ? img.src : null,
        imgClass: img ? img.className : null,
      };
    });

    return {
      cardCount: cards.length,
      imgInfo,
      activeSessionLS: localStorage.getItem('autogram_drive_session'),
    };
  });

  console.log('[probeCacheKey] Result:', JSON.stringify(res, null, 2));
  if (typeof conn.dispose === 'function') {
    await conn.dispose().catch(() => {});
  }
}

probeCacheKey().catch(console.error);
