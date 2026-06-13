const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { fetchWithRetry } = require('./fetch-retry');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'puzzle-catalog.json');
const ALTS_DIR = path.join(__dirname, '..', 'designs', 'alts');
const DESIGNS_DIR = path.join(__dirname, '..', 'designs');

const ART_STYLES = [
  {
    id: 'cartoon',
    label: 'Bold Cartoon',
    prompt: 'Bold flat cartoon illustration, thick black outlines, vibrant saturated primary colors, playful chunky shapes, modern children\'s book style',
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    prompt: 'Soft watercolor illustration, gentle pastel washes, subtle paint bleeds, hand-painted feel, organic edges, dreamy nursery aesthetic',
  },
  {
    id: 'minimal',
    label: 'Minimal Scandi',
    prompt: 'Minimalist scandinavian style, clean geometric shapes, muted earth tones (sage, terracotta, cream), simple line accents, modern boho nursery',
  },
  {
    id: 'storybook',
    label: 'Vintage Storybook',
    prompt: 'Vintage 1950s storybook illustration, textured paper feel, warm muted retro palette, gentle cross-hatch shading, classic folk-art charm',
  },
];

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function findTheme(themeId) {
  const theme = loadCatalog().find(t => t.id === themeId);
  if (!theme) throw new Error(`Theme not found: ${themeId}`);
  return theme;
}

function buildPrompt(theme, style, childName) {
  const name = (childName || 'NAME').toUpperCase().slice(0, 10);
  const pieceCount = theme.pieces.length;
  const pieceList = theme.pieces.map(p => `${p.emoji} ${p.name}`).join(', ');
  const paletteHint = theme.palette?.length ? ` Color palette accents: ${theme.palette.join(', ')}.` : '';

  return [
    `Top-down product photograph of a single handcrafted wooden baby name puzzle board (one solid rectangular birch plywood plaque) for an Etsy listing.`,
    `Theme: ${theme.name}.`,
    `Layout — strict three-band sandwich: ONE horizontal wooden board fills the image, organized as THREE stacked horizontal bands. Top band: ${Math.ceil(pieceCount / 2)} pieces in a single straight row, evenly spaced. Middle band: the child's name "${name}" in large laser-cut capital letters using a BOLD CHUNKY ROUNDED SANS-SERIF typeface — specifically the Mali Bold / Baloo Bhai Bold style: very thick uniform strokes, fully rounded terminals and joins, soft pillow-like glyphs, generous internal counters, no serifs, no italics, no thin lines, no slab corners. Letters should look like solid wood pieces, not thin handwriting. Each letter sits in its own precisely-cut slot, centered and evenly spaced. EACH LETTER IS PAINTED IN A DIFFERENT THEME COLOR (rotate through the theme palette so adjacent letters never share the same color, like classic Etsy busy-puzzle name boards). Bottom band: ${Math.floor(pieceCount / 2)} pieces in a single straight row, evenly spaced. Top and bottom rows are mirror-aligned (same column positions, same piece scale, same gaps). Every piece and letter is fitted into its own laser-cut slot in the SAME single wooden board.`,
    `Piece roster — EACH piece appears EXACTLY ONCE; no duplicates, no repeats, no extras: ${pieceList}. Top row uses the first ${Math.ceil(pieceCount / 2)} from this list left-to-right; bottom row uses the remaining ${Math.floor(pieceCount / 2)} left-to-right.`,
    `Materials: light natural birch plywood base with visible wood grain; pieces AND name letters painted in flat solid colors drawn from the theme palette, with crisp edges.${paletteHint}`,
    `Illustration style for the painted pieces: ${style.prompt}.`,
    `Photography: clean white seamless backdrop, soft even product lighting, gentle drop shadow under the board, top-down 1:1 square framing. No props, no hands, no extra objects.`,
    `Strict no-go: do NOT repeat any piece (each of the ${pieceCount} pieces appears exactly once), do NOT scatter pieces, do NOT use more than two piece rows, do NOT put pieces on the left/right sides of the name, do NOT stack both rows above the name (they must sandwich it: one row above, one row below), do NOT omit the wooden board, do NOT paint every letter the same color (letters MUST be multi-colored from the theme palette), do NOT add any text/captions/watermarks/logos beyond the child's name. The top and bottom rows must be balanced, symmetric, and the SAME total count if pieceCount is even.`,
  ].join(' ');
}

