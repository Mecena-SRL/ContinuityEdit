#!/usr/bin/env node
// Assembla dist/com.continuityedit.plugin pronto per l'installazione (SENZA WorkflowIntegration.node,
// che e' di Blackmagic e lo copia scripts/install-mac.sh dall'installazione locale di Resolve).
// Uso: node scripts/build-plugin.mjs [cartella-output]

import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'com.continuityedit.plugin'));
const NM = path.join(ROOT, 'node_modules');

const RUNTIME_DEPS = ['fast-xml-parser']; // + pdfjs-dist (solo build legacy, vedi sotto)

const log = (m) => console.log(m);
const fail = (m) => { console.error(`Errore: ${m}`); process.exit(1); };

async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')); }

// Chiusura transitiva delle dipendenze `dependencies` di un pacchetto in node_modules.
async function collectDeps(names, seen = new Set()) {
  for (const n of names) {
    if (seen.has(n)) continue;
    const dir = path.join(NM, n);
    if (!existsSync(dir)) fail(`dipendenza mancante in node_modules: ${n} (esegui "npm ci")`);
    seen.add(n);
    const pkg = await readJson(path.join(dir, 'package.json'));
    await collectDeps(Object.keys(pkg.dependencies || {}), seen);
  }
  return seen;
}

async function main() {
  if (!existsSync(NM)) fail('node_modules assente: esegui "npm ci" nella radice del repository');
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // 1. plugin/ (senza harness di sviluppo, node_modules e binari Blackmagic)
  await cp(path.join(ROOT, 'plugin'), OUT, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(path.join(ROOT, 'plugin'), src).split(path.sep);
      return rel[0] !== 'dev' && rel[0] !== 'node_modules' && !src.endsWith('.node');
    },
  });
  log('plugin/            -> copiato (senza dev/)');

  // 2. core/src (ESM: serve un package.json "type":"module" perche' il plugin e' CommonJS)
  await cp(path.join(ROOT, 'core', 'src'), path.join(OUT, 'core', 'src'), { recursive: true });
  await writeFile(path.join(OUT, 'core', 'package.json'), '{\n  "type": "module",\n  "private": true\n}\n');
  log('core/src           -> copiato');

  // 3. dipendenze runtime
  const deps = await collectDeps(RUNTIME_DEPS);
  for (const n of deps) await cp(path.join(NM, n), path.join(OUT, 'node_modules', n), { recursive: true });
  log(`node_modules       -> ${[...deps].join(', ')}`);

  // pdfjs-dist e' pesante (~38 MB): a Node servono solo package.json, LICENSE e la build legacy (pdf.mjs + worker).
  const pj = path.join(NM, 'pdfjs-dist');
  if (!existsSync(pj)) fail('pdfjs-dist mancante in node_modules (esegui "npm ci")');
  const pjOut = path.join(OUT, 'node_modules', 'pdfjs-dist');
  await mkdir(path.join(pjOut, 'legacy', 'build'), { recursive: true });
  await cp(path.join(pj, 'package.json'), path.join(pjOut, 'package.json'));
  if (existsSync(path.join(pj, 'LICENSE'))) await cp(path.join(pj, 'LICENSE'), path.join(pjOut, 'LICENSE'));
  for (const f of ['pdf.mjs', 'pdf.worker.mjs']) {
    await cp(path.join(pj, 'legacy', 'build', f), path.join(pjOut, 'legacy', 'build', f));
  }
  log('pdfjs-dist         -> solo legacy/build/pdf.mjs + pdf.worker.mjs');

  log(`\nFatto: ${OUT}\n(manca WorkflowIntegration.node: lo aggiunge scripts/install-mac.sh)`);
}

main().catch((e) => fail(e.stack || e.message));
