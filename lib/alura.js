// Reusable Alura scraping module
// Usage:
//   const { scrapeAluraTags } = require('./lib/alura');
//   const { tags, title } = await scrapeAluraTags('https://www.etsy.com/listing/123/...');
//   // or with options:
//   const result = await scrapeAluraTags(url, { cdpPort: 9333, operaPath: '...' });

const path = require('path');
const { chromium } = require('playwright');
const WebSocket = require('ws');

const ALURA_EXT_ID = 'nhbghfidknjdblpfcmkkdpcfigkkpgpi';

// Connect to existing CDP browser or launch Opera
async function connectBrowser(port, operaPath) {
  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    console.log(`  [alura] Connected to browser on port ${port}`);
    return browser;
  } catch (e) {
    // Not running
  }

  if (!operaPath) {
    throw new Error('CDP baglantisi yok ve operaPath belirtilmedi.');
  }

  const { spawn } = require('child_process');
  console.log(`  [alura] Launching browser with CDP on port ${port}...`);
  const child = spawn(operaPath, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
      console.log(`  [alura] Connected on port ${port}`);
      return browser;
    } catch (e) { /* still starting */ }
  }
  throw new Error('Browser baslatilamadi veya CDP baglantisi kurulamadi.');
}

// Fallback: open Alura via CDP WebSocket (sends message to service worker)
async function openAluraViaCDP(cdpPort, etsyUrl) {
  const versionRes = await fetch(`http://localhost:${cdpPort}/json/version`);
  const { webSocketDebuggerUrl } = await versionRes.json();

  return new Promise((resolve) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    let msgId = 1;
    const callbacks = new Map();
    const cleanup = (result) => { try { ws.close(); } catch(e) {} resolve(result); };

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg);
        callbacks.delete(msg.id);
      }
    });

    const send = (method, params = {}, sessionId) => new Promise((cb) => {
      const id = msgId++;
      callbacks.set(id, cb);
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });

    ws.on('open', async () => {
      try {
        const { result } = await send('Target.getTargets');
        const aluraTarget = result.targetInfos.find(t =>
          t.type === 'service_worker' && t.url.includes(ALURA_EXT_ID)
        );
        if (!aluraTarget) { cleanup(false); return; }

        const attached = await send('Target.attachToTarget', { targetId: aluraTarget.targetId, flatten: true });
        const sid = attached.result.sessionId;
        await send('Runtime.enable', {}, sid);

        const tabRes = await send('Runtime.evaluate', {
          expression: `(async () => {
            const tabs = await chrome.tabs.query({ url: '*://*.etsy.com/*' });
            return tabs.map(t => ({ id: t.id, url: t.url }));
          })()`,
          awaitPromise: true, returnByValue: true
        }, sid);

        const etsyTabs = tabRes.result?.result?.value || [];
        const matchingTab = etsyTabs.find(t => etsyUrl && t.url.includes(etsyUrl.split('?')[0])) || etsyTabs[0];
        if (!matchingTab) { cleanup(false); return; }

        const openRes = await send('Runtime.evaluate', {
          expression: `(async () => {
            try {
              const resp = await chrome.tabs.sendMessage(${matchingTab.id}, {command: "launchAluraExtension"});
              return resp?.success ? 'ok' : 'no-success';
            } catch(e) { return 'error:' + e.message; }
          })()`,
          awaitPromise: true, returnByValue: true
        }, sid);

        cleanup(openRes.result?.result?.value === 'ok');
      } catch(e) { cleanup(false); }
    });

    ws.on('error', () => cleanup(false));
    setTimeout(() => cleanup(false), 15000);
  });
}

/**
 * Scrape tags from an Etsy listing using Alura extension.
 *
 * @param {string} etsyUrl - Full Etsy listing URL
 * @param {object} [opts] - Options
 * @param {number} [opts.cdpPort=9333] - CDP port
 * @param {string} [opts.operaPath] - Path to Opera/browser executable (for auto-launch)
 * @param {boolean} [opts.navigate=true] - Navigate to the URL (false if already on the page)
 * @returns {Promise<{tags: string[], title: string, rawTagCount: number}>}
 */
