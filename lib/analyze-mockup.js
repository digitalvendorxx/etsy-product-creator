const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// OpenRouter caps inline images at 30MB. Composed mockup PNGs can hit ~100MB,
// so we always re-encode to a downscaled JPEG before sending.
const MAX_IMAGE_DIM = 2048;
const JPEG_QUALITY = 85;

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

  const data = await sharp(abs)
    .rotate()
    .resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  const mime = 'image/jpeg';

  const tagsHint = (opts.tags || []).slice(0, 10).join(', ');
  const wantTags = opts.includeTags !== false; // default true
  const productContext = String(opts.productContext || '').trim();

  const prompt = productContext ? `You are an Etsy SEO expert writing copy for this REQUIRED product context: ${productContext}
The required context overrides ambiguous visual guesses. Never classify it as a baby puzzle, wooden toy, apparel, or another product.

${tagsHint ? `Reference keywords (use them naturally if relevant): ${tagsHint}\n\n` : ''}Return STRICT JSON in this exact shape, nothing else:
{
  "title": "...",
  "description": "..."${wantTags ? ',\n  "tags": ["tag1", "tag2", ...13 items]' : ''}
}

TITLE rules:
- Follow the 13 June 2026 Etsy algorithm rule: short, clear, buyer-friendly, readable, no keyword stuffing.
- Aim for under 15 words and usually 55-110 characters, maximum 140.
- Put the exact primary product phrase first.
- Naturally use the strongest relevant EtsyHunt reference keywords.
- Describe only this product, its visible style/material, personalization, and relevant buyer intent.
- Do not add "perfect gift", "free shipping", "on sale", or filler gift phrases to the title.
- Use commas only when helpful, never keyword stuffing.

DESCRIPTION rules:
- Write only a natural SEO introduction of 2 short paragraphs, approximately 350-650 characters.
- First sentence must identify the exact product and place its primary keyword in the first 40 characters.
- Mention visible style/material, ideal recipient/use, and why it is special.
- Preserve seller technical sections if they are appended later; do not replace sizing, style, order, shipping, material, care, or fulfillment details.
- Do not invent or state dimensions, capacity, materials percentages, colors, hardware, processing time, shipping time, care instructions, or other technical specifications.
- No headings or bullet points. The seller's locked technical sections will be appended unchanged afterward.
${wantTags ? `
TAGS rules:
- Exactly 13 relevant Etsy tags, each lowercase and maximum 20 characters.
- Prefer varied multi-word buyer search phrases covering product, material/style, personalization, recipient, use, and occasion.
- Avoid duplicate intent and avoid wasting tag slots on exact category/attribute/title repeats.
- Do not include unrelated products.
` : ''}
Output ONLY the JSON.` : `You are an Etsy SEO expert writing copy for the exact product shown in this Etsy listing image under Etsy's 2025-2026 NLP-based search algorithm. The algorithm rewards natural human-written copy with intent diversity and penalizes keyword stuffing.

${tagsHint ? `Reference keywords (use them naturally if relevant): ${tagsHint}\n\n` : ''}Return STRICT JSON in this exact shape, nothing else:
{"title":"...","description":"..."${wantTags ? ',"tags":["...13 items"]' : ''}}
Identify the actual product from the image and write a relevant Etsy title, natural description, and relevant tags.
Follow the 13 June 2026 Etsy algorithm rule: short readable title under 15 words when possible, primary product phrase first, no keyword stuffing, 13 varied multi-word tags, and a description whose first sentence clearly identifies the exact product.
Preserve any seller technical structure that will be appended later; never replace sizing, style, order, shipping, material, care, or fulfillment sections.
Do not assume it is a baby puzzle, apparel, mug, poster, or any other category unless the product is visibly that item. Output ONLY JSON.`;

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
  if (title.length > 140) {
    const lc = title.lastIndexOf(',', 140);
    title = (lc > 20 ? title.substring(0, lc) : title.substring(0, 140)).trim();
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
