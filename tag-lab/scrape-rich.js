const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function parseNum(s) {
  if (!s) return 0;
  s = String(s).trim().replace(/,/g, '');
  if (s === 'NR' || s === '-' || s === '') return 0;
  const m = s.match(/^([\d.]+)\s*([KkMmBb]?)$/);
  if (!m) return parseFloat(s) || 0;
  let n = parseFloat(m[1]);
  const u = (m[2] || '').toUpperCase();
  if (u === 'K') n *= 1e3;
  else if (u === 'M') n *= 1e6;
  else if (u === 'B') n *= 1e9;
  return Math.round(n);
}

async function scrapeRich(keyword, opts = {}) {
  const limit = Math.min(opts.limit || 50, 200);
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const port = config.cdpPort || 9333;

  const browser = await chromium.connectOverCDP('http://localhost:' + port);
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('ehunt.ai'));
  if (!page) page = await context.newPage();

  try {
    const targetUrl = 'https://ehunt.ai/etsy-keyword-tool?keyword=' + encodeURIComponent(keyword);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // login wall detection
    const bodyText = await page.evaluate(() => (document.body && document.body.innerText || '').slice(0, 500)).catch(() => '');
    if (/Giri[sş] Yap|Kay[ıi]t Ol|Sign in|Sign up|Log in/i.test(bodyText) && !await page.$('#zbaseiframe')) {
      throw new Error('EHunt login gerekli. CDP browser\'da ehunt.ai\'a giris yap, sonra tekrar dene.');
    }

    // wait for iframe
    await page.waitForSelector('#zbaseiframe', { timeout: 30000 });
    const frameHandle = await page.$('#zbaseiframe');
    const frame = await frameHandle.contentFrame();
    if (!frame) throw new Error('zbaseiframe contentFrame yok');

    // wait for table rows
    await frame.waitForFunction(() => {
      const rows = document.querySelectorAll('.el-table__body tr.el-table__row');
      return rows.length > 2;
    }, { timeout: 45000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    const rawRows = await frame.evaluate(() => {
      const out = [];
      const rows = document.querySelectorAll('.el-table__body tr.el-table__row');
      for (const tr of rows) {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 12) continue;
        out.push(tds.map(td => (td.innerText || td.textContent || '').trim()));
      }
      return out;
    });

    // columns: [0]checkbox [1]fav [2]Keywords [3]Competition
    // [4]Views Total [5]Views Mon [6]Fav Total [7]Fav Mon
    // [8]Sales Total [9]Sales Mon [10]Reviews Total [11]Score [12]Long Tail
    const rows = [];
    for (const cells of rawRows) {
      const kw = (cells[2] || '').replace(/[-]/g, ' ').trim();
      if (!kw || kw.length < 2) continue;
      rows.push({
        keyword: kw,
        competition: parseNum(cells[3]),
        viewsTotal: parseNum(cells[4]),
        viewsMonthly: parseNum(cells[5]),
        favoritesTotal: parseNum(cells[6]),
        favoritesMonthly: parseNum(cells[7]),
        salesTotal: parseNum(cells[8]),
        monthlySales: parseNum(cells[9]),
        reviewsTotal: parseNum(cells[10]),
        score: parseNum(cells[11]),
        longTail: parseFloat(cells[12]) || 0,
      });
    }

    return rows.slice(0, limit);
  } finally {
    try { await browser.close(); } catch {}
  }
}

module.exports = { scrapeRich };
