const { app, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { createMainWindow } = require('./window');
const SettingsManager = require('./settings');
const NetworkManager = require('./network');
const DiscoveryEngine = require('./discovery');
const HistoryManager = require('./history');
const ReceiverServer = require('./server');
const TransferClient = require('./transfer');

// Allow secondary instance for local testing if requested via CLI arg
const isAllowSecondary = process.argv.includes('--secondary-instance');
if (!isAllowSecondary) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  }
}

let mainWindow = null;
let settingsManager = null;
let historyManager = null;
let discoveryEngine = null;
let receiverServer = null;
let transferClient = null;

async function initializeApp() {
  settingsManager = new SettingsManager();
  historyManager = new HistoryManager();

  // If running as secondary instance, randomize deviceId & port
  if (isAllowSecondary) {
    const current = settingsManager.get();
    settingsManager.update({
      deviceId: require('crypto').randomUUID(),
      deviceName: `${current.deviceName} (2)`,
      port: (current.port || 53318) + 1
    });
  }

  receiverServer = new ReceiverServer(settingsManager, historyManager);
  await receiverServer.start();

  discoveryEngine = new DiscoveryEngine(settingsManager);
  discoveryEngine.start();

  transferClient = new TransferClient(settingsManager, historyManager);

  mainWindow = createMainWindow();

  // Handle second instance activation
  if (!isAllowSecondary) {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }

  // Forward discovery events to renderer
  discoveryEngine.on('peers-updated', (peers) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('peers-updated', peers);
    }
  });

  // Forward receiver server events to renderer
  receiverServer.on('incoming-request', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('incoming-transfer-request', data);
    }
  });

  receiverServer.on('transfer-progress', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer-progress', data);
    }
  });

  receiverServer.on('transfer-completed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer-completed', data);
    }
  });

  receiverServer.on('transfer-failed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer-failed', data);
    }
  });

  // Forward transfer client events to renderer
  transferClient.on('transfer-starting', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer-starting', data);
    }
  });

  transferClient.on('transfer-progress', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer-progress', data);
    }
  });

  transferClient.on('transfer-completed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer-completed', data);
    }
  });

  transferClient.on('transfer-failed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer-failed', data);
    }
  });

  registerIpcHandlers();
}

function registerIpcHandlers() {
  // Settings
  ipcMain.handle('get-settings', () => {
    return settingsManager.get();
  });

  ipcMain.handle('save-settings', (event, newSettings) => {
    const updated = settingsManager.update(newSettings);
    // Announce updated name to LAN
    if (discoveryEngine) {
      discoveryEngine.sendAnnounce();
    }
    return updated;
  });

  ipcMain.handle('choose-download-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Download Folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const selected = res.filePaths[0];
      settingsManager.update({ downloadPath: selected });
      return selected;
    }
    return null;
  });

  // Network
  ipcMain.handle('get-network-info', () => {
    const primary = NetworkManager.getPrimaryInterface();
    const settings = settingsManager.get();
    return {
      ip: primary.address,
      netmask: primary.netmask,
      name: primary.name,
      port: receiverServer ? receiverServer.port : settings.port,
      discoveryPort: 53317,
      status: 'Active',
      interfaces: NetworkManager.getInterfaces()
    };
  });

  // Peers / Discovery
  ipcMain.handle('get-peers', () => {
    return discoveryEngine ? discoveryEngine.getPeers() : [];
  });

  ipcMain.handle('scan-peers', () => {
    if (discoveryEngine) {
      discoveryEngine.scanNow();
    }
    return true;
  });

  // File Picker
  ipcMain.handle('select-files', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Files to Send',
      properties: ['openFile', 'multiSelections']
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths.map(fp => {
        const stat = fs.statSync(fp);
        return {
          path: fp,
          name: path.basename(fp),
          size: stat.size
        };
      });
    }
    return [];
  });

  // Transfer actions
  ipcMain.handle('send-files', async (event, { peer, filePaths }) => {
    try {
      await transferClient.sendFiles(peer, filePaths);
      return { success: true };
    } catch (err) {
      console.error('[Main] send-files error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('respond-incoming-transfer', (event, { sessionId, accepted }) => {
    return receiverServer.respondIncomingTransfer(sessionId, accepted);
  });

  ipcMain.handle('cancel-transfer', (event, { sessionId }) => {
    if (transferClient) {
      transferClient.cancelTransfer(sessionId);
    }
    return true;
  });

  // Open download folder / item
  ipcMain.handle('open-download-folder', (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    } else {
      const settings = settingsManager.get();
      const folder = settings.downloadPath || app.getPath('downloads');
      if (fs.existsSync(folder)) {
        shell.openPath(folder);
      }
    }
    return true;
  });

  // Web & QR Code Share
  ipcMain.handle('start-web-share', async (event, files) => {
    if (receiverServer) {
      const shared = receiverServer.setSharedFiles(files);
      const url = receiverServer.getShareUrl();
      const qrDataUrl = await receiverServer.getQrCodeDataUrl();
      return { success: true, url, qrDataUrl, count: shared.length };
    }
    return { success: false, error: 'Server not ready' };
  });

  ipcMain.handle('stop-web-share', () => {
    if (receiverServer) {
      receiverServer.clearSharedFiles();
    }
    return true;
  });

  ipcMain.handle('get-share-status', async () => {
    if (receiverServer) {
      const count = receiverServer.sharedWebFiles.size;
      const url = receiverServer.getShareUrl();
      const qrDataUrl = count > 0 ? await receiverServer.getQrCodeDataUrl() : null;
      return { active: count > 0, count, url, qrDataUrl };
    }
    return { active: false, count: 0 };
  });

  // History
  ipcMain.handle('get-history', () => {
    return historyManager.getAll();
  });

  ipcMain.handle('clear-history', () => {
    return historyManager.clear();
  });
}

app.whenReady().then(initializeApp);

app.on('window-all-closed', () => {
  if (discoveryEngine) {
    discoveryEngine.stop();
  }
  if (receiverServer) {
    receiverServer.stop();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (discoveryEngine) {
    discoveryEngine.stop();
  }
  if (receiverServer) {
    receiverServer.stop();
  }
});
