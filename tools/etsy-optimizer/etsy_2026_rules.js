const TITLE_BLOCKLIST = ['perfect gift', 'free shipping', 'on sale', 'gift for her', 'gift for him', 'best gift'];

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function optimizeTitle2026(title) {
  let out = cleanText(title).replace(/[|]/g, ',').replace(/\s+-\s+/g, ', ');
  for (const phrase of TITLE_BLOCKLIST) {
    out = out.replace(new RegExp(`\\b${phrase}\\b`, 'ig'), '');
  }
  out = out.replace(/\s*,\s*,+/g, ', ').replace(/^\s*,\s*|\s*,\s*$/g, '').replace(/\s+/g, ' ').trim();
  const words = out.split(/\s+/).filter(Boolean);
  if (words.length > 15) out = words.slice(0, 15).join(' ');
  if (out.length > 110) {
    const cut = out.slice(0, 110);
    const comma = cut.lastIndexOf(',');
    out = (comma > 35 ? cut.slice(0, comma) : cut).trim();
  }
  return out || cleanText(title);
}

function fallbackTagsFor(title = '') {
  const t = title.toLowerCase();
  if (/\b(tshirt|t-shirt|tee|shirt|hoodie|sweatshirt)\b/.test(t)) {
    return ['graphic tee', 'custom shirt', 'unisex tee', 'shirt gift', 'retro tee', 'funny shirt', 'trendy shirt', 'casual tee', 'tee gift', 'apparel gift', 'made to order', 'personalized tee', 'comfort shirt'];
  }
  return ['personalized gift', 'handmade gift', 'custom gift', 'gift idea', 'birthday gift', 'made to order', 'small business', 'home decor gift', 'unique style', 'etsy gift', 'custom decor', 'modern gift', 'quality gift'];
}

function optimizeTags2026(tags, title = '') {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const tag = normalizeTag(raw);
    if (!tag || tag.length < 3 || tag.length > 20 || seen.has(tag)) return;
    seen.add(tag);
    out.push(tag);
  };
  (tags || []).forEach(push);
  fallbackTagsFor(title).forEach(tag => {
    if (out.length < 13) push(tag);
  });
  return out.slice(0, 13);
}

module.exports = { optimizeTitle2026, optimizeTags2026 };
