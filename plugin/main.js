'use strict';
// Main process del plugin ContinuityEdit (Workflow Integration di DaVinci Resolve Studio).
// Contratto: docs/PLUGIN_API.md. La logica sta in ./main/*.js (testabile senza Electron).

const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const { Readable } = require('node:stream');
const { SCHEME, createMediaRegistry, planResponse } = require('./main/protocol.js');
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const fs = require('node:fs');

const PLUGIN_ID = 'com.continuityedit.plugin';

// Il binario e' di Blackmagic: non e' nel repository, lo copia scripts/install-mac.sh.
let WorkflowIntegration = null;
let nodeLoadError = null;
try {
  WorkflowIntegration = require('./WorkflowIntegration.node');
} catch (e) {
  nodeLoadError = e;
}

// Deve avvenire prima di app ready. Il registro e' la whitelist dei file servibili (mai percorsi arbitrari).
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
const mediaRegistry = createMediaRegistry();

function registerMediaProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const filePath = mediaRegistry.resolve(request.url);
    let size = null;
    if (filePath) { try { size = (await fsp.stat(filePath)).size; } catch { size = null; } }
    const plan = planResponse({ registry: mediaRegistry, url: request.url, rangeHeader: request.headers.get('range'), size });
    if (plan.status !== 200 && plan.status !== 206) return new Response(null, { status: plan.status, headers: plan.headers });
    const stream = Readable.toWeb(fs.createReadStream(plan.filePath, { start: plan.start, end: plan.end }));
    return new Response(stream, { status: plan.status, headers: plan.headers });
  });
}

let mainWindow = null;
let resolveObj = null;
let handlers = null;
let cleaned = false;

async function getResolve() {
  if (resolveObj) return resolveObj;
  const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
  if (!ok) throw new Error('Inizializzazione dell\'interfaccia Resolve non riuscita');
  resolveObj = await WorkflowIntegration.GetResolve();
  if (!resolveObj) throw new Error('Impossibile ottenere l\'oggetto Resolve');
  try {
    WorkflowIntegration.RegisterCallback?.('ResolveQuit', () => app.quit());
  } catch { /* callback facoltativa */ }
  return resolveObj;
}

function cleanUp() {
  if (cleaned || !WorkflowIntegration) return;
  cleaned = true;
  try { WorkflowIntegration.CleanUp(); } catch { /* in chiusura */ }
}

async function setup() {
  registerMediaProtocol();
  const { loadCore } = require('./main/loadCore.js');
  const { createState } = require('./main/state.js');
  const { createPersist } = require('./main/persist.js');
  const { createHandlers, METHOD_NAMES } = require('./main/handlers.js');

  const core = await loadCore(__dirname);
  const bridge = core.createBridge(getResolve, {
    lazy: true,
    fileExists: (p) => fsp.access(p).then(() => true, () => false),
    tmpDir: path.join(os.tmpdir(), 'continuityedit-diag'),
  });
  fs.mkdirSync(path.join(os.tmpdir(), 'continuityedit-diag'), { recursive: true });
  const state = createState(core.sync);
  const persist = createPersist({ dir: path.join(app.getPath('userData'), 'projects') });

  handlers = createHandlers({
    core, bridge, state, persist, media: mediaRegistry,
    notify: (snap) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ce:changed', snap);
    },
    pickFile: async () => {
      const r = await dialog.showOpenDialog(mainWindow, {
        title: 'Scegli la sceneggiatura',
        properties: ['openFile'],
        filters: [{ name: 'Sceneggiatura', extensions: ['fdx', 'pdf'] }],
      });
      if (r.canceled || !r.filePaths.length) return null;
      return { path: r.filePaths[0], name: path.basename(r.filePaths[0]) };
    },
    readFile: (p) => fsp.readFile(p),
    writeFile: (p, text) => fsp.writeFile(p, text, 'utf8'),
    diagPath: path.join(os.homedir(), 'Desktop', 'continuityedit_diag.json'),
    stillsDir: async () => path.join(app.getPath('userData'), 'stills', String(state.meta.projectName || 'senza-nome').replace(/[\\/:*?"<>|]/g, '_')),
    mkdir: (d) => fsp.mkdir(d, { recursive: true }),
    showSaveDialog: async ({ suggestedName, filters }) => {
      const r = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName, filters });
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    writeBinary: (p, buf) => fsp.writeFile(p, buf),
  });

  for (const name of METHOD_NAMES) {
    ipcMain.handle(`ce:${name}`, async (_event, ...args) => {
      try {
        return await handlers[name](...args);
      } catch (e) {
        // il messaggio (italiano) arriva al renderer come rifiuto della promessa
        throw new Error(e && e.message ? e.message : String(e));
      }
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.on('close', () => app.quit());
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // Ripristina automaticamente il sidecar del progetto Resolve corrente (se c'e' gia' uno script salvato).
  mainWindow.webContents.once('did-finish-load', () => {
    handlers?.loadProject().catch(() => { /* nessun sidecar o non leggibile: si parte da zero */ });
  });
}

app.whenReady().then(async () => {
  if (!WorkflowIntegration) {
    dialog.showErrorBox(
      'ContinuityEdit',
      'Manca WorkflowIntegration.node (il modulo di Blackmagic).\n' +
      'Rilancia scripts/install-mac.sh dopo aver installato DaVinci Resolve Studio, oppure copia il file a mano ' +
      'dalla cartella Developer/Workflow Integrations/Examples/SamplePlugin di Resolve nella cartella del plugin.\n\n' +
      `Dettaglio: ${nodeLoadError && nodeLoadError.message}`);
    app.quit();
    return;
  }
  try {
    await setup();
  } catch (e) {
    dialog.showErrorBox('ContinuityEdit', `Avvio non riuscito: ${e && e.message}`);
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', cleanUp);
app.on('activate', () => {
  if (handlers && BrowserWindow.getAllWindows().length === 0) createWindow();
});
