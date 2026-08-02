import WebSocket from 'ws';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const res = await fetch('http://[::1]:9222/json/list');
  const data = await res.json();
  const page = data.find(t => t.type === 'page' && (t.url.includes('1420') || t.title.includes('Tauri')));
  
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  console.log('1. Setting desktop overrides & switching to Channel -1004468191168...');
  await new Promise((resolve) => {
    const id = 111;
    ws.on('message', msg => {
      const res = JSON.parse(msg);
      if (res.id === id) resolve(res.result);
    });
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          (() => {
            window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
            localStorage.setItem('API_ID', '33766959');
            localStorage.setItem('API_HASH', 'd074b1e5a59dfcfedef8ec2c4bbcfbf8');
            localStorage.setItem('AUTOGRAM_FORCE_RUNTIME', 'desktop');
            localStorage.setItem('forceDesktop', 'true');
            localStorage.setItem('lastActiveTab', 'media-studio');

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
      }
    }));
  });

  await sleep(4000); // Allow Grammers to fetch channel files

  console.log('2. Triggering preview for Message 73...');
  const openRes = await new Promise((resolve) => {
    const id = 222;
    ws.on('message', msg => {
      const res = JSON.parse(msg);
      if (res.id === id) resolve(res.result);
    });
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: {
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

            const target = filesList.find(f => f.id === 73) || filesList[0];
            if (onPreviewFileFn && target) {
              onPreviewFileFn(target);
              return { success: true, target: { id: target.id, name: target.name } };
            }
            return { error: 'target file not found', filesCount: filesList.length };
          })()
        `,
        returnByValue: true
      }
    }));
  });

  console.log('Open Result:', JSON.stringify(openRes.result ? openRes.result.value : openRes, null, 2));

  console.log('3. Polling for <video> player element mounting over 15 seconds...');
  let videoInfo = null;
  const tStartOpen = Date.now();

  for (let poll = 1; poll <= 50; poll++) {
    await sleep(300);
    const checkRes = await new Promise((resolve) => {
      const id = 300 + poll;
      ws.on('message', msg => {
        const res = JSON.parse(msg);
        if (res.id === id) resolve(res.result);
      });
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (() => {
              const v = document.querySelector('video');
              const loader = document.querySelector('.spin, .drive-empty p')?.textContent;
              const error = document.querySelector('.drive-empty, .td-alert-error')?.textContent;
              if (!v) return { hasVideo: false, loader: loader || null, error: error || null };
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
                loader: loader || null,
                error: error || null
              };
            })()
          `,
          returnByValue: true
        }
      }));
    });

    const info = checkRes.result ? checkRes.result.value : null;
    if (info) {
      if (poll % 5 === 0 || info.hasVideo) {
        console.log(`[T+${Date.now() - tStartOpen}ms] Video: ${info.hasVideo ? 'YES' : 'NO'} | Src: ${info.src || 'none'} | Duration: ${info.duration}s | readyState: ${info.readyState} | Loader: ${info.loader || 'none'} | Error: ${info.error || 'none'}`);
      }
      if (info.hasVideo && info.duration > 0 && (info.readyState >= 2 || (info.buffered.length > 0 && info.buffered[0][1] > 0.1))) {
        videoInfo = info;
        break;
      }
    }
  }

  if (videoInfo && videoInfo.duration > 0) {
    const duration = videoInfo.duration;
    console.log(`\n4. Executing 5 RANDOM SEEKS on Item 73 (${duration}s total duration)...`);

    for (let sIdx = 1; sIdx <= 5; sIdx++) {
      const randomPct = (Math.random() * 0.9 + 0.05);
      const targetTime = +(duration * randomPct).toFixed(2);
      const tSeekStart = Date.now();

      await new Promise((resolve) => {
        const id = 400 + sIdx;
        ws.on('message', msg => {
          const res = JSON.parse(msg);
          if (res.id === id) resolve(res.result);
        });
        ws.send(JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: {
            expression: `
              (() => {
                const v = document.querySelector('video');
                if (v) v.currentTime = ${targetTime};
              })()
            `
          }
        }));
      });

      let seekLatencyMs = -1;
      for (let poll = 0; poll < 20; poll++) {
        await sleep(150);
        const checkRes = await new Promise((resolve) => {
          const id = 500 + sIdx * 50 + poll;
          ws.on('message', msg => {
            const res = JSON.parse(msg);
            if (res.id === id) resolve(res.result);
          });
          ws.send(JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: {
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
                    buffered: buf
                  };
                })()
              `,
              returnByValue: true
            }
          }));
        });

        const st = checkRes.result ? checkRes.result.value : null;
        if (st && st.readyState >= 2 && st.buffered.some(([start, end]) => start <= targetTime + 2 && targetTime >= start - 2)) {
          seekLatencyMs = Date.now() - tSeekStart;
          break;
        }
      }

      const passFast = seekLatencyMs > 0 && seekLatencyMs < 1000;
      console.log(`   Seek #${sIdx} to ${targetTime}s (${(randomPct * 100).toFixed(0)}%): Latency = ${seekLatencyMs}ms (<1s: ${passFast ? 'YES' : 'NO'})`);
      await sleep(800);
    }
  }

  ws.close();
}

main();
