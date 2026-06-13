/**
 * Pinterest Board Setup
 *
 * Usage: node pinterest_board.js [board_name]
 * Default board name: "HNApparelUSA - Custom Apparel"
 *
 * Creates a new Pinterest board and saves the board ID for pin posting.
 */

require('dotenv/config');
const fs = require('fs');

const TOKEN_FILE = 'pinterest_token.json';
const BOARD_CONFIG = 'pinterest_board_config.json';

if (!fs.existsSync(TOKEN_FILE)) {
  console.error('No token found. Run pinterest_auth.js first.');
  process.exit(1);
}

const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
const accessToken = tokenData.access_token;

if (Date.now() >= tokenData.expires_at) {
  console.error('Token expired. Run pinterest_auth.js to refresh.');
  process.exit(1);
}

const boardName = process.argv[2] || 'HNApparelUSA - Custom Apparel';

async function listBoards() {
  const res = await fetch('https://api.pinterest.com/v5/boards', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`List boards failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function createBoard(name) {
  const res = await fetch('https://api.pinterest.com/v5/boards', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      description: 'Trendy graphic tees, sweatshirts & hoodies from HNApparelUSA on Etsy. Custom designs, comfort colors, vintage vibes.',
      privacy: 'PUBLIC',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create board failed: ${res.status} ${text}`);
  }
  return res.json();
}

(async () => {
  // Check if board config already exists
  if (fs.existsSync(BOARD_CONFIG)) {
    const config = JSON.parse(fs.readFileSync(BOARD_CONFIG, 'utf8'));
    console.log(`Board already configured: "${config.name}" (ID: ${config.board_id})`);
    console.log('To create a new board, delete pinterest_board_config.json and run again.');
    return;
  }

  console.log('Checking existing boards...');
  const { items: boards } = await listBoards();

  // Check if board with same name already exists
  const existing = boards?.find(b => b.name === boardName);
  if (existing) {
    console.log(`Board "${boardName}" already exists (ID: ${existing.id})`);
    const config = { board_id: existing.id, name: existing.name, created_at: new Date().toISOString() };
    fs.writeFileSync(BOARD_CONFIG, JSON.stringify(config, null, 2));
    console.log('Saved board config to ' + BOARD_CONFIG);
    return;
  }

  console.log(`Creating board: "${boardName}"...`);
  const board = await createBoard(boardName);
  console.log(`Board created! ID: ${board.id}`);

  const config = { board_id: board.id, name: board.name, created_at: new Date().toISOString() };
  fs.writeFileSync(BOARD_CONFIG, JSON.stringify(config, null, 2));
  console.log('Saved board config to ' + BOARD_CONFIG);
  console.log('\nNext step: run  node pinterest_scrape.js');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
