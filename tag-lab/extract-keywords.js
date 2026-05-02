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

async function extractKeywords(imageBuffer, _mime, apiKey) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const prompt = `Analyze this Etsy product design image. Output two lists in JSON.

"keywords" — 7-9 short Etsy buyer search phrases (1-4 words each), mixed:
1) THEME phrases (most): every one MUST include a theme/character/franchise token. Use ONLY shirt/tee/tshirt/sweatshirt as product type (NEVER hoodie, crewneck, jumper, pullover, sweater). Vary sub-themes. e.g. "darth vader shirt", "star wars sweatshirt", "jedi tshirt", "stormtrooper tee".
2) THEME + recipient/occasion: 1-2 phrases tying theme to buyer intent. e.g. "star wars gift him", "vader fan gift".
3) PURE INTENT (1-2 only): "gift for her", "birthday gift him", "anniversary gift". NEVER pure product-only ("graphic tee", "cotton shirt").

"theme_words" — 25-40 single lowercase words covering EVERYTHING theme-related in the image AND common related synonyms an Etsy buyer might use. Include: main franchise/series tokens, character names, sub-themes, era/style descriptors, iconography, related concepts, aesthetic/style adjectives commonly paired with this theme, plant/animal/object names if part of the design, and morphological variants (singular and plural where natural).
For Star Wars Darth Vader: ["star","wars","darth","vader","sith","jedi","lightsaber","empire","stormtrooper","yoda","luke","leia","han","skywalker","force","scifi","rebel","galactic","fantasy","movie","film","cinema","villain","saga","trilogy","geek","nerd","cosplay"].
For a botanical/floral design: ["flower","flowers","floral","botanical","botanic","garden","plant","plants","houseplant","leaf","leaves","foliage","bloom","blossom","petal","wildflower","rose","daisy","sunflower","nature","cottage","cottagecore","boho","bohemian","earthy","greenhouse","gardener","greenery","vintage","pressed"].
Do NOT include shirt/tee/tshirt/sweatshirt or pure intent words (gift, mom, etc). Do NOT include unrelated occasions (halloween, christmas) unless the design clearly shows them.

Most important first. JSON only: {"keywords":["..."],"theme_words":["..."]}`;

  const { data, mime } = await compactImage(imageBuffer);

  const body = {
    max_tokens: 200,
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
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Gemini yaniti JSON degil: ' + raw.slice(0, 200));
    parsed = JSON.parse(m[0]);
  }
  const list = Array.isArray(parsed.keywords) ? parsed.keywords : [];
  const themeRaw = Array.isArray(parsed.theme_words) ? parsed.theme_words : [];
  const keywords = list.map(k => String(k).trim()).filter(Boolean).slice(0, 9);
  const themeWords = themeRaw.map(k => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 40);
  return { keywords, themeWords };
}

module.exports = { extractKeywords };
