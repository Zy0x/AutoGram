import fs from 'node:fs';
import path from 'node:path';
import { ensureDirs, SUITE_ROOT } from './core/paths.mjs';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(
  fs.readFileSync(path.join(SUITE_ROOT, 'config', 'remote_config.json'), 'utf8')
);

async function probe() {
  ensureDirs();
  console.log('[probe] Connecting to running AutoGram instance...');
  const conn = await connect(config);
  const page = conn.page;

  console.log('[probe] Connected! Page URL:', page.url());

  // Capture console logs
  const logs = [];
  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Evaluate DOM state
  const info = await page.evaluate(() => {
    const pingEl = document.querySelector('.td-conn-indicator, .td-sidebar-logo-dot, [title*="ms"], [title*="Kuat"]');
    const pingText = pingEl ? pingEl.innerText || pingEl.getAttribute('title') || 'found' : 'not found';

    const qualityBtns = Array.from(document.querySelectorAll('button, span, div'))
      .filter(el => /Hemat|Seimbang|Jelas/i.test(el.innerText || ''))
      .map(el => ({ text: el.innerText.trim(), className: el.className }));

    const cards = Array.from(document.querySelectorAll('.td-card, [class*="card"], [class*="grid-item"], [class*="DriveFileCard"]'));
    const thumbs = Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src ? (img.src.slice(0, 50) + '... (len ' + img.src.length + ')') : 'empty',
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      complete: img.complete,
      class: img.className
    }));

    const noPreviewLabels = Array.from(document.querySelectorAll('*'))
      .filter(el => (el.innerText || '').includes('TANPA PREVIEW') || (el.innerText || '').includes('Memuat...'))
      .map(el => el.innerText.trim());

    return {
      title: document.title,
      pingText,
      qualityBtns,
      cardsCount: cards.length,
      imgCount: thumbs.length,
      thumbsSample: thumbs.slice(0, 15),
      noPreviewLabels: noPreviewLabels.slice(0, 10),
      bodyTextSnippet: document.body?.innerText?.slice(0, 1000) || ''
    };
  });

  console.log('[probe] DOM Info:', JSON.stringify(info, null, 2));

  // Take screenshot
  const shotPath = path.join(SUITE_ROOT, 'reports', 'live_probe.png');
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log('[probe] Saved screenshot to:', shotPath);

  if (typeof conn.dispose === 'function') {
    await conn.dispose().catch(() => {});
  }
}

probe().catch(err => {
  console.error('[probe] Error:', err);
  process.exit(1);
});
