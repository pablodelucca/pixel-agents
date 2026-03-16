const { Menu, app, shell } = require('electron');

function createMenu(mainWindow, handlers) {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Export Layout...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => handlers.exportLayout(),
        },
        {
          label: 'Import Layout...',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => handlers.importLayout(),
        },
        { type: 'separator' },
        {
          label: 'Open Sessions Folder',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('main-message', {
                type: 'openSessionsFolder',
              });
            }
            // Also handled via webview message, but menu can trigger directly
            const path = require('path');
            const os = require('os');
            shell.openPath(path.join(os.homedir(), '.pixel-agents'));
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Pixel Agents',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Pixel Agents',
              message: 'Pixel Agents',
              detail:
                'Pixel art office where your Claude Code agents come to life as animated characters.\n\nVersion 2.0.0',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { createMenu };
