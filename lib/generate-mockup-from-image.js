const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const DEFAULT_PROMPT = `Transform this raw product photo into a professional Etsy-style product mockup.
- Clean, well-lit studio scene with natural styling
- Soft, warm lighting and subtle shadows
- Neutral or aesthetic background appropriate for the product (wood, linen, marble, plants, etc.)
- Keep the product's actual shape, color, and proportions exactly as in the source - only enhance presentation
- High resolution, sharp focus on the product
- Composition that feels handmade and lifestyle-oriented (Etsy aesthetic)
- No text, watermarks, or logos
Output only the final mockup image.`;

function buildPromptWithTheme(basePrompt, themeWords) {
  const list = (themeWords || []).filter(Boolean).slice(0, 12);
  if (!list.length) return basePrompt;
  return basePrompt + `\n\nAESTHETIC / VIBE (match the product's theme): ${list.join(', ')}.\nUse props, colors, and background that reinforce this theme without obscuring the product.`;
}

async function generateMockupFromImage(refImagePath, sku, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const abs = path.resolve(refImagePath);
  if (!fs.existsSync(abs)) throw new Error(`Reference image not found: ${abs}`);

  const data = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  const variantCount = Math.max(1, Math.min(opts.count || 1, 6));
  const outputs = [];
  const basePrompt = opts.prompt || DEFAULT_PROMPT;
  const promptWithTheme = buildPromptWithTheme(basePrompt, opts.themeWords);

  for (let i = 0; i < variantCount; i++) {
    const prompt = promptWithTheme;
    const variantHint = variantCount > 1
      ? `\nVariant ${i + 1} of ${variantCount}: use a different background style and angle than other variants.`
      : '';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Etsy Product Creator',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mime};base64,${data.toString('base64')}` } },
              { type: 'text', text: prompt + variantHint },
            ],
          },
        ],
        response_modalities: ['IMAGE', 'TEXT'],
      }),
    });

    if (!response.ok) throw new Error(await response.text());

    const json = await response.json();
    const message = json.choices?.[0]?.message;
    if (!message) throw new Error('No response from Gemini');

    const imageParts = [];
    if (Array.isArray(message.content)) imageParts.push(...message.content.filter(p => p.type === 'image_url'));
    if (Array.isArray(message.images)) imageParts.push(...message.images.filter(p => p.type === 'image_url'));

    let saved = null;
    for (const part of imageParts) {
      const url = part.image_url?.url;
      if (!url) continue;
      let buf;
      if (url.startsWith('data:')) buf = Buffer.from(url.split(',')[1], 'base64');
      else buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const outPath = path.join(OUTPUT_DIR, `${sku}_mockup_${i + 1}.png`);
      fs.writeFileSync(outPath, buf);
      saved = outPath;
      break;
    }
    if (!saved) throw new Error(`Variant ${i + 1}: no image returned. Response: ${JSON.stringify(message).slice(0, 200)}`);
    outputs.push(saved);
    console.log(`  Mockup ${i + 1}/${variantCount} saved: ${path.basename(saved)}`);
  }

  return outputs;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const refIdx = args.indexOf('--ref');
  const skuIdx = args.indexOf('--sku');
  const countIdx = args.indexOf('--count');
  if (refIdx === -1) {
    console.error('Usage: node generate-mockup-from-image.js --ref <image> [--sku <sku>] [--count N]');
    process.exit(1);
  }
  generateMockupFromImage(
    args[refIdx + 1],
    skuIdx !== -1 ? args[skuIdx + 1] : 'test',
    { count: countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 1 },
  ).catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { generateMockupFromImage };
