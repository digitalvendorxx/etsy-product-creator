// scrape-tags-etsyhunt.js
// Uses AppleScript to control Chrome and scrape EHunt keyword tool results
// Requires: Chrome open with ehunt.ai logged in, Apple Events JS enabled

const { execSync } = require('child_process');
const { fetchWithRetry } = require('./fetch-retry');
const path = require('path');
const fs = require('fs');

// Execute AppleScript that runs JavaScript in Chrome
function chromeJS(js) {
  // Escape for AppleScript string (double backslashes and double quotes)
  const escaped = js.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // First, find all ehunt tab indexes
  const findScript = `tell application "Google Chrome"
  set tabIndexes to {}
  set tabCount to count of tabs of front window
  repeat with i from 1 to tabCount
    set tabUrl to URL of tab i of front window
    if tabUrl contains "ehunt" and tabUrl contains "keyword" then
      set end of tabIndexes to i
    end if
  end repeat
  if (count of tabIndexes) = 0 then
    repeat with i from 1 to tabCount
      set tabUrl to URL of tab i of front window
      if tabUrl contains "ehunt" then
        set end of tabIndexes to i
      end if
    end repeat
  end if
  set AppleScript's text item delimiters to ","
  set out to tabIndexes as text
  set AppleScript's text item delimiters to ""
  return out
end tell`;

  let tabIndexes;
  try {
    const raw = execSync(`osascript -e '${findScript.replace(/'/g, "'\\''")}'`, {
      timeout: 10000, encoding: 'utf8',
    }).trim();
    tabIndexes = raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  } catch {
    return null;
  }

  if (tabIndexes.length === 0) return 'NO_EHUNT_TAB';

  // Try each ehunt tab with a short timeout until one responds
  for (const idx of tabIndexes) {
    const execScript = `tell application "Google Chrome"
  execute tab ${idx} of front window javascript "${escaped}"
  return result
end tell`;
    try {
      const result = execSync(`osascript -e '${execScript.replace(/'/g, "'\\''")}'`, {
        timeout: 10000,
        encoding: 'utf8',
      }).trim();
      if (!result || result === 'missing value') continue;
      return result;
    } catch {
      continue;
    }
  }
  return null;
}

// Get token from Chrome's EHunt cookie
function getToken() {
  const result = chromeJS(
    "var cookies = document.cookie.split('; '); var token = ''; for (var i = 0; i < cookies.length; i++) { if (cookies[i].startsWith('token=')) { token = cookies[i].substring(6); break; } } token"
  );
  if (!result || result === 'NO_EHUNT_TAB' || result === 'missing value') {
    throw new Error('EHunt token alinamadi. Chrome\'da ehunt.ai acik ve giris yapilmis olmali.');
  }
  return result;
}

