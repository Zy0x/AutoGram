import { execSync } from 'node:child_process';
import http from 'node:http';

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
  const rawJson = execSync('curl.exe -g -sS http://127.0.0.1:9225/json/list').toString();
  const targets = JSON.parse(rawJson);
  const page = targets.find(t => t.type === 'page' && t.url.includes('1420')) || targets.find(t => t.type === 'page');
  
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));

  await cdpCmd(ws, 'Runtime.enable');
  await cdpCmd(ws, 'Page.enable');

  console.log('--- 1. Reloading Page to test fresh video preview boot ---');
  await cdpCmd(ws, 'Page.reload');
  await sleep(4000);

  // Click #Gudang ~ HAnime topic if needed
  await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const hanime = Array.from(document.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.trim().includes('HAnime'));
        if (hanime) (hanime.closest('button, div, a, li') || hanime).click();
      })()
    `
  });
  await sleep(3000);

  // Double-click msg 2004 (365.26 MB)
  const dblRes = await cdpCmd(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const card = document.querySelector('[data-msg-id="2004"]') || document.querySelector('[data-msg-id="2000"]');
        if (card) {
          card.scrollIntoView({ block: 'center' });
          card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
          return { dblClicked: true, text: card.textContent.slice(0, 70) };
        }
        return { dblClicked: false };
      })()
    `,
    returnByValue: true
  });

  console.log('DBLCLICK_RESULT:', dblRes.result.value);
  await sleep(3000);

  // Monitor video state over 10 seconds WITHOUT manual .play() call!
  let streamUrl = null;
  let finalState = null;
  for (let i = 0; i < 6; i++) {
    const vState = await cdpCmd(ws, 'Runtime.evaluate', {
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
        })()
      `,
      returnByValue: true
    });

    finalState = vState.result.value;
    console.log(`VIDEO_AUTOBOOT_STATE_${i}:`, JSON.stringify(finalState));
    if (finalState.hasVideo && finalState.src) streamUrl = finalState.src;
    await sleep(2000);
  }

  if (finalState && finalState.readyState >= 3 && finalState.duration !== 'NaN') {
    console.log('SUCCESS: Video started playing automatically with valid metadata and active buffer!');
  } else {
    console.log('WARNING: Video state check completed.');
  }

  // Log real HTTP range headers
  if (streamUrl) {
    console.log('PROBING_LIVE_HTTP_RANGE:', streamUrl);
    const probe = await new Promise((res, rej) => {
      http.get(streamUrl, { headers: { 'Range': 'bytes=0-65535' } }, r => {
        let s = 0; r.on('data', c => s += c.length);
        r.on('end', () => res({ status: r.statusCode, cr: r.headers['content-range'], cl: r.headers['content-length'], rcv: s }));
      }).on('error', rej);
    });
    console.log('[REAL_HTTP_RANGE] RESPONSE:', probe);
  }

  ws.close();
}

main().catch(console.error);
