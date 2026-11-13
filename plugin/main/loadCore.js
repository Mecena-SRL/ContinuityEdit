'use strict';
// Carica il core (ESM) dal CommonJS del plugin con import() dinamico.
// Installato: <plugin>/core/src ; in sviluppo: <repo>/core/src (plugin/ e core/ sono fratelli).

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

function findCoreSrc(baseDir) {
  const candidates = [path.join(baseDir, 'core', 'src'), path.join(baseDir, '..', 'core', 'src')];
  const found = candidates.find((c) => fs.existsSync(path.join(c, 'sync', 'index.js')));
  if (!found) throw new Error(`Core non trovato (cercato in: ${candidates.join(', ')})`);
  return found;
}

async function loadCore(baseDir) {
  const src = findCoreSrc(baseDir);
  const imp = (rel) => import(pathToFileURL(path.join(src, rel)).href);
  const [sync, transcript, align, script, bridgeMod, sequence, board] = await Promise.all([
    imp('sync/index.js'), imp('transcript/parse.js'), imp('align/index.js'), imp('script/index.js'), imp('bridge/resolveBridge.js'),
    imp('sequence/index.js'), imp('board/index.js'),
  ]);
  return {
    sync,
    parseResolveTranscript: transcript.parseResolveTranscript,
    alignClip: align.alignClip,
    parseFdx: script.parseFdx,
    parsePdf: script.parsePdf,
    applyScriptEdit: script.applyScriptEdit,
    sequence,
    board,
    createBridge: bridgeMod.createBridge,
  };
}

module.exports = { loadCore, findCoreSrc };
