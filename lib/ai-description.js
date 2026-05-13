// AI-generated Etsy description for the product-mockup pipeline.
// Keeps the t-shirt-specific `generateDescription` in lib/optimize.js untouched.

const PRODUCT_TYPE_LABELS = {
  wall_art: 'wall art print',
  mug: 'ceramic mug',
  tumbler: 'insulated tumbler',
  sticker: 'vinyl sticker',
  candle: 'scented candle',
  blanket: 'throw blanket',
  pillow: 'throw pillow / cushion cover',
  tshirt: 't-shirt',
  hoodie: 'hoodie / sweatshirt',
  hat: 'hat / cap',
  bag: 'bag',
  tote: 'tote bag',
  jewelry: 'handmade jewelry piece',
  keychain: 'keychain',
  ornament: 'ornament',
  notebook: 'notebook / journal',
  poster: 'poster print',
  other: 'handmade product',
};

function labelFor(productType) {
  if (!productType) return 'handmade product';
  return PRODUCT_TYPE_LABELS[productType] || productType;
}

async function generateAiDescription({ productType, productDetail, title, tags, apiKey }) {
  const key = apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set');

  const typeLabel = labelFor(productType);
  const detail = (productDetail || '').trim();
  const detailBlock = detail ? `\nExtra product detail from seller: ${detail}` : '';
  const tagsText = (tags || []).slice(0, 13).join(', ');

  const prompt = `Write an Etsy listing description for this product. Output the body text only — no headings, no bullets, no emojis, no markdown.

Product type: ${typeLabel}${detailBlock}
Title: ${title || ''}
Tags: ${tagsText}

Write 4 short paragraphs in this order:
1. Engaging hook (2-3 sentences) that sounds specifically like a ${typeLabel} — not a generic product. Avoid "the perfect addition" / "elevate your space" cliches.
2. Key features and materials appropriate to the product type. For wall art mention paper / print quality / unframed; for mugs mention oz / ceramic / dishwasher microwave safe; for candles mention wax type, scent notes, burn hours; for tumblers mention insulation, lid, oz; for stickers mention vinyl, weatherproof, sizes; for apparel mention fabric, fit; etc. Pick whatever fits this product naturally.
3. Use case or gift idea — who buys this and when.
4. Care or sizing or display tips appropriate to the product type.

Tone: warm, conversational, confident, no fluff. ~160-220 words total. Do NOT mention shirts, sweatshirts, tees, hoodies, or apparel unless the product type IS apparel. Do NOT mention shipping or returns — those go in a separate block.`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-maverick',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error('AI description HTTP ' + res.status);
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content || '';
  if (Array.isArray(content)) content = content.filter(p => p.type === 'text').map(p => p.text).join('');
  return (content || '').trim();
}

// Generic shipping / closing block for non-apparel products.
function appendCommonFooter(intro, title) {
  const SHIPPING = `\n\nSHIPPING & HANDLING\nOrders ship within 1-3 business days with tracking. Address changes must be requested before the item ships.`;
  const QUESTIONS = `\n\nQUESTIONS?\nMessage us any time — we love helping you pick the right option.`;
  const closingOptions = [
    `Add it to your favorites so you don't lose it — and check out the rest of our shop for more.`,
    `Save it to your favorites and come back when you're ready. We'll be here.`,
    `Grab yours before it's gone — and feel free to browse the rest of our shop for more.`,
  ];
  let hash = 0;
  const s = title || '';
  for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash |= 0; }
  const closing = closingOptions[Math.abs(hash) % closingOptions.length];
  return (intro || '').trim() + SHIPPING + QUESTIONS + '\n\n' + closing;
}

module.exports = { generateAiDescription, appendCommonFooter, labelFor, PRODUCT_TYPE_LABELS };
