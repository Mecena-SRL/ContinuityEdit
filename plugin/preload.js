'use strict';
// Preload (sandbox): espone window.ce al renderer. In un preload sandboxed non si possono require() file locali,
// quindi l'elenco dei metodi e' ripetuto qui (deve coincidere con METHOD_NAMES di main/handlers.js).
const { contextBridge, ipcRenderer } = require('electron/renderer');

const METHODS = [
  'getEnv', 'pickScriptFile', 'loadScript', 'getSelectedClips', 'addTake', 'removeTake', 'transcribeClips',
  'getTranscribeStatus', 'autoSync', 'addAnchor', 'moveAnchor', 'removeAnchor', 'anchorFromMarker',
  'anchorFromPlayhead', 'getState', 'setSelection', 'setNote', 'saveProject', 'loadProject', 'previewLine',
  'assemble', 'writeMarkers', 'runDiagnostics',
  'listBins', 'loadBins', 'detectGroups', 'detectGroupsByCoverage', 'suggestMaster', 'setTakeShot', 'setTakeGroup', 'getClipMediaPath', 'board.addStill', 'board.removeItem', 'board.refreshStillViaResolve', 'saveFile',
  'editScript', 'undo', 'redo', 'setMark', 'setGradePalette',
  'sequence.fromLines', 'sequence.addItem', 'sequence.moveItem', 'sequence.trimItem', 'sequence.removeItem',
  'sequence.setMaster', 'sequence.addCutaway', 'sequence.trimCutaway', 'sequence.assemble',
  'board.addItem', 'board.moveItem', 'board.resizeItem', 'board.setCaption', 'board.bringToFront', 'board.link', 'board.toSequence',
];

const api = {};
// i nomi con '.' diventano oggetti annidati: 'board.addStill' -> window.ce.board.addStill
for (const name of METHODS) {
  const parts = name.split('.');
  let target = api;
  for (const ns of parts.slice(0, -1)) target = (target[ns] ??= {});
  target[parts[parts.length - 1]] = (...args) => ipcRenderer.invoke(`ce:${name}`, ...args);
}

// onChange(cb): cb(state) ad ogni mutazione. Ritorna la funzione per annullare la sottoscrizione.
api.onChange = (cb) => {
  const listener = (_event, state) => cb(state);
  ipcRenderer.on('ce:changed', listener);
  return () => ipcRenderer.removeListener('ce:changed', listener);
};

contextBridge.exposeInMainWorld('ce', api);
