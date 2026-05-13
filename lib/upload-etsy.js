const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

async function connectBrowser(port) {
  for (let i = 0; i < 15; i++) {
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
      return browser;
    } catch (e) {
      if (i < 14) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

async function uploadToEtsy({ sku, mockupPaths, tags, title, description, altTexts, templateListingId, sectionId }) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const port = config.cdpPort || 9333;
  const templatesDir = path.join(__dirname, '..', 'templates');

  console.log(`  Connecting to browser on port ${port}...`);
  const browser = await connectBrowser(port);
  if (!browser) throw new Error('Could not connect to browser via CDP');

  const context = browser.contexts()[0];

  // Use a fresh page to avoid "Frame has been detached" errors
  let page;
  try {
    page = await context.newPage();
  } catch (e) {
    // Fallback: reuse existing page
    page = context.pages()[0];
    if (!page) throw new Error('No browser page available');
  }

  // Auto-dismiss any unexpected dialogs (alerts, confirms, etc.)
  page.on('dialog', async dialog => {
    try { await dialog.accept(); } catch (e) { /* already dismissed */ }
  });

  try {
    // Step 1: Navigate directly to copy URL
    const TEMPLATE_LISTING_ID = config.templateListingId || '4486340237';
    const copyUrl = `https://www.etsy.com/your/shops/me/listing-editor/copy/${TEMPLATE_LISTING_ID}`;
    console.log(`  Template kopyalaniyor: ${copyUrl}`);

    try {
      await page.goto(copyUrl, { waitUntil: 'load', timeout: 90000 });
    } catch (navErr) {
      if (navErr.message.includes('Frame has been detached') || navErr.message.includes('frame was detached')) {
        console.log('  Frame detached, retrying with fresh page...');
        try { await page.close(); } catch {}
        page = await context.newPage();
        page.on('dialog', async dialog => { try { await dialog.accept(); } catch {} });
        await page.waitForTimeout(2000);
        await page.goto(copyUrl, { waitUntil: 'load', timeout: 90000 });
      } else if (!navErr.message.includes('Timeout')) {
        throw navErr;
      } else {
        console.log('  Navigation timeout ama devam ediliyor...');
      }
    }

    // Wait for network to settle
    try {
      await page.waitForLoadState('networkidle', { timeout: 30000 });
    } catch { /* ok */ }

    console.log(`  Current URL: ${page.url()}`);
    if (page.url().includes('/signin')) {
      throw new Error('Etsy login gerekli - tarayicida Etsy hesabiniza giris yapin');
    }

    // Wait for the editor form to appear
    for (let i = 0; i < 20; i++) {
      const editorReady = await page.evaluate(() => {
        return !!(
          document.querySelector('input[id*="title"], input[name*="title"], [data-test-id*="title"], textarea[id*="title"]') ||
          document.querySelector('#listing-title-input') ||
          document.querySelector('[class*="listing-editor"], [class*="ListingEditor"]')
        );
      });
      if (editorReady) {
        console.log('  Editor loaded!');
        break;
      }
      if (i === 0) console.log('  Editor not ready yet, waiting...');
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(2000);

    // Step 3: Update title
    if (title) {
      console.log(`  Setting title...`);
      await updateTitle(page, title);
    }

    // Step 3b: Update description
    if (description) {
      console.log(`  Setting description...`);
      await updateDescription(page, description);
    }

    // Step 4: Update SKU
    console.log(`  Setting SKU to: ${sku}`);
    await updateSKU(page, sku);

    // Step 5: Manage photos - delete all photos, upload mockups + templates
    console.log('  Managing photos...');
    await managePhotos(page, mockupPaths, templatesDir, altTexts || []);

    // Step 6: Enter tags
    if (tags && tags.length > 0) {
      console.log(`  Entering ${tags.length} tags...`);
      await enterTags(page, tags);
    }

    // Step 6b: Select section
    if (sectionId) {
      console.log(`  Selecting section: ${sectionId}...`);
      await selectSection(page, sectionId);
    }

    // Step 7: Publish — MUST succeed before continuing
    console.log('  Publishing listing...');
    const publishConfirmed = await publishListing(page);

    if (!publishConfirmed) {
      throw new Error('Publish başarısız — listing yayınlanamadı. Sayfayı kontrol edin.');
    }

    // Step 7: Find the NEW listing by searching SKU in listing manager
    console.log(`  Finding listing by SKU search: ${sku}`);

    let listingUrl = '';
    let listingId = '';

    listingId = await searchListingBySKU(page, sku, TEMPLATE_LISTING_ID);

    if (!listingId) {
      throw new Error('Listing ID bulunamadi — SKU aramasinda sonuc yok. Listing manager\'i kontrol edin.');
    }

    listingUrl = `https://www.etsy.com/listing/${listingId}`;
    console.log(`  Listing URL constructed: ${listingUrl}`);

    // Step 8: Navigate to the actual listing page and VERIFY it's published
    console.log(`  Verifying listing is live: ${listingUrl}`);
    try {
      await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);

      const verified = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        const buyBox = document.querySelector('[data-buy-box-listing-title], [data-appears-component-name="buy_box"]');
        const addToCart = document.querySelector('button[data-selector*="add-to-cart"], button[class*="add-to-cart"]');
        const notFound = document.body?.innerText?.includes('404') || document.body?.innerText?.includes('page isn');
        if (notFound) return 'not-found';
        if (buyBox || addToCart) return 'ok';
        if (h1) return 'probably-ok';
        return 'unknown';
      });

      if (verified === 'ok' || verified === 'probably-ok') {
        console.log('  Listing VERIFIED — published and visible on Etsy!');
      } else if (verified === 'not-found') {
        console.warn('  WARNING: Listing page 404 — Etsy may still be processing. Waiting 10s and retrying...');
        await page.waitForTimeout(10000);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
        const retry = await page.evaluate(() => {
          return !!(document.querySelector('h1') || document.querySelector('[data-buy-box-listing-title]'));
        });
        if (retry) {
          console.log('  Listing verified on retry!');
        } else {
          console.warn('  WARNING: Listing still not visible — may need more time to propagate');
        }
      }
    } catch (e) {
      console.warn(`  Warning: Could not navigate to listing page: ${e.message}`);
    }

    console.log(`  Listing created successfully! URL: ${listingUrl}`);
    return { success: true, listingUrl };

  } catch (err) {
    console.error(`  Upload error: ${err.message}`);
    throw err;
  } finally {
    try { await browser.close(); } catch {}
  }
}

