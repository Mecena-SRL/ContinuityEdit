#!/usr/bin/env node
// Converte docs/GUIDA_UTENTE.md in docs/GUIDA_UTENTE.html (sottoinsieme minimo di Markdown, senza dipendenze).
// Uso: node scripts/build-guide.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'docs', 'GUIDA_UTENTE.md'), 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const out = [];
let list = null; // 'ul' | 'ol'
let code = false;
let para = [];
const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

for (const raw of src.split('\n')) {
  if (raw.trim().startsWith('```')) {
    flushPara();
    out.push(code ? '</code></pre>' : '<pre><code>');
    code = !code;
    continue;
  }
  if (code) { out.push(esc(raw.trim() === '' ? '' : raw.replace(/^ {3}/, ''))); continue; }
  const h = /^(#{1,3}) (.*)$/.exec(raw);
  const ol = /^\d+\. (.*)$/.exec(raw);
  const ul = /^- (.*)$/.exec(raw);
  if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); }
  else if (ol || ul) {
    flushPara();
    const kind = ol ? 'ol' : 'ul';
    if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
    out.push(`<li>${inline((ol || ul)[1])}</li>`);
  } else if (raw.trim() === '') { flushPara(); }
  else if (list && /^\s+/.test(raw) === false) { closeList(); para.push(raw.trim()); }
  else { para.push(raw.trim()); }
}
flushPara(); closeList();

const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ContinuityEdit - Guida utente</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1c1f26;--code:#eef0f3}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--fg:#e8e6df;--code:#232833}}
body{background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,system-ui,sans-serif;max-width:46rem;margin:0 auto;padding:1.5rem 1rem}
code{background:var(--code);padding:.1em .3em;border-radius:4px}
pre{background:var(--code);padding:.8rem;border-radius:6px;overflow-x:auto}pre code{padding:0}
</style></head><body>
${out.join('\n')}
</body></html>
`;
writeFileSync(path.join(ROOT, 'docs', 'GUIDA_UTENTE.html'), html);
console.log('docs/GUIDA_UTENTE.html generato');
