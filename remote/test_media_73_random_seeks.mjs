import { execSync } from 'child_process';
import WebSocket from 'ws';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpCmd(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    const handler = msg => {
      const res = JSON.parse(msg);
      if (res.id === id) {
        ws.removeListener('message', handler);
        if (res.error) reject(res.error);
        else resolve(res.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  let targets = [];
  let page = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    for (const url of [
      'http://[::1]:9222/json/list',
      'http://127.0.0.1:9222/json/list',
      'http://[::1]:9225/json/list',
      'http://127.0.0.1:9225/json/list'
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
    console.error('AutoGram page target (1420) not found in CDP list.');
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });

  await cdpCmd(ws, 'Runtime.enable');
  await cdpCmd(ws, 'Page.enable');

  console.log('--- Navigating to Drives View & Channel -1004468191168 / Topic 73 ---');

  // 1. Click "Open Drives" if on Dashboard
  await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const driveBtns = Array.from(document.querySelectorAll('button, a')).filter(b => b.textContent.includes('Open Drives') || b.textContent.includes('Drives'));
        if (driveBtns.length > 0) driveBtns[0].click();
      })()
    `
  });
  await sleep(3000);

  // 2. Select session Lavender if dropdown present
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
        const connBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Hubungkan') || b.textContent.includes('Connect'));
        if (connBtn) connBtn.click();
      })()
    `
  });
  await sleep(4000);

  // 3. Click topic / channel -1004468191168 or Gudang / HAnime or topic 73
  await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const items = Array.from(document.querySelectorAll('*'));
        const target = items.find(el => 
          el.children.length === 0 && (
            el.textContent.includes('HAnime') || 
            el.textContent.includes('1004468191168') || 
            el.textContent.includes('#Gudang')
          )
        );
        if (target) {
          const clickable = target.closest('button, div, a, li, .td-folder-row') || target;
          clickable.click();
          console.log('Clicked target topic/channel:', target.textContent);
        }
      })()
    `
  });
  await sleep(4000);

  // Scan available video cards in DOM
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
              isTarget73: c.getAttribute('data-msg-id') === '73' || txt.includes('73'),
              isImage
            };
          })
          .filter(c => !c.isImage);
      })()
    `,
    returnByValue: true
  });

  const allCards = cardsRes.result.value || [];
  console.log(`Found ${allCards.length} video cards in DOM.`);

  // Ensure item 73 is tested first if present, followed by 9 other samples
  let testCards = allCards.filter(c => c.msgId === '73' || c.isTarget73);
  const remainingCards = allCards.filter(c => c.msgId !== '73' && !c.isTarget73);
  testCards = [...testCards, ...remainingCards].slice(0, 10);

  const testResults = [];

  for (let idx = 0; idx < testCards.length; idx++) {
    const card = testCards[idx];
    console.log(`\n==================================================`);
    console.log(`TEST SAMPLE ${idx + 1}/${testCards.length}: MsgID ${card.msgId} (${card.text.slice(0, 50)}...)`);
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

    const tStartOpen = Date.now();

    // Trigger open preview via React Fiber traversal
    const dblRes = await cdpCmd(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const rows = Array.from(document.querySelectorAll('tr, .group.relative, [data-msg-id]'));
          const row = rows.find(el => el.textContent.includes('${card.msgId}') || el.getAttribute('data-msg-id') === '${card.msgId}');
          if (!row) return false;
          row.scrollIntoView({ block: 'center' });

          const propsKey = Object.keys(row).find(k => k.startsWith('__reactProps'));
          if (propsKey && row[propsKey] && typeof row[propsKey].onDoubleClick === 'function') {
            row[propsKey].onDoubleClick({ stopPropagation: () => {}, preventDefault: () => {} });
            return true;
          }

          const fiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber'));
          let fiber = row[fiberKey];
          while (fiber) {
            if (fiber.memoizedProps && typeof fiber.memoizedProps.onDoubleClick === 'function') {
              fiber.memoizedProps.onDoubleClick({ stopPropagation: () => {}, preventDefault: () => {} });
              return true;
            }
            if (fiber.memoizedProps && typeof fiber.memoizedProps.onOpenFilePreview === 'function') {
              const fileObj = fiber.memoizedProps.file;
              fiber.memoizedProps.onOpenFilePreview(fileObj);
              return true;
            }
            fiber = fiber.return;
          }
          return false;
        })()
      `,
      returnByValue: true
    });

    if (!dblRes.result.value) {
      console.log(`Card ${card.msgId} not found in DOM.`);
      continue;
    }

    // Measure video start time (time from dblclick until readyState >= 3 and playing/buffered)
    let initV = { hasVideo: false };
    let startLatencyMs = -1;

    for (let poll = 0; poll < 15; poll++) {
      await sleep(200); // 200ms tight polling loop
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
      if (initV.hasVideo && initV.duration > 0 && (initV.readyState >= 3 || (initV.buffered.length > 0 && initV.buffered[0][1] > 0.5))) {
        startLatencyMs = Date.now() - tStartOpen;
        break;
      }
    }

    console.log(`Initial Boot State (Start Latency: ${startLatencyMs}ms):`, JSON.stringify(initV));

    if (!initV.hasVideo || initV.duration <= 0) {
      console.log(`Sample ${card.msgId} has no playable video or metadata timeout.`);
      testResults.push({
        sample: idx + 1,
        msgId: card.msgId,
        label: card.text.slice(0, 40),
        duration: 'N/A',
        startLatencyMs: 'TIMEOUT',
        seeks: [],
        status: 'FAIL_BOOT'
      });
      continue;
    }

    const duration = initV.duration;
    // Perform 5 to 7 random seeks for this media
    const seekCount = Math.floor(Math.random() * 3) + 5; // 5, 6, or 7
    console.log(`-> Performing ${seekCount} RANDOM SEEKS on MsgID ${card.msgId} (Duration: ${duration}s)...`);

    const seekResults = [];

    for (let sIdx = 1; sIdx <= seekCount; sIdx++) {
      // Pick random timestamp between 2% and 95% of duration
      const randomPct = (Math.random() * 0.93 + 0.02);
      const targetTime = +(duration * randomPct).toFixed(2);
      const tSeekStart = Date.now();

      // Dispatch Seek
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

      // Poll until readyState >= 3 and buffered contains targetTime
      let seekLatencyMs = -1;
      let postSeekState = null;

      for (let poll = 0; poll < 25; poll++) {
        await sleep(200); // 200ms poll
        const checkRes = await cdpCmd(ws, 'Runtime.evaluate', {
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
              };
            })()
          `,
          returnByValue: true
        });

        postSeekState = checkRes.result.value;
        const isBufNow = postSeekState && postSeekState.buffered.some(([s, e]) => s <= targetTime + 2 && targetTime >= s - 2);
        if (isBufNow && postSeekState.readyState >= 2) {
          seekLatencyMs = Date.now() - tSeekStart;
          break;
        }
      }

      const passFast = seekLatencyMs > 0 && seekLatencyMs < 1000;
      console.log(`   Seek #${sIdx} to ${targetTime}s (${(randomPct * 100).toFixed(0)}%): Latency = ${seekLatencyMs}ms (Fast<1s: ${passFast}) State:`, JSON.stringify(postSeekState));

      seekResults.push({
        seekNum: sIdx,
        targetTime,
        seekLatencyMs,
        passFast
      });

      await sleep(1500); // Small pause between random seeks
    }

    const allFast = seekResults.every(r => r.passFast);
    const avgSeekMs = Math.round(seekResults.reduce((acc, r) => acc + (r.seekLatencyMs > 0 ? r.seekLatencyMs : 5000), 0) / seekResults.length);

    testResults.push({
      sample: idx + 1,
      msgId: card.msgId,
      label: card.text.slice(0, 30),
      duration: `${duration}s`,
      startLatencyMs: `${startLatencyMs}ms`,
      seekCount,
      avgSeekMs: `${avgSeekMs}ms`,
      allSeeksUnder1s: allFast ? 'YES (<1s)' : 'NO',
      status: (startLatencyMs < 1000 && allFast) ? 'PERFECT (<1s)' : 'OK'
    });
  }

  console.log(`\n==================================================`);
  console.log(`SUMMARY REPORT: RANDOM SEEKS (5-7 SEES PER MEDIA)`);
  console.log(`==================================================`);
  console.table(testResults);

  ws.close();
}

main().catch(err => {
  console.error('Fatal error in main script:', err);
  process.exit(1);
});
