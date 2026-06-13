const sharp = require('sharp');

const MODEL = process.env.TAG_LAB_MODEL || 'google/gemini-2.0-flash-001';
const MAX_DIM = 768;

async function compactImage(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    const needsResize = (meta.width || 0) > MAX_DIM || (meta.height || 0) > MAX_DIM;
    const out = sharp(buffer)
      .rotate()
      [needsResize ? 'resize' : 'toFormat'](needsResize ? { width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true } : 'jpeg')
      .jpeg({ quality: 75, mozjpeg: true });
    const data = await out.toBuffer();
    return { data, mime: 'image/jpeg' };
  } catch {
    return { data: buffer, mime: 'image/jpeg' };
  }
}

const FALLBACK_MODELS = (process.env.TAG_LAB_FALLBACK_MODELS || 'google/gemini-2.5-flash,google/gemini-flash-1.5')
  .split(',').map(s => s.trim()).filter(Boolean);
const REQUEST_TIMEOUT_MS = parseInt(process.env.TAG_LAB_TIMEOUT_MS || '60000', 10);

async function callOpenRouter(model, body, apiKey) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3002',
        'X-Title': 'Etsy Tag Lab',
      },
      body: JSON.stringify({ ...body, model }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Robust parser: handles strict JSON, JSON wrapped in code fences, and Gemini
// truncations where one or both arrays are cut off mid-string. Salvages whatever
// quoted items can be recovered for "keywords" / "theme_words".
function lenientParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const block = raw.match(/\{[\s\S]*\}/);
  if (block) { try { return JSON.parse(block[0]); } catch {} }
  // Salvage individual arrays — match the array opening, then collect every
  // fully-closed quoted string until either ']' is seen or the response ends.
  const salvageArray = (key) => {
    const re = new RegExp('"' + key + '"\\s*:\\s*\\[', 'i');
    const m = re.exec(raw);
    if (!m) return null;
    const tail = raw.slice(m.index + m[0].length);
    const items = [];
    const strRe = /"((?:[^"\\]|\\.)*)"/g;
    let s;
    while ((s = strRe.exec(tail)) !== null) {
      // Stop if a closing bracket appears before this match
      const between = tail.slice(strRe.lastIndex - s[0].length - 0);
      if (/^\s*\]/.test(tail.slice(strRe.lastIndex))) {
        items.push(s[1]);
        break;
      }
      items.push(s[1]);
    }
    return items.length ? items : null;
  };
  const keywords = salvageArray('keywords');
  const themeWords = salvageArray('theme_words');
  if (keywords || themeWords) {
    return { keywords: keywords || [], theme_words: themeWords || [] };
  }
  return null;
}

