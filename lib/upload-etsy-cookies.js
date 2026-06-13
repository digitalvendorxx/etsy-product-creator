const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const sharp = require('sharp');

const ETSY_PHOTO_BYTES = 7 * 1024 * 1024;
const ETSY_PHOTO_MAX_DIM = 2700;
const COMPRESSED_DIR = path.join(__dirname, '..', 'output', '_etsy-compressed');

async function ensureUploadable(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size <= ETSY_PHOTO_BYTES) return absPath;
    if (!fs.existsSync(COMPRESSED_DIR)) fs.mkdirSync(COMPRESSED_DIR, { recursive: true });
    const outName = path.basename(absPath, path.extname(absPath)) + '.jpg';
    const outPath = path.join(COMPRESSED_DIR, outName);
    await sharp(absPath)
      .rotate()
      .resize(ETSY_PHOTO_MAX_DIM, ETSY_PHOTO_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(outPath);
    const newSize = fs.statSync(outPath).size;
    console.log(`  [etsy-cookie resize] ${path.basename(absPath)} ${(stat.size/1024/1024).toFixed(1)}MB -> ${(newSize/1024/1024).toFixed(1)}MB`);
    return outPath;
  } catch (err) {
    console.warn(`  [etsy-cookie resize] ${path.basename(absPath)} compress failed: ${err.message} - using original`);
    return absPath;
  }
}

