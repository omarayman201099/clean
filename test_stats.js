const http = require('http');
const token = process.argv[2];
if (!token) { console.error('Usage: node test_stats.js <token>'); process.exit(1); }
const opts = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/stats',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + token
  }
};
const r = http.request(opts, res => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => console.log(b));
});
r.on('error', e => console.error('request error', e));
r.end();
