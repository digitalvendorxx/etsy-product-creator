// Lifestyle mockup generator. Ported from etsy-unalta-metal with niche/providers
// stripped (we use direct OpenRouter calls).
// Strategy:
//   1. Vision-describe the product (for "rotate-angles" mode) so each generated
//      mockup can recreate the SAME product from a different camera angle without
//      pixel-locking to the source.
//   2. For each variant, pick a unique camera ANGLE + SCENE combo so the set is
//      visually diverse (Etsy's 20-photo slot fills cleanly).
//   3. bg-replace mode is the alternative: keep product pixels, only swap background.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const IMAGE_MODEL = 'google/gemini-2.5-flash-image';
const VISION_MODEL = 'google/gemini-2.5-flash';

const OR_HEADERS = (apiKey) => ({
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'http://localhost:3000',
  'X-Title': 'Etsy Lifestyle Mockup',
});

const SCENE_POOLS = {
  baby_puzzle: [
    'soft pastel nursery rug with the wooden baby puzzle laid open, plush teddy bear and folded muslin blanket nearby, warm morning sunlight, montessori aesthetic',
    'minimalist scandinavian nursery floor with the baby puzzle as the hero, light oak shelf with wooden toys in the background, soft diffused daylight',
    'beige boucle play mat with the puzzle pieces partially assembled, a wooden rattle and a knit elephant toy beside it, golden afternoon light',
    'natural light playroom with the puzzle on a low wooden montessori shelf, dried pampas in a vase, neutral cream walls, child-eye-level composition',
    'soft cream linen blanket on light wood floor, the baby puzzle centered with chunky wooden alphabet blocks scattered around, gentle window light',
    'organic muslin swaddle draped under the puzzle, small wooden stacking rings to one side, a board book half open, pastel nursery palette',
    'low childrens table in a sunlit nursery with the baby puzzle and a chubby toddler chair, rainbow stacker in the background bokeh, candid lifestyle',
    'sage green nursery rug with the wooden puzzle laid out, a wicker basket of soft toys, sheer curtains glowing with diffused morning light',
    'natural jute rug under the baby puzzle, a soft handmade bunny doll, eucalyptus sprig, scandinavian baby gift styling',
    'warm oak floorboards with the baby puzzle as hero, a wooden walker and felt ball garland softly out of focus, cozy lifestyle nursery',
  ],
  nursery_shelf: [
    'open montessori shelf with the baby puzzle leaning forward as the hero piece, wooden stacker and felt animals beside it, warm white wall',
    'beige nursery shelf with the puzzle propped up alongside a board book, dried bunny tail grass, soft pastel palette',
    'styled IKEA-style nursery cube with the puzzle, a wooden train, and a knit lovey, minimal scandinavian aesthetic',
    'natural pine shelf with the baby puzzle, a small ceramic name plaque (blank), and a tiny potted trailing plant, neutral nursery decor',
    'cream painted shelf with the puzzle as centerpiece, plush bear and wooden rattle staged for a baby gift photo',
  ],
  baby_gift: [
    'baby shower gift presentation: the wooden puzzle nestled in a kraft gift box with cream tissue paper, satin ribbon untied, a blank cream gift tag, dried baby breath sprig',
    'gender-neutral baby gift flat lay: the puzzle, a folded muslin swaddle, knit booties, a pacifier clip, and a small bouquet of dried wildflowers on cream linen',
    'newborn welcome basket woven wicker with the baby puzzle, a soft knit blanket, plush bunny, and dried lavender, soft natural light',
    'open kraft gift box revealing the baby puzzle on cream crinkle paper, satin ribbon draped, eucalyptus sprig, holiday-neutral baby gift styling',
    'first birthday gift table with the wooden puzzle, a number 1 candle (unlit), pastel balloons softly out of focus, celebration but not Christmas',
  ],
  toddler_in_use: [
    'small toddler hand (no face visible) placing a wooden puzzle piece into the baby puzzle on a soft cream rug, candid montessori lifestyle, soft daylight',
    'overhead view of a tiny toddler hand fitting a piece into the baby puzzle, neutral nursery rug, hands-only candid composition',
    'parent and toddler hands together holding a piece over the puzzle on a beige play mat, warm afternoon light, in-use storytelling',
    'toddler at a low wooden table playing with the baby puzzle, only hands and tiny shoulder visible, cozy nursery in soft focus background',
    'close-up of small fingers gripping a puzzle piece above the partially assembled baby puzzle, sharp focus on hands and piece, soft creamy bokeh',
  ],
  toddler_holding: [
    'happy toddler around 2 years old holding the wooden baby puzzle up to the camera, soft natural window light, neutral nursery background, candid lifestyle portrait, Etsy listing style',
    'cute toddler sitting on a soft cream rug proudly showing the wooden baby puzzle, warm afternoon daylight from a window, blurred nursery in the background, joyful candid moment',
    'smiling baby in a knit cardigan holding the wooden puzzle on their lap, clean light beige wall background, soft diffused light, magazine baby gift photography',
    'toddler kneeling on a wooden floor with the wooden baby puzzle in front of them, looking down at the pieces, soft window light, candid documentary style',
    'parent kneeling on a nursery rug holding the wooden baby puzzle in front of a happy seated toddler, warm storytelling lifestyle moment, soft natural light',
    'toddler in cream linen overalls hugging the wooden baby puzzle to their chest, neutral home interior softly out of focus, daylight portrait, Etsy hero style',
    'tiny child with curly hair sitting cross-legged on a boucle rug holding the wooden baby puzzle, looking at camera with a small smile, soft pastel nursery, gentle morning light',
    'baby being held by a parent (only parent hands and torso visible) while the baby holds the wooden puzzle, soft cream sweater, neutral background, tender lifestyle composition',
  ],
  playroom: [
    'sunny playroom corner with the baby puzzle on a soft rug, a wooden play kitchen and rainbow stacker softly out of focus in the background',
    'scandinavian playroom with the puzzle as hero, low childrens table, felt ball garland on the wall, neutral palette',
    'cozy boho playroom rug with macrame wall hanging, the puzzle laid out, wooden toys arranged tidily',
    'bright minimalist playroom with the puzzle on a jute rug, a stack of board books, and a wooden walker in the background',
    'pastel themed playroom with the baby puzzle hero, plush cloud cushion, soft window light, joyful childhood feel',
  ],
  kids_playground: [
    'sunny backyard play area with the product as the hero, clean green lawn, wooden fence, soft morning light, premium family lifestyle photography',
    'modern outdoor children play space with safety flooring, trees softly blurred in the background, warm natural daylight, catalog-quality composition',
    'preschool garden play corner with tasteful play equipment nearby, product centered, candid family lifestyle mood, no crowding',
    'clean park setting with rubber safety surface and soft greenery bokeh, product photographed from a 3/4 angle, professional Etsy listing style',
    'family backyard patio beside a play area, natural wood textures, potted plants, golden hour lighting, product clearly visible and sharply focused',
    'minimal outdoor nursery school playground scene, muted colors, soft shadows, product shown in realistic use context without text overlays',
  ],
  kitchen: [
    'warm kitchen counter with herbs, olive oil bottle, mediterranean feel',
    'marble kitchen island with morning sunlight, fresh bread and linen towel',
    'rustic dark wood kitchen table with a candle and small plant',
    'white subway tile backdrop, wooden cutting board with fresh basil',
    'farmhouse kitchen counter with ceramic jars and dried herbs',
    'modern kitchen island with sleek black surface and warm pendant light',
    'sunlit breakfast nook with coffee cup and croissant nearby',
    'rustic butcher block counter with cast iron and copper pots',
    'cozy kitchen with open shelving of spices and vintage scales',
    'travertine counter with a bowl of lemons and linen cloth',
  ],
  bathroom: [
    'natural stone bathroom vanity with soft towels, spa atmosphere',
    'marble bathroom counter with rolled white towels and eucalyptus sprig',
    'minimalist bathroom shelf with candle and small plant',
    'white ceramic sink surround with amber soap bottle',
    'dark slate bathroom counter with brass fixtures, moody spa look',
    'scandinavian bathroom vanity with wooden accessories',
    'bright bathroom window ledge with fresh flowers',
    'travertine bathroom surround with linen hand towel',
  ],
  desk_office: [
    'light oak wood desk with a green potted plant, scandinavian minimal',
    'walnut desk with open notebook, pen, and warm lamp light',
    'white modern desk with books, reading glasses and coffee',
    'industrial metal desk with leather notebook and brass accents',
    'home office shelf with stacked books and soft daylight',
    'minimalist desk with laptop off to the side, morning light',
  ],
  living_room: [
    'cozy coffee table with books and a warm throw blanket visible',
    'rustic wood coffee table with open hardcover book and candle',
    'modern side table next to a linen sofa, soft ambient lighting',
    'fireplace mantle with warm ambient glow, winter cozy',
    'mid-century sideboard with a vase of branches and vintage frame',
    'round coffee table with magazines and a steaming mug',
  ],
  bedroom: [
    'vintage wooden tray on white bedding, lifestyle morning scene',
    'nightstand with open book, brass lamp glow, and linen sheets',
    'boho bedroom dresser with dried flowers and jewelry dish',
    'sunlit bed with wrinkled white linen and coffee cup',
    'minimalist bedside table with small plant and reading glasses',
  ],
  dining: [
    'elegant dining table with fresh flowers in a vase, dinner setting',
    'rustic wooden dining table with linen runner and candlesticks',
    'set dinner table with wine glass and soft candlelight',
    'brunch table with fresh fruit, pastries and fresh flowers',
    'formal dining surface with silverware and cloth napkin',
  ],
  outdoor: [
    'outdoor wooden table with garden bokeh and golden hour sunlight',
    'woven picnic blanket on green grass, dappled sunlight',
    'patio table with greenery background and iced drink',
    'weathered garden bench with wildflowers and morning dew',
    'terracotta tile surface with small succulents, bohemian warm',
  ],
  jewelry: [
    'dark velvet fabric draped surface with warm accent lighting, gift presentation style',
    'marble jewelry dish with soft diffused light and rose petals',
    'cream silk fabric with pearl accents, luxury editorial style',
    'open vintage jewelry box on a wooden vanity, soft light',
    'black velvet pad with spotlight, high-end jewelry display',
    'soft pink satin surface with golden hour window light',
  ],
  clothing: [
    'wooden hanger against a neutral wall with soft window light',
    'folded on a linen chair with natural daylight',
    'flat lay on white bedsheet with coffee and sunglasses',
    'hung on a vintage clothing rack with boutique vibes',
    'wooden mannequin with plants in the background',
  ],
  wall_art: [
    'bright modern living room wall with linen sofa and indoor plant in the foreground',
    'bedroom wall above a minimalist nightstand with warm lamp glow',
    'scandinavian hallway wall with wooden bench and coat rack',
    'cozy reading nook wall next to a leather armchair and throw blanket',
    'entryway wall with a wooden console table, vase of branches and key dish',
    'home office wall behind a walnut desk with open books',
  ],
  decor_general: [
    'clean white marble surface with minimal shadows, modern and elegant',
    'warm marble countertop with morning sunlight and dried eucalyptus',
    'rustic dark wood table with soft window light and candle',
    'dark slate surface with dramatic side lighting, moody luxury aesthetic',
    'concrete surface with architectural shadows, industrial modern',
    'windowsill scene with soft rain light, atmospheric and moody',
    'artisan workshop bench with natural textures, handcrafted feel',
    'beach house weathered wood table, seashells nearby, coastal light',
    'glass shelf with soft backlighting, modern retail display',
  ],
  size_scale: [
    'product photographed in a human hand for scale reference, soft natural lighting, clean background',
    'product placed next to a wooden ruler for size reference, top-down minimal layout',
    'product held by a model showing actual real-world size, neutral background, soft focus',
    'product on a flat surface beside a coin or common everyday object for scale, clean composition',
    'product shown in use context with hands visible, demonstrating actual size proportions',
  ],
  color_variants: [
    'all color variants of the product laid out in a clean grid, top-down view, even studio lighting',
    'row of product in different colors arranged side-by-side on a neutral surface, professional catalog style',
    'color spectrum display of product variants, bright studio lighting, e-commerce style',
    'fan-style layout of color options showing the full variety, clean white background',
    'circular arrangement of product color variants, top-down magazine layout',
  ],
  gift_packaging: [
    'product presented in elegant gift packaging with satin ribbon, soft warm lighting, gift-giving moment',
    'open gift box revealing product nestled in tissue paper, ribbon visible, holiday warm tones',
    'product wrapped beautifully on a wooden table with greenery and twine, gift presentation',
    'luxury gift packaging with kraft paper and natural twine, handmade artisan gift aesthetic',
    'product nested in a gift box surrounded by dried flowers, romantic presentation, soft natural light',
  ],
  back_side_view: [
    'product photographed from directly behind, clean studio backdrop, professional product shot',
    'side profile view emphasizing product silhouette and shape, soft directional side lighting',
    'three-quarter back view showing product details from behind, natural daylight',
    'rear view of product on neutral background, focused composition, even lighting',
    'side angle showing depth and dimensionality of product, soft top light',
  ],
};

