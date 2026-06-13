// Daily eHunt dashboard scraper — pulls keyword + niche tracker data.
// Output: data/ehunt-daily/{YYYY-MM-DD}.json
//
// Requires Chrome on CDP port (npm run browser) AND eHunt logged in.
// On first run user must provide their tracked URLs (see README).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const CDP_PORT = CONFIG.cdpPort || 9222;
const TODAY = new Date().toISOString().split('T')[0];
const OUT_DIR = path.join(ROOT, 'data', 'ehunt-daily');
const OUT_FILE = path.join(OUT_DIR, `${TODAY}.json`);
const CONFIG_FILE = path.join(ROOT, 'data', 'ehunt-config.json');

// On first run we need the user to provide what to track.
// This config is editable and survives across runs.
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const tpl = {
      _instructions: "Edit 'tracked' arrays with the eHunt URLs you check daily. Each must be a full URL after login.",
      tracked: {
        keywords: [
          // Example: "https://ehunt.ai/keyword?q=bruce+springsteen+shirt"
        ],
        listings: [
          // Example: "https://ehunt.ai/listing/<listing-id>"
        ],
        shops: [
          // Example: "https://ehunt.ai/shop/<shop-name>"
        ],
        niches: [
          // Example: "https://ehunt.ai/niche/concert-merch"
        ],
      },
      dashboard_url: "https://ehunt.ai/dashboard",
      base_url: "https://ehunt.ai",
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(tpl, null, 2));
    console.error(`Created template at ${CONFIG_FILE} — please fill in tracked URLs before running again.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

async function dumpPage(page, url, label) {
  const out = { url, label, scraped_at: new Date().toISOString() };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(5000); // SPA hydration

    // Detect login wall
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 600));
    if (/sign in|log in|giriş yap|login/i.test(bodyText) && !/dashboard|niche|keyword|score/i.test(bodyText)) {
      out.error = 'login_wall — open Chrome via npm run browser, log into ehunt.ai, then re-run';
      return out;
    }

    // Extract any tabular data + key metrics from page
    const data = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const tableData = tables.map((t, i) => ({
        index: i,
        headers: Array.from(t.querySelectorAll('th')).map(h => h.textContent.trim()).slice(0, 25),
        rows: Array.from(t.querySelectorAll('tbody tr')).slice(0, 30).map(r =>
          Array.from(r.querySelectorAll('td')).map(td => td.textContent.trim().substring(0, 100))
        ),
      }));
      // Try common eHunt metric containers (will need refinement once selectors known)
      const metrics = {};
      const metricEls = Array.from(document.querySelectorAll('[class*="metric" i], [class*="score" i], [class*="stat" i]'));
      for (const el of metricEls.slice(0, 30)) {
        const label = el.querySelector('label, [class*="label"]')?.textContent?.trim();
        const value = el.querySelector('[class*="value"], [class*="num"]')?.textContent?.trim();
        if (label && value) metrics[label] = value;
      }
      // Key numbers in the page (search-friendly fallback)
      const keyNumbers = [];
      const candidates = Array.from(document.querySelectorAll('div, span, p'))
        .filter(el => el.children.length === 0 && /^[\d,.$%kKM]+$/.test(el.textContent?.trim() || ''))
        .slice(0, 20);
      for (const el of candidates) {
        const surrounding = el.parentElement?.textContent?.substring(0, 100)?.trim() || '';
        keyNumbers.push({ value: el.textContent.trim(), context: surrounding });
      }
      return { tableData, metrics, keyNumbers, title: document.title, url: location.href };
    });

    out.data = data;
    out.tableCount = data.tableData.length;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

(async () => {
  const config = loadConfig();
  const allTracked = [
    ...(config.tracked?.keywords || []).map(u => ({ url: u, label: 'keyword' })),
    ...(config.tracked?.listings || []).map(u => ({ url: u, label: 'listing' })),
    ...(config.tracked?.shops || []).map(u => ({ url: u, label: 'shop' })),
    ...(config.tracked?.niches || []).map(u => ({ url: u, label: 'niche' })),
  ];

  if (allTracked.length === 0) {
    console.error(`No tracked URLs in ${CONFIG_FILE}. Add at least one keyword/listing/shop/niche URL and re-run.`);
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`, { timeout: 12000 });
  } catch (e) {
    console.error(`Cannot connect to Chrome CDP on port ${CDP_PORT}.`);
    console.error(`Run: npm run browser, then sign into ehunt.ai in that window.`);
    process.exit(1);
  }

  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);

  const results = [];
  // Always pull dashboard first
  if (config.dashboard_url) {
    console.log(`Pulling dashboard: ${config.dashboard_url}`);
    results.push({ ...await dumpPage(page, config.dashboard_url, 'dashboard') });
  }

  for (const t of allTracked) {
    console.log(`Pulling ${t.label}: ${t.url}`);
    results.push({ ...await dumpPage(page, t.url, t.label) });
  }

  await page.close();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    scraped_at: new Date().toISOString(),
    config_file: CONFIG_FILE,
    tracked_count: allTracked.length,
    results,
  }, null, 2));

  const errors = results.filter(r => r.error).length;
  console.log(`\nDone. ${results.length} pages scraped, ${errors} error(s).`);
  console.log(`Output: ${OUT_FILE}`);

  if (errors > 0) {
    console.log('\nErrors:');
    for (const r of results.filter(r => r.error)) {
      console.log(`  ${r.label} ${r.url}: ${r.error}`);
    }
  }
})();
