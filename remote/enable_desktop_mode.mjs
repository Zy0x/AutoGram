import WebSocket from 'ws';

async function main() {
  const res = await fetch('http://[::1]:9222/json/list');
  const data = await res.json();
  const page = data.find(t => t.type === 'page' && (t.url.includes('1420') || t.title.includes('Tauri')));
  
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  await new Promise((resolve) => {
    const id = 3333;
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
            localStorage.setItem('AUTOGRAM_FORCE_RUNTIME', 'desktop');
            localStorage.setItem('forceDesktop', 'true');
            localStorage.setItem('lastActiveTab', 'media-studio');
            window.location.reload();
          })()
        `,
        returnByValue: true
      }
    }));
  });

  console.log('Desktop mode forced & page reloaded');
  ws.close();
}

main();
