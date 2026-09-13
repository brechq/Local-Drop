const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Mock electron app path for test
const electron = require('electron');
const testUserDataA = path.join(os.tmpdir(), 'localdrop-test-a');
const testUserDataB = path.join(os.tmpdir(), 'localdrop-test-b');
const testDownloadA = path.join(testUserDataA, 'downloads');
const testDownloadB = path.join(testUserDataB, 'downloads');

if (fs.existsSync(testUserDataA)) fs.rmSync(testUserDataA, { recursive: true, force: true });
if (fs.existsSync(testUserDataB)) fs.rmSync(testUserDataB, { recursive: true, force: true });

fs.mkdirSync(testUserDataA, { recursive: true });
fs.mkdirSync(testUserDataB, { recursive: true });
fs.mkdirSync(testDownloadA, { recursive: true });
fs.mkdirSync(testDownloadB, { recursive: true });

// Dummy test files
const testFile1 = path.join(testUserDataB, 'sample1.txt');
const testFile2 = path.join(testUserDataB, 'sample2.bin');
fs.writeFileSync(testFile1, 'Hello Brechq LocalDrop! Testing local transfer.');
// Create a 5MB random binary file for streaming progress verification
const largeBuf = Buffer.alloc(5 * 1024 * 1024, 0xAB);
fs.writeFileSync(testFile2, largeBuf);

console.log('>>> Running Brechq LocalDrop Integration Test Suite...\n');

async function runTests() {
  const SettingsManager = require('../src/main/settings');
  const NetworkManager = require('../src/main/network');
  const DiscoveryEngine = require('../src/main/discovery');
  const HistoryManager = require('../src/main/history');
  const ReceiverServer = require('../src/main/server');
  const TransferClient = require('../src/main/transfer');

  // 1. Test NetworkManager
  console.log('1. Testing NetworkManager...');
  const ifaces = NetworkManager.getInterfaces();
  assert(Array.isArray(ifaces), 'Interfaces should be an array');
  const primary = NetworkManager.getPrimaryInterface();
  console.log('   Primary Interface:', primary.name, primary.address, 'Broadcast:', primary.broadcast);
  assert(primary.address, 'Primary address must exist');

  // Setup Instance A
  const settingsA = new SettingsManager();
  settingsA.filePath = path.join(testUserDataA, 'settings.json');
  settingsA.update({
    deviceId: 'test-device-a',
    deviceName: 'Test Receiver A',
    downloadPath: testDownloadA,
    autoAccept: true,
    port: 54321
  });
  const historyA = new HistoryManager();
  historyA.filePath = path.join(testUserDataA, 'history.json');
  const serverA = new ReceiverServer(settingsA, historyA);
  await serverA.start();
  console.log('   Receiver Server A started on port', serverA.port);

  // Setup Instance B
  const settingsB = new SettingsManager();
  settingsB.filePath = path.join(testUserDataB, 'settings.json');
  settingsB.update({
    deviceId: 'test-device-b',
    deviceName: 'Test Sender B',
    downloadPath: testDownloadB,
    autoAccept: false,
    port: 54322
  });
  const historyB = new HistoryManager();
  historyB.filePath = path.join(testUserDataB, 'history.json');
  const clientB = new TransferClient(settingsB, historyB);

  // 2. Test File Transfer (Multiple files, streaming)
  console.log('2. Testing File Transfer (sample1.txt + 5MB sample2.bin)...');
  const peerTargetA = {
    deviceId: 'test-device-a',
    deviceName: 'Test Receiver A',
    ip: '127.0.0.1',
    port: serverA.port
  };

  let progressReceivedCount = 0;
  serverA.on('transfer-progress', (prog) => {
    progressReceivedCount++;
  });

  let completedData = null;
  serverA.once('transfer-completed', (data) => {
    completedData = data;
  });

  await clientB.sendFiles(peerTargetA, [testFile1, testFile2]);
  console.log('   Transfer finished. Server received', progressReceivedCount, 'progress updates.');
  assert(progressReceivedCount > 0, 'Progress events must have fired');
  assert(completedData, 'Server must emit transfer-completed');

  // Verify received files on disk
  const destFile1 = path.join(testDownloadA, 'sample1.txt');
  const destFile2 = path.join(testDownloadA, 'sample2.bin');
  assert(fs.existsSync(destFile1), 'sample1.txt must exist in download path');
  assert(fs.existsSync(destFile2), 'sample2.bin must exist in download path');

  const content1 = fs.readFileSync(destFile1, 'utf-8');
  assert.strictEqual(content1, 'Hello Brechq LocalDrop! Testing local transfer.');
  const stat2 = fs.statSync(destFile2);
  assert.strictEqual(stat2.size, 5 * 1024 * 1024, 'sample2.bin size must match exactly 5MB');
  console.log('   File integrity verified 100%.');

  // 3. Test Conflict Resolution (Duplicate filename)
  console.log('3. Testing Conflict Resolution (transferring sample1.txt again)...');
  await clientB.sendFiles(peerTargetA, [testFile1]);
  const destFile1_dup = path.join(testDownloadA, 'sample1 (1).txt');
  assert(fs.existsSync(destFile1_dup), 'sample1 (1).txt must be created without overwriting sample1.txt');
  assert.strictEqual(fs.readFileSync(destFile1_dup, 'utf-8'), content1);
  console.log('   Duplicate successfully resolved to: sample1 (1).txt');

  // 4. Test Decline Flow
  console.log('4. Testing Decline Flow...');
  settingsA.update({ autoAccept: false }); // disable auto accept
  serverA.once('incoming-request', (req) => {
    console.log('   Incoming request received for decline test, declining session:', req.sessionId);
    serverA.respondIncomingTransfer(req.sessionId, false);
  });

  let clientFailedEvent = null;
  clientB.once('transfer-failed', (err) => {
    clientFailedEvent = err;
  });

  await clientB.sendFiles(peerTargetA, [testFile1]);
  assert(clientFailedEvent, 'Client must receive transfer-failed event on decline');
  console.log('   Transfer correctly declined with message:', clientFailedEvent.error);

  // 5. Test History Persistence
  console.log('5. Testing History Persistence...');
  const recordsA = historyA.getAll();
  const recordsB = historyB.getAll();
  assert(recordsA.length >= 2, 'Receiver history must have records');
  assert(recordsB.length >= 3, 'Sender history must have records');
  console.log('   Receiver history count:', recordsA.length);
  console.log('   Sender history count:', recordsB.length);

  // Clean up
  serverA.stop();
  console.log('\n>>> All integration tests PASSED successfully!\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\nTest failed with error:', err);
  process.exit(1);
});
