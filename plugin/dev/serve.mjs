#!/usr/bin/env node
// Server statico per l'harness (con richieste Range, come il protocollo ce-media:// del plugin: senza Range il
// <video> non si puo' spostare). Serve SOLO la cartella del repository, solo su 127.0.0.1.
// Uso: node plugin/dev/serve.mjs [porta]   poi apri http://127.0.0.1:<porta>/plugin/dev/index.html?seed=1
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.argv[2]) || 8799;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = path.resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end(); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m) {
      const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Harness: http://127.0.0.1:${PORT}/plugin/dev/index.html?seed=1`));
