const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');

class SettingsManager {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = this.load();
  }

  getDefaults() {
    let defaultDownload = '';
    try {
      defaultDownload = app.getPath('downloads');
    } catch {
      defaultDownload = path.join(os.homedir(), 'Downloads');
    }

    return {
      deviceId: crypto.randomUUID(),
      deviceName: os.hostname() || 'My PC',
      downloadPath: defaultDownload,
      autoAccept: false,
      startWithWindows: false,
      port: 53318,
      discoveryPort: 53317,
      theme: 'dark'
    };
  }

  load() {
    const defaults = this.getDefaults();
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        return { ...defaults, ...data };
      }
    } catch (err) {
      console.warn('Failed to read settings file, using defaults:', err.message);
    }
    this.save(defaults);
    return defaults;
  }

  save(data = this.settings) {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      this.settings = data;
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  get() {
    return { ...this.settings };
  }

  update(newSettings) {
    const previous = { ...this.settings };
    this.settings = { ...this.settings, ...newSettings };
    this.save(this.settings);

    // If startWithWindows changed
    if (newSettings.startWithWindows !== undefined && newSettings.startWithWindows !== previous.startWithWindows) {
      try {
        app.setLoginItemSettings({
          openAtLogin: !!newSettings.startWithWindows,
          path: process.execPath
        });
      } catch (err) {
        console.warn('Failed to update login item settings:', err.message);
      }
    }

    return this.settings;
  }
}

module.exports = SettingsManager;
