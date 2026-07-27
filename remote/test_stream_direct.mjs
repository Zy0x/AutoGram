import http from 'node:http';

async function checkStream() {
  const port = 64447;
  console.log('Testing HTTP GET on active stream server port:', port);

  const req = http.request({
    hostname: '127.0.0.1',
    port: port,
    path: '/stream/g42772-784430-93638/Cindo_kacamata_sange_6.mp4',
    method: 'GET',
    headers: {
      'Range': 'bytes=0-'
    }
  }, (res) => {
    console.log('STATUS:', res.statusCode);
    console.log('HEADERS:', res.headers);
    let total = 0;
    res.on('data', (chunk) => {
      total += chunk.length;
    });
    res.on('end', () => {
      console.log('Total bytes received in chunk:', total);
    });
  });

  req.on('error', (e) => {
    console.error('HTTP Request error:', e.message);
  });

  req.end();
}

checkStream();