async function extractKeywords(imageBuffer, _mime, apiKey, opts = {}) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const productContext = String(opts.productContext || '').trim();
  let prompt = productContext ? `Analyze this Etsy product image using this REQUIRED product context: ${productContext}
The context overrides ambiguous visual guesses. Do not classify it as a baby puzzle, toy, apparel, or another product.

Output two lists in JSON.

"keywords" — 7-9 short Etsy buyer search phrases (2-4 words each) for this exact product. Mix product phrases, material/style phrases, personalization intent, recipient, and gifting occasions. Each must be a realistic EtsyHunt search phrase and stay closely relevant to the required product context.

"theme_words" — 25-40 lowercase words covering the exact product type, visible design/features, material, color, craftsmanship, personalization, style, recipients, use cases, and gifting occasions.

Do not include unrelated product categories. Most important first.
JSON only: {"keywords":["..."],"theme_words":["..."]}` : `Analyze this Etsy product design image. The product is a PERSONALIZED WOODEN BABY NAME PUZZLE (Montessori toy, busy puzzle, name board for toddlers). Output two lists in JSON.

"keywords" — 7-9 short Etsy buyer search phrases (2-4 words each), mixed:
1) PUZZLE + theme (most): every phrase MUST end with one of: "name puzzle", "baby puzzle", "wooden puzzle", "montessori puzzle", "puzzle". Combine with the theme of the design (animals/space/farm/dinosaur/unicorn/etc.). e.g. "farm animal name puzzle", "wooden dinosaur puzzle", "space montessori puzzle", "unicorn baby puzzle".
2) PUZZLE + occasion: 1-2 phrases tying the product to buyer intent. e.g. "first birthday puzzle gift", "baby shower wooden puzzle", "personalized newborn puzzle".
3) PURE INTENT (1-2 only): "personalized baby gift", "wooden baby gift", "montessori baby toy", "first birthday gift". NEVER include shirts/tees/hoodies/mugs/posters.

"theme_words" — 25-40 single lowercase words covering EVERYTHING relevant to a wooden baby name puzzle in this style. Include: the design theme (animals, space, farm, ocean, dinosaur, fruit, etc.), individual piece nouns visible in the image, baby/toddler vocabulary, Montessori/sensory/educational keywords, wood/material descriptors, gifting occasions (baby shower, newborn, first birthday, christening, baptism, godchild), and aesthetic/style words (handmade, personalized, custom, name, letters, alphabet, learning).
Universal puzzle seeds to always include if relevant: ["puzzle","baby","wooden","wood","handmade","personalized","custom","name","letters","alphabet","montessori","toddler","newborn","nursery","educational","sensory","learning","play","fine","motor","gift","keepsake","heirloom","birthday","shower","baptism","christening"].
Then ADD the specific theme nouns shown in the image (e.g. for farm: ["farm","barn","animal","cow","horse","sheep","pig","duck","rooster","chicken","goat","hen","tractor","barnyard"]; for space: ["space","astronaut","rocket","moon","star","planet","galaxy","saturn","earth","ufo","comet","cosmos"]).
Do NOT include shirt/tee/tshirt/hoodie/sweatshirt/mug/poster/print/decal/sticker/wallart or pure intent-only words (gift, mom, dad alone). Do NOT include unrelated occasions (halloween, christmas) unless the design clearly shows them.

Most important first. JSON only: {"keywords":["..."],"theme_words":["..."]}`;

  prompt = productContext ? `Analyze this Etsy product image using this REQUIRED product context: ${productContext}
The context overrides ambiguous visual guesses. Do not classify it as a baby puzzle, toy, apparel, or another product unless the context says so.

Output two lists in JSON.

"keywords" - 7-9 short Etsy buyer search phrases (2-4 words each) for this exact product. Follow the 13 June 2026 Etsy algorithm rule: exact product phrase first, buyer intent variety, no keyword stuffing, no duplicate intent. Mix product phrases, material/style phrases, personalization intent when relevant, recipient/use case, and gifting occasions. Each must be a realistic EtsyHunt search phrase and stay closely relevant to the required product context.

"theme_words" - 25-40 lowercase words covering the exact product type, visible design/features, material, color, craftsmanship, personalization, style, recipients, use cases, and gifting occasions.

Do not include unrelated product categories. Most important first.
JSON only: {"keywords":["..."],"theme_words":["..."]}` : `Analyze this Etsy product image. Identify the exact product from the image; do not assume it is a baby puzzle, shirt, mug, poster, or any other category unless it is visibly that item. Output two lists in JSON.

"keywords" - 7-9 short Etsy buyer search phrases (2-4 words each) for the exact product shown. Follow the 13 June 2026 Etsy algorithm rule: exact product phrase first, buyer intent variety, no keyword stuffing, no duplicate intent. Mix product phrases, material/style phrases, personalization or custom intent if visible/relevant, recipient/use case, and gifting occasions. Each phrase must be realistic for EtsyHunt and closely relevant.

"theme_words" - 25-40 lowercase words covering the exact product type, visible features, material, color, craftsmanship, personalization if relevant, style, recipients, use cases, and gifting occasions.

Do not include unrelated product categories. Do not invent baby puzzle, apparel, mug, poster, print, decal, sticker, or wall art terms unless the image clearly shows that product.

Most important first. JSON only: {"keywords":["..."],"theme_words":["..."]}`;

  const { data, mime } = await compactImage(imageBuffer);

  const body = {
    max_tokens: 700,
    temperature: 0.2,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + data.toString('base64') } },
        { type: 'text', text: prompt },
      ],
    }],
  };

  const models = [MODEL, ...FALLBACK_MODELS.filter(m => m !== MODEL)];
  let json = null;
  let lastErr = null;
  outer: for (const model of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      let r;
      try {
        r = await callOpenRouter(model, body, apiKey);
      } catch (e) {
        lastErr = new Error(model + ' istek hatasi (timeout/network): ' + e.message);
        if (attempt < 3) { await sleep(1000 * attempt); continue; }
        break;
      }
      if (r.ok) { json = await r.json(); lastErr = null; break outer; }
      const txt = (await r.text()).slice(0, 300);
      lastErr = new Error('OpenRouter HTTP ' + r.status + ' (' + model + '): ' + txt);
      if (![500, 502, 503, 504, 408, 429].includes(r.status)) break;
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  if (!json) throw lastErr || new Error('Gemini cagrisi basarisiz');
  let raw = json.choices?.[0]?.message?.content || '';
  if (Array.isArray(raw)) raw = raw.filter(p => p.type === 'text').map(p => p.text).join('');
  raw = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = lenientParse(raw);
  if (!parsed) throw new Error('Gemini yaniti JSON degil: ' + raw.slice(0, 200));
  const list = Array.isArray(parsed.keywords) ? parsed.keywords : [];
  const themeRaw = Array.isArray(parsed.theme_words) ? parsed.theme_words : [];
  const keywords = list.map(k => String(k).trim()).filter(Boolean).slice(0, 9);
  const themeWords = themeRaw.map(k => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 40);
  return { keywords, themeWords };
}

module.exports = { extractKeywords };
