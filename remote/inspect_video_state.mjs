import http from 'http';
import WebSocket from 'ws';

async function inspectVideo() {
  try {
    const listRes = await new Promise((res, rej) => {
      http.get('http://[::1]:9222/json', (r) => {
        let body = '';
        r.on('data', c => body += c);
        r.on('end', () => res(JSON.parse(body)));
      }).on('error', rej);
    });

    const page = listRes.find(p => p.type === 'page');
    if (!page) throw new Error('No page target found');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((res, rej) => {
        const id = msgId++;
        const handler = (data) => {
          const parsed = JSON.parse(data);
          if (parsed.id === id) {
            ws.removeListener('message', handler);
            if (parsed.error) rej(parsed.error);
            else res(parsed.result);
          }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    const evalResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const video = document.querySelector('video');
        if (!video) return { error: 'No video element' };
        return {
          src: video.src,
          paused: video.paused,
          currentTime: video.currentTime,
          duration: video.duration,
          readyState: video.readyState,
          networkState: video.networkState,
          error: video.error ? { code: video.error.code, message: video.error.message } : null,
          buffered: Array.from({ length: video.buffered.length }, (_, i) => ({ start: video.buffered.start(i), end: video.buffered.end(i) })),
          seeking: video.seeking
        };
      })()`,
      returnByValue: true
    });

    console.log('Video Element State:', JSON.stringify(evalResult.result.value, null, 2));

    const playResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const video = document.querySelector('video');
        if (video) {
          return video.play().then(() => 'play() resolved ok').catch(e => 'play() error: ' + e.message);
        }
        return 'no video';
      })()`,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('Play Call Result:', JSON.stringify(playResult.result.value, null, 2));

    ws.close();
  } catch (err) {
    console.error('CDP Error:', err.message);
  }
}

inspectVideo();