const ANGLE_POOL = [
  { name: 'eye-level front', desc: 'eye-level straight-on hero shot, product centered, professional product photography' },
  { name: '3/4 angle', desc: '3/4 angle perspective from above, slight tilt, dynamic composition' },
  { name: 'top-down flat lay', desc: 'top-down flat lay, bird\'s eye view, styled props arranged around product' },
  { name: 'side profile', desc: 'side profile view, clean horizontal composition, soft side lighting' },
  { name: '45-degree hero', desc: '45-degree hero shot, slight upward angle, magazine-quality lighting' },
  { name: 'low angle drama', desc: 'low angle dramatic shot looking up at product, cinematic depth' },
  { name: 'lifestyle wide', desc: 'lifestyle wide shot, product in context with surrounding scene visible, environmental story' },
  { name: 'macro detail', desc: 'tight macro close-up showing texture and craft detail, shallow depth of field' },
  { name: 'overhead 60deg', desc: 'overhead 60-degree angle, soft shadows, editorial style' },
  { name: 'in-use scene', desc: 'product shown in natural use context, hands or environment partially visible, candid feel' },
];

const THEME_PRESETS = {
  baby_puzzle:     { label: 'Baby Puzzle / Nursery', pool: 'baby_puzzle' },
  nursery_shelf:   { label: 'Nursery Shelf Styling', pool: 'nursery_shelf' },
  baby_gift:       { label: 'Baby Gift / Hediye',    pool: 'baby_gift' },
  toddler_in_use:  { label: 'Toddler Kullanim',      pool: 'toddler_in_use' },
  toddler_holding: { label: 'Cocuk Tutuyor (yuzlu)', pool: 'toddler_holding' },
  playroom:       { label: 'Playroom',              pool: 'playroom' },
  kids_playground:{ label: 'Cocuk Parki / Outdoor Play', pool: 'kids_playground' },
  bedroom:        { label: 'Yatak Odasi',       pool: 'bedroom' },
  living_room:    { label: 'Salon / Living',    pool: 'living_room' },
  kitchen:        { label: 'Mutfak',            pool: 'kitchen' },
  bathroom:       { label: 'Banyo',             pool: 'bathroom' },
  dining:         { label: 'Yemek Odasi',       pool: 'dining' },
  desk_office:    { label: 'Ofis / Calisma',    pool: 'desk_office' },
  outdoor:        { label: 'Disarisi / Bahce',  pool: 'outdoor' },
  wall_art:       { label: 'Duvar Sahnesi',     pool: 'wall_art' },
  jewelry:        { label: 'Taki Sahnesi',      pool: 'jewelry' },
  clothing:       { label: 'Giyim Sahnesi',     pool: 'clothing' },
  decor_general:  { label: 'Genel Lifestyle',   pool: 'decor_general' },
  studio_white:   { label: 'Studyo Beyaz Arkaplan', scenes: [
    'pure white seamless studio backdrop, soft even lighting, no shadows, professional product shot',
    'clean white studio with soft drop shadow under product, minimal, e-commerce style',
    'bright white background, single hero product centered, magazine catalog style',
    'pure white cyclorama studio, gentle gradient floor-to-wall, premium e-commerce look',
    'crisp white seamless paper backdrop, soft directional light, product hero shot',
  ] },
  studio_black:   { label: 'Studyo Siyah Arkaplan', scenes: [
    'deep black studio backdrop, dramatic side lighting, luxury product shot',
    'matte black surface, single rim light from above, moody luxury feel',
    'pitch black background with single hero product, high contrast editorial',
    'velvet black drape backdrop, soft top light, jewelry-store style premium look',
  ] },
  studio_neutral: { label: 'Studyo Notr (kraft/bej)', scenes: [
    'warm beige seamless studio backdrop, soft daylight, organic minimalist tone',
    'kraft paper background, subtle texture, handcrafted feel',
    'cream linen studio backdrop, soft window light, editorial calm',
  ] },
  macro_detail:   { label: 'Yakin Plan Detay', scenes: [
    'tight macro close-up showing material texture and craftsmanship detail, shallow depth of field',
    'extreme close-up on a single design feature, dramatic narrow focus',
    'detail shot revealing surface finish and material grain, soft directional light',
  ] },
  in_use:         { label: 'Kullanim Halinde', scenes: [
    'product shown in natural use context, hands or environment partially visible, candid feel',
    'real-life use shot with model interacting subtly, lifestyle authentic',
    'in-context shot demonstrating function, environment lightly visible',
  ] },
  size_scale:      { label: 'Boyut / Olcek (Slot 4)',     pool: 'size_scale' },
  color_variants:  { label: 'Renk Varyantlari (Slot 5)',  pool: 'color_variants' },
  gift_packaging:  { label: 'Hediye Paketleme (Slot 6)',  pool: 'gift_packaging' },
  back_side_view:  { label: 'Arka / Yan Goruntu (Slot 7)', pool: 'back_side_view' },
};

