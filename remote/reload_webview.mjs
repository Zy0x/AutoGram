import WebSocket from 'ws';

async function main() {
  const res = await fetch('http://[::1]:9222/json/list');
  const data = await res.json();
  const page = data.find(t => t.type === 'page' && (t.url.includes('1420') || t.title.includes('localhost') || t.url.includes('chromewebdata')));
  
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  console.log('Reloading page via CDP...');
  await new Promise((resolve) => {
    const id = 101;
    ws.on('message', msg => {
      const res = JSON.parse(msg);
      if (res.id === id) resolve(res.result);
    });
    ws.send(JSON.stringify({
      id,
      method: 'Page.navigate',
      params: { url: 'http://localhost:1420/' }
    }));
  });

  console.log('Page navigated to http://localhost:1420/');
  ws.close();
}

main();
