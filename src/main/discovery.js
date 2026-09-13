const dgram = require('dgram');
const EventEmitter = require('events');
const NetworkManager = require('./network');

const MULTICAST_ADDR = '224.0.0.167';
const PROTOCOL_HEADER = 'brechq-localdrop-v1';

class DiscoveryEngine extends EventEmitter {
  constructor(settingsManager) {
    super();
    this.settingsManager = settingsManager;
    this.socket = null;
    this.peers = new Map();
    this.broadcastTimer = null;
    this.pruneTimer = null;
    this.running = false;
    this.discoveryPort = 53317;
  }

  start() {
    if (this.running) return;
    this.running = true;

    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.warn('[Discovery] UDP Socket error:', err.message);
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.on('listening', () => {
        try {
          this.socket.setBroadcast(true);
          try {
            this.socket.addMembership(MULTICAST_ADDR);
          } catch (mErr) {
            // Multicast might fail on some network adapters, broadcast will still work
            console.log('[Discovery] Multicast join note:', mErr.message);
          }
          const address = this.socket.address();
          console.log(`[Discovery] UDP listening on ${address.address}:${address.port}`);
          
          // Send initial query and announce
          this.sendDiscover();
          this.sendAnnounce();
        } catch (setupErr) {
          console.warn('[Discovery] Socket setup warning:', setupErr.message);
        }
      });

      this.socket.bind(this.discoveryPort);
    } catch (err) {
      console.error('[Discovery] Failed to bind discovery socket:', err);
    }

    // Periodic announcement every 3 seconds
    this.broadcastTimer = setInterval(() => {
      if (this.running) {
        this.sendAnnounce();
      }
    }, 3000);

    // Prune stale peers every 2 seconds
    this.pruneTimer = setInterval(() => {
      this.pruneStalePeers();
    }, 2000);
  }

  stop(callback) {
    if (!this.running) {
      if (callback) callback();
      return;
    }
    this.running = false;

    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);

    this.sendGoodbye();

    setTimeout(() => {
      if (this.socket) {
        try {
          this.socket.close();
        } catch {}
        this.socket = null;
      }
      this.peers.clear();
      this.emit('peers-updated', []);
      if (callback) callback();
    }, 60);
  }

  handleMessage(msgBuffer, rinfo) {
    let data;
    try {
      data = JSON.parse(msgBuffer.toString('utf-8'));
    } catch {
      return; // Invalid JSON
    }

    if (data.protocol !== PROTOCOL_HEADER) return;

    const mySettings = this.settingsManager.get();
    // Ignore self-announcement
    if (data.deviceId === mySettings.deviceId) {
      return;
    }

    if (data.type === 'GOODBYE') {
      if (this.peers.has(data.deviceId)) {
        this.peers.delete(data.deviceId);
        this.emitPeers();
      }
      return;
    }

    if (data.type === 'DISCOVER') {
      // Respond to discovery queries immediately
      this.sendAnnounceTo(rinfo.address, rinfo.port);
      return;
    }

    if (data.type === 'ANNOUNCE') {
      const peer = {
        deviceId: data.deviceId,
        deviceName: data.deviceName || 'Unknown Device',
        deviceType: data.deviceType || 'desktop',
        deviceModel: data.deviceModel || 'Unknown',
        ip: rinfo.address,
        port: data.port || 53318,
        status: 'online',
        lastSeen: Date.now()
      };

      const isNewOrUpdated = !this.peers.has(peer.deviceId) || 
        JSON.stringify(this.peers.get(peer.deviceId)) !== JSON.stringify(peer);

      this.peers.set(peer.deviceId, peer);

      if (isNewOrUpdated) {
        this.emitPeers();
      }
    }
  }

  sendAnnounce() {
    if (!this.socket) return;
    const settings = this.settingsManager.get();
    const platform = NetworkManager.getPlatformInfo();

    const payload = JSON.stringify({
      protocol: PROTOCOL_HEADER,
      type: 'ANNOUNCE',
      deviceId: settings.deviceId,
      deviceName: settings.deviceName,
      deviceType: platform.deviceType,
      deviceModel: platform.deviceModel,
      port: settings.port,
      timestamp: Date.now()
    });

    const buf = Buffer.from(payload);
    const targets = NetworkManager.getBroadcastAddresses();

    for (const target of targets) {
      try {
        this.socket.send(buf, 0, buf.length, this.discoveryPort, target, (err) => {
          if (err && err.code !== 'ENETUNREACH' && err.code !== 'EPERM') {
            // Ignore normal non-fatal network unreachable warnings
          }
        });
      } catch {}
    }

    // Also send to multicast group
    try {
      this.socket.send(buf, 0, buf.length, this.discoveryPort, MULTICAST_ADDR);
    } catch {}
  }

  sendAnnounceTo(ip, port) {
    if (!this.socket) return;
    const settings = this.settingsManager.get();
    const platform = NetworkManager.getPlatformInfo();

    const payload = JSON.stringify({
      protocol: PROTOCOL_HEADER,
      type: 'ANNOUNCE',
      deviceId: settings.deviceId,
      deviceName: settings.deviceName,
      deviceType: platform.deviceType,
      deviceModel: platform.deviceModel,
      port: settings.port,
      timestamp: Date.now()
    });

    const buf = Buffer.from(payload);
    try {
      this.socket.send(buf, 0, buf.length, port || this.discoveryPort, ip);
    } catch {}
  }

  sendDiscover() {
    if (!this.socket) return;
    const settings = this.settingsManager.get();

    const payload = JSON.stringify({
      protocol: PROTOCOL_HEADER,
      type: 'DISCOVER',
      deviceId: settings.deviceId,
      timestamp: Date.now()
    });

    const buf = Buffer.from(payload);
    const targets = NetworkManager.getBroadcastAddresses();

    for (const target of targets) {
      try {
        this.socket.send(buf, 0, buf.length, this.discoveryPort, target);
      } catch {}
    }
  }

  sendGoodbye() {
    if (!this.socket) return;
    const settings = this.settingsManager.get();

    const payload = JSON.stringify({
      protocol: PROTOCOL_HEADER,
      type: 'GOODBYE',
      deviceId: settings.deviceId,
      timestamp: Date.now()
    });

    const buf = Buffer.from(payload);
    const targets = NetworkManager.getBroadcastAddresses();

    for (const target of targets) {
      try {
        this.socket.send(buf, 0, buf.length, this.discoveryPort, target);
      } catch {}
    }
  }

  pruneStalePeers() {
    const now = Date.now();
    let changed = false;

    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > 8000) {
        this.peers.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.emitPeers();
    }
  }

  emitPeers() {
    this.emit('peers-updated', this.getPeers());
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  scanNow() {
    this.sendDiscover();
    this.sendAnnounce();
  }
}

module.exports = DiscoveryEngine;
