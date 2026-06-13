// Shared Tag Lab pipeline: image -> Gemini keyword extraction -> EtsyHunt expansion ->
// composite scoring + relevance gating + token-set dedupe -> diversity-capped picks ->
// title/description -> title-overlap dedupe.
//
// Used by tag-lab/server.js (SSE UI) and the main server.js /api/create flow when
// tagSource === 'etsyhunt'.

const { extractKeywords } = require('../tag-lab/extract-keywords');
const { scrapeRich } = require('../tag-lab/scrape-rich');
const { scoreKeyword } = require('./scrape-tags-etsyhunt');
const { analyzeMockup } = require('./analyze-mockup');
const { appendStyleTemplate } = require('./optimize');
const fs = require('fs');
const os = require('os');
const path = require('path');

// product/style tokens — meaningless alone for SEO purposes
const PRODUCT_GENERIC = new Set([
  'shirt', 'shirts', 'tshirt', 'tshirts', 't', 'tee', 'tees', 'top', 'tops',
  'hoodie', 'hoodies', 'sweatshirt', 'sweater', 'crewneck', 'pullover', 'jumper',
  'graphic', 'vintage', 'retro', 'classic', 'cotton', 'oversized', 'unisex',
  'mens', 'womens', 'kids', 'youth', 'adult', 'boys', 'girls',
  'cute', 'funny', 'cool', 'aesthetic', 'minimalist', 'trendy', 'soft', 'comfy',
  'a', 'an', 'the', 'and', 'or', 'for', 'of', 'with', 'in', 'on',
]);

// intent/recipient/occasion tokens — valuable on their own as buyer-intent tags
const INTENT_GENERIC = new Set([
  'gift', 'gifts', 'present', 'presents',
  'his', 'her', 'him', 'mom', 'dad', 'mother', 'father', 'mama', 'papa',
  'sister', 'brother', 'husband', 'wife', 'girlfriend', 'boyfriend',
  'son', 'daughter', 'grandma', 'grandpa', 'auntie', 'uncle', 'friend', 'bff',
  'men', 'women', 'man', 'woman',
  'fan', 'fans', 'lover', 'lovers', 'enthusiast',
  'birthday', 'anniversary', 'wedding', 'graduation', 'baby', 'shower',
  'christmas', 'xmas', 'halloween', 'easter', 'valentine', 'valentines',
  'fathers', 'mothers', 'thanksgiving', 'holiday',
]);

const GENERIC_TOKENS = new Set([...PRODUCT_GENERIC, ...INTENT_GENERIC]);

// foreign theme tokens — present a competing theme/occasion not native to this design
const CROSS_THEME = new Set([
  'halloween', 'spooky', 'witch', 'witches', 'ghost', 'ghosts', 'vampire', 'zombie', 'skull', 'skeleton', 'pumpkin', 'jackolantern',
  'christmas', 'xmas', 'santa', 'reindeer', 'elf', 'elves', 'snowman', 'snowflake', 'snow',
  'valentine', 'valentines', 'cupid',
  'easter', 'bunny',
  'thanksgiving', 'turkey',
  'patrick', 'shamrock', 'clover', 'irish', 'leprechaun',
  'fourth', 'independence', 'patriotic',
  'hanukkah', 'menorah', 'kwanzaa',
]);

// Product is a WOODEN BABY NAME PUZZLE. Block anything that's a competing
// product category — apparel, prints, mugs, etc.
const BLOCKED_PRODUCTS = /\b(shirt|shirts|tshirt|tshirts|t\-?shirt|tee|tees|hoodie|hoody|hoodies|sweatshirt|sweatshirts|crewneck|crew\s?neck|pullover|jumper|sweater|cardigan|zip\s?up|fleece|tank\s?top|vest|romper|legging|pajama|pj|dress|skirt|sock|hat|cap|beanie|scarf|glove|mitten|apron|robe|swimsuit|bikini|underwear|bra|panties|boxer|brief|case|cases|wallpaper|sticker|stickers|decal|decals|mug|mugs|tumbler|cup|glass|bottle|tote|totebag|bag|bags|backpack|purse|wallet|clutch|pouch|poster|posters|print|prints|canvas|frame|painting|wallart|wall\s?art|sign|signs|plaque(?!s)|pillow|cushion|blanket|throw|quilt|towel|rug|mat|curtain|tapestry|coaster|placemat|napkin|tablecloth|magnet|candle|earring|necklace|bracelet|ring(?!s\s|er)|jewelry|brooch|patch|button|pin(?!\s)|badge)\b/i;

