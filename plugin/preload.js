'use strict';
// Preload (sandbox): espone window.ce al renderer. In un preload sandboxed non si possono require() file locali,
// quindi l'elenco dei metodi e' ripetuto qui (deve coincidere con METHOD_NAMES di main/handlers.js).
const { contextBridge, ipcRenderer } = require('electron/renderer');

const METHODS = [
  'getEnv', 'pickScriptFile', 'loadScript', 'getSelectedClips', 'addTake', 'removeTake', 'transcribeClips',
  'getTranscribeStatus', 'autoSync', 'addAnchor', 'moveAnchor', 'removeAnchor', 'anchorFromMarker',
  'anchorFromPlayhead', 'getState', 'setSelection', 'setNote', 'saveProject', 'loadProject', 'previewLine',
  'assemble', 'writeMarkers', 'runDiagnostics',
];

const api = {};
for (const name of METHODS) api[name] = (...args) => ipcRenderer.invoke(`ce:${name}`, ...args);

// onChange(cb): cb(state) ad ogni mutazione. Ritorna la funzione per annullare la sottoscrizione.
api.onChange = (cb) => {
  const listener = (_event, state) => cb(state);
  ipcRenderer.on('ce:changed', listener);
  return () => ipcRenderer.removeListener('ce:changed', listener);
};

contextBridge.exposeInMainWorld('ce', api);
