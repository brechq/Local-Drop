const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function generateIco() {
  const squarePngPath = path.join(__dirname, '../asset/icon-square.png');
  const iconIcoPath = path.join(__dirname, '../asset/icon.ico');

  if (!fs.existsSync(squarePngPath)) {
    console.log('Generating square PNG first...');
    execSync('powershell -ExecutionPolicy Bypass -File scripts/make-square.ps1', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
  }

  console.log('Converting icon-square.png to asset/icon.ico...');
  try {
    const pngToIco = require('png-to-ico');
    const buf = await pngToIco(squarePngPath);
    fs.writeFileSync(iconIcoPath, buf);
    console.log('Successfully generated asset/icon.ico (' + buf.length + ' bytes)');
  } catch (err) {
    console.error('Failed to convert to ico:', err);
    process.exit(1);
  }
}

generateIco();