function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function tokenMatchesTheme(t, themeTokens) {
  if (themeTokens.has(t)) return true;
  if (t.length < 4) return false;
  for (const tt of themeTokens) {
    if (tt.length < 4) continue;
    if (t.includes(tt) || tt.includes(t)) return true;
  }
  return false;
}

// 0 = irrelevant, 1 = strict (every meaningful matches), 2 = loose (at least one matches, no cross-theme contamination)
function relevanceTier(candidateKw, themeTokens) {
  const tokens = tokenize(candidateKw);
  if (tokens.length < 2) return 0;
  const meaningful = tokens.filter(t => !GENERIC_TOKENS.has(t) && t.length >= 2);
  if (!meaningful.length) {
    return tokens.some(t => INTENT_GENERIC.has(t)) ? 1 : 0;
  }
  for (const t of meaningful) {
    if (CROSS_THEME.has(t) && !tokenMatchesTheme(t, themeTokens)) return 0;
  }
  if (meaningful.every(t => tokenMatchesTheme(t, themeTokens))) return 1;
  if (meaningful.some(t => tokenMatchesTheme(t, themeTokens))) return 2;
  return 0;
}

function pickBest(allRows, want = 13, seedKeywords = [], themeWords = [], opts = {}) {
  const themeTokens = new Set();
  for (const seed of seedKeywords) {
    for (const t of tokenize(seed)) {
      if (!GENERIC_TOKENS.has(t) && t.length >= 2) themeTokens.add(t);
    }
  }
  for (const w of themeWords) {
    const t = String(w).toLowerCase().trim();
    if (t && !GENERIC_TOKENS.has(t) && t.length >= 2) themeTokens.add(t);
  }

  const sigOf = (kw) => tokenize(kw).slice().sort().join(' ');
  // Bucket every candidate into one of three tiers, all gated by length + BLOCKED_PRODUCTS:
  //   tier 1 = strict (every meaningful token matches design theme)
  //   tier 2 = loose  (at least one meaningful token matches)
  //   tier 3 = relaxed (no theme overlap; only used as last resort to hit `want`)
  const strictMap = new Map();
  const looseMap = new Map();
  const relaxedMap = new Map();
  for (const r of allRows) {
    const k = (r.keyword || '').toLowerCase().trim();
    if (!k || k.length > 20 || k.length < 3) continue;
    if (!opts.productContext && BLOCKED_PRODUCTS.test(k)) continue;
    if (tokenize(k).length < 2) continue; // long-tail rule (no single-word tags)
    const sig = sigOf(k);
    if (!sig) continue;
    const tier = themeTokens.size ? relevanceTier(k, themeTokens) : 1;
    if (opts.productContext && tier === 0) continue;
    let target;
    if (tier === 1) target = strictMap;
    else if (tier === 2) target = looseMap;
    else target = relaxedMap;
    const candidate = { ...r, relevanceTier: tier || 3 };
    const cur = target.get(sig);
    if (!cur || (r.compositeScore || r.score || 0) > (cur.compositeScore || cur.score || 0)) {
      target.set(sig, candidate);
    }
  }

  const scoreOne = (r) => {
    const adapted = {
      keyword: r.keyword,
      competition: r.competition || 0,
      score: r.score || 0,
      longTail: r.longTail || 0,
      salesMon: r.monthlySales || 0,
      favoritesMon: r.favoritesMonthly || 0,
      viewsMon: r.viewsMonthly || 0,
    };
    const compositeScore = opts.productContext
      ? ((r.score || 0) + (r.monthlySales || 0) / 100 + (r.viewsMonthly || 0) / 10000 - (r.competition || 0) / 1000)
      : scoreKeyword(adapted);
    return { ...r, compositeScore };
  };
  const sortPool = (arr) => arr.map(scoreOne).sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
  const strictPool = sortPool(Array.from(strictMap.values()));
  const loosePool = sortPool(Array.from(looseMap.values()));
  const relaxedPool = sortPool(Array.from(relaxedMap.values()));
  const pool = [...strictPool, ...loosePool, ...relaxedPool];

  // Diversity-aware fill: cap each token's usage to keep variety.
  const MAX_PER_TOKEN = 3;
  const picked = [];
  const seenKeyword = new Set();
  const fill = (sourcePool, useDiversity) => {
    const used = new Map();
    // Pre-seed used counts from already picked items so the cap stays honest
    for (const r of picked) {
      for (const t of tokenize(r.keyword).filter(x => !GENERIC_TOKENS.has(x) && x.length >= 2)) {
        used.set(t, (used.get(t) || 0) + 1);
      }
    }
    for (const r of sourcePool) {
      if (picked.length >= want) break;
      if (seenKeyword.has(r.keyword.toLowerCase())) continue;
      if (useDiversity) {
        const toks = tokenize(r.keyword).filter(t => !GENERIC_TOKENS.has(t) && t.length >= 2);
        if (toks.some(t => (used.get(t) || 0) >= MAX_PER_TOKEN)) continue;
        for (const t of toks) used.set(t, (used.get(t) || 0) + 1);
      }
      picked.push(r);
      seenKeyword.add(r.keyword.toLowerCase());
    }
  };

  // Order matters: prefer relevant + diverse, then drop diversity, then drop relevance.
  fill(strictPool, true);
  if (picked.length < want) fill(strictPool, false);
  if (picked.length < want) fill(loosePool, true);
  if (picked.length < want) fill(loosePool, false);
  if (picked.length < want) fill(relaxedPool, true);
  if (picked.length < want) fill(relaxedPool, false);

  picked.pool = pool;
  return picked;
}

