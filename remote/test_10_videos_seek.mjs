import { execSync } from 'node:child_process';
import WebSocket from 'ws';

function cdpCmd(ws, method, params = {}) {
  return new Promise((res, rej) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        if (data.error) rej(data.error);
        else res(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let targets = [];
  let page = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    for (const url of [
      'http://127.0.0.1:9225/json/list',
      'http://localhost:9225/json/list',
      'http://127.0.0.1:9222/json/list',
      'http://localhost:9222/json/list'
    ]) {
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (Array.isArray(data)) {
          const found = data.find(t => t.type === 'page' && t.url && (t.url.includes('1420') || t.url.includes('localhost')));
          if (found) {
            targets = data;
            page = found;
            console.log(`Connected to CDP at ${url} (Target: ${page.title})`);
            break;
          }
        }
      } catch {}
    }
    if (page) break;
    await sleep(1500);
  }
  
  if (!page) {
    console.error('AutoGram page target (1420) not found in CDP list after 15s.');
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));

  await cdpCmd(ws, 'Runtime.enable');
  await cdpCmd(ws, 'Page.enable');

  console.log('--- Navigating to Topic or Media List ---');
  
  // 1. If on session selection screen, select session 'Lavender'
  await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const sel = document.querySelector('.td-select');
        if (sel) {
          const opt = Array.from(sel.options).find(o => o.text.includes('Lavender') || o.value.includes('Lavender'));
          if (opt) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        // Click connect button if present
        const connBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Hubungkan') || b.textContent.includes('Connect'));
        if (connBtn) connBtn.click();
      })()
    `
  });
  await sleep(3000);

  // 2. Select topic #Gudang or HAnime
  await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const hanime = Array.from(document.querySelectorAll('*')).find(el => el.children.length === 0 && (el.textContent.trim().includes('HAnime') || el.textContent.trim().includes('Gudang')));
        if (hanime) {
          (hanime.closest('button, div, a, li, .td-folder-row') || hanime).click();
        }
      })()
    `
  });
  await sleep(4000);

  // 3. Scan available video cards in DOM (filter videos and document MP4/MKV)
  const cardsRes = await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const cards = Array.from(document.querySelectorAll('[data-msg-id]'));
        return cards
          .map(c => {
            const txt = c.textContent.trim().replace(/\\s+/g, ' ');
            const isImage = txt.includes('.jpg') || txt.includes('.png') || txt.includes('photo_');
            return {
              msgId: c.getAttribute('data-msg-id'),
              text: txt,
              isDocMp4: txt.includes('.mp4') || txt.includes('.mkv') || txt.includes('file_'),
              isImage
            };
          })
          .filter(c => !c.isImage);
      })()
    `,
    returnByValue: true
  });

  const allCards = cardsRes.result.value || [];
  console.log(`Found ${allCards.length} video/document-video cards in DOM.`);

  const videoCards = allCards.slice(0, 15);
  const testResults = [];

  for (let idx = 0; idx < Math.min(10, videoCards.length); idx++) {
    const card = videoCards[idx];
    console.log(`\n==================================================`);
    console.log(`TEST SAMPLE ${idx + 1}/10: MsgID ${card.msgId} (DocMP4=${card.isDocMp4}) (${card.text.slice(0, 50)}...)`);
    console.log(`==================================================`);

    // Ensure modal is closed first
    await cdpCmd(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const closeBtn = document.querySelector('[aria-label="Close"], .lucide-x');
          if (closeBtn) closeBtn.click();
        })()
      `
    });
    await sleep(1000);

    // Double click card target element
    const dblRes = await cdpCmd(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const c = document.querySelector('[data-msg-id="${card.msgId}"]');
          if (c) {
            c.scrollIntoView({ block: 'center' });
            const target = c.querySelector('img, div, span') || c;
            const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
            const dblClickEvt = new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 });
            target.dispatchEvent(clickEvt);
            target.dispatchEvent(dblClickEvt);
            c.dispatchEvent(dblClickEvt);
            return true;
          }
          return false;
        })()
      `,
      returnByValue: true
    });

    if (!dblRes.result.value) {
      console.log(`Card ${card.msgId} not found to click.`);
      continue;
    }

    // Wait up to 12 seconds for video element & metadata ready (head + tail MOOV fetch)
    let initV = { hasVideo: false };
    for (let poll = 0; poll < 12; poll++) {
      await sleep(1000);
      const bootCheck = await cdpCmd(ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            const v = document.querySelector('video');
            if (!v) return { hasVideo: false };
            const buf = [];
            for (let j = 0; j < v.buffered.length; j++) {
              buf.push([+v.buffered.start(j).toFixed(2), +v.buffered.end(j).toFixed(2)]);
            }
            return {
              hasVideo: true,
              src: v.src,
              duration: isNaN(v.duration) ? 0 : +v.duration.toFixed(2),
              currentTime: +v.currentTime.toFixed(2),
              readyState: v.readyState,
              paused: v.paused,
              buffered: buf,
            };
          })()
        `,
        returnByValue: true
      });
      initV = bootCheck.result.value;
      if (initV.hasVideo && initV.duration > 0 && initV.readyState >= 1) {
        break;
      }
    }
    console.log(`Initial Boot State:`, JSON.stringify(initV));

    if (!initV.hasVideo || initV.duration <= 0) {
      console.log(`Sample ${card.msgId} has no playable video or metadata timeout.`);
      testResults.push({
        sample: idx + 1,
        msgId: card.msgId,
        label: card.text.slice(0, 40),
        duration: 'N/A',
        initialBoot: 'FAILED',
        seek25: 'N/A',
        seek50: 'N/A',
        seek75: 'N/A',
        status: 'FAIL'
      });
      continue;
    }

    // Perform Seek Tests at 25%, 50%, 75%
    const seekPoints = [
      { pct: 0.25, label: '25%' },
      { pct: 0.50, label: '50%' },
      { pct: 0.75, label: '75%' }
    ];

    const seekResults = [];

    for (const sp of seekPoints) {
      const targetTime = +(initV.duration * sp.pct).toFixed(2);
      console.log(`-> Performing SEEK to ${sp.label} (${targetTime}s)...`);

      await cdpCmd(ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            const v = document.querySelector('video');
            if (v) {
              v.currentTime = ${targetTime};
            }
          })()
        `
      });

      // Wait up to 6 seconds for buffer & playback after seek
      let ps = null;
      for (let pSeek = 0; pSeek < 6; pSeek++) {
        await sleep(1000);
        const postSeek = await cdpCmd(ws, 'Runtime.evaluate', {
          expression: `
            (() => {
              const v = document.querySelector('video');
              if (!v) return null;
              const buf = [];
              for (let j = 0; j < v.buffered.length; j++) {
                buf.push([+v.buffered.start(j).toFixed(2), +v.buffered.end(j).toFixed(2)]);
              }
              return {
                currentTime: +v.currentTime.toFixed(2),
                readyState: v.readyState,
                paused: v.paused,
                buffered: buf,
                error: v.error ? v.error.code : null
              };
            })()
          `,
          returnByValue: true
        });
        ps = postSeek.result.value;
        const isBufNow = ps && ps.buffered.some(([s, e]) => s <= targetTime + 2 && targetTime >= s - 2);
        if (isBufNow && ps.readyState >= 3) {
          break;
        }
      }

      console.log(`   Post-Seek State (${sp.label}):`, JSON.stringify(ps));

      // Check if seek point falls inside one of the buffered ranges
      const isBuffered = ps && ps.buffered.some(([s, e]) => s <= targetTime + 1 && targetTime >= s - 1);
      const isPlaying = ps && (!ps.paused || ps.readyState >= 3);
      const pass = isBuffered || isPlaying;

      seekResults.push({
        pct: sp.label,
        targetTime,
        buffered: isBuffered,
        playing: isPlaying,
        currTime: ps ? ps.currentTime : 0,
        status: pass ? 'OK' : 'STALL'
      });
    }

    const allPassed = seekResults.every(r => r.status === 'OK');

    testResults.push({
      sample: idx + 1,
      msgId: card.msgId,
      label: card.text.slice(0, 40),
      duration: `${initV.duration}s`,
      initialBoot: `readyState ${initV.readyState}`,
      seek25: seekResults[0] ? `${seekResults[0].status} (${seekResults[0].currTime}s)` : 'N/A',
      seek50: seekResults[1] ? `${seekResults[1].status} (${seekResults[1].currTime}s)` : 'N/A',
      seek75: seekResults[2] ? `${seekResults[2].status} (${seekResults[2].currTime}s)` : 'N/A',
      status: allPassed ? 'SUCCESS' : 'STALL_DETECTED'
    });

    // Close preview modal before next test
    await cdpCmd(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const closeBtn = document.querySelector('[aria-label="Close"], .lucide-x');
          if (closeBtn) closeBtn.click();
        })()
      `
    });
    await sleep(1500);
  }

  console.log('\n==================================================');
  console.log('SUMMARY REPORT: 10 SAMPLE VIDEOS SEEK TEST');
  console.log('==================================================');
  console.table(testResults);

  ws.close();
}

main().catch(console.error);
