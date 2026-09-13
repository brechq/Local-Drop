const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const SettingsManager = require('../src/main/settings');
const HistoryManager = require('../src/main/history');
const ReceiverServer = require('../src/main/server');

async function testQrWebShare() {
  console.log('>>> Running QR Web Share Test Suite...\n');

  const settings = new SettingsManager();
  const history = new HistoryManager();
  const server = new ReceiverServer(settings, history);
  await server.start();
  const port = server.port;
  console.log('1. Server started on port', port);

  // Setup shared files (icon.png)
  const iconPath = path.join(__dirname, '../asset/icon.png');
  const stat = fs.statSync(iconPath);
  const sharedList = server.setSharedFiles([
    { path: iconPath, name: 'icon.png', size: stat.size }
  ]);
  assert(sharedList.length === 1, 'Should have 1 shared file');
  const fileId = sharedList[0].id;
  console.log('2. Shared files configured. File ID:', fileId);

  // Helper fetch function
  function get(pathStr, headers = {}) {
    return new Promise((resolve, reject) => {
      http.get({
        hostname: '127.0.0.1',
        port: port,
        path: pathStr,
        headers
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }).on('error', reject);
    });
  }

  // 3. Test GET /share (HTML Page)
  console.log('3. Testing GET /share...');
  const resPage = await get('/share');
  assert.strictEqual(resPage.statusCode, 200);
  assert(resPage.body.toString().includes('Brechq LocalDrop'), 'Page must contain app branding');
  assert(resPage.body.toString().includes('Shared Files'), 'Page title must match');
  console.log('   /share HTML page served successfully (Status 200)');

  // 4. Test GET /api/share/info (JSON Info)
  console.log('4. Testing GET /api/share/info...');
  const resInfo = await get('/api/share/info');
  assert.strictEqual(resInfo.statusCode, 200);
  const infoData = JSON.parse(resInfo.body.toString());
  assert.strictEqual(infoData.files.length, 1);
  assert.strictEqual(infoData.files[0].name, 'icon.png');
  assert.strictEqual(infoData.files[0].size, stat.size);
  console.log('   /api/share/info returned correct JSON metadata');

  // 5. Test GET /api/share/preview (Media Preview Stream)
  console.log('5. Testing GET /api/share/preview...');
  const resPreview = await get(`/api/share/preview?fileId=${fileId}`);
  assert.strictEqual(resPreview.statusCode, 200);
  assert.strictEqual(resPreview.headers['content-type'], 'image/png');
  assert.strictEqual(resPreview.body.length, stat.size);
  console.log('   /api/share/preview streamed full image with content-type: image/png');

  // 6. Test GET /api/share/download (Download attachment)
  console.log('6. Testing GET /api/share/download...');
  const resDownload = await get(`/api/share/download?fileId=${fileId}`);
  assert.strictEqual(resDownload.statusCode, 200);
  assert(resDownload.headers['content-disposition'].includes('attachment'), 'Must have attachment disposition');
  assert.strictEqual(resDownload.body.length, stat.size);
  console.log('   /api/share/download returned attachment successfully');

  // 7. Test QR Code generation
  console.log('7. Testing QR Code generation...');
  const qrDataUrl = await server.getQrCodeDataUrl();
  assert(qrDataUrl.startsWith('data:image/png;base64,'), 'QR must be base64 PNG data URL');
  console.log('   QR Code generated successfully! Length:', qrDataUrl.length, 'chars');

  server.stop();
  console.log('\n>>> All QR Web Share tests PASSED successfully!\n');
  process.exit(0);
}

testQrWebShare().catch(err => {
  console.error('\nQR Web Share test failed:', err);
  process.exit(1);
});
