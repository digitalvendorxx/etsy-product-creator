// Detect t-shirt print area on mockup templates using AI vision
// Run once: node lib/detect-positions.js
// Saves positions to mockup-positions.json

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { fetchWithRetry } = require('./fetch-retry');

const MOCKUPS_DIR = path.join(__dirname, '..', 'mockups');
const POSITIONS_FILE = path.join(__dirname, '..', 'mockup-positions.json');

async function detectPosition(templatePath, apiKey) {
  const data = fs.readFileSync(templatePath);
  const ext = path.extname(templatePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const base64 = data.toString('base64');

  const sharp = require('sharp');
  const meta = await sharp(templatePath).metadata();

  const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-001',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          { type: 'text', text: `This is a t-shirt mockup template image (${meta.width}x${meta.height} pixels).

Identify the EXACT rectangular area on the t-shirt chest where a design/graphic should be printed. This is the flat printable area on the front of the shirt.

Return ONLY a JSON object with pixel coordinates:
{
  "x": <left edge of print area>,
  "y": <top edge of print area>,
  "w": <width of print area>,
  "h": <height of print area>,
  "type": "model" or "flatlay"
}

Rules:
- The print area should be the chest/torso area of the t-shirt
- For model photos: center of chest, below collar, above belly
- For flat-lay photos: center of the shirt front
- Keep it proportional - typically 25-35% of image width
- Return ONLY valid JSON, nothing else` },
        ],
      }],
    }),
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response: ' + content.substring(0, 100));

  return JSON.parse(match[0]);
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

  // Load existing positions
  let positions = {};
  try { positions = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch {}

  const files = fs.readdirSync(MOCKUPS_DIR)
    .filter(f => /\.(png|jpe?g|webp)$/i.test(f));

  console.log(`Found ${files.length} templates, ${Object.keys(positions).length} already have positions`);

  let processed = 0;
  let errors = 0;

  for (const file of files) {
    if (positions[file]) {
      console.log(`  [skip] ${file} - already has position`);
      continue;
    }

    const templatePath = path.join(MOCKUPS_DIR, file);
    try {
      console.log(`  [detect] ${file}...`);
      const pos = await detectPosition(templatePath, apiKey);
      positions[file] = pos;
      processed++;
      console.log(`  [ok] ${file}: x=${pos.x} y=${pos.y} w=${pos.w} h=${pos.h} type=${pos.type}`);

      // Save after each detection
      fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
    } catch (err) {
      console.warn(`  [err] ${file}: ${err.message}`);
      errors++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nDone: ${processed} detected, ${errors} errors, ${Object.keys(positions).length} total`);
}

main().catch(console.error);