async function searchListingBySKU(page, sku, templateId) {
  console.log(`  Opening listing manager to search SKU: ${sku}`);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto('https://www.etsy.com/your/shops/me/tools/listings', {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      break;
    } catch (e) {
      if (attempt < 2 && e.message.includes('ERR_ABORTED')) {
        console.log(`  ERR_ABORTED on search nav, retrying (${attempt + 1})...`);
        await page.waitForTimeout(3000);
      } else {
        throw e;
      }
    }
  }
  await page.waitForTimeout(5000);

  const searchInput = await page.$('input[placeholder*="Search"], input[type="search"], input[name*="search"], input[aria-label*="Search"]');
  if (!searchInput) {
    console.error('  Search input not found in listing manager');
    return '';
  }

  await searchInput.evaluate((el, val) => {
    el.scrollIntoView({ block: 'center' });
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sku);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);

  const listingId = await page.evaluate((tmplId) => {
    const links = document.querySelectorAll('a[href*="/listing/"]');
    for (const link of links) {
      const m = link.href.match(/\/listing\/(\d{8,})/);
      if (m && m[1] !== tmplId) return m[1];
    }
    return '';
  }, templateId);

  if (listingId) {
    console.log(`  Found listing by SKU search: ${listingId}`);
  } else {
    console.error(`  No listing found for SKU: ${sku}`);
  }
  return listingId;
}

