import http from 'http';

async function checkPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/json/list', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve({ port, host, data: JSON.parse(body) });
        } catch(e) {
          resolve({ port, host, error: 'invalid json', body });
        }
      });
    });
    req.on('error', (err) => resolve({ port, host, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ port, host, error: 'timeout' }); });
  });
}

const ports = [9222, 9223, 9224, 9225, 9226, 9227, 9228];
for (const p of ports) {
  const r1 = await checkPort(p, '127.0.0.1');
  if (!r1.error) console.log(`FOUND 127.0.0.1:${p} ->`, JSON.stringify(r1.data, null, 2));
  const r2 = await checkPort(p, '::1');
  if (!r2.error) console.log(`FOUND [::1]:${p} ->`, JSON.stringify(r2.data, null, 2));
}
