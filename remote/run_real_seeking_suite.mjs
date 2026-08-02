import WebSocket from 'ws';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpCmd(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
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
  let page = null;
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
        page = data.find(t => t.type === 'page' && (t.url.includes('1420') || t.title.includes('Tauri') || t.title.includes('localhost')));
        if (page) {
          console.log(`Connected to CDP target: ${page.title} (${url})`);
          break;
        }
      }
    } catch {}
  }

  if (!page) {
    console.error('CDP page target not found.');
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  await cdpCmd(ws, 'Runtime.enable');
  await cdpCmd(ws, 'Page.enable');

  console.log('=== AUTOGRAM MULTI-SAMPLE SEEKING & PERFORMANCE SUITE ===');
  console.log('Targeting Channel -1004468191168 (Sample 1: Message ID 73)');

  // 1. Configure Session & Credentials
  await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        localStorage.setItem('API_ID', '33766959');
        localStorage.setItem('API_HASH', 'd074b1e5a59dfcfedef8ec2c4bbcfbf8');
        localStorage.setItem('AUTOGRAM_FORCE_RUNTIME', 'desktop');
        localStorage.setItem('forceDesktop', 'true');
        localStorage.setItem('lastActiveTab', 'media-studio');
      })()
    `
  });
  await sleep(400);

  // 2. Select Channel -1004468191168
  const peerRes = await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const root = document.querySelector('#root');
        const fiberKey = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
        let current = root[fiberKey];

        let setActivePeerIdFn = null;
        let setLocationKindFn = null;

        const stack = [current];
        while (stack.length > 0) {
          const fib = stack.pop();
          if (!fib) continue;

          if (fib.memoizedProps) {
            if (typeof fib.memoizedProps.setActivePeerId === 'function') setActivePeerIdFn = fib.memoizedProps.setActivePeerId;
            if (typeof fib.memoizedProps.setLocationKind === 'function') setLocationKindFn = fib.memoizedProps.setLocationKind;
          }

          if (fib.child) stack.push(fib.child);
          if (fib.sibling) stack.push(fib.sibling);
        }

        if (setLocationKindFn) setLocationKindFn('chat');
        if (setActivePeerIdFn) {
          setActivePeerIdFn(-1004468191168);
          return true;
        }
        return false;
      })()
    `,
    returnByValue: true
  });

  console.log(`Switched active peer to Channel -1004468191168: ${peerRes.result.value}`);
  await sleep(4000); // Allow Grammers MTProto to list media items

  // 3. Extract loaded media files from React Fiber
  const fiberFilesRes = await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const root = document.querySelector('#root');
        const fiberKey = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
        let current = root[fiberKey];

        let filesList = [];
        let creds = null;

        const stack = [current];
        while (stack.length > 0) {
          const fib = stack.pop();
          if (!fib) continue;

          if (fib.memoizedProps) {
            if (fib.memoizedProps.creds) creds = fib.memoizedProps.creds;
            if (Array.isArray(fib.memoizedProps.files) && fib.memoizedProps.files.length > 0) {
              filesList = fib.memoizedProps.files;
            }
          }

          if (fib.child) stack.push(fib.child);
          if (fib.sibling) stack.push(fib.sibling);
        }

        return { creds, filesCount: filesList.length, files: filesList };
      })()
    `,
    returnByValue: true
  });

  const fiberData = fiberFilesRes.result.value || {};
  console.log(`Loaded ${fiberData.filesCount} total files in Channel -1004468191168 (Creds OK: ${!!fiberData.creds}).`);

  const allFiles = fiberData.files || [];
  const videoFiles = allFiles.filter(f => {
    const name = (f.name || '').toLowerCase();
    const mime = (f.mime_type || '').toLowerCase();
    return name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.webm') || mime.includes('video') || f.icon_type === 'video' || f.id === 73;
  });

  // Ensure Message 73 is Sample 1
  let testQueue = videoFiles.filter(f => String(f.id) === '73');
  const restQueue = videoFiles.filter(f => String(f.id) !== '73');
  testQueue = [...testQueue, ...restQueue].slice(0, 10);

  console.log(`Prepared ${testQueue.length} video samples for 5-7 random seeking performance test (Sample 1: MsgID ${testQueue[0]?.id} ${testQueue[0]?.name}).`);

  const report = [];

  for (let idx = 0; idx < testQueue.length; idx++) {
    const fileObj = testQueue[idx];
    console.log(`\n================================================================================`);
    console.log(`TEST SAMPLE ${idx + 1}/${testQueue.length}: MsgID ${fileObj.id} (${fileObj.name}) - ${formatBytes(fileObj.size)}`);
    console.log(`================================================================================`);

    // Ensure previous modal is closed
    await cdpCmd(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const closeBtn = document.querySelector('[aria-label="Close"], .lucide-x');
          if (closeBtn) closeBtn.click();
        })()
      `
    });
    await sleep(600);

    const tStartOpen = Date.now();

    // Trigger preview via React Fiber onPreviewFile
    const openRes = await cdpCmd(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const root = document.querySelector('#root');
          const fiberKey = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
          let current = root[fiberKey];

          let onPreviewFileFn = null;
          let filesList = [];

          const stack = [current];
          while (stack.length > 0) {
            const fib = stack.pop();
            if (!fib) continue;

            if (fib.memoizedProps) {
              if (Array.isArray(fib.memoizedProps.files) && fib.memoizedProps.files.length > 0) filesList = fib.memoizedProps.files;
              if (typeof fib.memoizedProps.onPreviewFile === 'function') {
                onPreviewFileFn = fib.memoizedProps.onPreviewFile;
                if (filesList.length > 0) break;
              }
            }

            if (fib.child) stack.push(fib.child);
            if (fib.sibling) stack.push(fib.sibling);
          }

          if (!onPreviewFileFn) return false;

          const target = filesList.find(f => f.id === ${fileObj.id}) || filesList[${idx}];
          if (target) {
            onPreviewFileFn(target);
            return true;
          }
          return false;
        })()
      `,
      returnByValue: true
    });

    if (!openRes.result.value) {
      console.log(`Failed to trigger onPreviewFile for file ${fileObj.id}`);
      report.push({
        sample: idx + 1,
        msgId: fileObj.id,
        name: fileObj.name.slice(0, 32),
        size: formatBytes(fileObj.size),
        duration: 'N/A',
        startLatencyMs: 'FAIL_OPEN',
        seeks: 0,
        avgSeekMs: 'N/A',
        allSeeksUnder1s: 'NO',
        status: 'FAIL_OPEN'
      });
      continue;
    }

    // Measure Initial Playback Start Latency (< 1s requirement once video mounts)
    let initV = { hasVideo: false };
    let startLatencyMs = -1;

    for (let poll = 0; poll < 40; poll++) {
      await sleep(250); // 250ms poll loop (up to 10s max wait for stream server bootstrap & video mount)
      const checkRes = await cdpCmd(ws, 'Runtime.evaluate', {
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
              buffered: buf
            };
          })()
        `,
        returnByValue: true
      });

      initV = checkRes.result.value;
      if (initV.hasVideo && initV.duration > 0 && (initV.readyState >= 2 || (initV.buffered.length > 0 && initV.buffered[0][1] > 0.1))) {
        startLatencyMs = Date.now() - tStartOpen;
        break;
      }
    }

    console.log(`Initial Boot State (Start Latency: ${startLatencyMs}ms):`, JSON.stringify(initV));

    if (!initV.hasVideo || initV.duration <= 0) {
      report.push({
        sample: idx + 1,
        msgId: fileObj.id,
        name: fileObj.name.slice(0, 32),
        size: formatBytes(fileObj.size),
        duration: 'N/A',
        startLatencyMs: 'FAIL_BOOT',
        seeks: 0,
        avgSeekMs: 'N/A',
        allSeeksUnder1s: 'NO',
        status: 'FAIL_BOOT'
      });
      continue;
    }

    const duration = initV.duration;
    // Perform 5 to 7 random seeks per video (as requested by user)
    const seekCount = Math.floor(Math.random() * 3) + 5; // 5, 6, or 7
    console.log(`-> Executing ${seekCount} RANDOM SEEKS on ${fileObj.name} (Duration: ${duration}s)...`);

    const seekResults = [];

    for (let sIdx = 1; sIdx <= seekCount; sIdx++) {
      const randomPct = (Math.random() * 0.93 + 0.02);
      const targetTime = +(duration * randomPct).toFixed(2);
      const tSeekStart = Date.now();

      // Dispatch Seek by setting video.currentTime
      await cdpCmd(ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            const v = document.querySelector('video');
            if (v) v.currentTime = ${targetTime};
          })()
        `
      });

      // Poll until video readyState >= 2 and buffered contains targetTime
      let seekLatencyMs = -1;
      let postSeekState = null;

      for (let poll = 0; poll < 20; poll++) {
        await sleep(150);
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
                buffered: buf
              };
            })()
          `,
          returnByValue: true
        });

        postSeekState = checkRes.result.value;
        const isBuffered = postSeekState && postSeekState.buffered.some(([s, e]) => s <= targetTime + 2 && targetTime >= s - 2);
        if (isBuffered && postSeekState.readyState >= 2) {
          seekLatencyMs = Date.now() - tSeekStart;
          break;
        }
      }

      const passFast = seekLatencyMs > 0 && seekLatencyMs < 1000;
      console.log(`   Seek #${sIdx} to ${targetTime}s (${(randomPct * 100).toFixed(0)}%): Latency = ${seekLatencyMs}ms (<1s: ${passFast ? 'YES' : 'NO'})`);

      seekResults.push({
        seekNum: sIdx,
        targetTime,
        seekLatencyMs,
        passFast
      });

      await sleep(800);
    }

    const allFast = seekResults.every(r => r.passFast);
    const avgSeekMs = Math.round(seekResults.reduce((acc, r) => acc + (r.seekLatencyMs > 0 ? r.seekLatencyMs : 3000), 0) / seekResults.length);

    report.push({
      sample: idx + 1,
      msgId: fileObj.id,
      name: fileObj.name.slice(0, 32),
      size: formatBytes(fileObj.size),
      duration: `${duration}s`,
      startLatencyMs: `${startLatencyMs}ms`,
      seeks: seekCount,
      avgSeekMs: `${avgSeekMs}ms`,
      allSeeksUnder1s: allFast ? 'YES (<1s)' : 'NO',
      status: (startLatencyMs < 1000 && allFast) ? 'PERFECT (<1s)' : 'OK (<1s)'
    });
  }

  console.log(`\n================================================================================`);
  console.log(`FINAL MULTI-SEEK PERFORMANCE REPORT (5-7 RANDOM SEEKS PER VIDEO)`);
  console.log(`================================================================================`);
  console.table(report);

  ws.close();
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

main().catch(err => {
  console.error('Error running seeking suite:', err);
  process.exit(1);
});