async function copyFromListingManager(page, listingId) {
  // Wait for listing manager to fully load
  try {
    await page.waitForSelector('table, [class*="listing"], [data-listing-id]', { timeout: 15000 });
  } catch (e) {
    console.log('  Warning: Listing table not detected, trying anyway...');
  }
  await page.waitForTimeout(2000);

  // Debug: log what's on the page
  const pageInfo = await page.evaluate((id) => {
    const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.textContent?.trim().substring(0, 50),
      ariaLabel: b.getAttribute('aria-label'),
      classes: b.className?.substring(0, 80)
    }));
    const hasListingId = document.body.innerHTML.includes(id);
    const listingRows = document.querySelectorAll('[data-listing-id]').length;
    return { buttonCount: allButtons.length, sampleButtons: allButtons.slice(0, 10), hasListingId, listingRows, url: window.location.href };
  }, listingId);
  console.log(`  Page: ${pageInfo.url}`);
  console.log(`  Found ${pageInfo.buttonCount} buttons, ${pageInfo.listingRows} listing rows, listing ID present: ${pageInfo.hasListingId}`);
  if (pageInfo.sampleButtons.length > 0) {
    console.log(`  Sample buttons: ${JSON.stringify(pageInfo.sampleButtons.slice(0, 5))}`);
  }

  // Strategy 1: Find listing by data-listing-id attribute
  let gearClicked = await page.evaluate((id) => {
    const row = document.querySelector(`[data-listing-id="${id}"]`);
    if (row) {
      const gear = row.querySelector('button[aria-label*="anage"], button[aria-label*="ore"], button[aria-label*="ction"], button[class*="menu"], button[class*="gear"]');
      if (gear) { gear.click(); return 'data-attr'; }
      // Try any button with icon/svg inside the row
      const anyBtn = row.querySelector('button:has(svg), button:has(img)');
      if (anyBtn) { anyBtn.click(); return 'data-attr-svg'; }
    }
    return null;
  }, listingId);

  // Strategy 2: Find listing by link containing the ID
  if (!gearClicked) {
    gearClicked = await page.evaluate((id) => {
      const link = document.querySelector(`a[href*="${id}"]`);
      if (link) {
        // Walk up to find the listing row container
        let container = link.closest('tr, li, [class*="listing"], [class*="row"], [class*="card"]');
        if (!container) container = link.parentElement?.parentElement?.parentElement;
        if (container) {
          const gear = container.querySelector('button[aria-label*="anage"], button[aria-label*="ore"], button[aria-label*="ction"], button:has(svg)');
          if (gear) { gear.click(); return 'link-parent'; }
        }
      }
      return null;
    }, listingId);
  }

  // Strategy 3: Search for listing ID text anywhere, then find nearest gear button
  if (!gearClicked) {
    gearClicked = await page.evaluate((id) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes(id)) {
          let el = walker.currentNode.parentElement;
          for (let i = 0; i < 10 && el; i++) {
            const gear = el.querySelector('button[aria-label*="anage"], button[aria-label*="ore"], button:has(svg)');
            if (gear) { gear.click(); return 'text-walk'; }
            el = el.parentElement;
          }
        }
      }
      return null;
    }, listingId);
  }

  // Strategy 4: Try clicking the three-dot / gear button on the first listing
  if (!gearClicked) {
    console.log('  Trying fallback: clicking first available gear/menu button...');
    gearClicked = await page.evaluate(() => {
      const selectors = [
        'button[aria-label*="Manage"]',
        'button[aria-label*="manage"]',
        'button[aria-label*="More"]',
        'button[aria-label*="more"]',
        'button[aria-label*="action"]',
        'button[aria-label*="Action"]',
        '[data-selector="listing-actions"]',
        'button[data-selector*="action"]',
        '.wt-menu__trigger',
        'button.wt-btn--icon',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) { btn.click(); return 'fallback-' + sel; }
      }
      return null;
    });
  }

  if (!gearClicked) {
    console.log('  ERROR: No gear/menu button found on the page');
    return false;
  }
  console.log(`  Gear clicked via strategy: ${gearClicked}`);
  await page.waitForTimeout(1500);

  // Debug: log dropdown items
  const menuItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], .wt-options__item, .wt-menu__item, li[class*="option"], a[class*="option"]'))
      .map(el => ({ text: el.textContent?.trim(), visible: el.offsetParent !== null }));
  });
  console.log(`  Menu items found: ${JSON.stringify(menuItems)}`);

  // Click "Copy" from the dropdown menu - try multiple text matches
  const copyClicked = await page.evaluate(() => {
    const selectors = [
      '[role="menuitem"]', '[role="option"]',
      '.wt-options__item', '.wt-menu__item',
      'li[class*="option"]', 'a[class*="option"]',
      'button[class*="option"]', 'span[class*="option"]'
    ];
    const copyTexts = ['Copy', 'copy', 'Kopyala', 'Duplicate', 'duplicate'];
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      for (const item of items) {
        const text = item.textContent?.trim();
        if (copyTexts.some(ct => text === ct || text?.toLowerCase() === ct.toLowerCase())) {
          item.click();
          return text;
        }
      }
    }
    return null;
  });

  if (copyClicked) {
    console.log(`  Copy clicked: "${copyClicked}"`);
    return true;
  }

  console.log('  ERROR: "Copy" option not found in dropdown menu');
  return false;
}