async function generateOne(theme, style, childName, sku, apiKey) {
  const prompt = buildPrompt(theme, style, childName);
  const referer = 'http://localhost:3000';

  const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': referer,
      'X-Title': 'Etsy Product Creator - Puzzle Draft',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ],
      response_modalities: ['IMAGE', 'TEXT'],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();
  if (!data.choices?.length) throw new Error('No choices returned');
  const message = data.choices[0].message;

  const imageParts = [];
  if (Array.isArray(message.content)) imageParts.push(...message.content.filter(p => p.type === 'image_url'));
  if (Array.isArray(message.images)) imageParts.push(...message.images.filter(p => p.type === 'image_url'));

  for (const part of imageParts) {
    const url = part.image_url?.url;
    if (!url) continue;
    let imgBuffer;
    if (url.startsWith('data:')) {
      imgBuffer = Buffer.from(url.split(',')[1], 'base64');
    } else {
      const r = await fetch(url);
      imgBuffer = Buffer.from(await r.arrayBuffer());
    }
    const targetDir = path.join(ALTS_DIR, sku);
    fs.mkdirSync(targetDir, { recursive: true });
    const outPath = path.join(targetDir, `${style.id}.png`);
    fs.writeFileSync(outPath, imgBuffer);
    return outPath;
  }

  throw new Error('No image in response');
}

async function generateAlternatives(themeId, childName, sku, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') throw new Error('OPENROUTER_API_KEY not set');

  const theme = findTheme(themeId);
  fs.mkdirSync(ALTS_DIR, { recursive: true });

  const results = await Promise.all(
    ART_STYLES.map(async style => {
      try {
        const file = await generateOne(theme, style, childName, sku, apiKey);
        return { styleId: style.id, label: style.label, file, error: null };
      } catch (err) {
        return { styleId: style.id, label: style.label, file: null, error: err.message };
      }
    })
  );

  return { theme, childName: (childName || '').toUpperCase(), alternatives: results };
}

function selectAlternative(themeId, sku, styleId) {
  const src = path.join(ALTS_DIR, sku, `${styleId}.png`);
  if (!fs.existsSync(src)) throw new Error(`Alternative not found: ${src}`);
  fs.mkdirSync(DESIGNS_DIR, { recursive: true });
  const dest = path.join(DESIGNS_DIR, `${sku}_design.png`);
  fs.copyFileSync(src, dest);
  return { themeId, sku, styleId, path: dest, url: `/designs/${sku}_design.png` };
}

module.exports = {
  loadCatalog,
  findTheme,
  ART_STYLES,
  generateAlternatives,
  selectAlternative,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const themeIdx = args.indexOf('--theme');
  const nameIdx = args.indexOf('--name');
  const skuIdx = args.indexOf('--sku');
  if (themeIdx === -1) {
    console.error('Usage: node lib/puzzle-generator.js --theme <id> [--name <child>] [--sku <sku>]');
    process.exit(1);
  }
  const themeId = args[themeIdx + 1];
  const childName = nameIdx !== -1 ? args[nameIdx + 1] : 'LIAM';
  const sku = skuIdx !== -1 ? args[skuIdx + 1] : `draft-${Date.now()}`;
  generateAlternatives(themeId, childName, sku)
    .then(out => {
      console.log(JSON.stringify({ sku, theme: out.theme.name, alternatives: out.alternatives }, null, 2));
    })
    .catch(err => { console.error(err.message); process.exit(1); });
}