// Navigate the EHunt tab to keyword search via main page URL
function navigateToKeywordSearch(keyword, token) {
  const encodedKw = encodeURIComponent(keyword);
  // Always navigate the main page URL — iframe navigation is unreliable
  const navScript = `tell application "Google Chrome"
  set tabList to every tab of front window
  repeat with t in tabList
    set tabUrl to URL of t
    if tabUrl contains "ehunt" then
      set URL of t to "https://ehunt.ai/etsy-keyword-tool?keyword=${encodedKw}"
      return "navigated"
    end if
  end repeat
  return "NO_EHUNT_TAB"
end tell`;
  try {
    return execSync(`osascript -e '${navScript.replace(/'/g, "'\\''")}'`, { timeout: 15000, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// Wait for table to load and scrape results from iframe
function scrapeResults(maxWait = 25000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const js = `var iframe = document.getElementById('zbaseiframe'); if (!iframe) 'NO_IFRAME'; else { var doc = iframe.contentDocument || iframe.contentWindow.document; var rows = doc.querySelectorAll('.el-table__body tr.el-table__row'); if (rows.length > 2) { var results = []; for (var i = 0; i < Math.min(rows.length, 100); i++) { var tds = rows[i].querySelectorAll('td'); if (tds.length < 10) continue; var texts = []; for (var j = 0; j < tds.length; j++) texts.push(tds[j].innerText.trim()); results.push(texts); } JSON.stringify(results); } else { 'LOADING'; } }`;
    const result = chromeJS(js);
    if (result && result !== 'LOADING' && result !== 'NO_IFRAME' && result !== 'missing value') {
      try {
        return JSON.parse(result);
      } catch {}
    }
    execSync('sleep 1');
  }
  return null;
}

// Parse "102.3K" or "9.2M" into a number
function parseNum(s) {
  if (!s) return 0;
  s = s.toString().trim().replace(/,/g, '');
  if (s === 'NR' || s === '-' || s === '') return 0;
  const m = s.match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!m) return parseFloat(s) || 0;
  let n = parseFloat(m[1]);
  if (m[2] === 'K' || m[2] === 'k') n *= 1000;
  if (m[2] === 'M' || m[2] === 'm') n *= 1000000;
  return Math.round(n);
}

// Parse raw table row into structured keyword object
// Verified column layout from EHunt iframe table:
//   [0]=checkbox [1]=fav [2]=Keywords [3]=Competition
//   [4]=Views Total [5]=Views Mon [6]=Favorites Total [7]=Favorites Mon
//   [8]=Sales Total [9]=Sales Mon [10]=Reviews Total [11]=Score [12]=Long Tail [13]=actions
function parseRow(cells) {
  if (!cells || cells.length < 12) return null;
  const keyword = (cells[2] || '').replace(/[-]/g, ' ').trim();
  if (!keyword || keyword.length < 2) return null;

  return {
    keyword,
    competition: parseNum(cells[3]),     // Competition (lower = better)
    viewsTotal: parseNum(cells[4]),      // Views Total
    viewsMon: parseNum(cells[5]),        // Views Monthly
    favoritesTotal: parseNum(cells[6]),  // Favorites Total
    favoritesMon: parseNum(cells[7]),    // Favorites Monthly
    salesTotal: parseNum(cells[8]),      // Sales Total
    salesMon: parseNum(cells[9]),        // Sales Monthly (closest to "weekly")
    reviewsTotal: parseNum(cells[10]),   // Reviews Total
    score: parseNum(cells[11]),          // EHunt Score (higher = better)
    longTail: parseFloat(cells[12]) || 0, // Long Tail ratio (higher = more long-tail)
  };
}

// Score each keyword based on user's criteria:
// 1. Competition düsük (+50 max)
// 2. Score yüksek (+30 max)
// 3. Long-tail olan (+25 max)
// 4. Haftalik satisi yüksek (+30 max)
// 5. Favorilenmesi ve görüntülenmesi yüksek (+20 max)
// 6. Dizayn ile baglantili, alakasiz taglar secilmeyecek
// 7. Etsy tag kurallari: max 20 karakter, min 3 karakter
function scoreKeyword(kw) {
  let score = 0;

  // 1. LOW COMPETITION (most important — lower number = better)
  if (kw.competition <= 5000) score += 50;
  else if (kw.competition <= 15000) score += 40;
  else if (kw.competition <= 30000) score += 30;
  else if (kw.competition <= 60000) score += 15;
  else if (kw.competition <= 100000) score += 5;
  // >100K competition = no bonus

  // 2. HIGH EHUNT SCORE
  if (kw.score >= 10000) score += 30;
  else if (kw.score >= 5000) score += 25;
  else if (kw.score >= 2000) score += 20;
  else if (kw.score >= 500) score += 10;
  else if (kw.score >= 100) score += 5;

  // 3. LONG-TAIL preference (EHunt long-tail ratio + word count)
  if (kw.longTail >= 10) score += 25;
  else if (kw.longTail >= 5) score += 20;
  else if (kw.longTail >= 2) score += 15;
  else if (kw.longTail >= 1) score += 10;
  // Also bonus for multi-word tags
  const wordCount = kw.keyword.split(/\s+/).length;
  if (wordCount >= 3) score += 5;

  // 4. HIGH MONTHLY SALES (salesMon = monthly, best proxy for weekly)
  if (kw.salesMon >= 20000) score += 30;
  else if (kw.salesMon >= 10000) score += 25;
  else if (kw.salesMon >= 5000) score += 20;
  else if (kw.salesMon >= 1000) score += 10;
  else if (kw.salesMon >= 100) score += 5;

  // 5. HIGH FAVORITES + VIEWS (monthly)
  if (kw.favoritesMon >= 500) score += 10;
  else if (kw.favoritesMon >= 100) score += 7;
  else if (kw.favoritesMon >= 10) score += 3;
  if (kw.viewsMon >= 1000000) score += 10;
  else if (kw.viewsMon >= 500000) score += 7;
  else if (kw.viewsMon >= 100000) score += 3;

  // 6. RELEVANCE FILTERS — penalize non-shirt and non-buyer terms
  const lower = kw.keyword.toLowerCase();
  const badTerms = ['svg', 'png', 'jpg', 'dxf', 'eps', 'pdf', 'mock', 'mockup', 'template',
    'clipart', 'sublimation', 'dtf', 'dtg', 'cricut', 'silhouette', 'download',
    'printable', 'digital', 'bundle', 'file', 'cut file', 'vector'];
  const nonShirtProducts = ['towel', 'mug', 'cup', 'pillow', 'blanket', 'sticker',
    'poster', 'canvas', 'hat', 'cap', 'apron', 'bag', 'tote', 'phone case',
    'tumbler', 'decal', 'flag', 'banner', 'rug', 'coaster', 'magnet',
    'ornament', 'candle', 'keychain', 'onesie', 'bib', 'napkin', 'tablecloth',
    'topper', 'cake', 'cookie', 'invitation', 'card', 'garland', 'wreath',
    'sash', 'crown', 'tiara', 'pin', 'badge', 'patch', 'earring', 'necklace',
    'bracelet', 'ring', 'sign', 'wall art', 'door', 'mat', 'curtain',
    'dog', 'pet', 'collar', 'leash', 'bowl', 'treat',
    'decor', 'decoration', 'beach', 'gift', 'favor', 'party supply',
    'balloon', 'confetti', 'streamer', 'plate', 'napkin', 'recipe',
    'drink', 'food', 'cocktail', 'wine', 'beer', 'shot glass'];
  if (badTerms.some(t => lower.includes(t))) score -= 80;
  if (nonShirtProducts.some(t => lower.includes(t))) score -= 80;

  // 7. ETSY TAG RULES
  if (kw.keyword.length > 20) score -= 100; // Etsy max 20 chars per tag
  if (kw.keyword.length < 3) score -= 100;  // Too short to be useful

  // Penalize duplicate words in same tag (e.g. "fiesta shirt shirt")
  const words = kw.keyword.toLowerCase().split(/\s+/);
  if (new Set(words).size < words.length) score -= 30;

  return score;
}

// Single EHunt search: navigate, wait, scrape one round
function singleSearch(keyword, token) {
  console.log(`  [hunt] Searching: "${keyword}"`);
  navigateToKeywordSearch(keyword, token);
  execSync('sleep 3');

  const results = scrapeResults(25000);
  if (!results || results.length === 0) {
    execSync('sleep 2');
    return scrapeResults(20000) || [];
  }
  return results;
}

// Generate related search terms locally (no API needed) + AI fallback
async function getRelatedSearchTerms(mainKeyword) {
  // First try local generation by varying the keyword
  const words = mainKeyword.toLowerCase().replace(/\s+(shirt|tee|tshirt|t-shirt)$/i, '').trim().split(/\s+/);
  const localTerms = [];

  // Variation 1: keyword + "tee" instead of "shirt"
  localTerms.push(words.join(' ') + ' tee');
  // Variation 2: keyword + "tshirt"
  localTerms.push(words.join(' ') + ' tshirt');
  // Variation 3: if multi-word, try subsets
  if (words.length >= 3) {
    localTerms.push(words.slice(0, 2).join(' ') + ' shirt');
    localTerms.push(words.slice(1).join(' ') + ' shirt');
  } else if (words.length === 2) {
    localTerms.push(words[0] + ' shirt');
    localTerms.push(words[1] + ' shirt');
  } else {
    localTerms.push(words[0] + ' lover shirt');
    localTerms.push(words[0] + ' graphic tee');
  }

  // Deduplicate and filter
  const primary = mainKeyword.toLowerCase().trim();
  const unique = [...new Set(localTerms)]
    .filter(t => t !== primary && t.length >= 5 && t.length <= 40)
    .slice(0, 2);

  // Try AI if we have credits (bonus, not required)
  try {
    const dotenv = require('dotenv');
    dotenv.config({ path: path.join(__dirname, '..', '.env') });
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return unique;

    const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-maverick',
        messages: [{
          role: 'user',
          content: `I sell t-shirts on Etsy. My current design theme is: "${mainKeyword}"

Generate exactly 2 DIVERSE alternative Etsy search phrases buyers would type to find THIS SPECIFIC type of t-shirt. Each phrase MUST end with "shirt" or "tee".

Rules:
- 2-3 words + "shirt" or "tee" at the end
- The two phrases must use DIFFERENT lead words (e.g. if one starts with "highland", the other must not)
- Must be closely related to "${mainKeyword}" theme (synonyms, sub-themes, occasions, aesthetics)
- What real Etsy buyers actually type
- Do NOT include unrelated products (no mug, towel, decor, gift, etc.)
- No brand names

Output ONLY 2 lines, one phrase per line, nothing else.`,
        }],
      }),
    });
    if (!response.ok) return unique;
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const aiTerms = text.split('\n')
      .map(l => l.replace(/^[\d.\-*]+\s*/, '').replace(/["']/g, '').trim())
      .filter(l => l.length >= 5 && l.length <= 40)
      .slice(0, 2);
    return aiTerms.length > 0 ? aiTerms : unique;
  } catch {
    return unique;
  }
}

async function scrapeEtsyHunt(mainKeyword, designContext = '') {
  // Step 1: Get token from Chrome
  console.log('  [hunt] Getting token from Chrome...');
  const token = getToken();
  console.log('  [hunt] Token obtained');

  // Step 2: Build search keyword list
  // Main keyword always includes "shirt"
  let primaryKw = mainKeyword.trim();
  const shirtTerms = ['shirt', 'tshirt', 't-shirt', 'tee'];
  if (!shirtTerms.some(t => primaryKw.toLowerCase().includes(t))) {
    primaryKw = primaryKw + ' shirt';
  }

  // Get related keywords for more diverse results
  console.log('  [hunt] Generating related search terms...');
  const relatedTerms = await getRelatedSearchTerms(mainKeyword);
  console.log(`  [hunt] Related terms: ${relatedTerms.join(' | ')}`);

  const searchTerms = [primaryKw, ...relatedTerms];
  const allParsed = [];

  // Step 3: Search each term on EHunt and collect results
  for (const term of searchTerms) {
    const raw = singleSearch(term, token);
    console.log(`  [hunt] "${term}" => ${raw.length} rows`);
    const parsed = raw
      .map(parseRow)
      .filter(kw => kw !== null && kw.keyword.length >= 3 && kw.keyword.length <= 20);
    allParsed.push(...parsed);
  }

  console.log(`  [hunt] Total parsed: ${allParsed.length} keywords from ${searchTerms.length} searches`);

  if (allParsed.length === 0) {
    throw new Error('EHunt sonuclari alinamadi. Chrome\'da ehunt.ai acik ve giris yapilmis olmali.');
  }

  // Step 4: Score and deduplicate (same words in any order = duplicate)
  const seen = new Set();
  const scored = allParsed
    .map(kw => ({ ...kw, totalScore: scoreKeyword(kw) }))
    .filter(kw => {
      const normalized = kw.keyword.toLowerCase().split(/\s+/).sort().join(' ');
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return kw.totalScore > 0;
    })
    .sort((a, b) => b.totalScore - a.totalScore);

  // Debug: show top 20 scored keywords with details
  scored.slice(0, 20).forEach((kw, i) => {
    console.log(`  [hunt]  ${i + 1}. "${kw.keyword}" score=${kw.totalScore} comp=${kw.competition} ehuntScore=${kw.score} longTail=${kw.longTail} salesMon=${kw.salesMon} favMon=${kw.favoritesMon} viewsMon=${kw.viewsMon}`);
  });

  // Pick top 13 with anti-repetition: cap any single lead word at 4/13 (~30%)
  // to satisfy Etsy's "avoid repetition" warning. Pull lower-ranked diverse
  // alternatives from the same scored pool rather than fabricating tags.
  const leadWordCounts = new Map();
  const MAX_LEAD_REPEAT = 4;
  const picked = [];
  const skipped = [];
  for (const kw of scored) {
    if (picked.length >= 13) break;
    const tag = kw.keyword.toLowerCase().trim();
    const lead = tag.split(/\s+/)[0];
    const count = leadWordCounts.get(lead) || 0;
    if (count >= MAX_LEAD_REPEAT) { skipped.push(tag); continue; }
    picked.push(tag);
    leadWordCounts.set(lead, count + 1);
  }
  // If we still have fewer than 13 and some were skipped, fill from skipped pool
  for (const tag of skipped) {
    if (picked.length >= 13) break;
    picked.push(tag);
  }
  console.log('  [hunt] Top 13 tags (diversified):', picked);

  return picked;
}

// Extract main keyword from title using AI
async function getMainKeyword(title, designContext) {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return title.split(' ').slice(0, 3).join(' ');

  try {
    const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-maverick',
        messages: [{
          role: 'user',
          content: `Given this Etsy t-shirt listing title: "${title}"
Design context: "${designContext}"

Extract the single BEST main keyword phrase (2-4 words) to search on EHunt keyword research tool.
Rules:
- Must be what buyers actually search for
- 2-4 words maximum
- No brand names
- Most specific to the design
Output ONLY the keyword phrase, nothing else.`,
        }],
      }),
    });
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    const msg = data.choices?.[0]?.message?.content;
    return (typeof msg === 'string' ? msg : '').trim().replace(/["']/g, '') || title.split(',')[0].trim();
  } catch {
    return title.split(',')[0].trim().split(' ').slice(0, 3).join(' ');
  }
}

module.exports = { scrapeEtsyHunt, getMainKeyword, scoreKeyword };