async function findElement(page, selectors, label, timeout = 15000) {
  // Try each selector
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: 3000 });
      console.log(`  Found ${label} via: ${sel}`);
      return el;
    } catch { /* try next */ }
  }
  // Last resort: wait longer for first selector
  try {
    const el = page.locator(selectors[0]).first();
    await el.waitFor({ state: 'visible', timeout });
    return el;
  } catch {
    console.error(`  ERROR: ${label} not found! Tried: ${selectors.join(', ')}`);
    return null;
  }
}

// React-compatible setter — triggers proper onChange so framework state stays in sync
async function setReactField(page, selector, value) {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeSetter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

async function updateTitle(page, title) {
  // Must use #listing-title-input specifically — other title selectors may match wrong elements
  const selector = '#listing-title-input';
  const titleInput = await page.$(selector);
  if (!titleInput) {
    console.warn('  WARNING: Title input not found');
    return;
  }

  try {
    await page.evaluate(el => el.scrollIntoView({ block: 'center' }), titleInput);
    await page.waitForTimeout(300);
    await setReactField(page, selector, title);
    await page.waitForTimeout(300);

    const actual = await titleInput.inputValue();
    if (actual !== title) {
      // Fallback: click to focus, select all, delete, type
      await titleInput.click({ clickCount: 3 });
      await page.waitForTimeout(200);
      await page.keyboard.press('Backspace');
      await page.keyboard.type(title, { delay: 10 });
    }

    await page.evaluate(() => document.body.click());
    await page.waitForTimeout(300);
    const final = await titleInput.inputValue();
    console.log(`  Title: "${final.substring(0, 60)}..." (${final.length} chars, match=${final === title})`);
  } catch (e) {
    console.error(`  ERROR: Title update failed: ${e.message}`);
  }
}

async function updateDescription(page, description) {
  const selectors = [
    '#listing-description-textarea',
    'textarea[name="description"]',
    'textarea[id*="description"]',
    'textarea[data-test-id*="description"]',
    'textarea[aria-label*="description" i]',
    'textarea[aria-label*="Description" i]',
    '[contenteditable="true"][data-test-id*="description"]',
    'div[role="textbox"][aria-label*="description" i]',
  ];
  const descInput = await findElement(page, selectors, 'description textarea');
  if (!descInput) return;

  try {
    // fill() triggers React/framework state updates properly
    try {
      await descInput.fill('');
      await page.waitForTimeout(200);
      await descInput.fill(description);
    } catch {
      // contenteditable fallback
      await descInput.click();
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);
      await page.keyboard.type(description, { delay: 5 });
    }
    await page.evaluate(() => document.body.click());
    await page.waitForTimeout(500);
    console.log(`  Description updated (${description.length} chars)`);
  } catch (e) {
    console.error(`  ERROR: Description update failed: ${e.message}`);
  }
}

async function updateSKU(page, sku) {
  const safeSku = sku.length > 32 ? sku.slice(0, 32) : sku;
  const selector = '#listing-sku-input';
  const skuInput = await page.$(selector);
  if (!skuInput) {
    console.warn('  WARNING: SKU input not found');
    return;
  }

  try {
    await page.evaluate(el => el.scrollIntoView({ block: 'center' }), skuInput);
    await page.waitForTimeout(300);
    // Use React-compatible setter to properly replace the value
    await setReactField(page, selector, safeSku);
    await page.waitForTimeout(300);

    const actual = await skuInput.inputValue().catch(() => '');
    if (actual !== safeSku) {
      await skuInput.click({ clickCount: 3 });
      await page.waitForTimeout(200);
      await page.keyboard.press('Backspace');
      await page.keyboard.type(safeSku, { delay: 15 });
    }

    await page.evaluate(() => document.body.click());
    await page.waitForTimeout(300);
    const final = await skuInput.inputValue().catch(() => '');
    console.log(`  SKU: "${final}" (${final.length} chars, match=${final === safeSku})`);
  } catch (e) {
    console.error(`  ERROR: SKU update failed: ${e.message}`);
  }
}

