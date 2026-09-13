const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

class HistoryManager {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'history.json');
    this.history = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.warn('Failed to read history, resetting:', err.message);
    }
    return [];
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save history:', err);
    }
  }

  addEntry({ direction, status, peerName, peerIp, files, totalSize, error = null }) {
    const entry = {
      id: crypto.randomUUID(),
      direction, // 'sent' or 'received'
      status, // 'success' or 'failed'
      peerName: peerName || 'Unknown Device',
      peerIp: peerIp || '',
      files: files || [],
      totalSize: totalSize || 0,
      timestamp: Date.now(),
      error
    };

    this.history.unshift(entry);
    // Keep last 200 entries
    if (this.history.length > 200) {
      this.history = this.history.slice(0, 200);
    }

    this.save();
    return entry;
  }

  getAll() {
    return [...this.history];
  }

  clear() {
    this.history = [];
    this.save();
    return [];
  }
}

module.exports = HistoryManager;
