const path = require('path');
const { chromium } = require('playwright');
const WebSocket = require('ws');
const { generateDescription, optimizeTags, generateAltTexts } = require('./optimize');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const ALURA_EXT_ID = 'nhbghfidknjdblpfcmkkdpcfigkkpgpi';

// Raw CDP helper - evaluates JS in the actual page context (sees extension DOM)
function createCdpClient(port) {
  return new Promise((resolve, reject) => {
    fetch(`http://localhost:${port}/json/version`)
      .then(r => r.json())
      .then(({ webSocketDebuggerUrl }) => {
        const ws = new WebSocket(webSocketDebuggerUrl);
        let msgId = 1;
        const callbacks = new Map();

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

        ws.on('open', () => resolve({ ws, send }));
        ws.on('error', (e) => reject(e));
      })
      .catch(reject);
  });
}

// Pierce shadow DOM via CDP DOM API - works with both open and closed shadow roots
async function scrapeTagsViaCdpDom(send, sid) {
  await send('DOM.enable', {}, sid);
  const { result: doc } = await send('DOM.getDocument', { depth: -1, pierce: true }, sid);
  const tags = [];
  const tagTexts = new Set();

  function getNodeText(node) {
    let text = '';
    if (node.nodeType === 3 && node.nodeValue) text += node.nodeValue;
    if (node.children) for (const c of node.children) text += getNodeText(c);
    if (node.shadowRoots) for (const sr of node.shadowRoots) text += getNodeText(sr);
    return text;
  }

  function walkNode(node) {
    if (node.attributes) {
      const classIdx = node.attributes.indexOf('class');
      if (classIdx !== -1) {
        const cls = node.attributes[classIdx + 1] || '';
        if (cls.includes('p-table-text') && cls.includes('is-clickable')) {
          const text = getNodeText(node).trim();
          if (text && text.length > 1 && text.length < 60 && !tagTexts.has(text)) {
            tagTexts.add(text);
            tags.push(text);
          }
        }
      }
    }
    if (node.children) for (const c of node.children) walkNode(c);
    if (node.shadowRoots) for (const sr of node.shadowRoots) walkNode(sr);
    if (node.contentDocument) walkNode(node.contentDocument);
  }
  walkNode(doc.root);
  return tags;
}

// Click element inside shadow DOM via CDP DOM API
async function clickInShadowDom(send, sid, textToFind) {
  await send('DOM.enable', {}, sid);
  const { result: doc } = await send('DOM.getDocument', { depth: -1, pierce: true }, sid);

  function findNodeByText(node, text) {
    // Check if this node's text matches
    if (node.attributes) {
      const classIdx = node.attributes.indexOf('class');
      if (classIdx !== -1) {
        const cls = node.attributes[classIdx + 1] || '';
        if (cls.includes('p-badge') || cls.includes('sidebar-header')) {
          let nodeText = '';
          if (node.children) for (const c of node.children) {
            if (c.nodeType === 3 && c.nodeValue) nodeText += c.nodeValue;
          }
          if (nodeText.trim() === text) return node;
        }
      }
    }
    if (node.children) for (const c of node.children) {
      const found = findNodeByText(c, text);
      if (found) return found;
    }
    if (node.shadowRoots) for (const sr of node.shadowRoots) {
      const found = findNodeByText(sr, text);
      if (found) return found;
    }
    return null;
  }

  const tagsNode = findNodeByText(doc.root, textToFind);
  if (!tagsNode || !tagsNode.nodeId) return false;

  // Resolve to a JS object and click it
  const { result: resolved } = await send('DOM.resolveNode', { nodeId: tagsNode.nodeId }, sid);
  if (!resolved?.object?.objectId) return false;

  await send('Runtime.callFunctionOn', {
    objectId: resolved.object.objectId,
    functionDeclaration: 'function() { this.click(); }',
    awaitPromise: false,
  }, sid);
  return true;
}

// Check if Listing report text exists in shadow DOM
async function findTextInShadowDom(send, sid, text) {
  await send('DOM.enable', {}, sid);
  const { result: doc } = await send('DOM.getDocument', { depth: -1, pierce: true }, sid);

  function search(node) {
    if (node.nodeType === 3 && node.nodeValue && node.nodeValue.trim() === text) return true;
    if (node.children) for (const c of node.children) { if (search(c)) return true; }
    if (node.shadowRoots) for (const sr of node.shadowRoots) { if (search(sr)) return true; }
    return false;
  }
  return search(doc.root);
}

