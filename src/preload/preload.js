const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localdrop', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  chooseDownloadFolder: () => ipcRenderer.invoke('choose-download-folder'),

  // Network
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),

  // Discovery & Peers
  getPeers: () => ipcRenderer.invoke('get-peers'),
  scanPeers: () => ipcRenderer.invoke('scan-peers'),

  // File Picker
  selectFiles: () => ipcRenderer.invoke('select-files'),

  // Transfer Actions
  sendFiles: (peer, filePaths) => ipcRenderer.invoke('send-files', { peer, filePaths }),
  respondIncomingTransfer: (sessionId, accepted) => ipcRenderer.invoke('respond-incoming-transfer', { sessionId, accepted }),
  cancelTransfer: (sessionId) => ipcRenderer.invoke('cancel-transfer', { sessionId }),
  openDownloadFolder: (filePath) => ipcRenderer.invoke('open-download-folder', filePath),

  // Web & QR Code Share
  startWebShare: (files) => ipcRenderer.invoke('start-web-share', files),
  stopWebShare: () => ipcRenderer.invoke('stop-web-share'),
  getShareStatus: () => ipcRenderer.invoke('get-share-status'),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // Real-time Event Listeners
  onPeersUpdated: (callback) => {
    const handler = (_, peers) => callback(peers);
    ipcRenderer.on('peers-updated', handler);
    return () => ipcRenderer.removeListener('peers-updated', handler);
  },
  onIncomingRequest: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('incoming-transfer-request', handler);
    return () => ipcRenderer.removeListener('incoming-transfer-request', handler);
  },
  onTransferStarting: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('transfer-starting', handler);
    return () => ipcRenderer.removeListener('transfer-starting', handler);
  },
  onTransferProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('transfer-progress', handler);
    return () => ipcRenderer.removeListener('transfer-progress', handler);
  },
  onTransferCompleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('transfer-completed', handler);
    return () => ipcRenderer.removeListener('transfer-completed', handler);
  },
  onTransferFailed: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('transfer-failed', handler);
    return () => ipcRenderer.removeListener('transfer-failed', handler);
  }
});
