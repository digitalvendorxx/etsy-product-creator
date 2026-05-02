const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const ETSYHUNT_URL = 'https://ehunt.ai/etsy-keyword-tool';

async function connectBrowser(port) {
  try {
    return await chromium.connectOverCDP(`http://localhost:${port}`);
  } catch {}

  const { spawn } = require('child_process');
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const browserPath = config.operaPath;
  if (!browserPath) throw new Error('operaPath not set in config.json');

  const child = spawn(browserPath, [`--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try { return await chromium.connectOverCDP(`http://localhost:${port}`); } catch {}
  }
  throw new Error('Browser CDP baglantisi kurulamadi');
}

async function scrapeEtsyHunt(keyword, opts = {}) {
  const limit = opts.limit || 13;
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const port = config.cdpPort || 9333;

  console.log(`  EtsyHunt: keyword="${keyword}"`);
  const browser = await connectBrowser(port);
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('ehunt.ai'));
  if (!page) page = await context.newPage();

  try {
    if (!page.url().includes('ehunt.ai/etsy-keyword-tool')) {
      await page.goto(ETSYHUNT_URL, { waitUntil: 'load', timeout: 60000 });
    }

    await page.waitForSelector('input[placeholder*="keyword" i], input[type="text"]', { timeout: 30000 });

    const searchInput = await page.$('input[placeholder*="keyword" i]')
      || await page.$('input[type="text"]');
    if (!searchInput) throw new Error('EtsyHunt search input bulunamadi');

    await searchInput.click({ clickCount: 3 });
    await searchInput.fill(keyword);
    await new Promise(r => setTimeout(r, 500));

    const searchBtn = await page.$('button:has-text("Search")');
    if (searchBtn) await searchBtn.click();
    else await page.keyboard.press('Enter');

    console.log('  EtsyHunt: arama yapildi, tablo bekleniyor...');

    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('table tbody tr, [class*="table"] [class*="row"]');
      return rows.length > 2;
    }, { timeout: 45000 }).catch(() => {});

    await new Promise(r => setTimeout(r, 2500));

    const tags = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const rows = document.querySelectorAll('table tbody tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;
        // Keyword usually in 2nd cell (1st = checkbox)
        for (let i = 0; i < Math.min(cells.length, 3); i++) {
          const txt = (cells[i].innerText || cells[i].textContent || '').trim();
          if (!txt) continue;
          if (txt.length < 2 || txt.length > 60) continue;
          if (/^\d+(\.\d+)?[KMB]?$/i.test(txt)) continue;
          if (/^(N\/A|NR|—|-)$/i.test(txt)) continue;
          if (seen.has(txt.toLowerCase())) continue;
          seen.add(txt.toLowerCase());
          out.push(txt);
          break;
        }
      }
      return out;
    });

    console.log(`  EtsyHunt: ${tags.length} tag bulundu (limit: ${limit})`);
    return tags.slice(0, limit);

  } finally {
    try { await browser.close(); } catch {}
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const kwIdx = args.indexOf('--keyword');
  if (kwIdx === -1) {
    console.error('Usage: node scrape-etsyhunt.js --keyword <text>');
    process.exit(1);
  }
  scrapeEtsyHunt(args[kwIdx + 1]).then(tags => {
    console.log(JSON.stringify(tags, null, 2));
  }).catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { scrapeEtsyHunt };