// Hero priority — rendered first so mockup01 is always the clean hero shot per Etsy rule
const HERO_PRIORITY = ['studio_white', 'studio_black', 'studio_neutral'];

function sortSpecsHeroFirst(specs) {
  return specs.slice().sort((a, b) => {
    const ai = HERO_PRIORITY.indexOf(_themeKeyForSpec(a));
    const bi = HERO_PRIORITY.indexOf(_themeKeyForSpec(b));
    if (ai !== -1 && bi === -1) return -1;
    if (bi !== -1 && ai === -1) return 1;
    if (ai !== -1 && bi !== -1) return ai - bi;
    return 0;
  });
}
function _themeKeyForSpec(spec) {
  // resolve back from the label hint we attach during build
  if (spec.themeKey) return spec.themeKey;
  return null;
}

function pickScenePool(desc) {
  const t = (desc || '').toLowerCase();
  // Baby puzzle / nursery / montessori family — preferred default for this app build.
  if (/playground|play.set|playset|slide|swing|climber|climbing|outdoor.play|backyard.play|cocuk.parki|kaydirak|salincak|oyun.parki/.test(t)) return 'kids_playground';
  if (/baby.puzzle|wooden.*name.*puzzle|name.puzzle|jigsaw.baby|montessori.*puzzle|nursery.*puzzle|toddler.*puzzle|infant.*puzzle|bebek.*puzzle|isimli.puzzle|first.birthday.*puzzle|baby.gift|baby.shower|newborn.*puzzle/.test(t)) return 'baby_puzzle';
  if (/wooden.toy|kids.toy|children.toy|educational.toy|oyuncak|playroom/.test(t)) return 'playroom';
  if (/wall.art|poster|canvas|print|painting|tablo|kanvas|duvar/.test(t)) return 'wall_art';
  if (/kitchen|cook|chef|spatula|utensil|cutting.board|apron|pot.holder|oven.mitt|coaster|trivet|towel.holder|paper.towel|spice|salt|pepper|olive.oil|recipe|mug|cup|tea|coffee|bowl|plate|mutfak|kupa|kase|tabak/.test(t)) return 'kitchen';
  if (/bathroom|bath|shower|soap|towel|toothbrush|vanity|spa|toilet|banyo|havlu/.test(t)) return 'bathroom';
  if (/desk|office|pen|notebook|journal|laptop|mouse.pad|monitor|bookend|planner|calendar|ofis|defter/.test(t)) return 'desk_office';
  if (/living.room|sofa|couch|throw|pillow|blanket|coffee.table|fireplace|mantel|mantle|salon|somine|yastik/.test(t)) return 'living_room';
  if (/bedroom|bed|nightstand|sheet|duvet|lamp|yatak|nevresim/.test(t)) return 'bedroom';
  if (/dining|dinner|placemat|napkin|centerpiece|candlestick|tablecloth|yemek/.test(t)) return 'dining';
  if (/garden|outdoor|patio|porch|yard|lawn|picnic|bbq|grill|bahce/.test(t)) return 'outdoor';
  if (/necklace|ring|earring|bracelet|jewelry|pendant|charm|brooch|anklet|kolye|kupe|yuzuk/.test(t)) return 'jewelry';
  if (/shirt|tee|tshirt|hoodie|sweater|sweatshirt|dress|pants|hat|cap|scarf|clothing|apparel|tisort|elbise|sapka/.test(t)) return 'clothing';
  // Fallback: this build is for baby puzzles, so default to nursery scenes rather than generic decor.
  return 'decor_general';
}

