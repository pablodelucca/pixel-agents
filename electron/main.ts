import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

import { AppController } from './appController.js';

let mainWindow: BrowserWindow | null = null;
let controller: AppController | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const indexPath = path.join(__dirname, '..', 'dist', 'webview', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

export function sendToRenderer(message: unknown): void {
  mainWindow?.webContents.send('main-message', message);
}

app.whenReady().then(() => {
  createWindow();

  // Create controller after window exists so sendToRenderer works
  controller = new AppController(sendToRenderer, app.getAppPath());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  controller?.dispose();
  controller = null;
  app.quit();
});

// IPC: renderer -> main → AppController
ipcMain.on('webview-message', (_event, message: unknown) => {
  if (controller) {
    controller.handleMessage(message);
  } else {
    console.log('[Main] No controller, message dropped:', JSON.stringify(message));
  }
});
