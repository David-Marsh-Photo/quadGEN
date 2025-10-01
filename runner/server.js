// runner/server.js
import http from 'http';
import { spawn } from 'node:child_process';

const PORT = 3535;
http.createServer((req, res) => {
  if (req.url === '/run' && req.method === 'POST') {
    const p = spawn('npx', ['playwright', 'test'], { shell: true });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => {
      res.writeHead(code === 0 ? 200 : 500, { 'content-type': 'text/plain' });
      res.end(out + (err ? `\n--- STDERR ---\n${err}` : ''));
    });
  } else {
    res.writeHead(404); res.end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => console.log(`runner on :${PORT}`));