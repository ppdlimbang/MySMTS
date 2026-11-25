// Pelayan statik ringkas untuk pratonton setempat: npm run serve
// Buka http://localhost:8080 (perlukan web/config.js — salin daripada config.example.js).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = fileURLToPath(new URL('../web/', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const JENIS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  try {
    let laluan = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (laluan.endsWith('/')) laluan += 'index.html';
    const fail = normalize(join(AKAR, laluan));
    if (!fail.startsWith(AKAR.endsWith(sep) ? AKAR : AKAR + sep)) throw new Error('luar akar');
    const isi = await readFile(fail);
    res.writeHead(200, { 'Content-Type': JENIS[extname(fail)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(isi);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Tidak dijumpai');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`MySMTS: http://localhost:${PORT}`));
