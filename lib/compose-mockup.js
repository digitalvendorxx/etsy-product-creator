const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { fetchWithRetry } = require('./fetch-retry');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const POSITIONS_FILE = path.join(__dirname, '..', 'mockup-positions.json');

function loadPositions() {
  try { return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch { return {}; }
}

function normalizePos(p) {
  if (!p) return null;
  return {
    x: p.x,
    y: p.y,
    width: p.width != null ? p.width : p.w,
    height: p.height != null ? p.height : p.h,
    rotation: p.rotation || 0,
    source: p.source || 'migrated',
  };
}

function getPositionForTemplate(templatePath, opts) {
  if (opts?.customPosition) return normalizePos(opts.customPosition);
  if (opts?.position) return normalizePos(opts.position);
  const key = path.basename(templatePath);
  const positions = loadPositions();
  return normalizePos(positions[key]) || null;
}

// Flood-fill white background removal: only removes white pixels connected to edges.
// Preserves white/light content inside the design.
function floodFillRemoveBackground(pixels, w, h) {
  const total = w * h;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  let stackPtr = 0;

  // Auto-detect background color from edge pixels
  let edgeR = 0, edgeG = 0, edgeB = 0, edgeCount = 0;
  const sampleEdge = (idx) => {
    const off = idx * 4;
    if (pixels[off + 3] < 128) return;
    edgeR += pixels[off]; edgeG += pixels[off + 1]; edgeB += pixels[off + 2];
    edgeCount++;
  };
  for (let x = 0; x < w; x++) { sampleEdge(x); sampleEdge((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { sampleEdge(y * w); sampleEdge(y * w + (w - 1)); }
  const bgR = edgeCount ? edgeR / edgeCount : 255;
  const bgG = edgeCount ? edgeG / edgeCount : 255;
  const bgB = edgeCount ? edgeB / edgeCount : 255;
  const bgBrightness = (bgR + bgG + bgB) / 3;
  // Tolerance: wider for light backgrounds, tighter for dark
  const colorTolerance = bgBrightness > 200 ? 45 : 30;

  function isBackground(idx) {
    const off = idx * 4;
    const a = pixels[off + 3];
    if (a === 0) return true;
    const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
    const dr = Math.abs(r - bgR), dg = Math.abs(g - bgG), db = Math.abs(b - bgB);
    if (dr < colorTolerance && dg < colorTolerance && db < colorTolerance) return true;
    // Also catch near-white/cream with low saturation
    const brightness = (r + g + b) / 3;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    return brightness > 200 && saturation < 0.15;
  }

  // Seed from all edge pixels that are whitish
  for (let x = 0; x < w; x++) {
    if (isBackground(x)) { stack[stackPtr++] = x; visited[x] = 1; }
    const bottom = (h - 1) * w + x;
    if (isBackground(bottom)) { stack[stackPtr++] = bottom; visited[bottom] = 1; }
  }
  for (let y = 1; y < h - 1; y++) {
    const left = y * w;
    if (isBackground(left)) { stack[stackPtr++] = left; visited[left] = 1; }
    const right = y * w + (w - 1);
    if (isBackground(right)) { stack[stackPtr++] = right; visited[right] = 1; }
  }

  // DFS flood fill using stack
  while (stackPtr > 0) {
    const idx = stack[--stackPtr];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0     && !visited[idx - 1] && isBackground(idx - 1)) { visited[idx - 1] = 1; stack[stackPtr++] = idx - 1; }
    if (x < w - 1 && !visited[idx + 1] && isBackground(idx + 1)) { visited[idx + 1] = 1; stack[stackPtr++] = idx + 1; }
    if (y > 0     && !visited[idx - w] && isBackground(idx - w)) { visited[idx - w] = 1; stack[stackPtr++] = idx - w; }
    if (y < h - 1 && !visited[idx + w] && isBackground(idx + w)) { visited[idx + w] = 1; stack[stackPtr++] = idx + w; }
  }

  // Make visited pixels transparent, with soft edge at boundary
  for (let idx = 0; idx < total; idx++) {
    if (!visited[idx]) continue;
    const off = idx * 4;
    const x = idx % w;
    const y = (idx - x) / w;

    // Check if any non-visited neighbor exists (design boundary pixel)
    let nearEdge = false;
    if (x > 0     && !visited[idx - 1]) nearEdge = true;
    if (!nearEdge && x < w - 1 && !visited[idx + 1]) nearEdge = true;
    if (!nearEdge && y > 0     && !visited[idx - w]) nearEdge = true;
    if (!nearEdge && y < h - 1 && !visited[idx + w]) nearEdge = true;

    if (nearEdge) {
      const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
      const brightness = (r + g + b) / 3;
      if (brightness < 240) {
        // Soft edge: keep partial opacity for smoother blending
        const fade = Math.max(0, Math.min(255, Math.round(((brightness - 200) / 40) * 255)));
        pixels[off + 3] = Math.max(0, 255 - fade);
      } else {
        pixels[off + 3] = 0;
      }
    } else {
      pixels[off + 3] = 0;
    }
  }
}

// Analyze mockup image to detect t-shirt area via color region detection
async function detectShirtArea(mockupPath) {
  const sharp = require('sharp');
  const meta = await sharp(mockupPath).metadata();
  const ow = meta.width, oh = meta.height;

  // Downscale for faster processing (200px wide)
  const scale = 200 / ow;
  const sw = 200;
  const sh = Math.round(oh * scale);

  const { data, info } = await sharp(mockupPath)
    .resize(sw, sh)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Step 1: Sample the center column (where shirt always is) to find shirt color
  const centerX = Math.floor(info.width / 2);
  const sampleColors = [];
  // Sample from 20% to 60% of height (chest area)
  for (let y = Math.floor(info.height * 0.2); y < Math.floor(info.height * 0.6); y++) {
    // Sample 5 pixels across center
    for (let dx = -2; dx <= 2; dx++) {
      const x = centerX + dx * 5;
      if (x < 0 || x >= info.width) continue;
      const idx = (y * info.width + x) * 4;
      if (idx + 2 >= data.length) continue;
      sampleColors.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  if (sampleColors.length === 0) return null;

  // Step 2: Find dominant color cluster via simple averaging
  const avgR = Math.round(sampleColors.reduce((s, c) => s + c[0], 0) / sampleColors.length);
  const avgG = Math.round(sampleColors.reduce((s, c) => s + c[1], 0) / sampleColors.length);
  const avgB = Math.round(sampleColors.reduce((s, c) => s + c[2], 0) / sampleColors.length);

  // Step 3: Find matching pixels ONLY in the central zone (avoid background confusion)
  // Limit search to center 60% width, 15%-75% height — where the chest always is
  const threshold = 55;
  const searchMinX = Math.floor(info.width * 0.20);
  const searchMaxX = Math.floor(info.width * 0.80);
  const searchMinY = Math.floor(info.height * 0.15);
  const searchMaxY = Math.floor(info.height * 0.70);

  let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
  let shirtPixels = 0;
  const totalSearchPixels = (searchMaxX - searchMinX) * (searchMaxY - searchMinY);
  for (let y = searchMinY; y < searchMaxY; y++) {
    for (let x = searchMinX; x < searchMaxX; x++) {
      const idx = (y * info.width + x) * 4;
      if (idx + 2 >= data.length) continue;
      const dist = Math.sqrt((data[idx] - avgR) ** 2 + (data[idx+1] - avgG) ** 2 + (data[idx+2] - avgB) ** 2);
      if (dist < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        shirtPixels++;
      }
    }
  }

  // If not enough shirt pixels found in search zone, return null
  if (shirtPixels < totalSearchPixels * 0.08) {
    console.log('  [detect] Not enough shirt pixels found, using defaults');
    return null;
  }

  // Step 5: Calculate print area — small chest zone, NOT the whole shirt
  const shirtW = maxX - minX;
  const shirtH = maxY - minY;

  // Print area: 33% of shirt width, 22% of shirt height — just the chest zone
  const printW = Math.round(shirtW * 0.33);
  const printH = Math.round(shirtH * 0.22);
  const printX = Math.round(minX + (shirtW - printW) / 2); // centered horizontally
  const printY = Math.round(minY + shirtH * 0.20); // 20% down from shirt top (below collar, upper chest)

  // Scale back to original image dimensions
  const result = {
    x: Math.round(printX / scale),
    y: Math.round(printY / scale),
    w: Math.round(printW / scale),
    h: Math.round(printH / scale),
    shirtColor: { r: avgR, g: avgG, b: avgB },
    confidence: shirtPixels / (sw * sh),
  };

  console.log(`  [detect] Shirt color: R=${avgR} G=${avgG} B=${avgB} | Area: x=${result.x} y=${result.y} w=${result.w} h=${result.h} | Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  return result;
}

async function composeMockup(designPath, mockupPaths, sku) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in .env');

  if (!fs.existsSync(designPath)) {
    throw new Error(`Design not found: ${designPath}`);
  }

  const designBase64 = fs.readFileSync(designPath).toString('base64');
  const designExt = path.extname(designPath).toLowerCase();
  const designMime = designExt === '.png' ? 'image/png' : designExt === '.webp' ? 'image/webp' : 'image/jpeg';

  const outputPaths = [];

  for (let i = 0; i < mockupPaths.length; i++) {
    const mockupPath = path.resolve(mockupPaths[i]);
    if (!fs.existsSync(mockupPath)) {
      console.warn(`  Warning: Mockup not found, skipping: ${mockupPath}`);
      continue;
    }

    const mockupBase64 = fs.readFileSync(mockupPath).toString('base64');
    const mockupExt = path.extname(mockupPath).toLowerCase();
    const mockupMime = mockupExt === '.png' ? 'image/png' : mockupExt === '.webp' ? 'image/webp' : 'image/jpeg';

    console.log(`  Composing mockup ${i + 1}/${mockupPaths.length} via AI...`);

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
                image_url: { url: `data:${designMime};base64,${designBase64}` },
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mockupMime};base64,${mockupBase64}` },
              },
              {
                type: 'text',
                text: `First image is a design/graphic. Second image is a clothing mockup photo.

You MUST place the design onto the t-shirt mockup. Follow these rules EXACTLY:

POSITION:
- Find the chest area of the t-shirt (the flat front panel between collar and hem).
- Place the design CENTERED horizontally on the chest.
- Place the design in the UPPER-MIDDLE area of the chest (roughly 1/3 from collar, 2/3 from hem).

SIZE:
- The design width should be approximately 60-70% of the t-shirt's chest width (seam to seam). Make it LARGE and prominent.
- Maintain the design's original aspect ratio. Do NOT stretch, squash, or distort.
- The design should look like a bold, large screen-printed graphic.

QUALITY:
- Match the t-shirt's perspective, angle, and any rotation or fold.
- Apply subtle fabric texture, lighting, and wrinkles over the design so it looks naturally printed on the shirt.
- If the design has a white or solid background, remove it — only place the artwork itself.
- Do NOT alter the mockup photo in any way — same background, same colors, same everything. ONLY add the design.
- Do NOT add any borders, frames, or extra elements around the design.

OUTPUT: A single high-quality image of the mockup with the design placed on it.`,
              },
            ],
          },
        ],
        response_modalities: ['IMAGE', 'TEXT'],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Mockup compose failed: ${errBody}`);
    }

    const data = await response.json();
    console.log('  [DEBUG] Gemini mockup response structure:', JSON.stringify(data, null, 2).slice(0, 1500));

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No choices returned from OpenRouter');
    }

    const message = data.choices[0].message;
    console.log('  [DEBUG] message keys:', Object.keys(message));
    if (Array.isArray(message.content)) {
      console.log('  [DEBUG] content types:', message.content.map(p => p.type));
    }

    // Collect image parts from both message.content and message.images
    const imageParts = [];
    if (Array.isArray(message.content)) {
      imageParts.push(...message.content.filter(p => p.type === 'image_url'));
    }
    if (Array.isArray(message.images)) {
      imageParts.push(...message.images.filter(p => p.type === 'image_url'));
    }
    console.log('  [DEBUG] imageParts count:', imageParts.length);

    let saved = false;
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
        const outputName = `${sku}_mockup${i + 1}.png`;
        const outputPath = path.join(OUTPUT_DIR, outputName);
        fs.writeFileSync(outputPath, imgBuffer);
        console.log(`  Mockup saved: ${outputPath}`);
        outputPaths.push(outputPath);
        saved = true;
        break;
      }
    }

    if (!saved) {
      const msgContent = JSON.stringify(data.choices[0].message, null, 2).slice(0, 500);
      console.warn(`  Warning: No image in response for mockup ${i + 1}. Response: ${msgContent}`);
    }
  }

  if (outputPaths.length === 0) {
    const lastData = 'Check server terminal for full response';
    throw new Error('No mockups were generated - Gemini returned no images. ' + lastData);
  }

  return outputPaths;
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const designIdx = args.indexOf('--design');
  const mockupsIdx = args.indexOf('--mockups');
  const skuIdx = args.indexOf('--sku');

  if (designIdx === -1 || mockupsIdx === -1) {
    console.error('Usage: node compose-mockup.js --design <image> --mockups <m1.png,m2.png> [--sku <sku>]');
    process.exit(1);
  }

  const design = args[designIdx + 1];
  const mockups = args[mockupsIdx + 1].split(',');
  const sku = skuIdx !== -1 ? args[skuIdx + 1] : 'test';

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  composeMockup(design, mockups, sku).then(paths => {
    console.log(`  Generated ${paths.length} mockup(s)`);
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

// ── Background removal: flood fill from edges (safe for illustrations) ──
async function removeBackground(designBuffer) {
  const sharp = require('sharp');
  console.log('  Removing background with flood fill...');

  const { data: rawPixels, info } = await sharp(designBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(rawPixels);
  floodFillRemoveBackground(pixels, info.width, info.height);

  const result = await sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();

  let transparent = 0;
  for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] < 128) transparent++; }
  const pct = ((transparent / (info.width * info.height)) * 100).toFixed(0);
  console.log(`  Background removed: ${pct}% transparent`);

  return result;
}

// ── Auto-detect garment area in mockup for design placement ──
async function detectGarmentArea(mockupPath) {
  const sharp = require('sharp');
  // Downscale for faster analysis
  const scale = 0.25;
  const { data, info } = await sharp(mockupPath)
    .resize({ width: Math.round((await sharp(mockupPath).metadata()).width * scale) })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width, h = info.height;
  const invScale = 1 / scale;

  // Sample center region to get garment color (5x5 grid around center)
  const samples = [];
  for (let sy = -2; sy <= 2; sy++) {
    for (let sx = -2; sx <= 2; sx++) {
      const cx = Math.round(w / 2 + sx * (w * 0.02));
      const cy = Math.round(h * 0.4 + sy * (h * 0.02));
      const idx = (cy * w + cx) * 4;
      if (idx >= 0 && idx + 2 < data.length) {
        samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
      }
    }
  }
  if (samples.length === 0) return null;

  // Median color as garment color
  samples.sort((a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b));
  const mid = samples[Math.floor(samples.length / 2)];
  const gR = mid.r, gG = mid.g, gB = mid.b;

  // Scan for garment pixels (color distance < threshold)
  const tolerance = 50;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  // Also track horizontal extent per row for chest detection
  const rowExtent = new Array(h).fill(null);

  for (let y = 0; y < h; y++) {
    let rowMin = w, rowMax = 0, rowCount = 0;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const dr = Math.abs(data[idx] - gR);
      const dg = Math.abs(data[idx + 1] - gG);
      const db = Math.abs(data[idx + 2] - gB);
      if (dr < tolerance && dg < tolerance && db < tolerance) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < rowMin) rowMin = x;
        if (x > rowMax) rowMax = x;
        rowCount++;
      }
    }
    if (rowCount > w * 0.1) rowExtent[y] = { min: rowMin, max: rowMax, count: rowCount };
  }

  if (maxX <= minX || maxY <= minY) return null;

  const garmentW = maxX - minX;
  const garmentH = maxY - minY;

  // Find chest area: widest continuous rows in upper 60% of garment
  let bestChestY = minY + garmentH * 0.25;
  let bestChestWidth = 0;
  const chestSearchStart = Math.round(minY + garmentH * 0.15);
  const chestSearchEnd = Math.round(minY + garmentH * 0.55);
  for (let y = chestSearchStart; y < chestSearchEnd; y++) {
    if (rowExtent[y] && rowExtent[y].count > bestChestWidth) {
      bestChestWidth = rowExtent[y].count;
      bestChestY = y;
    }
  }

  // Design placement
  const designW = Math.round(garmentW * 0.33);
  const designH = Math.round(garmentH * 0.28);
  // Horizontal: use neckline rows center (first 5-10% of garment height).
  // At the neckline level, arms don't interfere so horizontal center is reliable.
  const neckStart = Math.round(minY + garmentH * 0.02);
  const neckEnd = Math.round(minY + garmentH * 0.12);
  const neckCenters = [];
  for (let y = neckStart; y < neckEnd; y++) {
    if (rowExtent[y] && rowExtent[y].count > garmentW * 0.15) {
      neckCenters.push((rowExtent[y].min + rowExtent[y].max) / 2);
    }
  }
  neckCenters.sort((a, b) => a - b);
  const centerX = neckCenters.length > 0
    ? neckCenters[Math.floor(neckCenters.length / 2)]
    : (minX + maxX) / 2;
  const designX = Math.round((centerX - designW / 2) * invScale);
  // Vertical: 38% of image height
  const designY = Math.round((h * 0.38 - designH / 2) * invScale);

  const result = {
    x: designX,
    y: designY,
    w: Math.round(designW * invScale),
    h: Math.round(designH * invScale),
  };

  console.log(`  Auto-detected garment: color=rgb(${gR},${gG},${gB}), area=${Math.round(garmentW*invScale)}x${Math.round(garmentH*invScale)}, design=${result.w}x${result.h} at (${result.x},${result.y})`);
  return result;
}

// ── Programmatic mockup composer using Sharp (no AI, no content filtering) ──
async function composeMockupSharp(designPath, mockupPaths, sku, opts) {
  const sharp = require('sharp');
  opts = opts || {};

  if (!fs.existsSync(designPath)) {
    throw new Error(`Design not found: ${designPath}`);
  }

  const rawDesignBuffer = fs.readFileSync(designPath);
  const outputPaths = [];
  const scaleFactor = opts.scale || 1.0;

  // Step 1: HD Upscale — ensure design is at least 2000px wide for 300 DPI quality
  const designInfo = await sharp(rawDesignBuffer).metadata();
  let hdBuffer = rawDesignBuffer;
  if (designInfo.width < 2000) {
    const upscaleWidth = 2000;
    hdBuffer = await sharp(rawDesignBuffer)
      .resize(upscaleWidth, null, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    console.log(`  HD upscale: ${designInfo.width}px -> ${upscaleWidth}px`);
  }

  // Step 2: Remove background — transparent BG always required
  let designBuffer = hdBuffer;
  const hdInfo = await sharp(hdBuffer).metadata();
  const hasAlpha = hdInfo.channels === 4;

  if (hasAlpha) {
    const { data, info } = await sharp(hdBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparentPixels = 0;
    const totalPixels = info.width * info.height;
    for (let p = 3; p < data.length; p += 4) {
      if (data[p] < 128) transparentPixels++;
    }
    if (transparentPixels / totalPixels > 0.05) {
      console.log('  Design already has transparency, skipping BG removal');
    } else {
      console.log('  Removing background from design...');
      designBuffer = await removeBackground(hdBuffer);
    }
  } else {
    console.log('  No alpha channel, removing background...');
    designBuffer = await removeBackground(hdBuffer);
  }

  for (let i = 0; i < mockupPaths.length; i++) {
    const mockupPath = path.resolve(mockupPaths[i]);
    if (!fs.existsSync(mockupPath)) {
      console.warn(`  Warning: Mockup not found, skipping: ${mockupPath}`);
      continue;
    }

    console.log(`  Composing mockup ${i + 1}/${mockupPaths.length} via Sharp...`);

    const mockupMeta = await sharp(mockupPath).metadata();
    const mw = mockupMeta.width;
    const mh = mockupMeta.height;

    // Check for per-template custom position (print area rectangle)
    const tplName = path.basename(mockupPath);
    const overridePos = opts.positionOverrides && opts.positionOverrides[tplName];
    const pos = overridePos ? normalizePos(overridePos) : getPositionForTemplate(mockupPath, opts);
    let printArea; // { x, y, width, height } in original image coords

    if (pos) {
      printArea = { x: pos.x, y: pos.y, width: pos.width, height: pos.height, rotation: pos.rotation || 0 };
    } else {
      console.warn(`  SKIPPING ${tplName} - no calibrated position. Calibrate it first.`);
      if (opts.sendSSE) opts.sendSSE({ type: 'warning', message: `Kalibre edilmemis, atlandi: ${tplName}` });
      continue;
    }
    // Scale design target size within print area
    const designWidth = Math.round(printArea.width * scaleFactor);
    const designHeight = Math.round(printArea.height * scaleFactor);
    // Print area top-left stays fixed; design is centered within it
    const areaLeft = printArea.x;
    const areaTop = printArea.y;

    // Remove white background from design using flood-fill from edges.
    // Only when opts.removeBg is set by the user. Skip if the design already has
    // meaningful transparency (pre-cut PNG).
    let inputBuffer = designBuffer;

    if (!opts.whiteMode) {
      const { data: rawPixels, info } = await sharp(designBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let transparentCount = 0;
      const totalPixels = info.width * info.height;
      for (let i = 3; i < rawPixels.length; i += 4) {
        if (rawPixels[i] < 250) transparentCount++;
      }
      const hasTransparency = transparentCount / totalPixels > 0.05;

      if (hasTransparency || !opts.removeBg) {
        if (hasTransparency) {
          console.log(`  Design already has transparency (${(transparentCount/totalPixels*100).toFixed(0)}%) - skipping bg removal`);
        } else {
          console.log('  removeBg off - using design as-is');
        }
        inputBuffer = await sharp(rawPixels, {
          raw: { width: info.width, height: info.height, channels: 4 },
        }).png().toBuffer();
      } else {
        console.log('  Removing white background (flood-fill)...');
        const pixels = Buffer.from(rawPixels);
        floodFillRemoveBackground(pixels, info.width, info.height);
        inputBuffer = await sharp(pixels, {
          raw: { width: info.width, height: info.height, channels: 4 },
        }).png().toBuffer();
      }
    } else {
      const designMeta = await sharp(designBuffer).metadata();
      inputBuffer = await sharp({
        create: { width: designMeta.width, height: designMeta.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } }
      }).composite([{ input: designBuffer, blend: 'over' }]).png().toBuffer();
    }

    const resizedDesign = await sharp(inputBuffer)
      .rotate() // EXIF orientation normalization
      .resize(designWidth, designHeight, {
        fit: 'inside',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: 'lanczos3',
      })
      .png()
      .toBuffer();

    // Apply rotation if set
    let finalDesign = resizedDesign;
    if (printArea.rotation) {
      finalDesign = await sharp(resizedDesign)
        .rotate(printArea.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    }

    const finalMeta = await sharp(finalDesign).metadata();
    // Center design within the print area rectangle
    const actualLeft = Math.round(areaLeft + (printArea.width - finalMeta.width) / 2);
    const actualTop = Math.round(areaTop + (printArea.height - finalMeta.height) / 2);

    // Apply 85% opacity to design for natural printed look
    const designWithOpacity = await sharp(resizedDesign)
      .ensureAlpha()
      .linear(1, 0) // keep colors
      .composite([{
        input: Buffer.from([255, 255, 255, Math.round(255 * 0.85)]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in', // apply opacity mask
      }])
      .png()
      .toBuffer();

    const outputName = `${sku}_mockup${i + 1}.png`;
    const outputPath = path.join(OUTPUT_DIR, outputName);

    const composites = [{
      input: finalDesign,
      left: actualLeft,
      top: actualTop,
      blend: 'over',
    }];

    // Debug overlay: red dashed rectangle showing print area
    if (opts.debug) {
      const debugSvg = Buffer.from(`<svg width="${mw}" height="${mh}">
        <rect x="${printArea.x}" y="${printArea.y}" width="${printArea.width}" height="${printArea.height}"
              fill="none" stroke="red" stroke-width="4" stroke-dasharray="20,10" />
        <text x="${printArea.x + 8}" y="${printArea.y - 8}" fill="red" font-size="28" font-family="sans-serif">
          ${printArea.width}x${printArea.height} @ (${printArea.x},${printArea.y})
        </text>
      </svg>`);
      composites.push({ input: debugSvg, left: 0, top: 0, blend: 'over' });
    }

    await sharp(mockupPath)
      .composite(composites)
      .png()
      .toFile(outputPath);

    console.log(`  Mockup saved: ${outputPath}`);
    outputPaths.push(outputPath);
  }

  if (outputPaths.length === 0) {
    throw new Error('No mockups were generated');
  }

  return outputPaths;
}

async function composeSingleMockupSharp(designPath, mockupPath, outputPath, opts) {
  const sharp = require('sharp');
  opts = opts || {};

  const designBuffer = fs.readFileSync(designPath);
  const mockupMeta = await sharp(mockupPath).metadata();
  const mw = mockupMeta.width;
  const mh = mockupMeta.height;

  const scaleFactor = opts.scale || 1.0;
  const pos = getPositionForTemplate(mockupPath, opts);
  let printArea;

  if (pos) {
    printArea = { x: pos.x, y: pos.y, width: pos.width, height: pos.height, rotation: pos.rotation || 0 };
  } else {
    const tplName = path.basename(mockupPath);
    throw new Error(`Kalibre edilmemis mockup: ${tplName}. Kalibrasyon ekranindan ayarlayin.`);
  }

  const designWidth = Math.round(printArea.width * scaleFactor);
  const designHeight = Math.round(printArea.height * scaleFactor);

  // Resize design (high quality lanczos3)
  const resizedDesign = await sharp(designBuffer)
    .rotate() // EXIF orientation normalization
    .resize(designWidth, designHeight, {
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    })
    .ensureAlpha()
    .png()
    .toBuffer();

  // Apply rotation if set
  let rotatedDesign = resizedDesign;
  if (printArea.rotation) {
    rotatedDesign = await sharp(resizedDesign)
      .rotate(printArea.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }

  const rotMeta = await sharp(rotatedDesign).metadata();
  const rw = rotMeta.width;
  const rh = rotMeta.height;
  // Center design within print area rectangle
  const actualLeft = Math.round(printArea.x + (printArea.width - rw) / 2);
  const actualTop = Math.round(printArea.y + (printArea.height - rh) / 2);

  // Check if design already has transparency — skip bg removal if pre-cut
  const { data, info } = await sharp(rotatedDesign)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let transparentCount = 0;
  const totalPx = info.width * info.height;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) transparentCount++;
  }
  const hasAlpha = transparentCount / totalPx > 0.05;

  let transparentDesign;
  if (hasAlpha || !opts.removeBg) {
    if (hasAlpha) {
      console.log(`  Design already has transparency (${(transparentCount/totalPx*100).toFixed(0)}%) - skipping bg removal`);
    } else {
      console.log('  removeBg off - using design as-is');
    }
    transparentDesign = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer();
  } else {
    console.log('  Removing white background (flood-fill)...');
    const pixels = Buffer.from(data);
    floodFillRemoveBackground(pixels, info.width, info.height);
    transparentDesign = await sharp(pixels, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer();
  }

  // Composite design onto mockup (no shadow -- keep it clean)
  const composites = [{
    input: transparentDesign,
    left: actualLeft,
    top: actualTop,
    blend: 'over',
  }];

  if (opts.debug) {
    const debugSvg = Buffer.from(`<svg width="${mw}" height="${mh}">
      <rect x="${printArea.x}" y="${printArea.y}" width="${printArea.width}" height="${printArea.height}"
            fill="none" stroke="red" stroke-width="4" stroke-dasharray="20,10" />
      <text x="${printArea.x + 8}" y="${printArea.y - 8}" fill="red" font-size="28" font-family="sans-serif">
        ${printArea.width}x${printArea.height} @ (${printArea.x},${printArea.y})
      </text>
    </svg>`);
    composites.push({ input: debugSvg, left: 0, top: 0, blend: 'over' });
  }

  await sharp(mockupPath)
    .composite(composites)
    .png()
    .toFile(outputPath);

  return outputPath;
}

module.exports = { composeMockup, composeMockupSharp, composeSingleMockupSharp, removeBackground, detectGarmentArea, normalizePos, POSITIONS_FILE };