// Evaluate JS in a specific page target via CDP (bypasses Playwright isolation)
async function cdpEvalInPage(cdpClient, targetId, expression) {
  const { send } = cdpClient;
  const attached = await send('Target.attachToTarget', { targetId, flatten: true });
  const sid = attached.result.sessionId;
  await send('Runtime.enable', {}, sid);

  const res = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sid);

  await send('Target.detachFromTarget', { sessionId: sid });
  return res.result?.result?.value;
}

async function connectBrowser(port) {
  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    console.log(`  Connected to existing browser on port ${port}`);
    return browser;
  } catch (e) {}

  const fs = require('fs');
  const { spawn } = require('child_process');
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const browserPath = config.operaPath;
  if (!browserPath) throw new Error('operaPath not set in config.json');

  console.log(`  Launching Opera with CDP on port ${port}...`);
  const child = spawn(browserPath, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
      console.log(`  Connected to Opera on port ${port}`);
      return browser;
    } catch (e) {}
  }
  throw new Error('Opera baslatilamadi veya CDP baglantisi kurulamadi.');
}

async function scrapeTags(competitorUrl) {
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const port = config.cdpPort || 9333;

  console.log(`  Connecting to browser on port ${port}...`);
  const browser = await connectBrowser(port);
  if (!browser) throw new Error('Could not connect to browser via CDP');

  // Also create raw CDP client for extension-aware DOM access
  const cdpClient = await createCdpClient(port);

  try {
    const context = browser.contexts()[0];
    const pages = context.pages();
    let page = pages.find(p => p.url().includes('etsy.com/listing'))
             || pages.find(p => p.url().includes('etsy.com'))
             || pages[0];

    if (!page) throw new Error('No browser page found');

    // Navigate via Chrome service worker so extension content scripts fire properly
    const { send } = cdpClient;
    const { result: targetsResult } = await send('Target.getTargets');

    // Find Alura service worker to navigate via chrome.tabs API
    const aluraSW = targetsResult.targetInfos.find(t =>
      t.type === 'service_worker' && t.url.includes(ALURA_EXT_ID)
    );

    // Find which tab to navigate (prefer existing Etsy tab)
    let navigatedViaChrome = false;
    if (aluraSW) {
      const swAttached = await send('Target.attachToTarget', { targetId: aluraSW.targetId, flatten: true });
      const swSid = swAttached.result.sessionId;
      await send('Runtime.enable', {}, swSid);

      // Get all tabs, find Etsy one
      const tabRes = await send('Runtime.evaluate', {
        expression: `(async () => {
          const tabs = await chrome.tabs.query({ url: '*://*.etsy.com/*' });
          if (tabs.length === 0) {
            const allTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            return allTabs.map(t => ({ id: t.id, url: t.url }));
          }
          return tabs.map(t => ({ id: t.id, url: t.url }));
        })()`,
        awaitPromise: true, returnByValue: true
      }, swSid);

      const tabs = tabRes.result?.result?.value || [];
      const tab = tabs[0];

      if (tab) {
        console.log(`  Navigating tab ${tab.id} via chrome.tabs.update...`);
        const navRes = await send('Runtime.evaluate', {
          expression: `(async () => {
            await chrome.tabs.update(${tab.id}, { url: ${JSON.stringify(competitorUrl)} });
            return 'ok';
          })()`,
          awaitPromise: true, returnByValue: true
        }, swSid);
        navigatedViaChrome = navRes.result?.result?.value === 'ok';
        console.log(`  chrome.tabs.update: ${navigatedViaChrome ? 'ok' : 'failed'}`);
      }

      await send('Target.detachFromTarget', { sessionId: swSid });
    }

    // Fallback: navigate via Playwright if service worker method failed
    if (!navigatedViaChrome) {
      console.log(`  Fallback: Playwright page.goto...`);
      await page.goto(competitorUrl, { waitUntil: 'load', timeout: 60000 });
    }

    // Wait for page to fully load + extension to inject
    console.log(`  Sayfa yuklenmesi bekleniyor...`);
    await new Promise(r => setTimeout(r, 8000));

    // Find the page target matching competitor URL
    const competitorId = competitorUrl.match(/listing\/(\d+)/)?.[1] || '';
    const { result: targets2 } = await send('Target.getTargets');
    const pageTarget = targets2.targetInfos.find(t =>
      t.type === 'page' && competitorId && t.url.includes(competitorId)
    ) || targets2.targetInfos.find(t =>
      t.type === 'page' && t.url.includes('etsy.com/listing')
    ) || targets2.targetInfos.find(t =>
      t.type === 'page' && t.url.includes('etsy.com')
    );
    console.log(`  CDP targets: ${targets2.targetInfos.filter(t => t.type === 'page' && t.url.includes('etsy.com')).map(t => t.url.substring(0, 60)).join(' | ')}`);

    if (!pageTarget) throw new Error('CDP: Etsy page target bulunamadi');
    console.log(`  CDP page target: ${pageTarget.targetId.substring(0, 12)}...`);

    // Attach to page for all subsequent evaluations
    const attached = await send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
    const sid = attached.result.sessionId;
    await send('Runtime.enable', {}, sid);

    const evalInPage = async (expression) => {
      const res = await send('Runtime.evaluate', {
        expression: `(async () => { ${expression} })()`,
        awaitPromise: true,
        returnByValue: true,
      }, sid);
      return res.result?.result?.value;
    };

    // Check for Alura elements via raw CDP
    console.log('  Alura listing report aciliyor...');
    const aluraDebug = await evalInPage(`
      const launcher = document.querySelector('.ae_launcher-listing');
      const sidebar = document.querySelector('#ae-sidebar_launcher');
      const aluraEl = document.querySelector('alura-chrome-extension');
      return {
        launcher: launcher ? { tag: launcher.tagName, classes: launcher.className, visible: launcher.offsetHeight > 0 } : null,
        sidebar: sidebar ? { tag: sidebar.tagName } : null,
        aluraEl: !!aluraEl,
      };
    `);
    console.log('  [alura-debug]', JSON.stringify(aluraDebug));

    let launcherClicked = false;

    if (aluraDebug?.launcher) {
      await evalInPage(`
        const launcher = document.querySelector('.ae_launcher-listing');
        launcher.classList.remove('hide');
        launcher.style.display = '';
        launcher.click();
      `);
      launcherClicked = true;
      console.log('  Launcher tiklandi: ae_launcher-listing');
    } else if (aluraDebug?.sidebar) {
      await evalInPage(`document.querySelector('#ae-sidebar_launcher').click();`);
      launcherClicked = true;
      console.log('  Launcher tiklandi: ae-sidebar_launcher');
    }

    if (!launcherClicked) {
      // Try opening via Alura service worker
      console.log('  Launcher bulunamadi, CDP ile extension aciliyor...');
      const aluraTarget = targetsResult.targetInfos.find(t =>
        t.type === 'service_worker' && t.url.includes(ALURA_EXT_ID)
      );

      if (aluraTarget) {
        const swAttached = await send('Target.attachToTarget', { targetId: aluraTarget.targetId, flatten: true });
        const swSid = swAttached.result.sessionId;
        await send('Runtime.enable', {}, swSid);

        // Find Etsy tab
        const tabRes = await send('Runtime.evaluate', {
          expression: `(async () => {
            const tabs = await chrome.tabs.query({ url: '*://*.etsy.com/*' });
            return tabs.map(t => ({ id: t.id, url: t.url }));
          })()`,
          awaitPromise: true,
          returnByValue: true
        }, swSid);

        const etsyTabs = tabRes.result?.result?.value || [];
        const matchingTab = etsyTabs.find(t => t.url.includes(competitorUrl.split('?')[0])) || etsyTabs[0];

        if (matchingTab) {
          console.log(`  Alura aciliyor tab ${matchingTab.id}...`);
          const openRes = await send('Runtime.evaluate', {
            expression: `(async () => {
              try {
                const resp = await chrome.tabs.sendMessage(${matchingTab.id}, {command: "launchAluraExtension"});
                return resp?.success ? 'ok' : 'no-success';
              } catch(e) { return 'error:' + e.message; }
            })()`,
            awaitPromise: true,
            returnByValue: true
          }, swSid);
          console.log(`  Alura sonuc: ${openRes.result?.result?.value}`);
        }
        await send('Target.detachFromTarget', { sessionId: swSid });
      }

      // Wait and re-check
      await new Promise(r => setTimeout(r, 3000));
      const postCdp = await evalInPage(`
        const launcher = document.querySelector('.ae_launcher-listing');
        const aluraEl = document.querySelector('alura-chrome-extension');
        const allAlura = document.querySelectorAll('[class*="ae_"], [id*="ae-"], [class*="alura"], alura-chrome-extension');
        return {
          launcher: !!launcher,
          aluraEl: !!aluraEl,
          count: allAlura.length,
          elements: [...allAlura].slice(0, 5).map(el => ({ tag: el.tagName, id: el.id, cls: (el.className || '').substring(0, 60) })),
        };
      `);
      console.log('  [post-cdp]', JSON.stringify(postCdp));

      if (postCdp?.launcher) {
        await evalInPage(`
          const launcher = document.querySelector('.ae_launcher-listing');
          launcher.classList.remove('hide');
          launcher.style.display = '';
          launcher.click();
        `);
        launcherClicked = true;
        console.log('  Launcher tiklandi (post-cdp)');
      }
    }

    // Wait for listing report (try both JS and CDP DOM piercing)
    console.log('  Listing report yuklenmesi bekleniyor...');
    let reportFound = false;
    for (let i = 0; i < 20; i++) {
      const status = await evalInPage(`
        const alura = document.querySelector('alura-chrome-extension');
        if (!alura) return 'no-alura';
        const root = alura.shadowRoot || alura;
        const hasShadow = !!alura.shadowRoot;
        const childCount = root.querySelectorAll('*').length;
        for (const el of root.querySelectorAll('*')) {
          const txt = el.textContent?.trim();
          if (txt === 'Listing report' && el.offsetHeight > 0) return 'found';
          if (txt?.includes('limit') || txt?.includes('upgrade') || txt?.includes('exceeded')) {
            return 'LIMIT: ' + txt.substring(0, 100);
          }
        }
        return 'shadow=' + hasShadow + ', children=' + childCount;
      `);
      console.log(`  [report-wait ${i}] ${status}`);
      if (status === 'found') { reportFound = true; break; }
      if (status?.startsWith('LIMIT')) {
        console.log('  [ALURA LIMIT] ' + status);
        throw new Error('Alura limit dolmus: ' + status);
      }
      // Also try CDP DOM piercing (works with closed shadow DOM)
      if (i === 10) {
        const cdpFound = await findTextInShadowDom(send, sid, 'Listing report');
        if (cdpFound) { reportFound = true; console.log('  [report] Found via CDP DOM pierce'); break; }
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    if (!reportFound) console.log('  WARNING: Listing report bulunamadi');

    // Click "Tags" nav
    console.log('  Tags bolumune gidiliyor...');
    const tagClickResult = await evalInPage(`
      const alura = document.querySelector('alura-chrome-extension');
      if (!alura) return 'no-alura';
      const root = alura.shadowRoot || alura;
      const badges = root.querySelectorAll('a.p-badge.is-sidebar-header');
      const badgeTexts = [...badges].map(b => b.textContent.trim());
      for (const badge of badges) {
        if (badge.textContent.trim() === 'Tags') { badge.click(); return 'clicked-badge'; }
      }
      for (const el of root.querySelectorAll('a, div, span')) {
        if (el.textContent.trim() === 'Tags' && el.offsetHeight > 0 && el.offsetHeight < 40) {
          el.click(); return 'clicked-fallback';
        }
      }
      return 'not-found, badges=' + JSON.stringify(badgeTexts);
    `);
    console.log(`  [tag-click] ${tagClickResult}`);

    // Fallback: click Tags via CDP DOM pierce (closed shadow DOM support)
    if (tagClickResult === 'no-alura' || tagClickResult?.startsWith('not-found')) {
      console.log('  [tag-click] CDP DOM pierce ile deneniyor...');
      const cdpClicked = await clickInShadowDom(send, sid, 'Tags');
      console.log(`  [tag-click] CDP pierce: ${cdpClicked ? 'ok' : 'failed'}`);
    }

    // Wait for tags — first wait for loading state to finish, then look for tag elements
    await new Promise(r => setTimeout(r, 3000));

    // Phase 1: wait for loading spinner to disappear (up to 30s)
    for (let i = 0; i < 15; i++) {
      const loading = await evalInPage(`
        const alura = document.querySelector('alura-chrome-extension');
        if (!alura) return false;
        const root = alura.shadowRoot || alura;
        const loadingEl = root.querySelector('.p-table-content_state-loading, .p-table-content_state-loading-wrap, [class*="state-loading"]');
        return loadingEl && loadingEl.offsetHeight > 0;
      `);
      if (!loading) break;
      console.log(`  [tag-loading ${i}] still loading...`);
      await new Promise(r => setTimeout(r, 2000));
    }

    await new Promise(r => setTimeout(r, 2000));

    // Phase 2: look for tag elements
    for (let i = 0; i < 15; i++) {
      const info = await evalInPage(`
        const alura = document.querySelector('alura-chrome-extension');
        if (!alura) return { count: 0, debug: 'no-alura' };
        const root = alura.shadowRoot || alura;
        const count = root.querySelectorAll('.p-table-text.is-table-text-bold.is-clickable').length;
        if (count > 0) return { count };
        const clickable = root.querySelectorAll('.is-clickable').length;
        const tableTexts = root.querySelectorAll('.p-table-text').length;
        const classes = new Set();
        root.querySelectorAll('[class*="table"]').forEach(el => classes.add(el.className));
        return { count, clickable, tableTexts, tableClasses: [...classes].slice(0, 10) };
      `);
      console.log(`  [tag-wait ${i}] ${JSON.stringify(info)}`);
      if (info?.count > 0) break;
      // If still showing loading classes after phase 1, re-click Tags badge
      if (i === 5) {
        console.log('  [tag-wait] Re-clicking Tags badge...');
        await evalInPage(`
          const alura = document.querySelector('alura-chrome-extension');
          if (alura) {
            const root = alura.shadowRoot || alura;
            for (const badge of root.querySelectorAll('a.p-badge.is-sidebar-header')) {
              if (badge.textContent.trim() === 'Tags') { badge.click(); break; }
            }
          }
        `);
        await new Promise(r => setTimeout(r, 3000));
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    // Scrape title
    const title = await evalInPage(`
      const h1 = document.querySelector('h1[data-buy-box-listing-title], h1.wt-text-body-01, h1');
      return h1 ? h1.textContent.trim() : '';
    `);
    console.log(`  Found title: ${(title || '').substring(0, 60)}...`);

    // Scrape tags - try JS first, then CDP DOM pierce
    let tags = await evalInPage(`
      const tagSet = new Set();
      const alura = document.querySelector('alura-chrome-extension');
      if (alura) {
        const root = alura.shadowRoot || alura;
        const selectors = [
          '.p-table-text.is-table-text-bold.is-clickable',
          '.p-table-text.is-clickable',
          '[class*="table-text"][class*="bold"]',
          '[class*="tag-keyword"]',
          '[class*="tag-text"]',
          '[class*="tag-name"]',
        ];
        for (const sel of selectors) {
          root.querySelectorAll(sel).forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.length > 1 && text.length < 60) tagSet.add(text);
          });
          if (tagSet.size > 0) break;
        }
      }
      if (tagSet.size === 0) {
        document.querySelectorAll('a[href*="/search?q="]').forEach(a => {
          const text = a.textContent?.trim();
          if (text && text.length > 1 && text.length < 60) tagSet.add(text);
        });
      }
      return [...tagSet];
    `);

    // Fallback: CDP DOM pierce for closed shadow DOM
    if (!tags || tags.length === 0) {
      console.log('  JS scrape bos, CDP DOM pierce deneniyor...');
      tags = await scrapeTagsViaCdpDom(send, sid);
      console.log(`  CDP DOM pierce: ${(tags || []).length} tag bulundu`);
    }

    // Check for Alura limit/error messages — only match actual limit banners, not generic UI text
    if (!tags || tags.length === 0) {
      const limitCheck = await evalInPage(`
        const alura = document.querySelector('alura-chrome-extension');
        if (!alura) return 'no-alura-element';
        const root = alura.shadowRoot || alura;
        // Look for visible error/limit banners specifically, not generic page text
        for (const el of root.querySelectorAll('[class*="error"], [class*="limit"], [class*="upgrade"], [class*="banner"], [class*="alert"], [class*="notice"]')) {
          const txt = el.textContent?.trim()?.toLowerCase() || '';
          if (txt.length > 5 && txt.length < 200) {
            if (txt.includes('upgrade') && (txt.includes('plan') || txt.includes('limit'))) return 'UPGRADE_NEEDED: ' + txt.substring(0, 100);
            if (txt.includes('limit') && (txt.includes('reached') || txt.includes('exceeded'))) return 'LIMIT_REACHED: ' + txt.substring(0, 100);
          }
        }
        const childCount = root.querySelectorAll('*').length;
        return 'children=' + childCount;
      `);
      console.log(`  [alura-status] ${limitCheck}`);
    }

    const rawTagCount = (tags || []).length;
    console.log(`  Found ${rawTagCount} raw tags`);

    // Cleanup CDP
    await send('Target.detachFromTarget', { sessionId: sid });
    try { cdpClient.ws.close(); } catch {}

    // Generate SEO title
    console.log('  Generating SEO title with AI...');
    const seoTitle = await generateSEOTitle(title || '', tags || []);
    console.log(`  SEO Title: ${seoTitle}`);

    const listing = { title: seoTitle, tags: tags || [] };
    const optimizedTags = optimizeTags(listing);
    const description = generateDescription(seoTitle, tags || []);
    const altTexts = generateAltTexts(seoTitle, optimizedTags);
    console.log(`  Optimized: ${optimizedTags.length} tags, description ready, ${altTexts.length} alt texts`);

    return { tags: optimizedTags, title: seoTitle, description, altTexts, rawTagCount };

  } finally {
    try { cdpClient.ws.close(); } catch {}
  }
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf('--url');
  if (urlIdx === -1) {
    console.error('Usage: node scrape-tags.js --url <etsy_listing_url>');
    process.exit(1);
  }
  const url = args[urlIdx + 1];
  scrapeTags(url).then(tags => {
    console.log('Tags:', JSON.stringify(tags, null, 2));
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

async function generateSEOTitle(originalTitle, tags, overrideApiKey) {
  const fs = require('fs');
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  const apiKey = overrideApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) return originalTitle;

  try {
    const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-maverick',
        messages: [
          {
            role: 'user',
            content: `You are an Etsy SEO expert. Rewrite this listing title following the 2025/2026 Etsy SEO rules.

Original title: "${originalTitle}"
Tags: ${tags.slice(0, 10).join(', ')}

STRICT RULES:
1. UNDER 70 CHARACTERS - natural language, not keyword stuffing
2. Most important product phrase goes FIRST (first 30-40 chars are visible on mobile)
3. Follow this template: [What you're selling], [Key feature], [For whom/occasion]
4. NO word repetition - each word appears only once
5. REMOVE "Gift for her/him/mom/dad" from title (these go in tags only)
6. Use ONLY commas (,) or colons (:) to separate sections. NEVER use dashes (-, --, ---) or pipes (|)
7. Be specific and natural, like a human wrote it
8. NEVER use "Comfort Colors" in the title - this is STRICTLY FORBIDDEN

GOOD examples:
- Minimalist Sterling Silver Ring for Women, Handmade Boho Gift
- Personalized Leather Wallet for Men, Engraved Anniversary Gift
- Watercolor Cat Portrait, Custom Pet Painting from Photo

BAD examples (DO NOT do this):
- Silver Ring Women Boho Ring Minimalist Ring Handmade Ring Birthday Ring
- Gift For Her Mom Birthday Gift Idea Trendy Aesthetic Comfort Colors

Output ONLY the new title, nothing else.`,
          },
        ],
      }),
    });

    if (!response.ok) return originalTitle;

    const data = await response.json();
    const msg = data.choices?.[0]?.message;
    let newTitle = '';
    if (typeof msg?.content === 'string') {
      newTitle = msg.content.trim();
    } else if (Array.isArray(msg?.content)) {
      newTitle = msg.content.filter(p => p.type === 'text').map(p => p.text).join('').trim();
    }

    newTitle = newTitle.replace(/^["']|["']$/g, '').trim();
    newTitle = newTitle.replace(/,?\s*comfort\s*colors?\s*/gi, ' ').replace(/\s+/g, ' ').trim();
    newTitle = newTitle.replace(/\s*[–—\-|]+\s*/g, ', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '').trim();

    if (newTitle && newTitle.length > 10) {
      if (newTitle.length > 70) {
        const lastComma = newTitle.lastIndexOf(',', 70);
        if (lastComma > 20) {
          newTitle = newTitle.substring(0, lastComma).trim();
        } else {
          newTitle = newTitle.substring(0, 70).trim();
        }
      }
      return newTitle;
    }
    let cleaned = originalTitle
      .replace(/,?\s*comfort\s*colors?\s*/gi, ' ')
      .replace(/\s*[–—\-|]+\s*/g, ', ')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > 70) {
      const lastComma = cleaned.lastIndexOf(',', 70);
      if (lastComma > 20) cleaned = cleaned.substring(0, lastComma).trim();
      else cleaned = cleaned.substring(0, 70).trim();
    }
    return cleaned;
  } catch (e) {
    console.warn('  Warning: AI title generation failed, using original');
    return originalTitle;
  }
}

module.exports = { scrapeTags, generateSEOTitle };
