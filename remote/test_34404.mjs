import http from 'http';
import WebSocket from 'ws';

async function testRemote(targetUrl) {
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

    console.log('Navigating to target:', targetUrl);
    await send('Runtime.evaluate', {
      expression: `window.location.hash = '${targetUrl}'`
    });

    await new Promise(r => setTimeout(r, 2000));

    const evalResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const video = document.querySelector('video');
        const badge = Array.from(document.querySelectorAll('span, div')).find(e => e.textContent && e.textContent.includes('Buffer'));
        return {
          title: document.title,
          hasVideo: !!video,
          paused: video ? video.paused : null,
          currentTime: video ? video.currentTime : null,
          readyState: video ? video.readyState : null,
          badgeText: badge ? badge.textContent.trim() : null
        };
      })()`
    });

    console.log('CDP Test Result:', JSON.stringify(evalResult.result.value, null, 2));
    ws.close();
  } catch (err) {
    console.error('CDP Error:', err.message);
  }
}

testRemote('/-1003214112048/9/34404');
