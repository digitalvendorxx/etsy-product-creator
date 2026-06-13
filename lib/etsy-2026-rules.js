const TITLE_BLOCKLIST = [
  'perfect gift',
  'free shipping',
  'on sale',
  'sale',
  'gift for her',
  'gift for him',
  'best gift',
  'unique gift',
  'gift idea',
  'for her',
  'for him',
];

const TITLE_STOP_WORDS = new Set(['and', 'or', 'for', 'with', 'the', 'a', 'an', 'to', 'of', 'in', 'by']);

const FALLBACK_TAGS = [
  'personalized gift',
  'handmade gift',
  'custom gift',
  'small business',
  'made to order',
  'gift idea',
  'birthday gift',
  'home decor gift',
  'kids gift',
  'nursery gift',
  'wooden toy',
  'wall art print',
  'custom decor',
  'etsy gift',
];

const PRODUCT_FALLBACKS = [
  {
    test: /\b(baby|toddler|montessori|nursery|name)\b.*\bpuzzle\b|\bpuzzle\b.*\b(baby|toddler|montessori|nursery|name)\b/i,
    tags: [
      'baby name puzzle',
      'wooden puzzle',
      'montessori toy',
      'baby shower gift',
      'first birthday',
      'custom baby gift',
      'nursery decor',
      'toddler toy',
      'wooden baby toy',
      'learning toy',
      'name puzzle gift',
      'newborn gift',
      'keepsake gift',
    ],
  },
  {
    test: /\b(playground|play ground|slide|swing|kids park|children park|cocuk parki|park)\b/i,
    tags: [
      'kids playground',
      'outdoor playset',
      'wooden playset',
      'backyard playset',
      'children slide',
      'kids swing set',
      'garden play area',
      'toddler playset',
      'outdoor toy',
      'playground gift',
      'kids outdoor toy',
      'wooden playground',
      'active play toy',
    ],
  },
  {
    test: /\b(tshirt|t-shirt|tee|shirt|hoodie|sweatshirt|apparel)\b/i,
    tags: [
      'graphic tee',
      'custom shirt',
      'unisex tee',
      'comfort shirt',
      'shirt gift',
      'personalized tee',
      'retro tee',
      'funny shirt',
      'trendy shirt',
      'casual tee',
      'tee gift',
      'apparel gift',
      'made to order',
    ],
  },
  {
    test: /\b(canvas|wall art|print|poster)\b/i,
    tags: [
      'canvas wall art',
      'wall art print',
      'home decor',
      'living room art',
      'bedroom wall art',
      'gallery wall',
      'canvas print',
      'modern wall art',
      'art print gift',
      'decor print',
      'wall decor',
      'custom wall art',
      'ready to hang',
    ],
  },
  {
    test: /\b(cam tablo|glass|tempered glass|acrylic)\b/i,
    tags: [
      'glass wall art',
      'tempered glass art',
      'modern wall decor',
      'home decor art',
      'wall art gift',
      'living room art',
      'glass print',
      'decor panel',
      'luxury wall art',
      'ready to hang',
      'art panel',
      'office wall art',
      'custom wall art',
    ],
  },
];

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripBlockedTitlePhrases(title) {
  let out = title;
  for (const phrase of TITLE_BLOCKLIST) {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'), '');
  }
  return out.replace(/\s*,\s*,+/g, ', ').replace(/^\s*,\s*|\s*,\s*$/g, '').replace(/\s+/g, ' ').trim();
}

function dedupeAdjacentWords(value) {
  const words = cleanText(value).split(' ');
  const out = [];
  for (const word of words) {
    if (out.length && out[out.length - 1].toLowerCase() === word.toLowerCase()) continue;
    out.push(word);
  }
  return out.join(' ');
}

function inferKnownProductPhrase(title = '', productContext = '') {
  const hay = `${title} ${productContext}`;
  const text = cleanText(title);
  const apparelMatch = text.match(/\b(t[-\s]?shirt|tee|shirt|hoodie|sweatshirt)\b/i);
  if (apparelMatch) return apparelMatch[1].replace(/\s+/, ' ');
  if (/\b(tshirt|t-shirt|tee|shirt|hoodie|sweatshirt|apparel)\b/i.test(hay)) return 'custom shirt';
  if (/\b(baby|toddler|montessori|nursery|name)\b.*\bpuzzle\b|\bpuzzle\b.*\b(baby|toddler|montessori|nursery|name)\b/i.test(hay)) return 'baby name puzzle';
  if (/\b(playground|play ground|slide|swing|kids park|children park|cocuk parki|park)\b/i.test(hay)) return 'kids playground';
  if (/\b(canvas|wall art|print|poster)\b/i.test(hay)) return 'canvas wall art';
  if (/\b(cam tablo|glass|tempered glass|acrylic)\b/i.test(hay)) return 'glass wall art';
  return '';
}

