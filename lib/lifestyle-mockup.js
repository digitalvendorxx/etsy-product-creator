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
    return `Edit this product photo: REPLACE ONLY THE BACKGROUND. The product in the image is a ${productDesc}.

NEW BACKGROUND: ${scene}

CRITICAL RULES:
1. DO NOT touch, modify, reshape, recolor, or redraw the product itself. Pixel-perfect identical.
2. ONLY replace the background/surroundings.
3. Match lighting on the new background to the product naturally.
4. Add small contextual props around (not on top of) the product.
5. Square 1:1 output. No text, watermarks, labels, or logos.`;
  }

  // Theme-aware special instructions for slots that need explicit composition rules.
  // These are extremely detailed because Gemini's image model needs concrete props,
  // composition rules, lighting, and counter-instructions to override the "single hero product" default.
  let specialBlock = '';
  if (themeKey === 'size_scale') {
    specialBlock = `
=== SIZE / SCALE REFERENCE — Etsy SLOT 4 (MANDATORY) ===
PURPOSE: The buyer must instantly understand the REAL-WORLD physical size of the product. Without this, they cannot decide to buy.

COMPOSITION RULES (pick ONE and execute it precisely):

OPTION A — HUMAN HAND:
- An adult human hand (well-manicured, neutral skin tone, no jewelry, no nail polish) is HOLDING the product.
- Hand fills approximately 25-40% of frame, product 50-70%, background minimal.
- Hand position: pinch grip from the side OR cradled in open palm — never gripping over the front face.
- Lighting: soft natural daylight from the side, gentle skin highlights, product evenly lit.
- Background: out-of-focus neutral surface (linen, light wood, or soft beige fabric).

OPTION B — RULER MEASUREMENT:
- A natural-finish wooden ruler with clear black numerical markings (inches AND/OR centimeters visible).
- Ruler placed parallel to the longest dimension of the product, touching or 1cm away.
- Top-down 90-degree flat lay angle. Both product and ruler in razor-sharp focus.
- Ruler markings must be legible at thumbnail size.
- Background: clean white, neutral kraft, or pale wood.

OPTION C — EVERYDAY SCALE OBJECT:
- A universally-recognizable size reference next to product: US quarter coin, Euro coin, AAA battery, standard #2 pencil, modern smartphone (front-down so screen is hidden), brass key, or matchstick.
- Object placed 1-3cm beside product, both at the same focal plane, both sharply focused.
- Top-down or 3/4 angle.
- Background: minimal — single-color surface, no competing visual elements.

ABSOLUTE RULES:
- The reference (hand/ruler/object) MUST be in SHARP focus, NOT blurred bokeh.
- Reference and product must be clearly visible AT THE SAME TIME — neither hides the other.
- NO text overlays, NO measurement annotations drawn on image, NO arrows.
- Lighting on reference must match lighting on product (same direction, same warmth).
- Reference must look photographically real, not 3D rendered or sticker-like.`;
  } else if (themeKey === 'color_variants') {
    specialBlock = `
=== COLOR VARIANTS LAYOUT — Etsy SLOT 5 (MANDATORY) ===
PURPOSE: Show the buyer ALL color options at a single glance. This image overrides the "single product" rule on purpose.

COMPOSITION RULES:
- This image contains EXACTLY 4 OR 5 IDENTICAL COPIES of the product, each in a DIFFERENT color.
- Suggested color palette (pick a coherent set of 4-5):
  * Earth set: cream / sand / terracotta / olive / charcoal
  * Bold set: white / black / navy / burgundy / forest green
  * Pastel set: blush pink / sage / dusty blue / lavender / cream
  * Mono set: white / light gray / mid gray / dark gray / black
- Each variant is geometrically IDENTICAL — same shape, material, surface finish, proportions, design details. ONLY the base color differs.

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
=== GIFT PACKAGING PRESENTATION — Etsy SLOT 6 (MANDATORY) ===
PURPOSE: Trigger the gifting use-case in the buyer's mind. The product must look like the perfect gift waiting to be given.

COMPOSITION (pick ONE):

OPTION A — INSIDE OPEN GIFT BOX:
- A premium kraft, white, or matte black gift box, lid open or removed and placed beside.
- Inside: tissue paper (white, blush, or kraft) crinkled artfully, product nestled in the center.
- Outside box: a satin ribbon untied/draped, a small unmarked gift tag (cream cardstock, no text).
- Surrounding the box: 2-3 dried flowers (lavender, eucalyptus, or baby's breath), a small sprig of greenery.

OPTION B — WRAPPED GIFT BESIDE PRODUCT:
- The product fully visible in foreground (hero), positioned diagonally.
- A wrapped gift package in soft background (kraft paper + twine, or matte paper + satin ribbon, no patterns).
- Both items lit by the same warm light source. Product is sharper than the wrapped gift (depth of field).
- Background: soft wood or warm linen surface with gentle shadow.

OPTION C — MID-WRAPPING:
- Product partially nestled in unwrapped tissue paper, half-revealed.
- Loose ribbon, scissors (out of focus in distance), washi tape roll, gift tag with blank face.
- Hands not visible — implied "in the middle of wrapping" composition.
- Top-down or 3/4 angle.

LIGHTING:
- Warm tones: 3000-4500 Kelvin equivalent. Golden hour window light, candle warmth, or string-light bokeh in distant background.
- Soft shadows, no harsh contrast. Holiday/celebration mood without being explicitly Christmas/holiday-themed (unless the design is).

ABSOLUTE RULES:
- Product remains the FOCAL POINT — wrapping never fully hides it.
- Gift tag is BLANK — no text, no name, no logo.
- Ribbon: satin or grosgrain, in cream, kraft brown, dusty pink, or sage. NEVER neon, glitter, or pattern.
- NO Christmas trees, NO Santa, NO explicit holiday markers (unless the product itself is holiday-themed).
- Composition feels handmade, intentional, gift-shop premium — NOT mass-produced or cheap.`;
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

WHAT TO REVEAL:
- For garments: back stitching, neckline shape, shoulder construction, back-print if present, label area (label blank).
- For accessories: clasp, zipper, buckle, hardware finish, back surface texture.
- For wall art / posters: edge finish, hanging hardware, frame depth.
- For ceramic / glass: rear glaze, foot/base, makers mark area (blank).

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
- Extreme close-up: the product fills 80-100% of the frame.
- Focus on ONE specific detail (pick the most appealing for this product type):
  * For fabric/garments: weave pattern, stitching, hem detail, seam finish, fiber close-up
  * For ceramic/glass: glaze texture, rim finish, throw lines, base mark area
  * For wood: grain pattern, joinery, edge bevel, surface oil/wax sheen
  * For metal/jewelry: polish or brush pattern, solder lines, gemstone facets, hallmark area
  * For paper/print: fiber texture, ink bleed/saturation, embossed line edges
  * For leather: grain/pebble, edge burnish, stitching tension, patina
  * For knit: yarn twist, stitch pattern, gauge

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
- NO context background — the entire visible area is the product surface.
- Image must convey "premium, handcrafted" feel, never "cheap, mass-produced".
- Sharp focus area must be in the GOLDEN-RATIO sweet spot (rule of thirds intersection).`;
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
