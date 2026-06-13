/**
 * Etsy Image URL Scraper for Pinterest
 *
 * Usage: node pinterest_scrape.js
 *
 * Connects to Opera GX via CDP (port 9334) and scrapes the main product image
 * from each Etsy listing's public page. Saves results to listings_with_images.json.
 *
 * Prerequisites: Opera GX running with --remote-debugging-port=9334
 *   "C:/Users/berka/AppData/Local/Programs/Opera GX/opera.exe" --remote-debugging-port=9334
 */

const { chromium } = require('playwright');
const fs = require('fs');

const DEBUG_PORT = 9334;
const OUTPUT_FILE = 'listings_with_images.json';
const SHOP_URL = 'https://www.etsy.com/shop/HNApparelUSA';

async function loadListings() {
  const listings = [];

  // Load from listings_raw.json (153 listings)
  if (fs.existsSync('listings_raw.json')) {
    const raw = JSON.parse(fs.readFileSync('listings_raw.json', 'utf8'));
    raw.forEach(l => listings.push(l));
  }

  // Load from listings_new_raw.json (19 more)
  if (fs.existsSync('listings_new_raw.json')) {
    const raw = JSON.parse(fs.readFileSync('listings_new_raw.json', 'utf8'));
    raw.forEach(l => {
      if (!listings.find(x => x.id === l.id)) listings.push(l);
    });
  }

  // Also merge optimized titles/descriptions if available
  const optimized = [];
  if (fs.existsSync('listings_new_optimized.json')) {
    optimized.push(...JSON.parse(fs.readFileSync('listings_new_optimized.json', 'utf8')));
  }

  // Merge optimized data onto listings
  for (const opt of optimized) {
    const existing = listings.find(l => l.id === opt.id);
    if (existing) {
      existing.optimizedTitle = opt.title;
      existing.optimizedDescription = opt.description;
    } else {
      listings.push(opt);
    }
  }

  return listings;
}

async function loadProgress() {
  if (fs.existsSync(OUTPUT_FILE)) {
    return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  }
  return [];
}

function saveProgress(data) {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
}

(async () => {
  console.log('Etsy Image Scraper for Pinterest\n');

  const listings = await loadListings();
  console.log(`Loaded ${listings.length} listings total`);

  const scraped = await loadProgress();
  const scrapedIds = new Set(scraped.map(s => s.id));
  const toScrape = listings.filter(l => !scrapedIds.has(l.id));

  if (toScrape.length === 0) {
    console.log('All listings already scraped! Delete ' + OUTPUT_FILE + ' to re-scrape.');
    return;
  }

  console.log(`Already scraped: ${scraped.length}, remaining: ${toScrape.length}\n`);

  // Connect to Opera GX
  let browser;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
      console.log('Connected to Opera GX\n');
      break;
    } catch (e) {
      console.log(`Connecting... (${attempt + 1}/10)`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!browser) {
    console.error('Could not connect to Opera GX. Make sure it is running with --remote-debugging-port=9334');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  // Strategy: visit the public listing page and extract the main image
  for (let i = 0; i < toScrape.length; i++) {
    const listing = toScrape[i];
    const listingUrl = `https://www.etsy.com/listing/${listing.id}`;

    console.log(`[${scraped.length + 1}/${listings.length}] Scraping: ${listing.id} - ${(listing.title || '').substring(0, 50)}...`);

    try {
      await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);

      // Extract the main product image URL
      const imageUrl = await page.evaluate(() => {
        // Try the main listing image carousel - first image
        // Etsy uses different structures, try multiple selectors
        const selectors = [
          // Main listing image
          'ul[data-carousel] li:first-child img',
          '[data-carousel-pane] img',
          'div[data-appears-component-name="listing_page_image_carousel"] img',
          '.image-carousel-container img',
          'img[data-listing-card-image]',
          // OG meta tag as fallback
        ];

        for (const sel of selectors) {
          const img = document.querySelector(sel);
          if (img && img.src && !img.src.includes('placeholder')) {
            // Get the highest resolution version - Etsy uses il_fullxfull for largest
            let src = img.src;
            // Convert il_340x270 or il_794xN etc. to il_fullxfull
            src = src.replace(/il_\d+x\w+/, 'il_fullxfull');
            return src;
          }
        }

        // Fallback: og:image meta tag
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) {
          let src = ogImage.content;
          src = src.replace(/il_\d+x\w+/, 'il_fullxfull');
          return src;
        }

        // Last resort: any large product image
        const allImages = document.querySelectorAll('img');
        for (const img of allImages) {
          if (img.src && img.src.includes('etsystatic.com') && img.naturalWidth > 200) {
            let src = img.src;
            src = src.replace(/il_\d+x\w+/, 'il_fullxfull');
            return src;
          }
        }

        return null;
      });

      // Also grab the canonical URL (the pretty URL with the listing title slug)
      const canonicalUrl = await page.evaluate(() => {
        const link = document.querySelector('link[rel="canonical"]');
        return link ? link.href : null;
      });

      scraped.push({
        id: listing.id,
        title: listing.optimizedTitle || listing.title,
        description: listing.optimizedDescription || listing.description,
        imageUrl: imageUrl,
        listingUrl: canonicalUrl || listingUrl,
        editUrl: listing.editUrl,
        scrapedAt: new Date().toISOString(),
      });

      if (!imageUrl) {
        console.log('  WARNING: No image found for this listing');
      } else {
        console.log('  Image: ' + imageUrl.substring(0, 80) + '...');
      }

      // Save progress after each listing
      saveProgress(scraped);

      // Small delay between requests
      await page.waitForTimeout(1500);

    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      // Save what we have and continue
      scraped.push({
        id: listing.id,
        title: listing.optimizedTitle || listing.title,
        description: listing.optimizedDescription || listing.description,
        imageUrl: null,
        listingUrl: `https://www.etsy.com/listing/${listing.id}`,
        editUrl: listing.editUrl,
        error: err.message,
        scrapedAt: new Date().toISOString(),
      });
      saveProgress(scraped);
    }
  }

  const withImages = scraped.filter(s => s.imageUrl);
  const withoutImages = scraped.filter(s => !s.imageUrl);

  console.log(`\nDone! ${withImages.length}/${scraped.length} listings have images.`);
  if (withoutImages.length > 0) {
    console.log(`Missing images for: ${withoutImages.map(s => s.id).join(', ')}`);
  }
  console.log('Saved to ' + OUTPUT_FILE);
  console.log('\nNext step: run  node pinterest_post.js');
})();
