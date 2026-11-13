'use strict';
// Persistenza sidecar: <dir>/<projectName>.ce.json (scrittura atomica). Nessuna dipendenza da Electron.

const fsDefault = require('node:fs/promises');
const pathMod = require('node:path');

// Nome di progetto -> nome file sicuro.
function safeName(name) {
  const s = String(name || 'senza-nome').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/^\.+/, '_');
  return s || 'senza-nome';
}

function createPersist({ dir, fs = fsDefault, path = pathMod } = {}) {
  if (!dir) throw new Error('persist: cartella non specificata');
  const fileFor = (name) => path.join(dir, `${safeName(name)}.ce.json`);

  async function save(name, serialized) {
    await fs.mkdir(dir, { recursive: true });
    const file = fileFor(name);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, serialized, 'utf8');
    await fs.rename(tmp, file);
    return file;
  }

  // Ritorna la stringa JSON oppure null se il file non esiste.
  async function load(name) {
    try {
      return await fs.readFile(fileFor(name), 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    }
  }

  return { save, load, fileFor };
}

module.exports = { createPersist, safeName };