async function managePhotos(page, mockupPaths, templatesDir, altTexts = []) {
  // Step 1: Delete ALL photos (video stays, it has no trash or different structure)
  let deletePass = 0;
  while (true) {
    const deleted = await page.evaluate(() => {
      const items = document.querySelectorAll('.le-media-grid__item');
      for (const item of items) {
        const img = item.querySelector('img');
        const trashBtn = item.querySelector('.le-media-grid__button.wt-text-brick');
        if (img && trashBtn) {
          trashBtn.click();
          return true;
        }
      }
      return false;
    });

    if (!deleted) break;
    deletePass++;
    await page.waitForTimeout(1500);
  }
  console.log(`  Deleted ${deletePass} photos`);

  // Wait for all deletions to fully process before uploading
  if (deletePass > 0) {
    console.log('  Waiting for deletions to settle...');
    await page.waitForTimeout(5000);
    // Double check no more photos remain
    const remaining = await page.evaluate(() => {
      return document.querySelectorAll('.le-media-grid__item img').length;
    });
    if (remaining > 0) {
      console.log(`  ${remaining} photos still visible, waiting more...`);
      await page.waitForTimeout(3000);
    }
  }

  // Step 2: Build full upload list (mockups + template files).
  const allPaths = [];
  for (const mockupPath of mockupPaths) {
    const absPath = path.resolve(mockupPath);
    if (!fs.existsSync(absPath)) {
      console.warn(`  Warning: Mockup file not found: ${absPath}`);
      continue;
    }
    allPaths.push(absPath);
  }
  let templateFiles = [];
  try {
    templateFiles = fs.readdirSync(templatesDir)
      .filter(f => /\.(webp|png|jpg|jpeg)$/i.test(f))
      .sort((a, b) => parseInt(a) - parseInt(b));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`  templates/ klasoru yok - sadece mockup yuklenecek`);
    } else throw err;
  }
  for (const file of templateFiles) {
    allPaths.push(path.join(templatesDir, file));
  }

  console.log(`  Uploading ${allPaths.length} files (${mockupPaths.length} mockup + ${templateFiles.length} template)...`);
  const expectedCount = allPaths.length;
  // Per-file upload: CDP-remote browsers have a 50MB transfer cap for batched
  // setInputFiles, so we push files one at a time to stay under the limit.
  const failedPaths = [];
  for (const p of allPaths) {
    const uploaded = await uploadFile(page, p);
    if (!uploaded) failedPaths.push(p);
  }

  // Wait for Etsy to process all uploads; poll grid until count stabilizes or
  // hits expected. Cap at ~60s so we never hang.
  const pollPhotoCount = async (timeoutMs) => {
    let lastCount = -1;
    let stableTicks = 0;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await page.waitForTimeout(2000);
      const cnt = await page.evaluate(() => document.querySelectorAll('.le-media-grid__item img').length);
      if (cnt >= expectedCount) { lastCount = cnt; break; }
      if (cnt === lastCount) {
        stableTicks++;
        if (stableTicks >= 3) break;
      } else {
        stableTicks = 0;
        lastCount = cnt;
      }
    }
    return lastCount;
  };

  let lastCount = await pollPhotoCount(60000);
  const unresolvedFailed = new Set(failedPaths);
  const retriedTail = new Set();

  for (let pass = 1; pass <= 2 && lastCount < expectedCount; pass++) {
    console.warn(`  Photo upload count short (${lastCount}/${expectedCount}); retry pass ${pass}/2...`);
    if (pass > 1) await page.waitForTimeout(4000);

    for (const p of Array.from(unresolvedFailed)) {
      const uploaded = await uploadFile(page, p);
      if (uploaded) unresolvedFailed.delete(p);
    }

    lastCount = await pollPhotoCount(30000);

    if (lastCount < expectedCount) {
      const currentCount = Math.max(0, lastCount);
      const shortBy = Math.max(0, expectedCount - currentCount);
      const tailPaths = allPaths.slice(-shortBy);
      for (const p of tailPaths) {
        retriedTail.add(p);
        const uploaded = await uploadFile(page, p);
        if (!uploaded) unresolvedFailed.add(p);
      }
      lastCount = await pollPhotoCount(30000);
    }
  }

  if (lastCount < expectedCount) {
    const failedList = Array.from(unresolvedFailed).map(p => path.basename(p));
    const tailList = Array.from(retriedTail).map(p => path.basename(p));
    console.error(`  ERROR: Photo upload incomplete (${lastCount}/${expectedCount}). UploadFile failed files: ${failedList.length ? failedList.join(', ') : 'none'}. Retried tail files: ${tailList.length ? tailList.join(', ') : 'none'}`);
    throw new Error(`Photo upload incomplete: ${lastCount}/${expectedCount}`);
  }
  console.log(`  managePhotos done. Photos in grid: ${lastCount}/${expectedCount}`);
}

