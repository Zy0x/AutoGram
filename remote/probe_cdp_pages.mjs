import http from 'http';

function getJson(urlStr) {
  return new Promise((resolve, reject) => {
    http.get(urlStr, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch(e) {
          resolve(body);
        }
      });
    }).on('error', reject);
  });
}

const list9225 = await getJson('http://127.0.0.1:9225/json/list').catch(e => String(e));
console.log('127.0.0.1:9225 ->', JSON.stringify(list9225, null, 2));

const list9222 = await getJson('http://127.0.0.1:9222/json/list').catch(e => String(e));
console.log('127.0.0.1:9222 ->', JSON.stringify(list9222, null, 2));
