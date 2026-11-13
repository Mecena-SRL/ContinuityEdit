'use strict';
// Logica pura (senza Electron) del protocollo ce-media://: whitelist di percorsi di clip indicizzati da token
// opaco, parsing dell'header Range, Content-Type e piano di risposta. main.js la collega a protocol.handle.
// Sicurezza: si servono SOLO percorsi registrati; l'URL non contiene mai un percorso.

const nodeCrypto = require('node:crypto');

const SCHEME = 'ce-media';
const HOST = 'clip';

const CONTENT_TYPES = {
  mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  mxf: 'application/mxf', // Chromium non lo decodifica: il renderer ripiega su proxy/segnaposto
  avi: 'video/x-msvideo', mp3: 'audio/mpeg', wav: 'audio/wav',
};

function contentTypeFor(filePath) {
  const ext = String(filePath || '').toLowerCase().split('.').pop();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

// Header Range -> {start,end} (end incluso) | null (assente: risposta intera) | {invalid:true} (416).
// Supporta "bytes=a-b", "bytes=a-", "bytes=-n". Range multipli: si serve solo il primo.
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)(?:,.*)?$/i.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return { invalid: true };
  if (!(size > 0)) return { invalid: true };
  let start; let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return { invalid: true };
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return { invalid: true };
  return { start, end };
}

function createMediaRegistry({ randomToken = () => nodeCrypto.randomBytes(16).toString('hex') } = {}) {
  const byToken = new Map();
  const byPath = new Map();
  return {
    // Registra un percorso (idempotente) e ritorna l'URL ce-media://clip/<token>; null se percorso non valido.
    register(filePath) {
      if (typeof filePath !== 'string' || !filePath) return null;
      let token = byPath.get(filePath);
      if (!token) {
        token = randomToken();
        byPath.set(filePath, token); byToken.set(token, filePath);
      }
      return `${SCHEME}://${HOST}/${token}`;
    },
    // URL -> percorso locale registrato, altrimenti null (qualunque altro URL e' rifiutato).
    resolve(url) {
      let u;
      try { u = new URL(url); } catch { return null; }
      if (u.protocol !== `${SCHEME}:` || u.hostname !== HOST) return null;
      const token = u.pathname.replace(/^\//, '');
      return byToken.get(token) || null;
    },
    get size() { return byToken.size; },
  };
}

// Piano di risposta per una richiesta: {status, headers, start, end, filePath} oppure {status:403|404|416, headers}.
// `size` = dimensione del file (da stat); passare null se il file non esiste.
function planResponse({ registry, url, rangeHeader, size, origin = '*' }) {
  const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length' };
  const filePath = registry.resolve(url);
  if (!filePath) return { status: 403, headers: cors };
  if (size === null || size === undefined) return { status: 404, headers: cors };
  const headers = { ...cors, 'Content-Type': contentTypeFor(filePath), 'Accept-Ranges': 'bytes' };
  const r = parseRange(rangeHeader, size);
  if (r && r.invalid) return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } };
  if (!r) return { status: 200, headers: { ...headers, 'Content-Length': String(size) }, start: 0, end: size - 1, filePath };
  return {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${r.start}-${r.end}/${size}`, 'Content-Length': String(r.end - r.start + 1) },
    start: r.start, end: r.end, filePath,
  };
}

module.exports = { SCHEME, HOST, contentTypeFor, parseRange, createMediaRegistry, planResponse };
