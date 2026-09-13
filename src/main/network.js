const os = require('os');

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

function longToIp(long) {
  return [
    (long >>> 24) & 255,
    (long >>> 16) & 255,
    (long >>> 8) & 255,
    long & 255
  ].join('.');
}

function getBroadcastAddress(ip, netmask) {
  try {
    const ipLong = ipToLong(ip);
    const maskLong = ipToLong(netmask);
    const broadcastLong = (ipLong | (~maskLong >>> 0)) >>> 0;
    return longToIp(broadcastLong);
  } catch {
    return '255.255.255.255';
  }
}

class NetworkManager {
  static getInterfaces() {
    const interfaces = os.networkInterfaces();
    const result = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          const broadcast = getBroadcastAddress(addr.address, addr.netmask);
          result.push({
            name,
            address: addr.address,
            netmask: addr.netmask,
            broadcast,
            mac: addr.mac
          });
        }
      }
    }

    return result;
  }

  static getPrimaryInterface() {
    const list = this.getInterfaces();
    if (list.length === 0) {
      return {
        name: 'Loopback',
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        broadcast: '255.255.255.255',
        mac: ''
      };
    }

    // Prefer Wi-Fi or Ethernet
    const preferred = list.find(i => /wi-?fi|ethernet|lan/i.test(i.name)) || list[0];
    return preferred;
  }

  static getBroadcastAddresses() {
    const list = this.getInterfaces();
    const set = new Set(['255.255.255.255']);
    for (const item of list) {
      if (item.broadcast) {
        set.add(item.broadcast);
      }
    }
    return Array.from(set);
  }

  static getPlatformInfo() {
    const platform = os.platform();
    let deviceType = 'desktop';
    let deviceModel = 'Windows PC';

    if (platform === 'win32') {
      deviceModel = 'Windows ' + (os.release().startsWith('10.0.22') ? '11' : '10');
    } else if (platform === 'darwin') {
      deviceModel = 'macOS';
    } else if (platform === 'linux') {
      deviceModel = 'Linux';
    } else if (platform === 'android') {
      deviceType = 'mobile';
      deviceModel = 'Android';
    }

    return { deviceType, deviceModel };
  }
}

module.exports = NetworkManager;