function inferPrimaryPhrase(title, productContext = '') {
  const known = inferKnownProductPhrase(title, productContext);
  if (known) return known;
  const source = cleanText(title) || cleanText(productContext);
  const chunk = source.split(/[,.|/-]/)[0] || source;
  const words = chunk
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/gi, ''))
    .filter(w => w.length > 1 && !TITLE_STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 5);
  return words.join(' ');
}

function applyEtsy2026Title(title, options = {}) {
  const original = cleanText(title);
  let out = stripBlockedTitlePhrases(original)
    .replace(/[|]/g, ',')
    .replace(/\s+-\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  const primary = inferPrimaryPhrase(out, options.productContext);
  if (primary && !out.toLowerCase().startsWith(primary.toLowerCase())) {
    const escapedPrimary = primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`\\b${escapedPrimary}\\b`, 'i'), '')
      .replace(/\s*,\s*,+/g, ', ')
      .replace(/^\s*,\s*|\s*,\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    out = `${primary}${out ? `, ${out}` : ''}`.trim();
  }

  out = dedupeAdjacentWords(out);
  const words = out.split(/\s+/).filter(Boolean);
  if (words.length > 15) out = words.slice(0, 15).join(' ');
  if (out.length > 110) {
    const cut = out.slice(0, 110);
    const comma = cut.lastIndexOf(',');
    out = (comma > 35 ? cut.slice(0, comma) : cut).trim();
  }
  if (out.length > 140) out = out.slice(0, 140).trim();
  return out || original;
}

function normalizeTag(tag) {
  return String(tag || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20)
    .trim();
}

function getFallbackTags(title = '', productContext = '') {
  const hay = `${title} ${productContext}`;
  const product = PRODUCT_FALLBACKS.find(item => item.test.test(hay));
  return product ? product.tags : FALLBACK_TAGS;
}

function tagOverlapsTooMuchTitle(tag, title) {
  const tagWords = new Set(normalizeTag(tag).split(' ').filter(w => w.length > 3));
  if (!tagWords.size) return false;
  const titleWords = new Set(normalizeTag(title).split(' ').filter(w => w.length > 3));
  const overlap = [...tagWords].filter(w => titleWords.has(w)).length;
  return overlap >= Math.max(3, tagWords.size);
}

function applyEtsy2026Tags(tags, options = {}) {
  const out = [];
  const seen = new Set();
  const title = options.title || '';
  const push = (raw, allowTitleOverlap = false) => {
    const tag = normalizeTag(raw);
    if (!tag || tag.length < 3 || tag.length > 20) return;
    if (seen.has(tag)) return;
    if (!allowTitleOverlap && tagOverlapsTooMuchTitle(tag, title)) return;
    seen.add(tag);
    out.push(tag);
  };

  (tags || []).forEach(tag => push(tag));
  for (const fallback of getFallbackTags(title, options.productContext)) {
    if (out.length >= 13) break;
    push(fallback, true);
  }
  for (const fallback of FALLBACK_TAGS) {
    if (out.length >= 13) break;
    push(fallback, true);
  }
  return out.slice(0, 13);
}

function applyEtsy2026Description(description, options = {}) {
  let out = String(description || '').replace(/\n{3,}/g, '\n\n').trim();
  const technicalBodyLocked = /\bAVAILABLE STYLES\b|\bSIZING\b|\bHOW TO ORDER\b|\bSHIPPING & HANDLING\b/i.test(out);
  if (technicalBodyLocked) return out;

  const primary = inferPrimaryPhrase(options.title, options.productContext);
  if (!out && primary) return `${primary} made for shoppers who want a clear, specific Etsy product with accurate details, strong photos, and buyer-friendly information.`;
  if (primary) {
    const firstSentence = out.split(/(?<=[.!?])\s+/)[0] || '';
    if (firstSentence && !firstSentence.toLowerCase().includes(primary.toLowerCase().split(' ').slice(0, 2).join(' '))) {
      out = `${primary}. ${out}`;
    }
  }
  return out;
}

function applyEtsy2026Listing(input, options = {}) {
  const title = applyEtsy2026Title(input.title, options);
  const tags = applyEtsy2026Tags(input.tags, { ...options, title });
  const description = applyEtsy2026Description(input.description, { ...options, title });
  return { title, tags, description };
}

const ETSY_2026_RULE_SUMMARY = [
  'Use a short, clear, buyer-friendly title under 15 words; primary product phrase first.',
  'Keep exact/proximate keyword match, but do not keyword-stuff.',
  'Use all 13 tags with varied multi-word buyer intents; avoid wasting slots on duplicates.',
  'Make the first description sentence identify the exact product and primary keyword.',
  'Optimize for relevance, engagement, trust, shipping clarity, policy safety, and conversion.',
];

module.exports = {
  ETSY_2026_RULE_SUMMARY,
  applyEtsy2026Description,
  applyEtsy2026Listing,
  applyEtsy2026Tags,
  applyEtsy2026Title,
  inferPrimaryPhrase,
  normalizeTag,
};
