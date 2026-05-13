// Shared product-type metadata. Used by extract-keywords, analyze-mockup,
// tag-lab-pipeline, and ai-description so all three stages speak the same
// language about what the user is actually selling.

const PRODUCT_TYPES = {
  wall_art:  { label: 'wall art print (hung on a wall, unframed paper or canvas)', shortLabel: 'wall art print',
               synonyms: ['wall art', 'wallart', 'poster', 'print', 'canvas', 'painting', 'tapestry'],
               themeExamples: ['vintage flower wall art', 'boho wall print', 'botanical canvas', 'minimalist wall art'] },
  mug:       { label: 'ceramic coffee mug', shortLabel: 'mug',
               synonyms: ['mug', 'cup', 'coffee mug', 'ceramic mug'],
               themeExamples: ['cat lover mug', 'funny coffee mug', 'plant lady mug', 'teacher gift mug'] },
  tumbler:   { label: 'insulated stainless steel tumbler', shortLabel: 'tumbler',
               synonyms: ['tumbler', 'travel mug', 'water bottle', 'insulated cup'],
               themeExamples: ['floral tumbler', 'monogram tumbler', 'mama tumbler', 'gym tumbler'] },
  sticker:   { label: 'vinyl sticker', shortLabel: 'sticker',
               synonyms: ['sticker', 'decal', 'vinyl sticker', 'laptop sticker'],
               themeExamples: ['laptop sticker', 'water bottle sticker', 'cute sticker pack', 'plant sticker'] },
  candle:    { label: 'scented candle in glass jar', shortLabel: 'candle',
               synonyms: ['candle', 'scented candle', 'soy candle'],
               themeExamples: ['lavender candle', 'birthday candle gift', 'cozy fall candle', 'wedding favor candle'] },
  blanket:   { label: 'soft throw blanket', shortLabel: 'blanket',
               synonyms: ['blanket', 'throw blanket', 'fleece blanket', 'minky blanket'],
               themeExamples: ['cozy throw blanket', 'pet name blanket', 'minky baby blanket', 'photo blanket'] },
  pillow:    { label: 'throw pillow with printed cover', shortLabel: 'throw pillow',
               synonyms: ['pillow', 'pillow cover', 'cushion', 'throw pillow'],
               themeExamples: ['floral throw pillow', 'monogram pillow', 'farmhouse pillow', 'boho cushion'] },
  tshirt:    { label: 't-shirt', shortLabel: 'tshirt',
               synonyms: ['shirt', 'tshirt', 'tee', 'sweatshirt'],
               themeExamples: ['vintage star wars shirt', 'darth vader tshirt', 'retro jedi sweatshirt'] },
  hoodie:    { label: 'hoodie / crewneck sweatshirt', shortLabel: 'hoodie',
               synonyms: ['hoodie', 'sweatshirt', 'crewneck', 'pullover'],
               themeExamples: ['cozy hoodie', 'team hoodie', 'graphic hoodie', 'unisex sweatshirt'] },
  hat:       { label: 'hat or cap', shortLabel: 'hat',
               synonyms: ['hat', 'cap', 'baseball cap', 'beanie', 'trucker hat'],
               themeExamples: ['embroidered cap', 'mama hat', 'trucker hat', 'beach hat'] },
  bag:       { label: 'bag', shortLabel: 'bag',
               synonyms: ['bag', 'tote', 'handbag', 'crossbody bag'],
               themeExamples: ['canvas bag', 'crossbody bag', 'travel bag', 'gym bag'] },
  tote:      { label: 'canvas tote bag', shortLabel: 'tote bag',
               synonyms: ['tote', 'tote bag', 'canvas tote', 'shopping bag'],
               themeExamples: ['floral tote bag', 'farmer market tote', 'aesthetic tote bag', 'beach tote'] },
  jewelry:   { label: 'handmade jewelry piece', shortLabel: 'jewelry',
               synonyms: ['necklace', 'bracelet', 'earring', 'ring', 'jewelry'],
               themeExamples: ['boho necklace', 'minimalist earrings', 'evil eye bracelet', 'birth flower ring'] },
  keychain:  { label: 'keychain', shortLabel: 'keychain',
               synonyms: ['keychain', 'keyring', 'key fob', 'charm'],
               themeExamples: ['leather keychain', 'name keychain', 'aesthetic keychain', 'car keychain'] },
  ornament:  { label: 'hanging ornament', shortLabel: 'ornament',
               synonyms: ['ornament'],
               themeExamples: ['christmas ornament', 'family name ornament', 'first christmas ornament', 'pet memorial ornament'] },
  notebook:  { label: 'notebook / journal', shortLabel: 'notebook',
               synonyms: ['notebook', 'journal', 'planner', 'notepad'],
               themeExamples: ['floral journal', 'self care planner', 'gratitude notebook', 'travel journal'] },
  poster:    { label: 'poster print', shortLabel: 'poster',
               synonyms: ['poster', 'print', 'art print'],
               themeExamples: ['minimalist poster', 'vintage movie poster', 'concert poster', 'travel poster'] },
  other:     { label: 'handmade product', shortLabel: 'product', synonyms: [], themeExamples: [] },
};

const APPAREL_TYPES = new Set(['tshirt', 'hoodie', 'hat']);

function getType(productType) {
  if (!productType) return null;
  return PRODUCT_TYPES[productType] || null;
}

function isApparel(productType) {
  return APPAREL_TYPES.has(productType);
}

// Build a blocklist regex of OTHER products (so wall_art keywords pass when the
// user is selling wall art, but mug/shirt/etc are still filtered out).
const APPAREL_TOKENS = ['shirt', 'shirts', 'tshirt', 'tshirts', 'tee', 'tees', 'sweatshirt', 'hoodie', 'hoodies', 'crewneck', 'crew neck', 'sweater', 'pullover'];
const ALL_PRODUCT_TOKENS = [
  ...APPAREL_TOKENS,
  'cardigan', 'fleece', 'tank top', 'vest',
  'mug', 'mugs', 'cup', 'tumbler', 'bottle',
  'sticker', 'stickers', 'decal', 'decals',
  'tote', 'tote bag', 'bag', 'backpack', 'purse',
  'poster', 'posters', 'print', 'prints', 'canvas', 'painting', 'wallart', 'wall art', 'sign', 'signs', 'plaque',
  'pillow', 'cushion', 'blanket', 'throw', 'quilt', 'towel', 'rug', 'tapestry',
  'coaster', 'placemat', 'magnet', 'ornament', 'candle', 'keychain', 'charm',
  'earring', 'necklace', 'bracelet', 'ring', 'jewelry', 'brooch',
  'notebook', 'notepad', 'journal', 'planner',
  'hat', 'cap', 'beanie',
];

function blockedProductsRegexFor(productType) {
  const t = getType(productType);
  if (!t) return null; // caller falls back to legacy regex
  const allowSet = new Set(t.synonyms.flatMap(w => [w, w.replace(/\s+/g, '')]).map(w => w.toLowerCase()));
  const blocklist = ALL_PRODUCT_TOKENS.filter(w => !allowSet.has(w.toLowerCase()) && !allowSet.has(w.toLowerCase().replace(/\s+/g, '')));
  const escaped = blocklist.map(w => w.replace(/([.+?^${}()|[\]\\])/g, '\\$1').replace(/\s+/g, '\\s?'));
  return new RegExp('\\b(' + escaped.join('|') + ')\\b', 'i');
}

module.exports = { PRODUCT_TYPES, APPAREL_TYPES, getType, isApparel, blockedProductsRegexFor, ALL_PRODUCT_TOKENS };