function readAsBase64(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { base64: buf.toString('base64'), mime };
}

async function visionDescribe({ imagePath, prompt, maxTokens, apiKey }) {
  const { base64, mime } = readAsBase64(imagePath);
  const r = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: OR_HEADERS(apiKey),
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: maxTokens || 600,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  if (!r.ok) throw new Error('vision describe failed: ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  let raw = j.choices?.[0]?.message?.content || '';
  if (Array.isArray(raw)) raw = raw.filter(p => p.type === 'text').map(p => p.text).join('');
  return { text: String(raw || '').trim() };
}

async function geminiGenerateImage({ imageParts, prompt, apiKey }) {
  const content = imageParts.map(img => ({
    type: 'image_url',
    image_url: { url: `data:${img.mime};base64,${img.base64}` },
  }));
  content.push({ type: 'text', text: prompt });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  let response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: OR_HEADERS(apiKey),
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: 'user', content }],
        response_modalities: ['IMAGE', 'TEXT'],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Image gen failed (${response.status}): ${errBody.slice(0, 400)}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('No message from image model');

  const allParts = [];
  if (Array.isArray(message.content)) allParts.push(...message.content.filter(p => p.type === 'image_url'));
  if (Array.isArray(message.images)) allParts.push(...message.images.filter(p => p.type === 'image_url'));

  for (const part of allParts) {
    const url = part.image_url?.url;
    if (!url) continue;
    if (url.startsWith('data:')) return Buffer.from(url.split(',')[1], 'base64');
    const r = await fetch(url);
    return Buffer.from(await r.arrayBuffer());
  }
  return null;
}