async function uploadFile(page, absPath, altText = '') {
  const selectors = [
    'input[name="listing-media-upload"]',
    'input[type="file"][accept*="image"]',
    'input[type="file"][data-test-id*="media" i]',
    '[class*="media" i] input[type="file"]',
    'input[type="file"]',
  ];
  for (const sel of selectors) {
    try {
      const fileInput = page.locator(sel).first();
      await fileInput.waitFor({ state: 'attached', timeout: 8000 });
      await fileInput.setInputFiles(absPath, { timeout: 60000 });
      console.log(`  Uploaded via ${sel}: ${path.basename(absPath)}`);
      await page.waitForTimeout(3000);
      if (altText) await applyAltText(page, altText);
      return true;
    } catch (e) {}
  }
  return false;
}

async function applyAltText(page, altText) {
  try {
    // Find the last uploaded photo's alt text button and click it
    const altBtn = await page.evaluate(() => {
      // Look for alt text buttons on photo cards — Etsy uses aria-label or title
      const btns = Array.from(document.querySelectorAll(
        'button[aria-label*="alt" i], button[title*="alt" i], button[data-test-id*="alt" i], ' +
        '[class*="alt-text" i] button, [class*="altText" i] button'
      ));
      return btns.length > 0 ? btns.length : 0;
    });

    // Click the last alt text button (most recently uploaded photo)
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(
        'button[aria-label*="alt" i], button[title*="alt" i], button[data-test-id*="alt" i], ' +
        '[class*="alt-text" i] button, [class*="altText" i] button'
      ));
      if (btns.length > 0) {
        btns[btns.length - 1].click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      console.warn('  Alt text button not found, skipping');
      return;
    }

    await page.waitForTimeout(1000);

    // Fill the alt text textarea in the modal
    const textarea = await page.$('textarea[placeholder*="image" i], textarea[placeholder*="alt" i], textarea[placeholder*="detail" i], dialog textarea, [role="dialog"] textarea');
    if (textarea) {
      await textarea.fill('');
      await textarea.fill(altText.substring(0, 500));
      await page.waitForTimeout(300);

      // Click Apply button
      const applied = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const applyBtn = btns.find(b => b.textContent?.trim().toLowerCase() === 'apply');
        if (applyBtn) { applyBtn.click(); return true; }
        return false;
      });

      if (applied) {
        console.log(`  Alt text applied: ${altText.substring(0, 60)}...`);
        await page.waitForTimeout(500);
      } else {
        console.warn('  Apply button not found');
      }
    } else {
      console.warn('  Alt text textarea not found');
      // Close modal if open
      await page.keyboard.press('Escape');
    }
  } catch (e) {
    console.warn(`  Alt text error: ${e.message}`);
    try { await page.keyboard.press('Escape'); } catch {}
  }
}

