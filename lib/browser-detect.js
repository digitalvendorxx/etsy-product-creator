const fs = require('fs');
const path = require('path');
const os = require('os');

function expandPaths(template) {
  const home = os.homedir();
  const username = path.basename(home);
  return template
    .replace(/\$\{HOME\}/g, home)
    .replace(/\$\{USER\}/g, username);
}

const CANDIDATES = {
  win32: [
    { name: 'Opera GX', path: '${HOME}/AppData/Local/Programs/Opera GX/opera.exe' },
    { name: 'Opera GX', path: 'C:/Program Files/Opera GX/launcher.exe' },
    { name: 'Opera', path: '${HOME}/AppData/Local/Programs/Opera/launcher.exe' },
    { name: 'Opera', path: 'C:/Program Files/Opera/launcher.exe' },
    { name: 'Chrome', path: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
    { name: 'Chrome', path: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' },
    { name: 'Edge', path: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
    { name: 'Edge', path: 'C:/Program Files/Microsoft/Edge/Application/msedge.exe' },
    { name: 'Brave', path: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' },
  ],
  darwin: [
    { name: 'Opera GX', path: '/Applications/Opera GX.app/Contents/MacOS/Opera' },
    { name: 'Opera', path: '/Applications/Opera.app/Contents/MacOS/Opera' },
    { name: 'Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { name: 'Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    { name: 'Brave', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
  ],
  linux: [
    { name: 'Chrome', path: '/usr/bin/google-chrome' },
    { name: 'Chrome', path: '/usr/bin/google-chrome-stable' },
    { name: 'Chromium', path: '/usr/bin/chromium' },
    { name: 'Chromium', path: '/usr/bin/chromium-browser' },
    { name: 'Edge', path: '/usr/bin/microsoft-edge' },
  ],
};

function detectBrowser() {
  const list = CANDIDATES[process.platform] || [];
  for (const entry of list) {
    const expanded = expandPaths(entry.path);
    if (fs.existsSync(expanded)) {
      return { name: entry.name, path: expanded, platform: process.platform };
    }
  }
  return null;
}

function detectAll() {
  const list = CANDIDATES[process.platform] || [];
  const found = [];
  for (const entry of list) {
    const expanded = expandPaths(entry.path);
    if (fs.existsSync(expanded)) {
      found.push({ name: entry.name, path: expanded });
    }
  }
  return found;
}

module.exports = { detectBrowser, detectAll };
