const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { generateDesign } = require('./lib/generate-design');
const { composeMockup } = require('./lib/compose-mockup');
const { scrapeTags } = require('./lib/scrape-tags');
const { uploadToEtsy } = require('./lib/upload-etsy');
const { pinToPinterest } = require('./lib/pin-to-pinterest');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
  };
  const has = (flag) => args.includes(flag);

  return {
    ref: get('--ref'),
    mockups: get('--mockups')?.split(',') || [],
    competitor: get('--competitor'),
    sku: get('--sku') || `SKU${Date.now()}`,
    prompt: get('--prompt'),
    designOnly: has('--design-only'),
    skipUpload: has('--skip-upload'),
    skipTags: has('--skip-tags'),
    design: get('--design'), // use existing design instead of generating
  };
}

async function main() {
  const opts = parseArgs();

  if (!opts.ref && !opts.design) {
    console.error('Usage: node create.js --ref <image> --mockups <m1,m2> --competitor <url> --sku <sku>');
    console.error('');
    console.error('Options:');
    console.error('  --ref <image>         Reference image for AI design generation');
    console.error('  --design <image>      Use existing design (skip generation)');
    console.error('  --mockups <m1,m2>     Comma-separated mockup template paths');
    console.error('  --competitor <url>     Competitor Etsy listing URL for tag scraping');
    console.error('  --sku <sku>           Product SKU');
    console.error('  --prompt <text>       Custom prompt for design generation');
    console.error('  --design-only         Only generate design, skip mockup/upload');
    console.error('  --skip-upload         Skip Etsy upload step');
    console.error('  --skip-tags           Skip tag scraping step');
    process.exit(1);
  }

  // Ensure directories exist
  ['designs', 'output'].forEach(dir => {
    fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
  });

  console.log(`\n=== Etsy Product Creator ===`);
  console.log(`SKU: ${opts.sku}\n`);

  let designPath = opts.design;

  // ── Step 1: Generate Design ──
  if (!designPath) {
    console.log('[1/4] Generating design...');
    try {
      designPath = await generateDesign(opts.ref, opts.sku, opts.prompt);
      console.log('  Done!\n');
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`[1/4] Using existing design: ${designPath}\n`);
  }

  if (opts.designOnly) {
    console.log('Design-only mode, stopping here.');
    return;
  }

  // ── Step 2: Compose Mockups ──
  let mockupOutputs = [];
  if (opts.mockups.length > 0) {
    console.log('[2/4] Composing mockups...');
    try {
      mockupOutputs = await composeMockup(designPath, opts.mockups, opts.sku);
      console.log('  Done!\n');
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log('[2/4] No mockup templates provided, skipping.\n');
  }

  // ── Step 3: Scrape Tags & Title ──
  let tags = [];
  let title = '';
  let description = '';
  if (opts.competitor && !opts.skipTags) {
    console.log('[3/4] Scraping & optimizing from competitor...');
    try {
      const result = await scrapeTags(opts.competitor);
      tags = result.tags;
      title = result.title;
      description = result.description;
      console.log(`  Title: ${title.substring(0, 50)}...`);
      console.log(`  Tags: ${tags.slice(0, 5).join(', ')}${tags.length > 5 ? '...' : ''}`);
      console.log(`  Description: ${description.length} chars`);
      console.log('  Done!\n');
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      console.log('  Continuing without tags...\n');
    }
  } else {
    console.log('[3/4] No competitor URL or --skip-tags, skipping.\n');
  }

  // ── Step 4: Upload to Etsy ──
  let listingUrl = '';
  if (!opts.skipUpload) {
    console.log('[4/5] Uploading to Etsy...');
    try {
      const result = await uploadToEtsy({
        sku: opts.sku,
        mockupPaths: mockupOutputs,
        tags,
        title,
        description,
      });
      listingUrl = result.listingUrl || '';
      console.log('  Done!\n');
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log('[4/5] Upload skipped (--skip-upload).\n');
  }

  // ── Step 5: Pin to Pinterest ──
  if (listingUrl) {
    console.log('[5/5] Pinning to Pinterest...');
    try {
      await pinToPinterest({ listingUrl, title: title || opts.sku });
      console.log('  Done!\n');
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      console.log('  Continuing without Pinterest...\n');
    }
  } else {
    console.log('[5/5] No listing URL, skipping Pinterest.\n');
  }

  console.log('=== All done! ===\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