async function uploadToEtsyWithCookies({ sku, mockupPaths, tags, title, description, etsyCookies, altTexts = [], templateListingId, sectionId }) {
  const TEMPLATE_LISTING_ID = templateListingId || '4484014869';
  if (!etsyCookies) throw new Error('Etsy cookie\'leri bulunamadi. Ayarlardan Etsy hesabinizi baglayin.');

  let cookieArray;
  try {
    cookieArray = JSON.parse(etsyCookies);
  } catch {
    throw new Error('Etsy cookie formati hatali');
  }

  // Use headed mode — Etsy's React forms don't render properly in headless
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const etsyCookiesFormatted = cookieArray.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain || '.etsy.com',
    path: c.path || '/',
    httpOnly: c.httpOnly || false,
    secure: c.secure || true,
    sameSite: c.sameSite || 'Lax',
  }));
  await context.addCookies(etsyCookiesFormatted);

  const page = await context.newPage();
  page.on('dialog', async dialog => {
    try { await dialog.accept(); } catch {}
  });

  try {
    console.log(`  [etsy-cookie] Navigating to Etsy listing creation...`);
    await page.goto('https://www.etsy.com/your/shops/me/tools/listings/create', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    // Check login
    const url = page.url();
    console.log(`  [etsy-cookie] Landed on: ${url}`);
    if (url.includes('/signin') || url.includes('/login')) {
      throw new Error('Etsy oturumu gecersiz. Cookie\'lerinizi yenileyin.');
    }
    console.log(`  [etsy-cookie] Page loaded: ${url.substring(0, 80)}`);

    // Upload images via hidden file input
    console.log(`  [etsy-cookie] Uploading ${mockupPaths.length} images...`);
    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 });
    const input = await page.$('input[type="file"]');
    if (!input) throw new Error('Gorsel yukleme alani bulunamadi');

    const validPaths = mockupPaths.filter(p => fs.existsSync(p));
    if (validPaths.length === 0) throw new Error('Yuklenecek mockup bulunamadi');
    await input.setInputFiles(validPaths);
    console.log(`  [etsy-cookie] ${validPaths.length} image uploaded, waiting for processing...`);
    await page.waitForTimeout(8000);

    // Fill title — wait for it to be visible since page is headed now
    console.log(`  [etsy-cookie] Filling title: ${title?.substring(0, 40)}...`);
    const titleSel = '#title-input, input[name="title"], textarea[name="title"]';
    try {
      await page.waitForSelector(titleSel, { timeout: 10000 });
      await page.fill(titleSel, '');
      await page.fill(titleSel, title || sku);
    } catch {
      // Fallback: JS injection
      console.log('  [etsy-cookie] Title fill fallback (JS)');
      await page.evaluate((t) => {
        const el = document.querySelector('#title-input, input[name="title"], textarea[name="title"]');
        if (el) { el.value = t; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, title || sku);
    }
    await page.waitForTimeout(500);

    // Fill description
    if (description) {
      console.log(`  [etsy-cookie] Filling description...`);
      const descSel = '#description-input, textarea[name="description"], [data-testid="description-input"]';
      try {
        await page.waitForSelector(descSel, { timeout: 5000 });
        await page.fill(descSel, '');
        await page.fill(descSel, description);
      } catch {
        console.log('  [etsy-cookie] Description fill fallback (JS)');
        await page.evaluate((d) => {
          const el = document.querySelector('#description-input, textarea[name="description"], [data-testid="description-input"]');
          if (el) { el.value = d; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
        }, description);
      }
      await page.waitForTimeout(500);
    }

    // Fill tags
    if (tags && tags.length > 0) {
      console.log(`  [etsy-cookie] Adding ${tags.length} tags...`);
      const tagSel = '#tag-input, input[name="tags"], input[placeholder*="tag"], input[aria-label*="tag"], input[aria-label*="Tag"]';
      for (const tag of tags.slice(0, 13)) {
        try {
          const tagInput = await page.$(tagSel);
          if (tagInput) {
            await tagInput.click();
            await tagInput.fill(tag);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
          }
        } catch {
          // Skip tag if input not interactive
        }
      }
    }

    // Fill SKU
    try {
      const skuSel = 'input[name="sku"], input[placeholder*="SKU"], input[aria-label*="SKU"]';
      const skuEl = await page.$(skuSel);
      if (skuEl) {
        await skuEl.fill(sku);
      }
    } catch {}

    await page.waitForTimeout(2000);
    const draftUrl = page.url();
    console.log(`  [etsy-cookie] Draft created at: ${draftUrl}`);

    // Step 4: Update description
    if (description) {
      console.log('  [etsy-cookie] Setting description...');
      await updateField(page, [
        '#description-input', 'textarea[id*="description"]', 'textarea[name*="description"]',
        '[data-testid="description-input"]'
      ], description);
    }

    // Step 5: Manage photos - delete existing, upload new mockups
    console.log(`  [etsy-cookie] Managing photos (${mockupPaths.length} mockups)...`);
    await managePhotos(page, mockupPaths, altTexts);

    // Step 6: Enter tags
    if (tags && tags.length > 0) {
      console.log(`  [etsy-cookie] Entering ${tags.length} tags...`);
      await enterTags(page, tags);
    }

    // Step 6b: Select section
    if (sectionId) {
      console.log(`  [etsy-cookie] Selecting section: ${sectionId}...`);
      await selectSection(page, sectionId);
    }

    // Step 7: Save as draft (NOT publish - publish costs $0.20)
    console.log('  [etsy-cookie] Saving as draft...');
    const saved = await saveAsDraft(page);

    if (!saved) {
      throw new Error('Draft kayit basarisiz.');
    }

    // Get the draft URL - extract listing ID from the editor URL
    const editorUrl = page.url();
    console.log(`  [etsy-cookie] After save URL: ${editorUrl}`);

    // Try to extract listing ID from editor URL (e.g. /listing-editor/edit/1234567890)
    const idMatch = editorUrl.match(/\/(?:edit|copy)\/(\d{8,})/);
    let listingUrl = '';
    let listingId = '';

    if (idMatch) {
      listingId = idMatch[1];
      // Don't use the template ID as the listing ID -- that means copy didn't create a new one
      if (listingId === TEMPLATE_LISTING_ID) {
        console.warn(`  [etsy-cookie] WARNING: Got template ID back, copy may have failed`);
        listingId = '';
      } else {
        listingUrl = `https://www.etsy.com/listing/${listingId}`;
        console.log(`  [etsy-cookie] Draft listing ID: ${listingId}`);
      }
    }

    if (!listingId) {
      // Fallback: search by SKU in listing manager
      console.log(`  [etsy-cookie] Finding listing by SKU: ${sku}`);
      listingId = await searchListingBySKU(page, sku, TEMPLATE_LISTING_ID);
      if (listingId) {
        listingUrl = `https://www.etsy.com/listing/${listingId}`;
      } else {
        // Return empty -- do NOT fall back to editor URL
        console.error(`  [etsy-cookie] ERROR: Could not find listing ID for SKU ${sku}`);
        listingUrl = '';
      }
    }

    console.log(`  [etsy-cookie] Draft saved: ${listingUrl}`);
    return { listingUrl, success: true, isDraft: true };
  } finally {
    await browser.close();
  }
}

async function copyFromListingManager(page, listingId) {
  try {
    await page.waitForSelector('table, [class*="listing"], [data-listing-id]', { timeout: 15000 });
  } catch {
    console.log('  [etsy-cookie] Warning: Listing table not detected');
  }
  await page.waitForTimeout(2000);

  // Strategy 1: data-listing-id attribute
  let gearClicked = await page.evaluate((id) => {
    const row = document.querySelector(`[data-listing-id="${id}"]`);
    if (row) {
      const gear = row.querySelector('button[aria-label*="anage"], button[aria-label*="ore"], button[aria-label*="ction"], button[class*="menu"], button[class*="gear"]');
      if (gear) { gear.click(); return 'data-attr'; }
      const anyBtn = row.querySelector('button:has(svg), button:has(img)');
      if (anyBtn) { anyBtn.click(); return 'data-attr-svg'; }
    }
    return null;
  }, listingId);

  // Strategy 2: link containing the ID
  if (!gearClicked) {
    gearClicked = await page.evaluate((id) => {
      const link = document.querySelector(`a[href*="${id}"]`);
      if (link) {
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

  // Strategy 3: text walk
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

  // Strategy 4: first available gear button
  if (!gearClicked) {
    gearClicked = await page.evaluate(() => {
      const selectors = [
        'button[aria-label*="Manage"]', 'button[aria-label*="manage"]',
        'button[aria-label*="More"]', 'button[aria-label*="more"]',
        'button[aria-label*="action"]', '[data-selector="listing-actions"]',
        '.wt-menu__trigger', 'button.wt-btn--icon',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) { btn.click(); return 'fallback-' + sel; }
      }
      return null;
    });
  }

  if (!gearClicked) {
    console.error('  [etsy-cookie] No gear/menu button found');
    return false;
  }
  console.log(`  [etsy-cookie] Gear clicked: ${gearClicked}`);
  await page.waitForTimeout(1500);

  // Click "Copy" from dropdown
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
    console.log(`  [etsy-cookie] Copy clicked: "${copyClicked}"`);
    return true;
  }

  console.error('  [etsy-cookie] "Copy" option not found in dropdown');
  return false;
}

async function updateField(page, selectors, value) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      const visible = await el.isVisible();
      if (visible) {
        await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        // React-compatible: set nativeInputValueSetter then dispatch
        await page.evaluate(({ sel, val }) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
          if (setter) {
            setter.call(el, val);
          } else {
            el.value = val;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, { sel, val: value });
        await page.waitForTimeout(500);
        return;
      }
    }
  }
  console.log('  [etsy-cookie] Field not found for selectors:', selectors[0]);
}

async function managePhotos(page, mockupPaths, altTexts) {
  // Delete existing photos from the template
  console.log('  [etsy-cookie] Removing template photos...');
  for (let attempt = 0; attempt < 20; attempt++) {
    const deleted = await page.evaluate(() => {
      const deleteBtn = document.querySelector(
        'button[aria-label*="Delete" i], button[aria-label*="Remove" i], ' +
        'button[aria-label*="Sil" i], button[data-test-id*="delete" i], ' +
        '.le-media-grid button[aria-label*="delete" i]'
      );
      if (deleteBtn && deleteBtn.offsetParent !== null) {
        deleteBtn.click();
        return true;
      }
      return false;
    });
    if (!deleted) break;
    await page.waitForTimeout(500);

    // Confirm deletion dialog if any
    await page.evaluate(() => {
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(
        b => ['Delete', 'Confirm', 'Yes', 'OK', 'Sil', 'Onayla'].includes(b.textContent?.trim())
      );
      if (confirmBtn) confirmBtn.click();
    });
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);

  // Upload new mockup images
  const validPaths = mockupPaths.filter(p => fs.existsSync(p));
  if (validPaths.length === 0) {
    console.log('  [etsy-cookie] No mockup files found to upload');
    return;
  }

  await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 10000 });
  const fileInput = await page.$('input[type="file"]');
  if (!fileInput) {
    console.log('  [etsy-cookie] File input not found');
    return;
  }

  console.log(`  [etsy-cookie] Uploading ${validPaths.length} images...`);
  for (let i = 0; i < validPaths.length; i++) {
    const uploadable = await ensureUploadable(validPaths[i]);
    await fileInput.setInputFiles(uploadable);
    await page.waitForTimeout(3000);

    if (altTexts[i]) {
      await applyAltText(page, altTexts[i]);
    }
  }

  // Wait for all uploads to finish
  for (let i = 0; i < 30; i++) {
    const uploading = await page.evaluate(() => {
      return !!document.querySelector('.le-media-grid__spinner, [class*="spinner"][class*="media"], [class*="uploading"], .le-media-grid__item--loading');
    });
    if (!uploading) break;
    if (i === 0) console.log('  [etsy-cookie] Waiting for uploads to finish...');
    await page.waitForTimeout(3000);
  }
}