function dedupeAgainstTitle(picked, pool, title, want) {
  const titleTokens = new Set(
    tokenize(title).filter(t => !GENERIC_TOKENS.has(t) && t.length >= 2)
  );
  if (!titleTokens.size) return picked;
  const fullyCovered = (kw) => {
    const toks = tokenize(kw).filter(t => !GENERIC_TOKENS.has(t) && t.length >= 2);
    if (!toks.length) return false;
    return toks.every(t => titleTokens.has(t));
  };
  const kept = picked.filter(r => !fullyCovered(r.keyword));
  if (kept.length >= want) return kept.slice(0, want);
  const seen = new Set(kept.map(r => r.keyword.toLowerCase()));
  for (const r of pool) {
    if (kept.length >= want) break;
    const k = r.keyword.toLowerCase();
    if (seen.has(k)) continue;
    if (fullyCovered(r.keyword)) continue;
    kept.push(r);
    seen.add(k);
  }
  return kept;
}

// Orchestrator. Optional callbacks let callers stream progress without coupling to SSE.
async function runTagLabPipeline(opts) {
  const {
    imageBuffer, mime = 'image/png', apiKey,
    perKwLimit = 50, targetCount = 13, minScore = 60, maxRetries = 10,
    productContext = '', lockedDescription = '', fallbackTags = [],
    onLog = () => {}, onKeywords = () => {}, onResult = () => {}, onProgress = () => {},
  } = opts;

  if (!imageBuffer) throw new Error('imageBuffer required');
  if (!apiKey) throw new Error('apiKey required');

  onLog('Gemini ile gorsel analiz ediliyor...');
  let { keywords, themeWords } = await extractKeywords(imageBuffer, mime, apiKey, { productContext });
  if (productContext && fallbackTags.length) {
    keywords = [...new Set([...fallbackTags.slice(0, 5), ...keywords])].slice(0, 9);
    themeWords = [...new Set([...productContext.toLowerCase().split(/\W+/), ...themeWords])].filter(Boolean).slice(0, 40);
  }
  onKeywords(keywords, false);
  onLog('Cikarildi: ' + keywords.join(' | '));
  if (themeWords.length) onLog('Theme tokens: ' + themeWords.join(', '));

  const allRows = [];
  const tried = new Set();
  const allSeeds = [...keywords];
  const allThemeWords = [...themeWords];
  let best = [];

  for (let pass = 0; pass <= maxRetries; pass++) {
    const queue = keywords.filter(k => !tried.has(k.toLowerCase()));
    if (!queue.length) break;
    for (const kw of queue) {
      tried.add(kw.toLowerCase());
      onLog('EtsyHunt: "' + kw + '"');
      try {
        const rows = await scrapeRich(kw, { limit: perKwLimit });
        allRows.push(...rows);
        onResult(kw, rows.length, rows.slice(0, 5));
      } catch (err) {
        onResult(kw, 0, [], err.message);
      }
    }
    best = pickBest(allRows, targetCount, allSeeds, allThemeWords, { productContext });
    const avgScore = best.length ? (best.reduce((s, r) => s + (r.compositeScore || 0), 0) / best.length) : 0;
    onProgress(best.length, avgScore);
    const goodEnough = best.length >= targetCount && avgScore >= minScore;
    if (goodEnough || pass === maxRetries) break;

    onLog('Yetersiz - ek keyword uretiliyor (pass ' + (pass + 2) + ')...');
    try {
      const more = await extractKeywords(imageBuffer, mime, apiKey, { productContext });
      const fresh = (more.keywords || []).filter(k => !tried.has(k.toLowerCase()));
      if (more.themeWords) {
        for (const t of more.themeWords) if (!allThemeWords.includes(t)) allThemeWords.push(t);
      }
      if (fresh.length) {
        keywords = fresh;
        allSeeds.push(...fresh);
        onKeywords(fresh, true);
      } else {
        onLog('Yeni keyword bulunamadi, eldekiler ile devam ediliyor');
        break;
      }
    } catch (err) {
      onLog('Ek keyword uretimi basarisiz: ' + err.message + ' (eldekiler ile devam)');
      break;
    }
  }

  let title = '';
  let description = '';
  if (best.length) {
    onLog('Title + description yaziliyor (Gemini)...');
    const tmpPath = path.join(os.tmpdir(), 'taglab-' + Date.now() + '.png');
    try {
      fs.writeFileSync(tmpPath, imageBuffer);
      const analysis = await analyzeMockup(tmpPath, { tags: best.map(r => r.keyword), apiKey, productContext });
      title = analysis.title || '';
      description = analysis.description || '';
      if (!productContext) description = description ? appendStyleTemplate(description, title) : '';
      else if (lockedDescription) {
        const heading = lockedDescription.search(/\n[◆✦📐🎁📦⚠️♡]/);
        description = `${description}\n\n${heading >= 0 ? lockedDescription.slice(heading).trim() : lockedDescription}`.trim();
      }
      const dedup = dedupeAgainstTitle(best, best.pool || best, title, targetCount);
      const bestSet = new Set(best.map(r => r.keyword.toLowerCase()));
      const dropped = dedup.filter(r => !bestSet.has(r.keyword.toLowerCase())).length;
      if (dropped > 0) onLog('Title ile cakisan ' + dropped + ' tag yenisiyle degistirildi');
      best = dedup;
    } catch (err) {
      onLog('Listing yazimi basarisiz: ' + err.message);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  return {
    rows: best,
    tags: best.map(r => r.keyword),
    title,
    description,
    keywords: allSeeds,
    themeWords: allThemeWords,
  };
}

module.exports = {
  runTagLabPipeline,
  pickBest,
  dedupeAgainstTitle,
  relevanceTier,
  tokenize,
  tokenMatchesTheme,
  PRODUCT_GENERIC,
  INTENT_GENERIC,
  GENERIC_TOKENS,
  CROSS_THEME,
  BLOCKED_PRODUCTS,
};
