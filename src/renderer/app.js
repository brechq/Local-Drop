class App {
  constructor() {
    this.activeTab = 'home';
    this.activeSessionId = null;
    this.lastSavedPath = null;
    this.lastIncomingSession = null;
    this.lastOutgoingPeer = null;
    this.lastOutgoingFiles = null;

    this.homePage = null;
    this.historyPage = null;
    this.settingsPage = null;

    this.init();
  }

  async init() {
    // Populate Navigation Icons
    document.getElementById('nav-icon-home').innerHTML = Icons.upload;
    document.getElementById('nav-icon-history').innerHTML = Icons.history;
    document.getElementById('nav-icon-settings').innerHTML = Icons.settings;

    // Initialize Pages
    this.homePage = new HomePage();
    this.historyPage = new HistoryPage();
    this.settingsPage = new SettingsPage();

    // Setup Tab Switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const targetPage = tab.getAttribute('data-page');
        this.switchTab(targetPage);
      });
    });

    // Setup Modals
    this.setupModals();

    // Setup IPC listeners
    this.setupIpcListeners();

    // Load initial network info & peers
    await this.refreshNetworkInfo();
    await this.refreshPeers();
  }

  switchTab(pageName) {
    this.activeTab = pageName;

    // Update tab styles
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-page') === pageName);
    });

    // Update view visibility
    document.querySelectorAll('.page-view').forEach(v => {
      v.classList.toggle('active', v.id === `view-${pageName}`);
    });

    if (pageName === 'history') {
      this.historyPage.load();
    } else if (pageName === 'settings') {
      this.settingsPage.load();
    }
  }

  async refreshNetworkInfo() {
    try {
      const net = await window.localdrop.getNetworkInfo();
      const ipText = document.getElementById('header-ip-text');
      if (net && net.ip) {
        ipText.textContent = `Online \u2022 ${net.ip}`;
      } else {
        ipText.textContent = 'Offline';
      }
    } catch (err) {
      console.error('Failed to load network info:', err);
    }
  }

  async refreshPeers() {
    try {
      const peers = await window.localdrop.getPeers();
      this.homePage.updatePeers(peers);
    } catch (err) {
      console.error('Failed to load peers:', err);
    }
  }

  setupModals() {
    // Incoming Modal buttons
    const modalIncoming = document.getElementById('modal-incoming');
    const btnDecline = document.getElementById('btn-decline-transfer');
    const btnAccept = document.getElementById('btn-accept-transfer');

    btnDecline.addEventListener('click', async () => {
      modalIncoming.classList.remove('active');
      if (this.lastIncomingSession) {
        await window.localdrop.respondIncomingTransfer(this.lastIncomingSession.sessionId, false);
      }
    });

    btnAccept.addEventListener('click', async () => {
      modalIncoming.classList.remove('active');
      if (this.lastIncomingSession) {
        await window.localdrop.respondIncomingTransfer(this.lastIncomingSession.sessionId, true);
        this.openProgressModal('incoming', this.lastIncomingSession.sender.deviceName, this.lastIncomingSession.files[0]?.name);
      }
    });

    // Progress Modal cancel button
    const btnCancel = document.getElementById('btn-cancel-transfer');
    btnCancel.addEventListener('click', async () => {
      if (this.activeSessionId) {
        await window.localdrop.cancelTransfer(this.activeSessionId);
      }
      this.closeProgressModal();
    });

    // Downloaded Modal buttons
    const modalDownloaded = document.getElementById('modal-downloaded');
    const btnOpenFolder = document.getElementById('btn-open-folder');
    const btnCloseDownloaded = document.getElementById('btn-close-downloaded');

    btnOpenFolder.addEventListener('click', () => {
      window.localdrop.openDownloadFolder(this.lastSavedPath);
      modalDownloaded.classList.remove('active');
    });

    btnCloseDownloaded.addEventListener('click', () => {
      modalDownloaded.classList.remove('active');
    });

    // Failed Modal buttons
    const modalFailed = document.getElementById('modal-failed');
    const btnCloseFailed = document.getElementById('btn-close-failed');
    const btnRetryFailed = document.getElementById('btn-retry-transfer');

    btnCloseFailed.addEventListener('click', () => {
      modalFailed.classList.remove('active');
    });

    btnRetryFailed.addEventListener('click', async () => {
      modalFailed.classList.remove('active');
      if (this.lastOutgoingPeer && this.lastOutgoingFiles) {
        this.homePage.initiateSend(this.lastOutgoingPeer);
      } else {
        this.showToast('Please select files and try again');
      }
    });

    // QR Share Modal buttons
    const modalQr = document.getElementById('modal-qr-share');
    const btnCloseQrTop = document.getElementById('btn-close-qr-top');
    const btnCloseQr = document.getElementById('btn-close-qr-share');
    const btnStopQr = document.getElementById('btn-stop-qr-share');
    const btnCopyUrl = document.getElementById('btn-copy-share-url');

    if (btnCloseQrTop) {
      btnCloseQrTop.innerHTML = Icons.close;
      btnCloseQrTop.addEventListener('click', () => modalQr.classList.remove('active'));
    }

    if (btnCloseQr) {
      btnCloseQr.addEventListener('click', () => modalQr.classList.remove('active'));
    }

    if (btnStopQr) {
      btnStopQr.addEventListener('click', async () => {
        await window.localdrop.stopWebShare();
        modalQr.classList.remove('active');
        this.showToast('Web share stopped');
      });
    }

    if (btnCopyUrl) {
      btnCopyUrl.addEventListener('click', () => {
        if (this.activeShareUrl) {
          navigator.clipboard.writeText(this.activeShareUrl);
          this.showToast('Link copied to clipboard');
        }
      });
    }
  }

  async openQrShareModal(files) {
    try {
      const res = await window.localdrop.startWebShare(files);
      if (res.success) {
        this.activeShareUrl = res.url;
        document.getElementById('qr-image').src = res.qrDataUrl;
        document.getElementById('qr-share-url-text').textContent = res.url;
        document.getElementById('modal-qr-share').classList.add('active');
      } else {
        this.showToast('Failed to start web share');
      }
    } catch (err) {
      console.error('Error starting web share:', err);
      this.showToast('Error sharing files');
    }
  }

  setupIpcListeners() {
    // Peers updated
    window.localdrop.onPeersUpdated((peers) => {
      this.homePage.updatePeers(peers);
    });

    // Incoming transfer request
    window.localdrop.onIncomingRequest((data) => {
      this.lastIncomingSession = data;
      this.activeSessionId = data.sessionId;

      document.getElementById('incoming-sender-name').textContent = data.sender.deviceName || 'A device';
      const fileCount = data.files.length;
      const firstName = data.files[0]?.name || 'File';
      document.getElementById('incoming-file-summary').textContent = fileCount > 1 
        ? `${firstName} (+${fileCount - 1} more)` 
        : firstName;
      document.getElementById('incoming-file-size').textContent = `${formatBytes(data.totalSize)} \u2022 ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;

      document.getElementById('modal-incoming').classList.add('active');
    });

    // Transfer starting
    window.localdrop.onTransferStarting((data) => {
      this.openProgressModal('outgoing', data.peerName, 'Preparing files...');
    });

    // Transfer progress
    window.localdrop.onTransferProgress((data) => {
      this.updateProgressModal(data);
    });

    // Transfer completed
    window.localdrop.onTransferCompleted((data) => {
      this.closeProgressModal();
      this.lastSavedPath = data.savedPath;

      if (data.direction === 'incoming') {
        // Show Downloaded! state modal as requested
        const modal = document.getElementById('modal-downloaded');
        const firstName = data.files[0]?.name || 'File';
        const moreCount = data.files.length > 1 ? ` (+${data.files.length - 1} more)` : '';
        document.getElementById('downloaded-filename').textContent = `${firstName}${moreCount}`;
        document.getElementById('downloaded-filesize').textContent = formatBytes(data.totalSize);
        modal.classList.add('active');
      } else {
        this.showToast('Files sent successfully!');
      }

      if (this.activeTab === 'history') {
        this.historyPage.load();
      }
    });

    // Transfer failed
    window.localdrop.onTransferFailed((data) => {
      this.closeProgressModal();
      const modal = document.getElementById('modal-failed');
      document.getElementById('failed-reason-text').textContent = data.error || 'The file could not be transferred.';
      modal.classList.add('active');

      if (this.activeTab === 'history') {
        this.historyPage.load();
      }
    });
  }

  startOutgoingTransfer(peer, files) {
    this.lastOutgoingPeer = peer;
    this.lastOutgoingFiles = files;
    this.openProgressModal('outgoing', peer.deviceName, files[0]?.name);
  }

  openProgressModal(direction, peerName, fileName) {
    const modal = document.getElementById('modal-progress');
    document.getElementById('progress-modal-title').textContent = direction === 'outgoing' ? 'Sending files' : 'Receiving files';
    document.getElementById('progress-peer-text').textContent = direction === 'outgoing' ? `To ${peerName}` : `From ${peerName}`;
    document.getElementById('progress-file-name').textContent = fileName || 'Connecting...';
    document.getElementById('progress-bar-fill').style.width = '0%';
    document.getElementById('progress-percent').textContent = '0%';
    document.getElementById('progress-bytes').textContent = '0 B';
    document.getElementById('progress-speed').textContent = '0.0 MB/s';
    document.getElementById('progress-eta').textContent = 'Estimating remaining time...';

    modal.classList.add('active');
  }

  updateProgressModal(data) {
    this.activeSessionId = data.sessionId;
    const currentFileText = data.totalFiles > 1 
      ? `[${data.currentFileIndex || 1}/${data.totalFiles}] ${data.currentFile}`
      : data.currentFile;

    document.getElementById('progress-file-name').textContent = currentFileText;
    document.getElementById('progress-bar-fill').style.width = `${data.progress}%`;
    document.getElementById('progress-percent').textContent = `${data.progress}%`;
    document.getElementById('progress-bytes').textContent = `${formatBytes(data.bytesTransferred)} / ${formatBytes(data.totalBytes)}`;
    document.getElementById('progress-speed').textContent = `${formatBytes(data.speed)}/s`;

    if (data.remainingSeconds > 0) {
      document.getElementById('progress-eta').textContent = `About ${data.remainingSeconds}s remaining`;
    } else {
      document.getElementById('progress-eta').textContent = 'Finishing transfer...';
    }
  }

  closeProgressModal() {
    document.getElementById('modal-progress').classList.remove('active');
    this.activeSessionId = null;
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span>${Icons.check}</span>
      <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
