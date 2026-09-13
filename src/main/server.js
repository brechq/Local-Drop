const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const EventEmitter = require('events');
const QRCode = require('qrcode');
const NetworkManager = require('./network');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};

function getUniqueFilePath(dir, originalName) {
  // Prevent path traversal
  const safeName = path.basename(originalName);
  const ext = path.extname(safeName);
  const base = path.basename(safeName, ext);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let dest = path.join(dir, safeName);
  let counter = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${base} (${counter})${ext}`);
    counter++;
  }
  return dest;
}

class ReceiverServer extends EventEmitter {
  constructor(settingsManager, historyManager) {
    super();
    this.settingsManager = settingsManager;
    this.historyManager = historyManager;
    this.server = null;
    this.port = 53318;
    this.sessions = new Map();
    this.sharedWebFiles = new Map();
  }

  async start() {
    const settings = this.settingsManager.get();
    let port = settings.port || 53318;

    return new Promise((resolve, reject) => {
      const tryListen = (attemptPort) => {
        const srv = http.createServer((req, res) => this.handleRequest(req, res));

        srv.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.warn(`[Server] Port ${attemptPort} in use, trying ${attemptPort + 1}`);
            tryListen(attemptPort + 1);
          } else {
            console.error('[Server] Server error:', err);
            reject(err);
          }
        });

        srv.listen(attemptPort, '0.0.0.0', () => {
          this.server = srv;
          this.port = attemptPort;
          this.settingsManager.update({ port: attemptPort });
          console.log(`[Server] File transfer HTTP server listening on port ${attemptPort}`);
          resolve(attemptPort);
        });
      };

      tryListen(port);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async handleRequest(req, res) {
    // CORS headers for local LAN calls
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Endpoints:
    // 1. GET /api/info
    if (req.method === 'GET' && pathname === '/api/info') {
      const settings = this.settingsManager.get();
      const platform = NetworkManager.getPlatformInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        deviceId: settings.deviceId,
        deviceName: settings.deviceName,
        deviceType: platform.deviceType,
        deviceModel: platform.deviceModel,
        version: '1.0.0',
        port: this.port
      }));
      return;
    }

    // ==========================================
    // Web & QR Code Share Endpoints (for Mobile)
    // ==========================================

    // GET /share - Mobile web page
    if (req.method === 'GET' && pathname === '/share') {
      const shareHtmlPath = path.join(__dirname, '../web-share/share.html');
      if (fs.existsSync(shareHtmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(shareHtmlPath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Share page not found');
      }
      return;
    }

    // GET /api/share/info - JSON file list for mobile browser
    if (req.method === 'GET' && pathname === '/api/share/info') {
      const settings = this.settingsManager.get();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        senderName: settings.deviceName,
        files: Array.from(this.sharedWebFiles.values()).map(f => ({
          id: f.id,
          name: f.name,
          size: f.size
        }))
      }));
      return;
    }

    // GET /api/share/preview - Stream media with partial content (HTTP 206) for video/audio preview
    if (req.method === 'GET' && pathname === '/api/share/preview') {
      const fileId = parsedUrl.query.fileId;
      const fileItem = this.sharedWebFiles.get(fileId);
      if (!fileItem || !fs.existsSync(fileItem.path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }

      const ext = path.extname(fileItem.path).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(fileItem.path);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(fileItem.path, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mimeType
        });
        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes'
        });
        fs.createReadStream(fileItem.path).pipe(res);
      }
      return;
    }

    // GET /api/share/download - Download file attachment
    if (req.method === 'GET' && pathname === '/api/share/download') {
      const fileId = parsedUrl.query.fileId;
      const fileItem = this.sharedWebFiles.get(fileId);
      if (!fileItem || !fs.existsSync(fileItem.path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }

      const stat = fs.statSync(fileItem.path);
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileItem.name)}"`
      });
      fs.createReadStream(fileItem.path).pipe(res);

      this.historyManager.addEntry({
        direction: 'sent',
        status: 'success',
        peerName: 'Mobile Device (Web Share)',
        peerIp: req.socket.remoteAddress,
        files: [{ name: fileItem.name, size: fileItem.size, path: fileItem.path }],
        totalSize: fileItem.size
      });
      return;
    }

    // GET /api/share/qr - QR Code data URL
    if (req.method === 'GET' && pathname === '/api/share/qr') {
      const shareUrl = this.getShareUrl();
      try {
        const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 2, width: 320 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: shareUrl, qr: qrDataUrl }));
      } catch (qrErr) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: qrErr.message }));
      }
      return;
    }

    // 2. POST /api/prepare-transfer
    if (req.method === 'POST' && pathname === '/api/prepare-transfer') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const { sessionId, sender, files, totalSize } = data;

          if (!sessionId || !files || !Array.isArray(files)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid transfer request' }));
            return;
          }

          const settings = this.settingsManager.get();
          const session = {
            sessionId,
            sender: sender || { deviceName: 'Unknown Device', ip: req.socket.remoteAddress },
            files: files.map(f => ({ ...f, receivedBytes: 0, savedPath: null })),
            totalSize: totalSize || files.reduce((acc, f) => acc + (f.size || 0), 0),
            accepted: false,
            activeWriteStream: null,
            activeFileDest: null,
            status: 'pending',
            startTime: Date.now()
          };

          this.sessions.set(sessionId, session);

          // Check autoAccept
          if (settings.autoAccept) {
            session.accepted = true;
            session.status = 'accepted';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ accepted: true }));
            return;
          }

          // Wait for user decision with 60s timeout
          const decision = await new Promise((resolve) => {
            session.resolveDecision = resolve;
            session.timeoutTimer = setTimeout(() => {
              resolve({ accepted: false, reason: 'timeout' });
            }, 60000);

            // Emit incoming transfer request to renderer
            this.emit('incoming-request', {
              sessionId,
              sender: session.sender,
              files: session.files,
              totalSize: session.totalSize
            });
          });

          if (decision.accepted) {
            session.accepted = true;
            session.status = 'accepted';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ accepted: true }));
          } else {
            session.status = 'declined';
            this.sessions.delete(sessionId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ accepted: false, reason: decision.reason || 'declined' }));
          }
        } catch (err) {
          console.error('[Server] prepare-transfer error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
      return;
    }

    // 3. POST /api/transfer-file
    if (req.method === 'POST' && pathname === '/api/transfer-file') {
      const sessionId = parsedUrl.query.sessionId;
      const fileId = parsedUrl.query.fileId;

      const session = this.sessions.get(sessionId);
      if (!session || !session.accepted) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found or not accepted' }));
        return;
      }

      const fileItem = session.files.find(f => f.id === fileId);
      if (!fileItem) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File item not found' }));
        return;
      }

      const settings = this.settingsManager.get();
      const targetDir = settings.downloadPath || path.join(require('os').homedir(), 'Downloads');
      const destPath = getUniqueFilePath(targetDir, fileItem.name);
      fileItem.savedPath = destPath;

      const writeStream = fs.createWriteStream(destPath);
      session.activeWriteStream = writeStream;
      session.activeFileDest = destPath;

      let receivedThisFile = 0;
      let lastTime = Date.now();
      let lastBytes = 0;
      let currentSpeed = 0;

      // Speed calculation every 500ms
      const speedInterval = setInterval(() => {
        const now = Date.now();
        const durationSec = (now - lastTime) / 1000;
        if (durationSec > 0) {
          currentSpeed = (receivedThisFile - lastBytes) / durationSec;
          lastBytes = receivedThisFile;
          lastTime = now;
        }
      }, 500);

      req.on('data', chunk => {
        receivedThisFile += chunk.length;
        fileItem.receivedBytes = receivedThisFile;

        const canWrite = writeStream.write(chunk);
        if (!canWrite) {
          req.pause();
          writeStream.once('drain', () => req.resume());
        }

        // Calculate total received across all files
        const totalReceived = session.files.reduce((acc, f) => acc + (f.receivedBytes || 0), 0);
        const overallProgress = session.totalSize > 0 
          ? Math.min(100, Math.round((totalReceived / session.totalSize) * 100))
          : 0;

        const remainingBytes = Math.max(0, session.totalSize - totalReceived);
        const remainingSeconds = currentSpeed > 0 ? Math.ceil(remainingBytes / currentSpeed) : 0;

        this.emit('transfer-progress', {
          sessionId,
          direction: 'incoming',
          peerName: session.sender.deviceName,
          currentFile: fileItem.name,
          currentFileIndex: session.files.indexOf(fileItem) + 1,
          totalFiles: session.files.length,
          fileReceivedBytes: receivedThisFile,
          fileTotalBytes: fileItem.size,
          bytesTransferred: totalReceived,
          totalBytes: session.totalSize,
          progress: overallProgress,
          speed: currentSpeed,
          remainingSeconds
        });
      });

      req.on('end', () => {
        writeStream.end();
      });

      writeStream.on('finish', () => {
        clearInterval(speedInterval);
        session.activeWriteStream = null;
        session.activeFileDest = null;

        // Check if all files completed
        const allCompleted = session.files.every(f => f.receivedBytes >= (f.size || 0));

        if (allCompleted) {
          this.historyManager.addEntry({
            direction: 'received',
            status: 'success',
            peerName: session.sender.deviceName,
            peerIp: req.socket.remoteAddress,
            files: session.files.map(f => ({ name: f.name, size: f.size, path: f.savedPath })),
            totalSize: session.totalSize
          });

          this.emit('transfer-completed', {
            sessionId,
            direction: 'incoming',
            peerName: session.sender.deviceName,
            files: session.files.map(f => ({ name: f.name, size: f.size, path: f.savedPath })),
            totalSize: session.totalSize,
            savedPath: session.files[0]?.savedPath
          });

          this.sessions.delete(sessionId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, savedPath: destPath }));
      });

      req.on('error', (err) => {
        clearInterval(speedInterval);
        console.error('[Server] Transfer file stream error:', err);
        this.cleanupFailedFile(writeStream, destPath);

        this.historyManager.addEntry({
          direction: 'received',
          status: 'failed',
          peerName: session.sender.deviceName,
          peerIp: req.socket.remoteAddress,
          files: session.files,
          totalSize: session.totalSize,
          error: 'Connection interrupted during transfer'
        });

        this.emit('transfer-failed', {
          sessionId,
          direction: 'incoming',
          peerName: session.sender.deviceName,
          error: 'The connection was interrupted.'
        });

        this.sessions.delete(sessionId);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Transfer failed' }));
      });

      return;
    }

    // 4. POST /api/cancel-transfer
    if (req.method === 'POST' && pathname === '/api/cancel-transfer') {
      const sessionId = parsedUrl.query.sessionId;
      const session = this.sessions.get(sessionId);
      if (session) {
        if (session.activeWriteStream) {
          this.cleanupFailedFile(session.activeWriteStream, session.activeFileDest);
        }
        this.sessions.delete(sessionId);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ canceled: true }));
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  respondIncomingTransfer(sessionId, accepted) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = null;
    }

    if (session.resolveDecision) {
      session.resolveDecision({ accepted });
      return true;
    }
    return false;
  }

  cleanupFailedFile(writeStream, filePath) {
    try {
      if (writeStream && !writeStream.destroyed) {
        writeStream.destroy();
      }
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn('[Server] Cleanup partial file failed:', err.message);
    }
  }

  setSharedFiles(files) {
    this.sharedWebFiles.clear();
    if (!files || !Array.isArray(files)) return [];
    const list = [];
    files.forEach((f, idx) => {
      const id = `share_${idx}_${Date.now()}`;
      const item = { id, path: f.path, name: f.name, size: f.size };
      this.sharedWebFiles.set(id, item);
      list.push(item);
    });
    return list;
  }

  clearSharedFiles() {
    this.sharedWebFiles.clear();
  }

  getShareUrl() {
    const primary = NetworkManager.getPrimaryInterface();
    const ip = primary.address || '127.0.0.1';
    return `http://${ip}:${this.port}/share`;
  }

  async getQrCodeDataUrl() {
    const shareUrl = this.getShareUrl();
    return await QRCode.toDataURL(shareUrl, { margin: 2, width: 320 });
  }
}

module.exports = ReceiverServer;
