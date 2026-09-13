const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const NetworkManager = require('./network');

class TransferClient extends EventEmitter {
  constructor(settingsManager, historyManager) {
    super();
    this.settingsManager = settingsManager;
    this.historyManager = historyManager;
    this.activeTransfers = new Map();
  }

  async sendFiles(peer, filePaths) {
    if (!peer || !peer.ip || !peer.port) {
      throw new Error('Invalid peer information');
    }

    if (!filePaths || filePaths.length === 0) {
      throw new Error('No files selected for transfer');
    }

    // Validate files and gather metadata
    const fileInfos = [];
    for (let i = 0; i < filePaths.length; i++) {
      const fp = filePaths[i];
      if (!fs.existsSync(fp)) {
        throw new Error(`File does not exist: ${fp}`);
      }
      const stat = fs.statSync(fp);
      fileInfos.push({
        id: `file_${i}_${Date.now()}`,
        name: path.basename(fp),
        path: fp,
        size: stat.size,
        sentBytes: 0
      });
    }

    const totalSize = fileInfos.reduce((acc, f) => acc + f.size, 0);
    const sessionId = crypto.randomUUID();
    const settings = this.settingsManager.get();
    const platform = NetworkManager.getPlatformInfo();

    const transferSession = {
      sessionId,
      peer,
      files: fileInfos,
      totalSize,
      canceled: false,
      activeReq: null,
      activeReadStream: null
    };

    this.activeTransfers.set(sessionId, transferSession);

    // Step 1: Handshake
    this.emit('transfer-starting', {
      sessionId,
      peerName: peer.deviceName,
      totalFiles: fileInfos.length,
      totalSize
    });

    try {
      const preparePayload = JSON.stringify({
        sessionId,
        sender: {
          deviceId: settings.deviceId,
          deviceName: settings.deviceName,
          deviceType: platform.deviceType,
          deviceModel: platform.deviceModel
        },
        files: fileInfos.map(f => ({ id: f.id, name: f.name, size: f.size })),
        totalSize
      });

      const prepareResult = await this.postJson(peer.ip, peer.port, '/api/prepare-transfer', preparePayload);

      if (!prepareResult.accepted) {
        const reason = prepareResult.reason === 'timeout'
          ? 'Transfer request timed out.'
          : 'Receiver declined the transfer.';

        this.historyManager.addEntry({
          direction: 'sent',
          status: 'failed',
          peerName: peer.deviceName,
          peerIp: peer.ip,
          files: fileInfos.map(f => ({ name: f.name, size: f.size })),
          totalSize,
          error: reason
        });

        this.emit('transfer-failed', {
          sessionId,
          direction: 'outgoing',
          peerName: peer.deviceName,
          error: reason
        });

        this.activeTransfers.delete(sessionId);
        return;
      }
    } catch (err) {
      console.error('[TransferClient] Handshake failed:', err);
      const friendlyError = err.code === 'ECONNREFUSED'
        ? 'Receiver is currently offline or unreachable.'
        : 'Could not connect to receiver on the local network.';

      this.historyManager.addEntry({
        direction: 'sent',
        status: 'failed',
        peerName: peer.deviceName,
        peerIp: peer.ip,
        files: fileInfos.map(f => ({ name: f.name, size: f.size })),
        totalSize,
        error: friendlyError
      });

      this.emit('transfer-failed', {
        sessionId,
        direction: 'outgoing',
        peerName: peer.deviceName,
        error: friendlyError
      });

      this.activeTransfers.delete(sessionId);
      return;
    }

    // Step 2: Stream files sequentially
    let totalSentAcrossFiles = 0;
    let lastTime = Date.now();
    let lastTotalSent = 0;
    let currentSpeed = 0;

    const speedInterval = setInterval(() => {
      const now = Date.now();
      const elapsedSec = (now - lastTime) / 1000;
      if (elapsedSec > 0) {
        currentSpeed = (totalSentAcrossFiles - lastTotalSent) / elapsedSec;
        lastTotalSent = totalSentAcrossFiles;
        lastTime = now;
      }
    }, 500);

    try {
      for (let i = 0; i < fileInfos.length; i++) {
        if (transferSession.canceled) {
          throw new Error('Transfer canceled by user');
        }

        const file = fileInfos[i];
        await this.streamSingleFile(transferSession, file, i + 1, fileInfos.length, (bytesChunk) => {
          totalSentAcrossFiles += bytesChunk;
          file.sentBytes += bytesChunk;

          const overallProgress = totalSize > 0 
            ? Math.min(100, Math.round((totalSentAcrossFiles / totalSize) * 100))
            : 100;

          const remainingBytes = Math.max(0, totalSize - totalSentAcrossFiles);
          const remainingSeconds = currentSpeed > 0 ? Math.ceil(remainingBytes / currentSpeed) : 0;

          this.emit('transfer-progress', {
            sessionId,
            direction: 'outgoing',
            peerName: peer.deviceName,
            currentFile: file.name,
            currentFileIndex: i + 1,
            totalFiles: fileInfos.length,
            fileTransferredBytes: file.sentBytes,
            fileTotalBytes: file.size,
            bytesTransferred: totalSentAcrossFiles,
            totalBytes: totalSize,
            progress: overallProgress,
            speed: currentSpeed,
            remainingSeconds
          });
        });
      }

      clearInterval(speedInterval);

      // All files sent successfully
      this.historyManager.addEntry({
        direction: 'sent',
        status: 'success',
        peerName: peer.deviceName,
        peerIp: peer.ip,
        files: fileInfos.map(f => ({ name: f.name, size: f.size })),
        totalSize
      });

      this.emit('transfer-completed', {
        sessionId,
        direction: 'outgoing',
        peerName: peer.deviceName,
        files: fileInfos.map(f => ({ name: f.name, size: f.size })),
        totalSize
      });

      this.activeTransfers.delete(sessionId);
    } catch (err) {
      clearInterval(speedInterval);
      console.error('[TransferClient] Transfer stream failed:', err);

      const errorMsg = transferSession.canceled 
        ? 'Transfer canceled by user.' 
        : 'The connection was interrupted during file transfer.';

      this.historyManager.addEntry({
        direction: 'sent',
        status: 'failed',
        peerName: peer.deviceName,
        peerIp: peer.ip,
        files: fileInfos.map(f => ({ name: f.name, size: f.size })),
        totalSize,
        error: errorMsg
      });

      this.emit('transfer-failed', {
        sessionId,
        direction: 'outgoing',
        peerName: peer.deviceName,
        error: errorMsg
      });

      this.activeTransfers.delete(sessionId);
    }
  }

