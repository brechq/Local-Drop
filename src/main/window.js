const { BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function createMainWindow() {
  const iconPath = path.join(__dirname, '../../asset/icon.png');

  const win = new BrowserWindow({
    title: 'Brechq LocalDrop',
    width: 960,
    height: 720,
    minWidth: 840,
    minHeight: 600,
    icon: iconPath,
    backgroundColor: '#0f172a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  Menu.setApplicationMenu(null);

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.once('ready-to-show', () => {
    win.show();
  });

  // Open external links in user's default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

module.exports = { createMainWindow };
