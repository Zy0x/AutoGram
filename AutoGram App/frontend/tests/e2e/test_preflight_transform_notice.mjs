import chromium from 'playwright';

async function testPreflightNotice() {
  console.log('=== E2E TEST: PREFLIGHT TRANSFORM NOTICES & BADGES ===');
  
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('1420')) || context.pages()[0];
  
  console.log('Connected to Tauri page target:', page.url());
  
  // Trigger preflight IPC query for WebP files
  const webpFolder = 'E:\\Data\\Upload\\Upload Fix\\New Folder 2';
  const fs = await import('fs');
  const path = await import('path');
  
  const files = fs.readdirSync(webpFolder)
    .filter(f => f.endsWith('.webp') || f.endsWith('.jpg'))
    .map(f => path.join(webpFolder, f))
    .slice(0, 10);
    
  console.log(`Testing preflight query for ${files.length} files...`);
  
  const preflightResult = await page.evaluate(async (sourcePaths) => {
    try {
      const { invoke } = window.__TAURI_INTERNALS__ || {};
      if (!invoke) return { error: 'Tauri IPC not available' };
      
      const report = await invoke('studio_query_quality_preflight', {
        request: {
          session: 'me',
          apiId: 1,
          apiHash: 'test',
          paths: sourcePaths,
          qualityMode: 'SEIMBANG_PREVENT_STICKER',
          presentationOverride: 'automatic',
          groupAsAlbum: true,
          preventStickerConversion: true,
          oversizeAction: 'split',
          globalCaption: null,
          captionOverflowPolicy: 'truncate_with_warning',
          destinationId: '-1003214112048',
          topicId: 9929
        }
      });
      return { success: true, report };
    } catch (e) {
      return { error: e.toString() };
    }
  }, files);
  
  console.log('Preflight Query Result:', JSON.stringify(preflightResult, null, 2));
  
  await browser.close();
}

testPreflightNotice().catch(console.error);