  streamSingleFile(session, file, fileIndex, totalFiles, onChunk) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: session.peer.ip,
        port: session.peer.port,
        path: `/api/transfer-file?sessionId=${encodeURIComponent(session.sessionId)}&fileId=${encodeURIComponent(file.id)}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': file.size
        }
      };

      const req = http.request(options, (res) => {
        let resData = '';
        res.on('data', c => { resData += c; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Receiver replied with status ${res.statusCode}: ${resData}`));
          }
        });
      });

      session.activeReq = req;

      req.on('error', (err) => {
        reject(err);
      });

      const readStream = fs.createReadStream(file.path, { highWaterMark: 64 * 1024 });
      session.activeReadStream = readStream;

      readStream.on('data', (chunk) => {
        onChunk(chunk.length);
        const canWrite = req.write(chunk);
        if (!canWrite) {
          readStream.pause();
          req.once('drain', () => readStream.resume());
        }
      });

      readStream.on('end', () => {
        req.end();
      });

      readStream.on('error', (err) => {
        req.destroy();
        reject(err);
      });
    });
  }

  postJson(host, port, path, payload) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: host,
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 65000 // Handshake timeout
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error('Invalid response from peer: ' + data));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out'));
      });

      req.write(payload);
      req.end();
    });
  }

  cancelTransfer(sessionId) {
    const session = this.activeTransfers.get(sessionId);
    if (session) {
      session.canceled = true;
      if (session.activeReadStream) {
        try { session.activeReadStream.destroy(); } catch {}
      }
      if (session.activeReq) {
        try { session.activeReq.destroy(); } catch {}
      }

      // Notify peer
      try {
        const post = http.request({
          hostname: session.peer.ip,
          port: session.peer.port,
          path: `/api/cancel-transfer?sessionId=${encodeURIComponent(sessionId)}`,
          method: 'POST'
        });
        post.on('error', () => {});
        post.end();
      } catch {}

      this.activeTransfers.delete(sessionId);
      return true;
    }
    return false;
  }
}

module.exports = TransferClient;
