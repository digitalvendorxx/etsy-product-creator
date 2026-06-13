const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { fetchWithRetry } = require('./fetch-retry');

const DESIGNS_DIR = path.join(__dirname, '..', 'designs');

async function generateDesign(refImagePath, sku, prompt, overrideApiKey) {
  const apiKey = overrideApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    throw new Error('API key not set');
  }

  // Read reference image as base64
  const refAbsPath = path.resolve(refImagePath);
  if (!fs.existsSync(refAbsPath)) {
    throw new Error(`Reference image not found: ${refAbsPath}`);
  }
  const imageData = fs.readFileSync(refAbsPath);
  const base64Image = imageData.toString('base64');
  const ext = path.extname(refAbsPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  const defaultPrompt = 'Generate a very similar design to this reference image. Keep the same style, colors, and composition but make it unique enough to be a new product. Output only the design image.';

  console.log(`  Generating design for SKU: ${sku}...`);

  const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
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
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
            {
              type: 'text',
              text: prompt || defaultPrompt,
            },
          ],
        },
      ],
      // Gemini image generation config
      response_modalities: ['IMAGE', 'TEXT'],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(errBody);
  }

  const data = await response.json();
  console.log('  [DEBUG] Full response:', JSON.stringify(data, null, 2).slice(0, 2000));

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No choices returned from OpenRouter');
  }

  const message = data.choices[0].message;

  // Collect image parts from both message.content and message.images
  const imageParts = [];
  if (Array.isArray(message.content)) {
    imageParts.push(...message.content.filter(p => p.type === 'image_url'));
  }
  if (Array.isArray(message.images)) {
    imageParts.push(...message.images.filter(p => p.type === 'image_url'));
  }

  for (const part of imageParts) {
    if (part.image_url?.url) {
      const url = part.image_url.url;
      let imgBuffer;
      if (url.startsWith('data:')) {
        const b64 = url.split(',')[1];
        imgBuffer = Buffer.from(b64, 'base64');
      } else {
        const imgResp = await fetch(url);
        imgBuffer = Buffer.from(await imgResp.arrayBuffer());
      }
      const outputPath = path.join(DESIGNS_DIR, `${sku}_design.png`);
      fs.writeFileSync(outputPath, imgBuffer);
      console.log(`  Design saved: ${outputPath}`);
      return outputPath;
    }
  }

  throw new Error('No image found in response. Response: ' +
    JSON.stringify(message).slice(0, 300));
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const refIdx = args.indexOf('--ref');
  const skuIdx = args.indexOf('--sku');
  const promptIdx = args.indexOf('--prompt');

  if (refIdx === -1) {
    console.error('Usage: node generate-design.js --ref <image> [--sku <sku>] [--prompt <text>]');
    process.exit(1);
  }

  const ref = args[refIdx + 1];
  const sku = skuIdx !== -1 ? args[skuIdx + 1] : 'test';
  const prompt = promptIdx !== -1 ? args[promptIdx + 1] : undefined;

  fs.mkdirSync(DESIGNS_DIR, { recursive: true });
  generateDesign(ref, sku, prompt).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { generateDesign };
