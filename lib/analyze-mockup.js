const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getType } = require('./product-types');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MAX_BASE64_BYTES = 20 * 1024 * 1024; // ~27MB once base64-encoded; safe under Gemini's 30MB limit
const MAX_DIMENSION = 2048;

// Try strict JSON.parse first; if it fails, repair common Gemini issues:
//   - stray backslashes followed by non-escape chars
//   - raw newlines inside string values
function parseLenientJson(raw) {
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let p = tryParse(raw);
  if (p) return p;
  // extract first {...} block
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let block = m[0];
  p = tryParse(block);
  if (p) return p;
  // escape stray backslashes (\X where X is not a valid JSON escape)
  block = block.replace(/\\(?!["\\\/bfnrtu])/g, '\\\\');
  p = tryParse(block);
  if (p) return p;
  // escape raw newlines that may have leaked into string values
  block = block.replace(/(?<="(?:[^"\\]|\\.)*)\n/g, '\\n').replace(/\r/g, '');
  return tryParse(block);
}

async function analyzeMockup(mockupPath, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const abs = path.resolve(mockupPath);
  if (!fs.existsSync(abs)) throw new Error(`Mockup not found: ${abs}`);

  let data = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  let mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  if (data.length > MAX_BASE64_BYTES) {
    const meta = await sharp(abs).metadata();
    const needsResize = (meta.width || 0) > MAX_DIMENSION || (meta.height || 0) > MAX_DIMENSION;
    let pipeline = sharp(abs);
    if (needsResize) pipeline = pipeline.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
    data = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    mime = 'image/jpeg';
    let q = 85;
    while (data.length > MAX_BASE64_BYTES && q > 50) {
      q -= 10;
      data = await sharp(abs)
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: q, mozjpeg: true })
        .toBuffer();
    }
    if (data.length > MAX_BASE64_BYTES) throw new Error(`Mockup too large for analysis even after compression: ${data.length} bytes`);
  }

  const tagsHint = (opts.tags || []).slice(0, 10).join(', ');
  const wantTags = opts.includeTags !== false; // default true

  // Backward compatible: when no productType is provided, the original
  // tshirt-only prompt is used verbatim (single / front-back / bulk modes).
  const ptMeta = getType(opts.productType);
  const productDetail = (opts.productDetail || '').trim();

  let titleRules, descRules, tagsRules;
  if (ptMeta) {
    const synList = ptMeta.synonyms.join(', ');
    const exampleList = ptMeta.themeExamples.join(', ');
    const detailLine = productDetail ? `\n- The seller noted: "${productDetail}". Weave it in naturally where it fits.` : '';
    titleRules = `TITLE rules (under 70 characters, natural language sentence-fragment):
- The primary product phrase MUST be in the first 30-40 characters (mobile crops the rest). The product is a ${ptMeta.shortLabel} — use that word or one of its synonyms (${synList}) in the title.
- Template: [What you sell], [key feature/style], [for whom/occasion]
- Use only commas (,) — never dashes or pipes
- No single word may appear more than twice
- NEVER include "Gift for her/him/mom/dad" in the title (those go in tags)
- NEVER use shirt / tshirt / tee / sweatshirt / hoodie in the title (this is a ${ptMeta.shortLabel}, not apparel).${detailLine}`;
    descRules = `DESCRIPTION rules — INTRO HOOK ONLY (the rest of the listing body is appended automatically from a fixed template):
- Output ONLY the opening hook: 2 short paragraphs, separated by a blank line. Total 400-700 characters.
- The first 40 characters MUST contain the primary product keyword (${ptMeta.shortLabel}).
- First 160 characters are critical (Google preview + Etsy "Read more" cutoff): natural hook stating WHAT it is, WHO it suits, WHY it stands out — not "Welcome to my shop..."
- Paragraph 1 (2-3 sentences): product + audience + why special, keywords woven naturally.
- Paragraph 2 (2-3 sentences): occasion / styling / use / display scenarios — paint a picture.
- DO NOT include sections labeled "AVAILABLE STYLES", "DETAILS", "CARE", "USAGE", "SIZING", "COLORS", "HOW TO ORDER", "SHIPPING", or any CTA — those are added automatically afterwards. Only the hook.
- NEVER mention shirts / tees / sweatshirts / hoodies / apparel sizing — this is a ${ptMeta.shortLabel}.
- Plain text, no markdown, no bullet points, no headings.`;
    tagsRules = wantTags ? `
TAGS rules (exactly 13 items — Etsy fills all 13 slots or visibility drops):
- Each tag max 20 characters, lowercase, multi-word long-tail (2-4 words), NEVER single-word
- Tags COMPLEMENT the title — do NOT repeat the title's non-generic tokens verbatim
- Cover diverse buyer intents in this order of priority:
  * 4-5 theme/style phrases (sub-themes, characters, related concepts) — different tokens than title
  * 3-4 recipient/occasion intent phrases — "gift for her", "birthday gift him", "anniversary gift", "housewarming gift", "gift for mom"
  * 2-3 audience/aesthetic cues — pair them with the product type, e.g. "${ptMeta.themeExamples[0] || (ptMeta.shortLabel + ' gift')}", "boho ${ptMeta.shortLabel}", "minimalist ${ptMeta.shortLabel}"
  * 1-2 broad-but-relevant — never use just "${ptMeta.shortLabel}" alone; always pair it
- Example tags for a ${ptMeta.shortLabel}: ${exampleList}
- No emoji, no punctuation other than spaces
- Only ${ptMeta.shortLabel} context — NEVER shirt, tee, tshirt, sweatshirt, hoodie, or any other unrelated product.
` : '';
  } else {
    titleRules = `TITLE rules (under 70 characters, natural language sentence-fragment):
- The primary product phrase MUST be in the first 30-40 characters (mobile crops the rest)
- Template: [What you sell], [key feature/style], [for whom/occasion]
- Use only commas (,) — never dashes or pipes
- No single word may appear more than twice
- NEVER include "Gift for her/him/mom/dad" in the title (those go in tags)
- No "Comfort Colors"`;
    descRules = `DESCRIPTION rules — INTRO HOOK ONLY (the rest of the listing body is appended automatically from a fixed template):
- Output ONLY the opening hook: 2 short paragraphs, separated by a blank line. Total 400-700 characters.
- The first 40 characters MUST contain the primary product keyword
- First 160 characters are critical (Google preview + Etsy "Read more" cutoff): natural hook stating WHAT it is, WHO it suits, WHY it stands out — not "Welcome to my shop..."
- Paragraph 1 (2-3 sentences): product + audience + why special, keywords woven naturally
- Paragraph 2 (2-3 sentences): occasion / styling / use scenarios — paint a picture
- DO NOT include sections labeled "AVAILABLE STYLES", "DETAILS", "CARE", "USAGE", "SIZING", "COLORS", "HOW TO ORDER", "SHIPPING", or any CTA — those are added automatically afterwards. Only the hook.
- Plain text, no markdown, no bullet points, no headings.`;
    tagsRules = wantTags ? `
TAGS rules (exactly 13 items — Etsy fills all 13 slots or visibility drops):
- Each tag max 20 characters, lowercase, multi-word long-tail (2-4 words), NEVER single-word
- Tags COMPLEMENT the title — do NOT repeat the title's non-generic tokens verbatim
- Cover diverse buyer intents in this order of priority:
  * 4-5 theme/style phrases (sub-themes, character variants, related concepts) — different tokens than title
  * 3-4 recipient/occasion intent phrases — "gift for her", "birthday gift him", "anniversary gift", "movie fan gift", "gift for mom"
  * 2-3 audience/aesthetic cues — "vintage style tee", "minimalist apparel", "geek fan shirt"
  * 1-2 broad-but-relevant — never use just "shirt" or "tshirt" alone; pair them
- Example for a Star Wars Darth Vader shirt (title contains "darth vader star wars"):
  yoda fan tee, jedi sith shirt, may the 4th gift, stormtrooper tshirt, sci fi movie tee, dark side apparel, gift for him, birthday gift husband, geek movie gift, force fan shirt, anakin skywalker tee, vintage scifi tshirt, cult film fan tee
- No emoji, no punctuation other than spaces
- Only shirt/sweatshirt context — no hoodie, mug, sticker, poster, etc.
` : '';
  }

  const prompt = `You are an Etsy SEO expert writing for Etsy's 2025-2026 NLP-based search algorithm. The algorithm now evaluates whether copy "looks human-written, not bot-stuffed". Keyword stuffing gets penalized; natural language with intent diversity gets boosted.

${tagsHint ? `Reference keywords (use them naturally if relevant): ${tagsHint}\n\n` : ''}Return STRICT JSON in this exact shape, nothing else:
{
  "title": "...",
  "description": "..."${wantTags ? ',\n  "tags": ["tag1", "tag2", ...13 items]' : ''}
}

${titleRules}

${descRules}
${tagsRules}
Output ONLY the JSON.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Etsy Product Creator',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${data.toString('base64')}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(await response.text());

  const json = await response.json();
  const msg = json.choices?.[0]?.message;
  let raw = '';
  if (typeof msg?.content === 'string') raw = msg.content;
  else if (Array.isArray(msg?.content)) raw = msg.content.filter(p => p.type === 'text').map(p => p.text).join('');

  raw = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed = parseLenientJson(raw);
  if (!parsed) {
    // last resort: regex-extract fields so a bad escape doesn't lose the whole response
    const tM = raw.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const dM = raw.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const tagsBlock = raw.match(/"tags"\s*:\s*\[([\s\S]*?)\]/);
    const tagItems = tagsBlock ? Array.from(tagsBlock[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)).map(m => m[1]) : [];
    if (!tM && !dM && !tagItems.length) {
      throw new Error('Gemini analiz yaniti JSON degil: ' + raw.slice(0, 200));
    }
    parsed = {
      title: tM ? tM[1].replace(/\\(.)/g, '$1') : '',
      description: dM ? dM[1].replace(/\\n/g, '\n').replace(/\\(.)/g, '$1') : '',
      tags: tagItems.map(t => t.replace(/\\(.)/g, '$1')),
    };
  }

  let title = (parsed.title || '').replace(/\s*[–—\-|]+\s*/g, ', ').replace(/\s+/g, ' ').trim();
  if (title.length > 70) {
    const lc = title.lastIndexOf(',', 70);
    title = (lc > 20 ? title.substring(0, lc) : title.substring(0, 70)).trim();
  }
  const description = (parsed.description || '').trim();
  let tags = [];
  if (Array.isArray(parsed.tags)) {
    tags = parsed.tags
      .map(t => String(t || '').toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim())
      .filter(t => t && t.length >= 3 && t.length <= 20)
      .slice(0, 13);
  }

  return { title, description, tags };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const imgIdx = args.indexOf('--image');
  if (imgIdx === -1) {
    console.error('Usage: node analyze-mockup.js --image <path>');
    process.exit(1);
  }
  analyzeMockup(args[imgIdx + 1]).then(r => {
    console.log(JSON.stringify(r, null, 2));
  }).catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { analyzeMockup };
