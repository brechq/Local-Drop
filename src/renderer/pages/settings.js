class SettingsPage {
  constructor() {
    this.inputDeviceName = document.getElementById('setting-device-name');
    this.btnSaveName = document.getElementById('btn-save-device-name');
    this.inputDownloadPath = document.getElementById('setting-download-path');
    this.btnBrowsePath = document.getElementById('btn-browse-download-path');
    this.chkAutoAccept = document.getElementById('setting-auto-accept');
    this.chkStartWindows = document.getElementById('setting-start-windows');

    this.netIp = document.getElementById('net-ip');
    this.netMask = document.getElementById('net-mask');
    this.netPort = document.getElementById('net-port');
    this.netDiscPort = document.getElementById('net-disc-port');
    this.netStatus = document.getElementById('net-status');

    this.init();
  }

  init() {
    // Save device name
    this.btnSaveName.addEventListener('click', async () => {
      const newName = this.inputDeviceName.value.trim();
      if (!newName) return;
      await window.localdrop.saveSettings({ deviceName: newName });
      window.app.showToast('Device name saved');
    });

    // Browse download location
    this.btnBrowsePath.addEventListener('click', async () => {
      const selected = await window.localdrop.chooseDownloadFolder();
      if (selected) {
        this.inputDownloadPath.value = selected;
        window.app.showToast('Download location updated');
      }
    });

    // Auto-accept toggle
    this.chkAutoAccept.addEventListener('change', async () => {
      await window.localdrop.saveSettings({ autoAccept: this.chkAutoAccept.checked });
      window.app.showToast(`Auto-accept ${this.chkAutoAccept.checked ? 'enabled' : 'disabled'}`);
    });

    // Start with Windows toggle
    this.chkStartWindows.addEventListener('change', async () => {
      await window.localdrop.saveSettings({ startWithWindows: this.chkStartWindows.checked });
      window.app.showToast(`Start with Windows ${this.chkStartWindows.checked ? 'enabled' : 'disabled'}`);
    });
  }

  async load() {
    try {
      const settings = await window.localdrop.getSettings();
      if (settings) {
        this.inputDeviceName.value = settings.deviceName || '';
        this.inputDownloadPath.value = settings.downloadPath || '';
        this.chkAutoAccept.checked = !!settings.autoAccept;
        this.chkStartWindows.checked = !!settings.startWithWindows;
      }

      const net = await window.localdrop.getNetworkInfo();
      if (net) {
        this.netIp.textContent = net.ip || '127.0.0.1';
        this.netMask.textContent = net.netmask || '255.255.255.0';
        this.netPort.textContent = net.port || '53318';
        this.netDiscPort.textContent = net.discoveryPort || '53317';
        this.netStatus.textContent = 'Active (LAN)';
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }
}