async function enterTags(page, tags) {
  // First clear existing tags
  for (let attempt = 0; attempt < 20; attempt++) {
    const removed = await page.evaluate(() => {
      const removeBtn = document.querySelector(
        '[class*="tag"] button[aria-label*="Remove" i], [class*="tag"] button[aria-label*="Delete" i], ' +
        '[class*="tag"] button[aria-label*="Sil" i], [class*="tag"] .wt-tag__remove'
      );
      if (removeBtn) { removeBtn.click(); return true; }
      return false;
    });
    if (!removed) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);

  // Add new tags
  for (const tag of tags.slice(0, 13)) {
    const tagInput = await page.$('#tag-input, input[name="tags"], input[placeholder*="tag" i], input[aria-label*="tag" i], input[placeholder*="Add a tag"]');
    if (tagInput) {
      await tagInput.fill(tag);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }
  }
}

async function selectSection(page, sectionId) {
  try {
    await page.evaluate(() => {
      const sel = document.querySelector('select[name="shop-section-select"], select[name="section_id"], select[id*="section"]');
      if (sel) sel.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(500);

    const result = await page.evaluate((secId) => {
      let sel = document.querySelector('select[name="shop-section-select"]');
      if (!sel) sel = document.querySelector('select[name="section_id"], select[id*="section"]');
      if (!sel) {
        const allSelects = Array.from(document.querySelectorAll('select'));
        for (const s of allSelects) {
          if (Array.from(s.options).some(o => o.value === secId)) { sel = s; break; }
        }
      }
      if (!sel) return 'section-select-not-found';

      const opt = Array.from(sel.options).find(o => o.value === secId);
      if (!opt) return 'section-id-not-found';

      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      nativeSetter.call(sel, secId);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok:' + opt.text.trim();
    }, sectionId);

    console.log(`  [etsy-cookie] Section: ${result.substring(0, 80)}`);
  } catch (e) {
    console.warn(`  [etsy-cookie] Section failed: ${e.message}`);
  }
}

async function saveAsDraft(page) {
  await page.waitForTimeout(2000);

  // Wait for any pending photo uploads
  for (let i = 0; i < 30; i++) {
    const uploading = await page.evaluate(() => {
      return !!document.querySelector('.le-media-grid__spinner, [class*="spinner"][class*="media"], [class*="uploading"], .le-media-grid__item--loading');
    });
    if (!uploading) break;
    if (i === 0) console.log('  [etsy-cookie] Waiting for photo uploads...');
    await page.waitForTimeout(3000);
  }

  const MAX_STEPS = 8;
  let confirmed = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const currentUrl = page.url();
    if (!currentUrl.includes('listing-editor') && step > 0) {
      console.log('  [etsy-cookie] Left editor - save complete');
      confirmed = true;
      break;
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // IMPORTANT: Prefer "Save as draft" over "Publish" to avoid $0.20 charge
    // Wait for page content to fully render
    await page.waitForTimeout(2000);

    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null && !b.disabled);
      // Priority order: save as draft > save and continue > publish > any primary button
      const priority = [
        'Save as draft', 'Save and continue', 'Save', 'Continue',
        'Publish', 'Publish changes', 'Next',
        'Kaydet', 'Devam et', 'Yayinla'
      ];
      for (const label of priority) {
        const btn = buttons.find(b => {
          const text = b.textContent.trim();
          return text === label || text.toLowerCase() === label.toLowerCase();
        });
        if (btn) { btn.click(); return label; }
      }
      // Fallback: find primary/submit button
      const primary = buttons.find(b =>
        b.classList.contains('wt-btn--filled') || b.type === 'submit' ||
        b.className.includes('primary') || b.className.includes('submit')
      );
      if (primary) { primary.click(); return 'fallback:' + primary.textContent.trim().substring(0, 30); }
      return null;
    });

    if (!clicked) {
      const allBtns = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button'))
          .filter(b => b.offsetParent !== null)
          .map(b => b.textContent?.trim().substring(0, 50))
          .slice(0, 15);
      });
      console.log(`  [etsy-cookie] Step ${step + 1}: No button found. Visible: ${JSON.stringify(allBtns)}`);
      if (step === 0) {
        return false;
      }
      confirmed = true;
      break;
    }

    console.log(`  [etsy-cookie] Step ${step + 1}: Clicked "${clicked}" (hash: ${currentUrl.split('#')[1] || 'none'})`);

    try {
      await Promise.race([
        page.waitForURL(url => url.toString() !== currentUrl, { timeout: 30000 }),
        page.waitForSelector('[class*="success"], .wt-alert--success', { timeout: 30000 }),
      ]);
    } catch {
      await page.waitForTimeout(5000);
    }

    // Wait for new page content to render after navigation
    await page.waitForTimeout(4000);

    const newUrl = page.url();
    if (!newUrl.includes('listing-editor')) {
      console.log('  [etsy-cookie] Redirected out of editor - confirmed');
      confirmed = true;
      break;
    }
  }

  await page.waitForTimeout(2000);
  return confirmed;
}

