const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { createMenu } = require('./menu.js');
const { createStateStore } = require('./stateStore.js');

let mainWindow = null;
let stateStore = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Pixel Agents',
    backgroundColor: '#1E1E2E',
  });

  const indexPath = path.join(__dirname, '..', 'dist', 'webview', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIpcHandlers() {
  stateStore = createStateStore();

  // State persistence
  ipcMain.handle('get-state', (_event, key) => {
    return stateStore.get(key);
  });

  ipcMain.handle('set-state', (_event, key, val) => {
    stateStore.set(key, val);
  });

  // Dialogs
  ipcMain.handle('show-save-dialog', async (_event, opts) => {
    const result = await dialog.showSaveDialog(mainWindow, opts || {});
    return result;
  });

  ipcMain.handle('show-open-dialog', async (_event, opts) => {
    const result = await dialog.showOpenDialog(mainWindow, opts || {});
    return result;
  });

  ipcMain.handle('show-message', async (_event, opts) => {
    const result = await dialog.showMessageBox(mainWindow, opts || {});
    return result;
  });

  // File operations
  ipcMain.on('open-path', (_event, targetPath) => {
    shell.openPath(targetPath);
  });

  // Webview messages (pass-through for future IPC bridge in Phase 2)
  ipcMain.on('webview-message', (_event, msg) => {
    handleWebviewMessage(msg);
  });
}

function handleWebviewMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'webviewReady':
      sendToRenderer('settingsLoaded', {
        soundEnabled: stateStore.get('soundEnabled', true),
      });
      // Send workspace/project directory info
      const projectDir = stateStore.get('projectDirectory', null);
      if (projectDir) {
        sendToRenderer('workspaceFolders', {
          folders: [{ name: path.basename(projectDir), path: projectDir }],
        });
      }
      // Load persisted layout
      const { loadLayout } = require('./layoutBridge.js');
      const layout = loadLayout();
      sendToRenderer('layoutLoaded', { layout });
      // Restore persisted agents
      const agents = stateStore.get('agents', []);
      const agentSeats = stateStore.get('agentSeats', {});
      if (agents.length > 0) {
        sendToRenderer('existingAgents', {
          agents: agents.map((a) => a.id),
          agentMeta: agentSeats,
          folderNames: {},
        });
      }
      break;

    case 'saveLayout': {
      const { saveLayout } = require('./layoutBridge.js');
      saveLayout(msg.layout);
      break;
    }

    case 'saveAgentSeats':
      stateStore.set('agentSeats', msg.seats);
      break;

    case 'setSoundEnabled':
      stateStore.set('soundEnabled', msg.enabled);
      break;

    case 'openSessionsFolder': {
      const sessionsDir = stateStore.get('projectDirectory') || app.getPath('home');
      shell.openPath(sessionsDir);
      break;
    }

    case 'exportLayout':
      exportLayout();
      break;

    case 'importLayout':
      importLayout();
      break;

    case 'openClaude':
      // Phase 2: will launch terminal via node-pty
      console.log('[Main] openClaude requested (Phase 2)');
      break;

    case 'focusAgent':
      // Phase 2: terminal focus
      break;

    case 'closeAgent':
      // Phase 2: terminal close
      break;
  }
}

function sendToRenderer(type, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('main-message', { type, ...data });
  }
}

async function exportLayout() {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    defaultPath: 'layout.json',
  });
  if (!result.canceled && result.filePath) {
    const { loadLayout } = require('./layoutBridge.js');
    const layout = loadLayout();
    if (layout) {
      const fs = require('fs');
      fs.writeFileSync(result.filePath, JSON.stringify(layout, null, 2));
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'Layout exported successfully.',
      });
    } else {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        message: 'No saved layout to export.',
      });
    }
  }
}

async function importLayout() {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const fs = require('fs');
      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      const layout = JSON.parse(content);
      if (!layout || typeof layout !== 'object') {
        throw new Error('Invalid format');
      }
      const { saveLayout } = require('./layoutBridge.js');
      saveLayout(layout);
      sendToRenderer('layoutLoaded', { layout });
    } catch {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        message: 'Invalid layout file.',
      });
    }
  }
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();
  createMenu(mainWindow, { exportLayout, importLayout });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

module.exports = { sendToRenderer };
