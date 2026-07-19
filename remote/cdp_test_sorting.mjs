import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

async function run() {
  console.log('Fetching CDP targets...');
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const pageTarget = targets.find(t => t.type === 'page' && (t.url.includes('1420') || t.url.includes('tauri')));
  
  if (!pageTarget) {
    console.error('Page target not found');
    return;
  }
  
  console.log('Connecting to Page WebSocket:', pageTarget.webSocketDebuggerUrl);
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  
  let msgId = 1;
  const sendRPC = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const onMessage = (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.id === id) {
          ws.off('message', onMessage);
          if (parsed.error) reject(parsed.error);
          else resolve(parsed.result);
        }
      };
      ws.on('message', onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  
  ws.on('open', async () => {
    console.log('CDP Connection Opened!');
    try {
      await sendRPC('Runtime.enable');
      await sendRPC('Page.enable');
      
      // 1. Switch to #Gudang folder in sidebar
      console.log('Selecting #Gudang folder in sidebar...');
      await sendRPC('Runtime.evaluate', {
        expression: `
          (() => {
            const items = Array.from(document.querySelectorAll('*'));
            const gudang = items.find(el => {
              const text = el.innerText || '';
              return text.trim() === '#Gudang ~ NSFW' && (
                el.className.includes('item') || 
                el.className.includes('row') || 
                el.className.includes('name') ||
                el.getAttribute('data-peer-id')
              );
            });
            if (gudang) {
              gudang.click();
              return 'Clicked #Gudang ~ NSFW';
            }
            return 'Could not find #Gudang button directly';
          })()
        `,
        returnByValue: true
      });
      
      // Wait for files to load
      await new Promise(r => setTimeout(r, 6000));
      
      // 2. Click sort dropdown
      console.log('Opening sort dropdown...');
      await sendRPC('Runtime.evaluate', {
        expression: `
          (() => {
            const selectBtn = document.querySelector('.td-modern-select.td-sort');
            if (selectBtn) {
              selectBtn.click();
              return 'Dropdown clicked';
            }
            return 'Sort button not found';
          })()
        `,
        returnByValue: true
      });
      
      // Wait for menu to render
      await new Promise(r => setTimeout(r, 500));
      
      // Click Terlama dulu (Oldest)
      console.log('Clicking Terlama dulu...');
      const sortOldestRes = await sendRPC('Runtime.evaluate', {
        expression: `
          (() => {
            const menu = document.querySelector('.td-modern-select-menu');
            if (!menu) return 'Menu not found';
            const btns = Array.from(menu.querySelectorAll('button[role="option"]'));
            const targetBtn = btns.find(b => b.innerText.includes('Terlama'));
            if (targetBtn) {
              targetBtn.click();
              return 'Terlama clicked';
            }
            return 'Terlama option not found';
          })()
        `,
        returnByValue: true
      });
      console.log('Click Result:', sortOldestRes.result.value);
      
      // Wait for list to update
      await new Promise(r => setTimeout(r, 6000));
      
      // Capture oldest files listed
      const oldestFilesEval = await sendRPC('Runtime.evaluate', {
        expression: `
          (() => {
            const names = Array.from(document.querySelectorAll('.td-file-card-name'))
              .map(el => (el.innerText || el.textContent || '').trim());
            return {
              count: names.length,
              files: names.slice(0, 15)
            };
          })()
        `,
        returnByValue: true
      });
      const oldestFiles = oldestFilesEval.result.value;
      console.log('\n--- OLDEST FILES (Terlama dulu) ---');
      console.log(JSON.stringify(oldestFiles, null, 2));
      
      // Capture screenshot for oldest sorting
      let screenshotRes = await sendRPC('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync('f:/AutoGram/remote/reports/screenshots/01_sort_oldest.png', Buffer.from(screenshotRes.data, 'base64'));
      console.log('Saved oldest sorting screenshot.');
      
      // 3. Click sort dropdown
      console.log('\nOpening sort dropdown again...');
      await sendRPC('Runtime.evaluate', {
        expression: `
          (() => {
            const selectBtn = document.querySelector('.td-modern-select.td-sort');
            if (selectBtn) {
              selectBtn.click();
              return 'Dropdown clicked';
            }
            return 'Sort button not found';
          })()
        `,
        returnByValue: true
      });
      
      // Wait for menu to render
      await new Promise(r => setTimeout(r, 500));
      
      // Click Terbaru dulu (Newest)
      console.log('Clicking Terbaru dulu...');
      const sortNewestRes = await sendRPC('Runtime.evaluate', {
        expression: `
          (() => {
            const menu = document.querySelector('.td-modern-select-menu');
            if (!menu) return 'Menu not found';
            const btns = Array.from(menu.querySelectorAll('button[role="option"]'));
            const targetBtn = btns.find(b => b.innerText.includes('Terbaru'));
            if (targetBtn) {
              targetBtn.click();
              return 'Terbaru clicked';
            }
            return 'Terbaru option not found';
          })()
        `,
        returnByValue: true
      });
      console.log('Click Result:', sortNewestRes.result.value);
      
      // Wait for list to update
      await new Promise(r => setTimeout(r, 6000));
      
      // Capture newest files listed
      const newestFilesEval = await sendRPC('Runtime.evaluate', {
        expression: `
          (() => {
            const names = Array.from(document.querySelectorAll('.td-file-card-name'))
              .map(el => (el.innerText || el.textContent || '').trim());
            return {
              count: names.length,
              files: names.slice(0, 15)
            };
          })()
        `,
        returnByValue: true
      });
      const newestFiles = newestFilesEval.result.value;
      console.log('\n--- NEWEST FILES (Terbaru dulu) ---');
      console.log(JSON.stringify(newestFiles, null, 2));
      
      // Capture screenshot for newest sorting
      screenshotRes = await sendRPC('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync('f:/AutoGram/remote/reports/screenshots/02_sort_newest.png', Buffer.from(screenshotRes.data, 'base64'));
      console.log('Saved newest sorting screenshot.');
      
      // 4. Verify Accuracy
      const isDivergent = oldestFiles.files.length > 0 && newestFiles.files.length > 0 && oldestFiles.files[0] !== newestFiles.files[0];
      console.log('\n--- VERIFICATION VERDICT ---');
      if (isDivergent) {
        console.log('SUCCESS: Time-based sorting works correctly! The files listed in Terlama dulu differ from Terbaru dulu.');
        fs.writeFileSync('f:/AutoGram/remote/reports/last-run-status.txt', 'OK - Sorting verification passed successfully!');
      } else {
        console.warn('WARNING: The file lists did not differ. Check if folder contains enough files or if list failed to load.');
        fs.writeFileSync('f:/AutoGram/remote/reports/last-run-status.txt', 'FAIL - Sorting verification failed or file list empty');
      }
      
    } catch (err) {
      console.error('Error during CDP interaction:', err);
    } finally {
      ws.close();
    }
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket Error:', err);
  });
}

run().catch(console.error);
