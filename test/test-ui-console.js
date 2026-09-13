const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const SettingsManager = require('../src/main/settings');
const HistoryManager = require('../src/main/history');
const NetworkManager = require('../src/main/network');
const DiscoveryEngine = require('../src/main/discovery');
const ReceiverServer = require('../src/main/server');
const TransferClient = require('../src/main/transfer');

app.whenReady().then(async () => {
  console.log('>>> Testing UI Loading & Console Output...\n');

  const settingsManager = new SettingsManager();
  const historyManager = new HistoryManager();
  const receiverServer = new ReceiverServer(settingsManager, historyManager);
  await receiverServer.start();
  const discoveryEngine = new DiscoveryEngine(settingsManager);
  discoveryEngine.start();
  const transferClient = new TransferClient(settingsManager, historyManager);

  // Register all handlers
  ipcMain.handle('get-settings', () => settingsManager.get());
  ipcMain.handle('save-settings', (e, s) => settingsManager.update(s));
  ipcMain.handle('choose-download-folder', async () => null);
  ipcMain.handle('get-network-info', () => {
    const primary = NetworkManager.getPrimaryInterface();
    return {
      ip: primary.address,
      netmask: primary.netmask,
      name: primary.name,
      port: receiverServer.port,
      discoveryPort: 53317,
      status: 'Active',
      interfaces: NetworkManager.getInterfaces()
    };
  });
  ipcMain.handle('get-peers', () => discoveryEngine.getPeers());
  ipcMain.handle('scan-peers', () => discoveryEngine.scanNow());
  ipcMain.handle('select-files', async () => []);
  ipcMain.handle('send-files', async () => ({ success: true }));
  ipcMain.handle('respond-incoming-transfer', () => true);
  ipcMain.handle('cancel-transfer', () => true);
  ipcMain.handle('open-download-folder', () => true);
  ipcMain.handle('get-history', () => historyManager.getAll());
  ipcMain.handle('clear-history', () => historyManager.clear());
  ipcMain.handle('start-web-share', async () => ({ success: true, url: 'http://127.0.0.1:53318/share', qrDataUrl: 'data:image/png;base64,test' }));
  ipcMain.handle('stop-web-share', () => true);
  ipcMain.handle('get-share-status', () => ({ active: false, count: 0 }));

  const consoleErrors = [];
  const consoleMessages = [];

  const win = new BrowserWindow({
    show: false,
    width: 960,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, '../src/preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.on('console-message', (event) => {
    consoleMessages.push(event.message);
    if (event.level >= 2) { // 2 = warning, 3 = error
      consoleErrors.push(`[Console ${event.level === 3 ? 'ERROR' : 'WARN'}] ${event.message}`);
    }
  });

  // Load index.html
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  console.log('1. Loaded index.html successfully.');

  // Wait 1 second for renderer init
  await new Promise(r => setTimeout(r, 1000));

  // Evaluate DOM checks and tab switching
  const domCheck = await win.webContents.executeJavaScript(`
    (() => {
      const results = {
        title: document.title,
        hasHeaderLogo: !!document.getElementById('header-logo'),
        hasDropZone: !!document.getElementById('drop-zone'),
        tabs: Array.from(document.querySelectorAll('.nav-tab')).map(t => t.getAttribute('data-page')),
        activePage: document.querySelector('.page-view.active')?.id
      };

      // Test tab switching
      document.getElementById('tab-history').click();
      results.historyTabActive = document.getElementById('view-history').classList.contains('active');

      document.getElementById('tab-settings').click();
      results.settingsTabActive = document.getElementById('view-settings').classList.contains('active');

      document.getElementById('tab-home').click();
      results.homeTabActive = document.getElementById('view-home').classList.contains('active');

      return results;
    })()
  `);

  console.log('2. DOM and Navigation Verification:', JSON.stringify(domCheck, null, 2));

  // Check console errors
  console.log('3. Console messages count:', consoleMessages.length);
  if (consoleErrors.length > 0) {
    console.error('Console ERRORS found:\n', consoleErrors.join('\n'));
    process.exit(1);
  } else {
    console.log('   ZERO console errors detected! Clean UI load verified.');
  }

  console.log('\n>>> UI Console Test PASSED successfully!\n');
  app.exit(0);
});
