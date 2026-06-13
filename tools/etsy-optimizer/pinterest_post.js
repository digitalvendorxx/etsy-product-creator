/**
 * Pinterest Pin Poster
 *
 * Usage: node pinterest_post.js [--dry-run] [--limit N]
 *
 * Posts pins to Pinterest board from scraped Etsy listings.
 * Rate limited to 1 pin per 3 seconds. Resume-capable via progress file.
 *
 * Options:
 *   --dry-run   Show what would be posted without actually posting
 *   --limit N   Only post N pins (useful for testing)
 */

require('dotenv/config');
const fs = require('fs');

const TOKEN_FILE = 'pinterest_token.json';
const BOARD_CONFIG = 'pinterest_board_config.json';
const LISTINGS_FILE = 'listings_with_images.json';
const PROGRESS_FILE = 'pinterest_progress.json';
const RATE_LIMIT_MS = 3000;

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;

function loadConfig() {
  if (!fs.existsSync(TOKEN_FILE)) {
    console.error('No token found. Run pinterest_auth.js first.');
    process.exit(1);
  }
  if (!fs.existsSync(BOARD_CONFIG)) {
    console.error('No board config found. Run pinterest_board.js first.');
    process.exit(1);
  }
  if (!fs.existsSync(LISTINGS_FILE)) {
    console.error('No listings with images found. Run pinterest_scrape.js first.');
    process.exit(1);
  }

  const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  if (Date.now() >= token.expires_at) {
    console.error('Token expired. Run pinterest_auth.js to refresh.');
    process.exit(1);
  }

  const board = JSON.parse(fs.readFileSync(BOARD_CONFIG, 'utf8'));
  const listings = JSON.parse(fs.readFileSync(LISTINGS_FILE, 'utf8'));

  return { token, board, listings };
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return { posted: [], errors: [], startedAt: new Date().toISOString() };
}

function saveProgress(progress) {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max - 3) + '...' : str;
}

function extractPinDescription(description) {
  if (!description) return '';
  const lines = description.split('\n').filter(l => l.trim());
  const pinDesc = lines.slice(0, 3).join(' ').trim();
  return truncate(pinDesc, 500);
}

async function createPin(accessToken, { boardId, title, description, link, imageUrl }) {
  const body = {
    board_id: boardId,
    title: truncate(title, 100),
    description,
    link,
    media_source: {
      source_type: 'image_url',
      url: imageUrl,
    },
  };

  const res = await fetch('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create pin failed: ${res.status} ${text}`);
  }

  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  const { token, board, listings } = loadConfig();
  const progress = loadProgress();

  const postedIds = new Set(progress.posted.map(p => p.listingId));
  const toPost = listings
    .filter(l => l.imageUrl && !postedIds.has(l.id))
    .slice(0, limit);

  const skippedNoImage = listings.filter(l => !l.imageUrl);

  console.log('Pinterest Pin Poster');
  console.log('====================');
  console.log(`Board: ${board.name} (${board.board_id})`);
  console.log(`Total listings: ${listings.length}`);
  console.log(`Already posted: ${progress.posted.length}`);
  console.log(`Skipped (no image): ${skippedNoImage.length}`);
  console.log(`To post now: ${toPost.length}`);
  if (dryRun) console.log('MODE: DRY RUN (no pins will be created)\n');
  else console.log('');

  if (toPost.length === 0) {
    console.log('Nothing to post! All listings have been pinned.');
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toPost.length; i++) {
    const listing = toPost[i];
    const pinTitle = truncate(listing.title, 100);
    const pinDesc = extractPinDescription(listing.description);

    console.log(`[${i + 1}/${toPost.length}] ${listing.id} - ${pinTitle.substring(0, 60)}...`);

    if (dryRun) {
      console.log(`  Title: ${pinTitle}`);
      console.log(`  Desc: ${pinDesc.substring(0, 80)}...`);
      console.log(`  Image: ${listing.imageUrl.substring(0, 80)}...`);
      console.log(`  Link: ${listing.listingUrl}`);
      console.log('');
      continue;
    }

    try {
      const pin = await createPin(token.access_token, {
        boardId: board.board_id,
        title: pinTitle,
        description: pinDesc,
        link: listing.listingUrl,
        imageUrl: listing.imageUrl,
      });

      progress.posted.push({
        listingId: listing.id,
        pinId: pin.id,
        title: pinTitle,
        postedAt: new Date().toISOString(),
      });
      saveProgress(progress);
      successCount++;
      console.log(`  Posted! Pin ID: ${pin.id}`);

      if (i < toPost.length - 1) {
        await sleep(RATE_LIMIT_MS);
      }

    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      progress.errors.push({
        listingId: listing.id,
        error: err.message,
        failedAt: new Date().toISOString(),
      });
      saveProgress(progress);
      errorCount++;

      // If rate limited, wait longer
      if (err.message.includes('429')) {
        console.log('  Rate limited! Waiting 60 seconds...');
        await sleep(60000);
      } else {
        await sleep(RATE_LIMIT_MS);
      }
    }
  }

  console.log('\n====================');
  console.log(`Done! Posted: ${successCount}, Errors: ${errorCount}`);
  console.log(`Total posted so far: ${progress.posted.length}/${listings.length}`);
  if (errorCount > 0) {
    console.log(`\nFailed listings can be retried by running the script again.`);
    console.log('Errors are logged in ' + PROGRESS_FILE);
  }
})().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
