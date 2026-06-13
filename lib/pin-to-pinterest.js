const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const TEMPLATE_LISTING_ID = '4484014869';

async function connectBrowser(port) {
  for (let i = 0; i < 15; i++) {
    try {
      return await chromium.connectOverCDP(`http://localhost:${port}`);
    } catch (e) {
      if (i < 14) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// Find listing URL by searching SKU in listing manager
async function findListingBySKU(page, sku) {
  console.log(`  [pin] Searching listing manager for SKU: ${sku}`);
  await page.goto('https://www.etsy.com/your/shops/me/tools/listings', {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await page.waitForTimeout(5000);

  const searchInput = await page.$('input[placeholder*="Search"], input[type="search"], input[name*="search"], input[aria-label*="Search"]');
  if (!searchInput) {
    console.error('  [pin] Search input not found in listing manager');
    return null;
  }

  await searchInput.scrollIntoViewIfNeeded();
  await searchInput.evaluate((el, val) => {
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
  }, TEMPLATE_LISTING_ID);

  if (listingId) {
    const url = `https://www.etsy.com/listing/${listingId}`;
    console.log(`  [pin] Found listing: ${url}`);
    return url;
  }

  console.error(`  [pin] No listing found for SKU: ${sku}`);
  return null;
}

async function pinToPinterest({ sku, listingUrl: passedListingUrl }) {
  if (!sku && !passedListingUrl) throw new Error('SKU veya listingUrl verilmedi — pin iptal edildi');

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const port = config.cdpPort || 9333;

  console.log('  [pin] Connecting to browser...');
  const browser = await connectBrowser(port);
  if (!browser) throw new Error('Could not connect to browser via CDP');

  const context = browser.contexts()[0];

  let page;
  try {
    page = await context.newPage();
  } catch (e) {
    page = context.pages()[0];
    if (!page) throw new Error('No browser page available');
  }

  page.on('dialog', async dialog => {
    try { await dialog.accept(); } catch {}
  });

  // Step 1: Use passed listing URL if available, otherwise search by SKU
  let listingUrl = passedListingUrl;
  if (!listingUrl) {
    listingUrl = await findListingBySKU(page, sku);
  } else {
    console.log(`  [pin] Using passed listing URL: ${listingUrl}`);
  }
  if (!listingUrl) {
    try { await page.close(); } catch {}
    throw new Error(`SKU ${sku} ile listing bulunamadi — pin iptal edildi`);
  }

  // Step 2: Go to the Etsy listing page
  console.log(`  [pin] Opening listing: ${listingUrl}`);
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log(`  [pin] Page URL: ${page.url()}`);

  // Step 3: Click the Pinterest "Save" button
  console.log('  [pin] Looking for Pinterest Save button on listing page...');
  const saveClicked = await page.evaluate(() => {
    const pinterestLink = document.querySelector('a[data-network="pinterest"][data-action="share"]');
    if (pinterestLink) {
      pinterestLink.click();
      return 'data-network';
    }
    const links = document.querySelectorAll('a[href*="pinterest"]');
    for (const el of links) {
      if (el.getAttribute('href')?.includes('/share?network=_pinterest')) {
        el.click();
        return 'href-match';
      }
    }
    return null;
  });

  if (!saveClicked) {
    console.error('  [pin] Pinterest Save button not found on listing page');
    throw new Error('Pinterest Save button not found on Etsy listing page');
  }
  console.log(`  [pin] Clicked Pinterest Save via: ${saveClicked}`);

  // Step 4: Wait for Pinterest popup
  console.log('  [pin] Waiting for Pinterest popup...');
  let popup = null;
  try {
    popup = await page.waitForEvent('popup', { timeout: 10000 });
    console.log(`  [pin] Popup opened: ${popup.url()}`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(3000);
  } catch (e) {
    console.log('  [pin] No popup detected, checking for iframe or same-page modal...');
  }

  const pinPage = popup || page;

  // Step 5: Hover over first board to reveal "Kaydet"
  console.log('  [pin] Looking for Kaydet button in Pinterest popup...');
  await pinPage.waitForTimeout(2000);

  const boardPos = await pinPage.evaluate(() => {
    const items = document.querySelectorAll('[data-test-id="board-row"], [data-test-id="boardWithoutSection"], [role="listitem"]');
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 20) {
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  });

  if (boardPos) {
    await pinPage.mouse.move(boardPos.x, boardPos.y);
    await pinPage.waitForTimeout(1000);
  }

  // Find and click the red "Kaydet" button
  let kaydetPos = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    kaydetPos = await pinPage.evaluate(() => {
      const els = document.querySelectorAll('div, button, span, a');
      for (const el of els) {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const rect = el.getBoundingClientRect();
        if (bg === 'rgb(230, 0, 35)' && rect.width > 30 && rect.width < 200 && rect.height > 20 && rect.height < 60) {
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return null;
    });
    if (kaydetPos) break;
    if (boardPos) await pinPage.mouse.move(boardPos.x, boardPos.y);
    await pinPage.waitForTimeout(1000);
  }

  if (!kaydetPos) {
    console.error('  [pin] Kaydet button not found in Pinterest popup');
    throw new Error('Pinterest Kaydet button not found');
  }

  console.log('  [pin] Clicking Kaydet...');
  await pinPage.mouse.click(kaydetPos.x, kaydetPos.y);

  // Step 6: Wait for confirmation
  let confirmed = false;
  for (let wait = 0; wait < 20; wait++) {
    await pinPage.waitForTimeout(1000);
    confirmed = await pinPage.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('kaydedildi') || text.includes('kaydettiniz') ||
             text.includes('Saved to') || text.includes('saved to') || text.includes('panosuna');
    });
    if (confirmed) break;
  }

  if (confirmed) {
    console.log('  [pin] Pinterest\'e kaydedildi!');
  } else {
    console.warn('  [pin] Onay mesaji alinamadi');
  }

  if (popup) {
    try { await popup.close(); } catch {}
  }
  try { await page.close(); } catch {}

  return { confirmed, listingUrl };
}

module.exports = { pinToPinterest };
