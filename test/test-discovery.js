const assert = require('assert');
const path = require('path');
const os = require('os');
const SettingsManager = require('../src/main/settings');
const DiscoveryEngine = require('../src/main/discovery');

async function testDiscovery() {
  console.log('>>> Running Discovery Engine Test Suite...\n');

  const settingsA = new SettingsManager();
  settingsA.filePath = path.join(os.tmpdir(), 'disc-test-a', 'settings.json');
  settingsA.update({
    deviceId: 'peer-alpha-123',
    deviceName: 'Alpha PC',
    port: 53318
  });

  const settingsB = new SettingsManager();
  settingsB.filePath = path.join(os.tmpdir(), 'disc-test-b', 'settings.json');
  settingsB.update({
    deviceId: 'peer-beta-456',
    deviceName: 'Beta Laptop',
    port: 53319
  });

  const engineA = new DiscoveryEngine(settingsA);
  const engineB = new DiscoveryEngine(settingsB);

  engineA.start();
  engineB.start();

  console.log('1. Waiting for discovery exchange between Engine A and Engine B...');
  const discovered = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Discovery timed out after 5 seconds'));
    }, 5000);

    engineB.on('peers-updated', (peers) => {
      const foundA = peers.find(p => p.deviceId === 'peer-alpha-123');
      if (foundA) {
        clearTimeout(timeout);
        resolve(foundA);
      }
    });

    // Force an immediate discovery ping
    engineB.scanNow();
  });

  console.log('   Engine B discovered peer A:');
  console.log('   - Device Name:', discovered.deviceName);
  console.log('   - IP:', discovered.ip);
  console.log('   - Port:', discovered.port);
  console.log('   - Status:', discovered.status);
  assert.strictEqual(discovered.deviceName, 'Alpha PC');
  assert.strictEqual(discovered.port, 53318);

  console.log('2. Testing Goodbye packet...');
  const goodbyeHandled = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Goodbye check timed out'));
    }, 3000);

    engineB.on('peers-updated', (peers) => {
      const foundA = peers.find(p => p.deviceId === 'peer-alpha-123');
      if (!foundA) {
        clearTimeout(timeout);
        resolve(true);
      }
    });

    engineA.stop();
  });

  await goodbyeHandled;
  console.log('   Engine B successfully removed peer A on goodbye!');

  engineB.stop();
  console.log('\n>>> All Discovery tests PASSED successfully!\n');
  process.exit(0);
}

testDiscovery().catch(err => {
  console.error('\nDiscovery test failed:', err);
  process.exit(1);
});
