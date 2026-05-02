const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function pinToPinterestWithCookies({ listingUrl, mockupPath, title, description, pinterestCookies }) {
  if (!pinterestCookies) throw new Error('Pinterest cookie\'leri bulunamadi. Ayarlardan Pinterest hesabinizi baglayin.');

  let cookieArray;
  try {
    cookieArray = JSON.parse(pinterestCookies);
  } catch {
    throw new Error('Pinterest cookie formati hatali');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  const pinterestCookiesFormatted = cookieArray.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain || '.pinterest.com',
    path: c.path || '/',
    httpOnly: c.httpOnly || false,
    secure: c.secure || true,
    sameSite: c.sameSite || 'Lax',
  }));
  await context.addCookies(pinterestCookiesFormatted);

  const page = await context.newPage();

  try {
    // Navigate to Pinterest pin creation
    console.log(`  [pinterest-cookie] Creating pin...`);
    await page.goto('https://www.pinterest.com/pin-creation-tool/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Check login
    const url = page.url();
    if (url.includes('/login') || url.includes('/signup')) {
      throw new Error('Pinterest oturumu gecersiz. Cookie\'lerinizi yenileyin.');
    }

    // Upload image
    if (mockupPath && fs.existsSync(mockupPath)) {
      console.log(`  [pinterest-cookie] Uploading image...`);
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(mockupPath);
        await page.waitForTimeout(3000);
      }
    }

    // Fill title
    const titleInput = await page.$('[data-test-id="pin-draft-title"] textarea, input[placeholder*="title"], [aria-label*="title"]');
    if (titleInput) {
      await titleInput.fill(title || '');
      await page.waitForTimeout(300);
    }

    // Fill description
    const descInput = await page.$('[data-test-id="pin-draft-description"] textarea, textarea[placeholder*="description"], [aria-label*="description"]');
    if (descInput) {
      await descInput.fill(description || '');
      await page.waitForTimeout(300);
    }

    // Fill link
    if (listingUrl) {
      const linkInput = await page.$('[data-test-id="pin-draft-link"] input, input[placeholder*="link"], input[aria-label*="link"], input[type="url"]');
      if (linkInput) {
        await linkInput.fill(listingUrl);
        await page.waitForTimeout(300);
      }
    }

    console.log(`  [pinterest-cookie] Pin draft created`);
    return { success: true };
  } finally {
    await browser.close();
  }
}

module.exports = { pinToPinterestWithCookies };