async function toSquareBuffer(buffer) {
  const meta = await sharp(buffer).metadata();
  const naturalSize = Math.min(meta.width || 1024, meta.height || 1024);
  // Etsy 2025-2026 algorithm: min 2000px on shortest side. Upscale if model returned smaller.
  const size = Math.max(2000, naturalSize);
  return sharp(buffer)
    .resize(size, size, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

function buildPrompt({ productDesc, scene, angle, mode, idx, total, themeKey }) {
  if (mode === 'bg-replace') {
    return `Edit this product photo: REPLACE ONLY THE BACKGROUND/SURROUNDINGS. The product in the image is a baby puzzle: ${productDesc}.

NEW BACKGROUND/SCENE: ${scene}

ABSOLUTE FIDELITY RULES (highest priority — break these and the output is unusable):
1. The baby puzzle in the photo must remain PIXEL-PERFECT IDENTICAL. Same shape, same wood grain, same exact colors, same engraved letters/animals/shapes, same piece cut-outs, same proportions, same finish. Treat the product like a copy-paste cut-out.
2. DO NOT redraw, regenerate, restyle, recolor, reshape, repose, re-engrave, re-letter, or re-illustrate any part of the puzzle. NOT a single piece. NOT a single letter. NOT a single animal silhouette.
3. DO NOT add new puzzle pieces, remove pieces, rearrange pieces, or change the count of pieces.
4. DO NOT change the camera angle on the product itself — keep the puzzle in the SAME orientation and SAME perspective as the source photo. Only the surrounding scene changes.
5. DO NOT crop the puzzle differently from the source — the puzzle should occupy roughly the same region of the frame.
6. ONLY the area AROUND the puzzle changes (background, surface, props).

SCENE INTEGRATION:
- Replace the background with the scene described above.
- Match the new scene's lighting direction and color temperature so the puzzle blends in naturally — but do NOT repaint the puzzle to match.
- You may add small soft-focus props AROUND (never on top of, never overlapping) the puzzle: a folded muslin, a plush toy, dried flowers, a board book — props from the scene description.

OUTPUT:
- Square 1:1, photo-realistic, professional Etsy listing quality, minimum 2000x2000 feel.
- No text, no watermarks, no labels, no logos, no writing of any kind.
- If you cannot keep the puzzle pixel-identical, output the original puzzle untouched on a softly blurred neutral background — fidelity beats creativity.`;
  }

  // Theme-aware special instructions for slots that need explicit composition rules.
  // These are extremely detailed because Gemini's image model needs concrete props,
  // composition rules, lighting, and counter-instructions to override the "single hero product" default.
  let specialBlock = '';
  if (themeKey === 'size_scale') {
    specialBlock = `
=== SIZE / SCALE REFERENCE — Etsy SLOT 4 (MANDATORY) ===
PURPOSE: A parent buying a baby/toddler puzzle MUST instantly understand the real-world size — is it a chunky toddler-safe puzzle or a small fine-motor piece? This decides the purchase.

COMPOSITION RULES (pick ONE and execute it precisely):

OPTION A — ADULT HAND HOLDING THE PUZZLE / A PIECE:
- An adult hand (neutral skin tone, no jewelry, no nail polish) holding either the entire baby puzzle board OR a single chunky puzzle piece.
- For a single piece: pinch grip from the side, piece fills ~30% of frame, hand ~30%, background neutral.
- For the whole board: cradled in two open palms, board diagonal across frame.
- Lighting: soft natural daylight from the side. Background: out-of-focus cream linen or pale wood.

OPTION B — RULER MEASUREMENT:
- A natural-finish wooden ruler with clear black numerical markings (inches AND centimeters visible).
- Ruler placed parallel to the longest dimension of the puzzle board, touching or 1cm away.
- Top-down 90-degree flat lay angle. Both product and ruler in razor-sharp focus.
- Ruler markings must be legible at thumbnail size.
- Background: cream linen, pale wood, or soft pastel nursery surface.

OPTION C — EVERYDAY SCALE OBJECT FAMILIAR TO PARENTS:
- A universally-recognizable child-context size reference next to the puzzle: a standard pacifier, a baby spoon, a child's hand-knit bootie, a small board book, OR a smartphone (front-down, screen hidden).
- Avoid coins, batteries, keys — parents read those as choking-hazard cues which hurts the photo.
- Object placed 1-3cm beside product, both at the same focal plane, both sharply focused.
- Top-down or 3/4 angle. Background: cream linen, pale wood, or soft pastel surface.

ABSOLUTE RULES:
- The reference (hand/ruler/object) MUST be in SHARP focus, NOT blurred bokeh.
- Reference and product must be clearly visible AT THE SAME TIME — neither hides the other.
- NO text overlays, NO measurement annotations drawn on image, NO arrows.
- Lighting on reference must match lighting on product (same direction, same warmth).
- Reference must look photographically real, not 3D rendered or sticker-like.
- NO small loose items that would scan as a choking hazard near a baby product.`;
  } else if (themeKey === 'color_variants') {
    specialBlock = `
=== COLOR / FINISH VARIANTS LAYOUT — Etsy SLOT 5 (MANDATORY) ===
PURPOSE: Show the parent ALL finish/color options of the baby puzzle in one glance. This image deliberately overrides the "single product" rule.

COMPOSITION RULES:
- This image contains EXACTLY 4 OR 5 IDENTICAL COPIES of the baby puzzle, each in a DIFFERENT finish/color.
- Suggested baby-puzzle palettes (pick ONE coherent set of 4-5):
  * Natural wood set: raw beech / light oak / walnut / pine / cherry
  * Pastel painted set: blush pink / sage green / dusty blue / butter yellow / cream
  * Montessori muted set: terracotta / olive / mustard / dusty rose / cream
  * Boy/girl/neutral set: powder blue / blush pink / sage / mint / cream
- Each variant is geometrically IDENTICAL — same shape, cut-outs, piece count, proportions, design details. ONLY the base color/finish differs.

LAYOUT (pick ONE):
A) HORIZONTAL ROW: 4-5 variants in a single straight horizontal line, equal spacing (~10-15% of variant width between each), centered in frame, top-down or eye-level.
B) GRID 2x2 or 2x3: variants arranged in tight grid, equal spacing, top-down 90-degree.
C) FAN ARC: variants fanned out in a quarter-circle arc, slight overlap between adjacent items, top-down.
D) STAGGERED DIAGONAL: variants placed in a diagonal cascade, each slightly offset, eye-level perspective.

LIGHTING & SURFACE:
- Surface: neutral white, light beige, or pale wood that does not compete with any color.
- Lighting: even, soft, shadowless studio light from above. Each variant equally lit.
- Color separation: each variant must read as DISTINCTLY different — avoid colors that blend together visually.

ABSOLUTE RULES:
- ALL items in the same image, NOT a collage of separate photos.
- Equal size, equal angle, equal lighting per item — true catalog consistency.
- NO text labels under colors, NO swatches, NO color names written.
- Background must NOT add color cast — keep it truly neutral.
- This OVERRIDES "single product hero" rule deliberately.`;
  } else if (themeKey === 'gift_packaging') {
    specialBlock = `
=== BABY GIFT PACKAGING PRESENTATION — Etsy SLOT 6 (MANDATORY) ===
PURPOSE: Trigger the "perfect baby shower / first birthday / new baby gift" use-case in the buyer's mind. The puzzle must look like a thoughtful, gift-ready present.

COMPOSITION (pick ONE):

OPTION A — INSIDE OPEN BABY GIFT BOX:
- A premium kraft, soft cream, or matte pastel (blush, sage, dusty blue) gift box, lid open or placed beside.
- Inside: cream or blush tissue paper crinkled artfully, the baby puzzle nestled in the center.
- Outside box: a satin ribbon untied/draped, a small unmarked gift tag (cream cardstock, no text).
- Surrounding props: 2-3 dried baby's breath sprigs, a folded muslin swaddle, optionally a knit lovey or wooden rattle.

OPTION B — WRAPPED BABY GIFT BESIDE PRODUCT:
- The baby puzzle fully visible in foreground (hero), positioned diagonally.
- A wrapped gift package in soft background (kraft paper + twine, or pastel matte paper + satin ribbon, no patterns).
- A folded muslin swaddle and a small plush bunny softly out of focus.
- Both items lit by the same warm light source. Puzzle sharper than the wrapped gift.
- Background: soft pale wood or warm cream linen surface with gentle shadow.

OPTION C — MID-WRAPPING ON A NURSERY TABLE:
- Puzzle partially nestled in unwrapped cream tissue paper, half-revealed.
- Loose satin ribbon, washi tape roll in pastel, blank cream gift tag.
- Hands not visible — implied "in the middle of wrapping" composition.
- Top-down or 3/4 angle, soft daylight.

LIGHTING:
- Warm tones: 3000-4500 Kelvin equivalent. Golden hour window light, candle warmth, or string-light bokeh in distant background.
- Soft shadows, no harsh contrast. Holiday/celebration mood without being explicitly Christmas/holiday-themed (unless the design is).

ABSOLUTE RULES:
- Puzzle remains the FOCAL POINT — wrapping never fully hides it.
- Gift tag is BLANK — no text, no name, no logo, no baby's name written.
- Ribbon: satin or grosgrain, in cream, kraft brown, blush pink, sage, or dusty blue. NEVER neon, glitter, or pattern.
- NO balloons with text, NO "It's a boy/girl" banners, NO Christmas/holiday markers.
- Mood is "thoughtful baby shower / new baby gift" — handmade, soft, gender-neutral-friendly.`;
  } else if (themeKey === 'back_side_view') {
    specialBlock = `
=== BACK / SIDE VIEW — Etsy SLOT 7 (MANDATORY) ===
PURPOSE: Reveal an aspect of the product the hero shot did NOT show. Buyers need to see all sides before buying.

CAMERA POSITION (pick ONE based on product type):

OPTION A — DIRECT REAR:
- Camera at 180 degrees from the front. Product centered, photographed straight from behind.
- For apparel (shirts, dresses): show back of garment — neckline, shoulder seams, back design if any.
- For boxes/items with a "back" face: show the rear panel directly.

OPTION B — SIDE PROFILE (90-degree):
- Camera perpendicular to front face. Pure side silhouette visible.
- Reveals depth, thickness, layering, side hardware, side seams.

OPTION C — THREE-QUARTER BACK (135-degree):
- Camera positioned behind and to the side. Shows the back AND a slice of the side simultaneously.
- Most dynamic — reveals back details and dimensionality at once.

WHAT TO REVEAL FOR A BABY PUZZLE:
- The smooth sanded back of the puzzle board (no rough cuts, parent-safe).
- The depth/thickness of the puzzle pieces and the board (chunky toddler-grip vs. thin fine-motor).
- The cut-out wells for each piece, showing precise CNC/laser fit.
- Any optional name slot, peg handle, or attachment loop on the back (kept blank — no text, no name, no logo).
- The wood grain and finish quality on the rear face.

LIGHTING & BACKGROUND:
- Lighting matches the hero shot's style for visual continuity.
- Background: clean studio neutral OR soft contextual surface. NO busy lifestyle props that distract from the back details.
- Depth of field: entire product in focus to show back details clearly.

ABSOLUTE RULES:
- Whatever was visible in the hero shot must NOT be the focus here. Show NEW information.
- Product fully fills 60-75% of frame.
- NO text on labels, NO logos.`;
  } else if (themeKey === 'macro_detail') {
    specialBlock = `
=== MACRO DETAIL SHOT — Etsy SLOT 3 (MANDATORY) ===
PURPOSE: Demonstrate craftsmanship, material quality, and the tactile feel. The buyer should mentally "touch" the surface.

COMPOSITION:
- Extreme close-up: the baby puzzle fills 80-100% of the frame.
- Focus on ONE specific detail that proves quality and child-safety:
  * Wood grain on the puzzle face with the laser-cut piece edge in razor focus
  * The rounded sanded edge of a chunky toddler piece (no splinters, parent-safe)
  * The precise fit of a piece sitting flush in its cut-out well
  * Non-toxic paint/stain finish catching soft directional light
  * Any engraved name slot or letter (engraving sharp, surface satin)
  * The peg handle attachment point if present

DEPTH OF FIELD:
- Shallow — only a 5-15% slice of the frame in razor-sharp focus.
- Rest gently falls off into soft creamy bokeh.
- The sharp area shows micro-detail (individual fibers, grain lines, polish marks).

LIGHTING:
- Single soft directional source from one side, raking across the surface to maximize texture.
- No harsh specular highlights.
- Slight warmth in tone (3500-4500K).

ABSOLUTE RULES:
- NO full product in frame — this is a CROP, not a wide shot.
- NO context background — the entire visible area is the puzzle surface.
- Image must convey "handcrafted wooden montessori toy, parent-safe" feel — never "cheap plastic mass-produced".
- Sharp focus area must be in the GOLDEN-RATIO sweet spot (rule of thirds intersection).
- NO text, NO baby's name, NO brand logo carved or printed on the surface.`;
  }

  return `Generate a brand new photograph (mockup ${idx} of ${total}) of the product described below.

CAMERA ANGLE (most important): ${angle}
The composition MUST match this camera angle. If the angle says "top-down flat lay", the output is a flat lay -- the product is photographed straight from above. If the angle says "low angle dramatic", the camera is below the product looking up. Each mockup uses a DIFFERENT angle from this set. Do NOT default to an eye-level front shot.

SCENE / BACKGROUND: ${scene}
Style the surroundings to match the scene above. Lifestyle Etsy listing aesthetic with warm natural lighting and complementary props.

PRODUCT: ${productDesc}
The product must be recognizable as this exact item: same colors${themeKey === 'color_variants' ? ' (except when explicitly showing color variants)' : ''}, materials, design, proportions, finish. It is the hero of the image${themeKey === 'color_variants' ? ' (multi-product layout for variant slot)' : ''}.
${specialBlock}

OUTPUT:
- Square 1:1, photo-realistic, professional Etsy listing quality.
- Minimum 2000x2000 pixel resolution feel — sharp, high-detail, premium.
- No text, no watermarks, no labels, no logos, no writing of any kind.
- This image must be visually distinct from any other mockup in the set (different angle AND different background AND different framing).`;
}

async function generateLifestyleMockups({
  productImagePath, productImagePaths,
  productDescription, sku,
  count = 4, mode = 'rotate-angles',
  themes, themeWords, onProgress, apiKey,
}) {
  const key = apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set in .env');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const imagePaths = Array.isArray(productImagePaths) && productImagePaths.length
    ? productImagePaths
    : (productImagePath ? [productImagePath] : []);
  if (imagePaths.length === 0) throw new Error('No product image provided');

  const specs = [];
  if (Array.isArray(themes) && themes.length) {
    for (const t of themes) {
      const themeKey = (t.theme || '').trim();
      const cnt = Math.max(0, Math.min(50, parseInt(t.count, 10) || 0));
      if (!cnt) continue;
      const preset = THEME_PRESETS[themeKey];
      let themeScenes;
      let themeLabel;
      if (preset) {
        themeLabel = preset.label;
        if (Array.isArray(preset.scenes)) themeScenes = preset.scenes;
        else if (preset.pool && SCENE_POOLS[preset.pool]) themeScenes = SCENE_POOLS[preset.pool];
        else themeScenes = SCENE_POOLS.decor_general;
      } else {
        themeLabel = themeKey || 'Custom';
        themeScenes = SCENE_POOLS.decor_general;
      }
      for (let k = 0; k < cnt; k++) {
        specs.push({ scene: themeScenes[k % themeScenes.length], themeLabel, themeKey });
      }
    }
  }

  if (specs.length === 0) {
    const hint = [(productDescription || ''), ...(themeWords || [])].join(' ');
    const poolKey = pickScenePool(hint);
    const scenes = SCENE_POOLS[poolKey];
    for (let i = 0; i < count; i++) {
      specs.push({ scene: scenes[i % scenes.length], themeLabel: poolKey, themeKey: poolKey });
    }
    onProgress?.({ type: 'step-done', step: 'scene', message: `Kategori: ${poolKey} (${count} mockup)`, pool: poolKey });
  } else {
    onProgress?.({ type: 'step-done', step: 'scene', message: `Tema spec: ${specs.length} mockup, ${themes.length} tema`, themes });
  }

  // Hero shot must be Etsy slot 1 — sort hero themes first so mockup01.png is always studio/clean
  const sortedSpecs = sortSpecsHeroFirst(specs);
  specs.length = 0;
  specs.push(...sortedSpecs);

  const total = specs.length;
  const imgParts = imagePaths.map(readAsBase64);
  const outputs = [];
  const concepts = [];

  let visualDescription = null;
  if (mode === 'rotate-angles') {
    onProgress?.({ type: 'step-start', step: 'describe', message: 'Urun gorseli analiz ediliyor (acilara karsi pixel-locking onleme)...' });
    try {
      const visionPrompt = `Describe this product in extreme visual detail for a downstream image generator. Include: type of product, exact colors, materials, textures, patterns, dimensions/proportions, finish (glossy/matte/etc), distinguishing features. Be precise so a different artist could recreate the SAME product from any camera angle. Do not describe the background. Output ONE detailed paragraph.`;
      const { text: desc } = await visionDescribe({ imagePath: imagePaths[0], prompt: visionPrompt, maxTokens: 600, apiKey: key });
      visualDescription = (desc || '').trim().slice(0, 1500);
      onProgress?.({ type: 'step-done', step: 'describe', message: `Urun analizi tamam (${visualDescription.length} chars)` });
    } catch (e) {
      console.warn('[lifestyle-mockup] vision describe failed, falling back to image input:', e.message);
    }
  }

  for (let i = 0; i < total; i++) {
    const { scene, themeLabel } = specs[i];
    const angleObj = ANGLE_POOL[i % ANGLE_POOL.length];
    const angleLabel = angleObj.name;
    const angleDesc = angleObj.desc;
    concepts.push({ angle: angleLabel, scene, theme: themeLabel });
    onProgress?.({ type: 'mockup-start', idx: i + 1, total, angle: angleLabel, scene, theme: themeLabel });

    const useTextOnly = mode === 'rotate-angles' && visualDescription;
    let refs;
    if (useTextOnly) {
      refs = [];
    } else {
      const primary = imgParts[i % imgParts.length];
      refs = imgParts.length > 1 ? [primary, ...imgParts.filter(p => p !== primary).slice(0, 2)] : [primary];
    }

    const productDescForPrompt = useTextOnly
      ? `${productDescription || 'product'}. Visual details: ${visualDescription}`
      : (productDescription || 'product');
    const prompt = buildPrompt({ productDesc: productDescForPrompt, scene, angle: angleDesc, mode, idx: i + 1, total, themeKey: specs[i].themeKey });

    try {
      const imgBuffer = await geminiGenerateImage({ imageParts: refs, prompt, apiKey: key });
      if (!imgBuffer) throw new Error('Model did not return an image');
      const squared = await toSquareBuffer(imgBuffer);
      const outName = `${sku}_mockup${String(i + 1).padStart(2, '0')}.png`;
      const outPath = path.join(OUTPUT_DIR, outName);
      fs.writeFileSync(outPath, squared);
      outputs.push(outPath);
      onProgress?.({ type: 'mockup-done', idx: i + 1, total, path: '/output/' + outName, angle: angleLabel, scene, theme: themeLabel });
    } catch (err) {
      console.warn(`[lifestyle-mockup] idx=${i + 1} failed: ${err.message}`);
      onProgress?.({ type: 'mockup-error', idx: i + 1, total, error: err.message, angle: angleLabel });
    }
  }

  return { outputs, concepts };
}

module.exports = { generateLifestyleMockups, pickScenePool, SCENE_POOLS, THEME_PRESETS, ANGLE_POOL };