async function scrapeAluraTags(etsyUrl, opts = {}) {
  const port = opts.cdpPort || 9333;
  const operaPath = opts.operaPath;
  const shouldNavigate = opts.navigate !== false;

  const browser = await connectBrowser(port, operaPath);
  const context = browser.contexts()[0];
  const pages = context.pages();
  let page = pages.find(p => p.url().includes('etsy.com/listing'))
           || pages.find(p => p.url().includes('etsy.com'))
           || pages[0];

  if (!page) throw new Error('No browser page found');

  // Navigate to listing
  if (shouldNavigate) {
    console.log(`  [alura] Opening: ${etsyUrl}`);
    await page.goto(etsyUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);
  }

  // Open Alura listing report sidebar
  console.log('  [alura] Listing report aciliyor...');
  const launcherClicked = await page.evaluate(() => {
    const launcher = document.querySelector('.ae_launcher-listing');
    if (launcher) {
      launcher.classList.remove('hide');
      launcher.click();
      return 'ae_launcher-listing';
    }
    const sb = document.querySelector('#ae-sidebar_launcher');
    if (sb) { sb.click(); return 'ae-sidebar_launcher'; }
    return null;
  }).catch(() => null);

  if (!launcherClicked) {
    console.log('  [alura] Launcher bulunamadi, CDP ile deneniyor...');
    await openAluraViaCDP(port, etsyUrl);
  } else {
    console.log(`  [alura] Launcher tiklandi: ${launcherClicked}`);
  }

  // Wait for listing report
  console.log('  [alura] Listing report bekleniyor...');
  for (let i = 0; i < 20; i++) {
    const found = await page.evaluate(() => {
      const alura = document.querySelector('alura-chrome-extension');
      if (!alura) return false;
      for (const el of alura.querySelectorAll('*')) {
        if (el.textContent.trim() === 'Listing report' && el.offsetHeight > 0) return true;
      }
      return false;
    }).catch(() => false);
    if (found) break;
    await page.waitForTimeout(1500);
  }

  // Click "Tags" nav
  console.log('  [alura] Tags bolumune gidiliyor...');
  await page.evaluate(() => {
    const alura = document.querySelector('alura-chrome-extension');
    if (!alura) return;
    const badges = alura.querySelectorAll('a.p-badge.is-sidebar-header');
    for (const b of badges) {
      if (b.textContent.trim() === 'Tags') { b.click(); return; }
    }
    for (const el of alura.querySelectorAll('a, div')) {
      if (el.textContent.trim() === 'Tags' && el.offsetHeight > 0 && el.offsetHeight < 40) {
        el.click(); return;
      }
    }
  });

  await page.waitForTimeout(5000);

  // Wait for tag elements to appear
  for (let i = 0; i < 15; i++) {
    const count = await page.evaluate(() => {
      const alura = document.querySelector('alura-chrome-extension');
      if (!alura) return 0;
      return alura.querySelectorAll('.p-table-text.is-table-text-bold.is-clickable').length;
    }).catch(() => 0);
    if (count > 0) break;
    await page.waitForTimeout(2000);
  }

  // Scrape title
  const title = await page.evaluate(() => {
    const h1 = document.querySelector('h1[data-buy-box-listing-title], h1.wt-text-body-01, h1');
    return h1 ? h1.textContent.trim() : '';
  });

  // Scrape tags
  const tags = await page.evaluate(() => {
    const tagSet = new Set();
    const alura = document.querySelector('alura-chrome-extension');

    if (alura) {
      const selectors = [
        '.p-table-text.is-table-text-bold.is-clickable',
        '.p-table-text.is-clickable',
        '[class*="table-text"][class*="bold"]',
      ];
      for (const sel of selectors) {
        alura.querySelectorAll(sel).forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length > 1 && text.length < 60) tagSet.add(text);
        });
        if (tagSet.size > 0) break;
      }
    }

    // Fallback: Etsy's own tags
    if (tagSet.size === 0) {
      document.querySelectorAll('a[href*="/search?q="]').forEach(a => {
        const text = a.textContent?.trim();
        if (text && text.length > 1 && text.length < 60) tagSet.add(text);
      });
    }

    return [...tagSet];
  });

  console.log(`  [alura] ${tags.length} tag bulundu`);
  return { tags, title, rawTagCount: tags.length };
}

module.exports = { scrapeAluraTags, connectBrowser };