async function searchListingBySKU(page, sku, templateId) {
  console.log(`  [etsy-cookie] Searching listing manager for SKU: ${sku}`);
  await page.goto('https://www.etsy.com/your/shops/me/tools/listings', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(5000);

  const searchInput = await page.$('input[placeholder*="Search"], input[type="search"], input[name*="search"], input[aria-label*="Search"]');
  if (!searchInput) {
    console.log('  [etsy-cookie] Search input not found');
    return '';
  }

  await page.evaluate(({ el, val }) => {
    el.scrollIntoView({ block: 'center' });
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { el: searchInput, val: sku });
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
    console.log(`  [etsy-cookie] Found listing: ${listingId}`);
  }
  return listingId;
}

async function applyAltText(page, altText) {
  try {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(
        'button[aria-label*="alt" i], button[title*="alt" i], button[data-test-id*="alt" i], ' +
        '[class*="alt-text" i] button, [class*="altText" i] button'
      ));
      if (btns.length > 0) { btns[btns.length - 1].click(); return true; }
      return false;
    });

    if (!clicked) return;
    await page.waitForTimeout(1000);

    const textarea = await page.$('textarea[placeholder*="image" i], textarea[placeholder*="alt" i], textarea[placeholder*="detail" i], dialog textarea, [role="dialog"] textarea');
    if (textarea) {
      await textarea.fill('');
      await textarea.fill(altText.substring(0, 500));
      await page.waitForTimeout(300);

      const applied = await page.evaluate(() => {
        const applyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().toLowerCase() === 'apply');
        if (applyBtn) { applyBtn.click(); return true; }
        return false;
      });
      if (applied) {
        await page.waitForTimeout(500);
      } else {
        await page.keyboard.press('Escape');
      }
    } else {
      await page.keyboard.press('Escape');
    }
  } catch (e) {
    try { await page.keyboard.press('Escape'); } catch {}
  }
}

module.exports = { uploadToEtsyWithCookies };