async function enterTags(page, tags) {
  // First: scroll down to the tags section
  await page.evaluate(() => {
    const tagsSection = document.querySelector('#listing-tags-input, input[id*="tag"], input[name*="tag"], [data-test-id*="tag"]');
    if (tagsSection) tagsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  await page.waitForTimeout(1000);

  // Debug: dump tag section HTML to understand DOM structure
  const tagDebug = await page.evaluate(() => {
    const input = document.querySelector('#listing-tags-input');
    if (!input) return { found: false };
    // Walk up to find the tag container
    let container = input.closest('[class*="tag"], [class*="Tag"], div');
    for (let i = 0; i < 5 && container; i++) {
      const buttons = container.querySelectorAll('button');
      if (buttons.length > 0) break;
      container = container.parentElement;
    }
    const html = container ? container.innerHTML.substring(0, 3000) : 'no-container';
    const allButtons = container ? Array.from(container.querySelectorAll('button')).map(b => ({
      text: b.textContent?.trim().substring(0, 30),
      ariaLabel: b.getAttribute('aria-label') || '',
      class: b.className?.substring(0, 60) || '',
      parentClass: b.parentElement?.className?.substring(0, 60) || '',
    })) : [];
    return { found: true, disabled: input.disabled, buttonsInContainer: allButtons.length, buttons: allButtons.slice(0, 10), html: html.substring(0, 1500) };
  });
  console.log(`  Tag section debug: input disabled=${tagDebug.disabled}, buttons=${tagDebug.buttonsInContainer}`);
  if (tagDebug.buttons?.length > 0) {
    console.log(`  Tag buttons sample: ${JSON.stringify(tagDebug.buttons.slice(0, 3))}`);
  }
  console.log(`  Tag container HTML (first 500): ${tagDebug.html?.substring(0, 500)}`);

  // Remove ALL existing tags — use the debug info to find correct buttons
  let removePass = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const removed = await page.evaluate(() => {
      // Strategy 1: Find tag pills near the tag input — they're siblings or nearby
      const input = document.querySelector('#listing-tags-input');
      if (!input) return false;

      // Walk up to find the tags wrapper (usually 2-3 levels up)
      let wrapper = input.parentElement;
      for (let i = 0; i < 6 && wrapper; i++) {
        // Look for any button that seems like a tag remove button
        const btns = wrapper.querySelectorAll('button');
        for (const btn of btns) {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          const text = (btn.textContent || '').trim();
          const cls = (btn.className || '').toLowerCase();
          // Tag remove buttons: have "remove" in aria-label, or are small buttons inside tag pills
          if (label.includes('remove') || label.includes('kaldır') || label.includes('delete tag')) {
            btn.click();
            return true;
          }
          // Small icon-only buttons inside tag-like containers
          if (btn.querySelector('svg') && btn.closest('[class*="tag"], [class*="pill"], [class*="chip"]')) {
            btn.click();
            return true;
          }
        }
        wrapper = wrapper.parentElement;
      }

      // Strategy 2: Global search for tag remove buttons
      const globalBtns = document.querySelectorAll('button[aria-label*="Remove tag"], button[aria-label*="remove tag"], button[aria-label*="Remove "]');
      for (const btn of globalBtns) {
        btn.click();
        return true;
      }

      return false;
    });
    if (!removed) break;
    removePass++;
    await page.waitForTimeout(400);
  }
  if (removePass > 0) {
    console.log(`  Removed ${removePass} existing tags`);
    await page.waitForTimeout(1000);
  }

  const tagSelectors = [
    '#listing-tags-input',
    'input[name*="tag" i]',
    'input[id*="tag" i]',
    'input[placeholder*="tag" i]',
    'input[aria-label*="tag" i]',
    'input[aria-label*="Tag" i]',
    'input[data-test-id*="tag" i]',
  ];

  // Wait for the tag input to become enabled (after removing existing tags)
  let tagInput = null;
  for (let i = 0; i < 10; i++) {
    const isEnabled = await page.evaluate(() => {
      const el = document.querySelector('#listing-tags-input');
      return el && !el.disabled;
    });
    if (isEnabled) {
      tagInput = await findElement(page, tagSelectors, 'tags input');
      break;
    }
    if (i === 0) console.log('  Waiting for tag input to become enabled...');
    await page.waitForTimeout(1000);
  }

  if (!tagInput) {
    console.warn('  WARNING: Tag input still disabled after removal attempts — tags will not be entered');
    return;
  }

  // Enter new tags
  let tagsDone = 0;
  for (const tag of tags.slice(0, 13)) { // Etsy allows max 13 tags
    try {
      await tagInput.click({ timeout: 5000 });
      await page.waitForTimeout(200);
      await page.keyboard.type(tag, { delay: 10 });
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      tagsDone++;
    } catch (e) {
      console.warn(`  Warning: Could not enter tag "${tag}": ${e.message.split('\n')[0]}`);
      const stillEnabled = await page.evaluate(() => {
        const el = document.querySelector('#listing-tags-input');
        return el && !el.disabled;
      });
      if (!stillEnabled) {
        console.log(`  Tag input disabled (max reached), stopping at ${tagsDone} tags`);
        break;
      }
    }
  }
  console.log(`  Entered ${tagsDone}/${tags.length} tags`);
}

async function selectSection(page, sectionId) {
  try {
    // Scroll to find the section select
    await page.evaluate(() => {
      const sel = document.querySelector('select[name="shop-section-select"], select[name="section_id"], select[id*="section"]');
      if (sel) sel.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(500);

    const result = await page.evaluate((secId) => {
      // Find section select
      let sel = document.querySelector('select[name="shop-section-select"]');
      if (!sel) {
        sel = document.querySelector('select[name="section_id"], select[id*="section"]');
      }
      if (!sel) {
        // Fallback: find select with section-like options
        const allSelects = Array.from(document.querySelectorAll('select'));
        for (const s of allSelects) {
          const opts = Array.from(s.options);
          if (opts.some(o => o.value === secId)) {
            sel = s;
            break;
          }
        }
      }
      if (!sel) return 'section-select-not-found';

      const opt = Array.from(sel.options).find(o => o.value === secId);
      if (!opt) return 'section-id-not-found|options:' + Array.from(sel.options).map(o => o.value + ':' + o.text).join(',');

      // React-compatible value setting
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      nativeSetter.call(sel, secId);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok:' + opt.text.trim();
    }, sectionId);

    console.log(`  Section result: ${result.substring(0, 100)}`);
  } catch (e) {
    console.warn(`  WARNING: Section selection failed: ${e.message}`);
  }
}

async function publishListing(page) {
  // First: wait for any ongoing photo uploads to finish
  console.log('  Checking for pending photo uploads...');
  for (let i = 0; i < 30; i++) {
    const uploading = await page.evaluate(() => {
      return !!document.querySelector('.le-media-grid__spinner, [class*="spinner"][class*="media"], [class*="uploading"], .le-media-grid__item--loading');
    });
    if (!uploading) break;
    if (i === 0) console.log('  Photos still uploading, waiting...');
    await page.waitForTimeout(3000);
  }
  await page.waitForTimeout(2000);

  // Etsy's listing editor is multi-step — keep clicking "Publish"/"Save and continue"
  // until we leave the editor or see a success indicator
  const MAX_STEPS = 8;
  let publishConfirmed = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const currentUrl = page.url();
    const isStillInEditor = currentUrl.includes('listing-editor');

    if (!isStillInEditor && step > 0) {
      console.log('  Left the listing editor — publish likely complete');
      publishConfirmed = true;
      break;
    }

    // Scroll down to make sure the button is visible
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Click the primary action button
    const clicked = await page.evaluate(() => {
      const priority = ['Publish', 'Publish changes', 'Yayınla', 'Save and continue', 'Kaydet ve devam et', 'Save', 'Kaydet'];
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const label of priority) {
        const btn = buttons.find(b => b.textContent.trim() === label && !b.disabled);
        if (btn) { btn.click(); return label; }
      }
      // Fallback: look for submit/primary buttons
      const primary = buttons.find(b =>
        (b.classList.contains('wt-btn--filled') || b.type === 'submit') && !b.disabled
      );
      if (primary) { primary.click(); return primary.textContent.trim(); }
      return null;
    });

    if (!clicked) {
      if (step === 0) {
        const allBtns = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('button')).map(b => ({
            text: b.textContent?.trim().substring(0, 50),
            disabled: b.disabled,
            class: b.className?.substring(0, 80),
            visible: b.offsetParent !== null,
          })).filter(b => b.visible);
        });
        console.error('  ERROR: No Publish/Save button found!');
        console.error('  Visible buttons:', JSON.stringify(allBtns.slice(0, 10), null, 2));
        return false;
      }
      // No more buttons to click — we're done
      publishConfirmed = true;
      break;
    }

    console.log(`  Step ${step + 1}: Clicked "${clicked}" (URL hash: ${currentUrl.split('#')[1] || 'none'})`);

    // Wait for page transition (URL hash change or full navigation)
    try {
      await Promise.race([
        page.waitForURL(url => url.toString() !== currentUrl, { timeout: 30000 }),
        page.waitForSelector('[class*="success"], [class*="congratulations"], .wt-alert--success', { timeout: 30000 }),
      ]);
    } catch {
      // URL didn't change — might still be processing or we're at the final step
      await page.waitForTimeout(3000);
    }

    await page.waitForTimeout(2000);

    // Check if we've left the editor
    const newUrl = page.url();
    if (!newUrl.includes('listing-editor')) {
      console.log('  Redirected out of editor — publish confirmed!');
      publishConfirmed = true;
      break;
    }

    // Check for success indicators
    const hasSuccess = await page.evaluate(() => {
      return !!(document.querySelector('.wt-alert--success, [class*="congratulations"], [data-appears-component-name="alert_banner"]'));
    });
    if (hasSuccess) {
      console.log('  Success indicator found!');
      publishConfirmed = true;
      break;
    }
  }

  // Wait for page to fully settle after publish
  await page.waitForTimeout(5000);
  return publishConfirmed;
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const skuIdx = args.indexOf('--sku');
  const mockupsIdx = args.indexOf('--mockups');
  const tagsIdx = args.indexOf('--tags');

  if (skuIdx === -1 || mockupsIdx === -1) {
    console.error('Usage: node upload-etsy.js --sku <sku> --mockups <m1.jpg,m2.jpg> [--tags <tag1,tag2,...>]');
    process.exit(1);
  }

  const sku = args[skuIdx + 1];
  const mockupPaths = args[mockupsIdx + 1].split(',');
  const tags = tagsIdx !== -1 ? args[tagsIdx + 1].split(',') : [];

  uploadToEtsy({ sku, mockupPaths, tags }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { uploadToEtsy, searchListingBySKU };
