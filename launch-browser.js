const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const port = config.cdpPort || 9333;
const browserPath = config.operaPath;
if (!browserPath) { console.error('ERROR: Set "operaPath" in config.json'); process.exit(1); }

// Check if CDP is already running
async function isCdpRunning() {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (await isCdpRunning()) {
    console.log(`Browser already running on CDP port ${port}`);
    return;
  }

  console.log(`Launching browser with CDP on port ${port}...`);
  const child = exec(`"${browserPath}" --remote-debugging-port=${port}`, { windowsHide: false });
  child.unref();

  // Wait for CDP to become available
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isCdpRunning()) {
      console.log(`Browser ready on CDP port ${port}`);
      return;
    }
  }

  console.error(`ERROR: Browser did not start CDP on port ${port} within 30s`);
  process.exit(1);
}

main();
