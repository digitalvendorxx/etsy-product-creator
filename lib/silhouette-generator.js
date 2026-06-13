// Per-piece silhouette pipeline:
//   1. AI-generate a clean black-on-white silhouette PNG for each piece (cached on disk)
//   2. Potrace → SVG path
//   3. Flatten the SVG path to a polygon (array of [x,y] points in normalized 0..1)
//   4. Cache the polygon as JSON so subsequent runs are instant
// Public API: getThemeSilhouettes(theme, { apiKey, onProgress }) → { [pieceName]: { polygon, srcPng } }

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const potrace = require('potrace');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { fetchWithRetry } = require('./fetch-retry');

const ROOT = path.join(__dirname, '..');
const SIL_DIR = path.join(ROOT, 'designs', 'silhouettes');

function safe(s) { return String(s).replace(/[^a-z0-9_-]/gi, '_'); }

function pieceLabel(piece) {
  // Plain English name, e.g. "COW", "T-REX", "POLAR BEAR" — strip extra punctuation
  return (piece.name || '').replace(/[_]+/g, ' ').trim() || 'shape';
}

function buildPrompt(piece) {
  const label = pieceLabel(piece).toLowerCase();
  return [
    `Single solid flat silhouette of one ${label}.`,
    `Pure SOLID BLACK filled shape on a PURE WHITE background.`,
    `No details, no shading, no gradients, no outlines, no eyes, no text, no captions.`,
    `Side-profile view (or three-quarter if natural), the entire ${label} as one connected shape.`,
    `Centered, fills about 80% of the frame, soft natural proportions.`,
    `Square 1024x1024, child-safe puzzle-piece style — chunky simple silhouette like a wooden toy cut-out.`,
    `Output: only the silhouette, nothing else.`,
  ].join(' ');
}

async function callGeminiImage(prompt, apiKey) {
  const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Etsy Product Creator - Silhouette',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      response_modalities: ['IMAGE', 'TEXT'],
    }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await response.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error('No message in response');
  const imageParts = [];
  if (Array.isArray(msg.content)) imageParts.push(...msg.content.filter(p => p.type === 'image_url'));
  if (Array.isArray(msg.images)) imageParts.push(...msg.images.filter(p => p.type === 'image_url'));
  for (const part of imageParts) {
    const url = part.image_url?.url;
    if (!url) continue;
    if (url.startsWith('data:')) return Buffer.from(url.split(',')[1], 'base64');
    const r = await fetch(url);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error('No image in silhouette response');
}

// ── PNG prep: threshold + slight median filter so potrace sees a clean mask ──
async function preprocessSilhouette(srcPng, dstPng) {
  await sharp(srcPng)
    .grayscale()
    .normalise()
    .threshold(170)                 // crisp black/white
    .median(2)                      // kill speckle
    .toFormat('png')
    .toFile(dstPng);
}

// ── potrace → SVG path string ──────────────────────────────────────────────
function tracePng(pngPath) {
  return new Promise((resolve, reject) => {
    potrace.trace(
      pngPath,
      {
        turdSize: 100,
        alphaMax: 1.0,
        optCurve: true,
        optTolerance: 0.4,
        threshold: 128,
        blackOnWhite: true,
      },
      (err, svg) => err ? reject(err) : resolve(svg)
    );
  });
}

// Parse the largest outer polygon from a potrace SVG (it emits a single <path d="M ... Z M ... Z" />).
// We flatten by parsing path commands, sampling Bezier curves, and keeping the LARGEST subpath by area.
function pathToPolygons(d) {
  // Tokenise commands
  const tokens = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push({ op: m[1] });
    else tokens.push({ num: parseFloat(m[2]) });
  }

  const polys = [];
  let cur = [];
  let px = 0, py = 0;       // current point
  let sx = 0, sy = 0;       // subpath start
  let lastCtrl = null;      // for S/T smooth-curve continuation
  let i = 0;

  function flatQuad(x0, y0, x1, y1, x2, y2, steps = 12) {
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const x = u * u * x0 + 2 * u * t * x1 + t * t * x2;
      const y = u * u * y0 + 2 * u * t * y1 + t * t * y2;
      cur.push([x, y]);
    }
  }
  function flatCubic(x0, y0, x1, y1, x2, y2, x3, y3, steps = 16) {
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const x = u*u*u*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3;
      const y = u*u*u*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3;
      cur.push([x, y]);
    }
  }

  while (i < tokens.length) {
    if (!tokens[i].op) { i++; continue; }
    const op = tokens[i].op;
    i++;
    const grab = () => {
      const v = tokens[i]; if (!v || v.op !== undefined) return null;
      i++; return v.num;
    };
    const upper = op.toUpperCase();
    const rel = op !== upper;

    if (upper === 'M') {
      while (i < tokens.length && tokens[i].op === undefined) {
        const x = grab(); const y = grab();
        const tx = rel ? px + x : x;
        const ty = rel ? py + y : y;
        if (cur.length === 0) { cur.push([tx, ty]); sx = tx; sy = ty; }
        else { cur.push([tx, ty]); }
        px = tx; py = ty;
        // Subsequent pairs after M are treated as implicit L
        if (i < tokens.length && tokens[i].op === undefined) {
          // continue same M as L
          const nx = grab(); const ny = grab();
          const lx = rel ? px + nx : nx;
          const ly = rel ? py + ny : ny;
          cur.push([lx, ly]);
          px = lx; py = ly;
        }
      }
      lastCtrl = null;
    } else if (upper === 'L') {
      while (i < tokens.length && tokens[i].op === undefined) {
        const x = grab(); const y = grab();
        const tx = rel ? px + x : x;
        const ty = rel ? py + y : y;
        cur.push([tx, ty]);
        px = tx; py = ty;
      }
      lastCtrl = null;
    } else if (upper === 'H') {
      while (i < tokens.length && tokens[i].op === undefined) {
        const x = grab();
        const tx = rel ? px + x : x;
        cur.push([tx, py]);
        px = tx;
      }
      lastCtrl = null;
    } else if (upper === 'V') {
      while (i < tokens.length && tokens[i].op === undefined) {
        const y = grab();
        const ty = rel ? py + y : y;
        cur.push([px, ty]);
        py = ty;
      }
      lastCtrl = null;
    } else if (upper === 'C') {
      while (i < tokens.length && tokens[i].op === undefined) {
        const x1 = grab(), y1 = grab(), x2 = grab(), y2 = grab(), x = grab(), y = grab();
        const ax1 = rel ? px + x1 : x1, ay1 = rel ? py + y1 : y1;
        const ax2 = rel ? px + x2 : x2, ay2 = rel ? py + y2 : y2;
        const tx = rel ? px + x : x, ty = rel ? py + y : y;
        flatCubic(px, py, ax1, ay1, ax2, ay2, tx, ty);
        lastCtrl = [ax2, ay2];
        px = tx; py = ty;
      }
    } else if (upper === 'S') {
      while (i < tokens.length && tokens[i].op === undefined) {
        const x2 = grab(), y2 = grab(), x = grab(), y = grab();
        const ax1 = lastCtrl ? 2 * px - lastCtrl[0] : px;
        const ay1 = lastCtrl ? 2 * py - lastCtrl[1] : py;
        const ax2 = rel ? px + x2 : x2, ay2 = rel ? py + y2 : y2;
        const tx = rel ? px + x : x, ty = rel ? py + y : y;
        flatCubic(px, py, ax1, ay1, ax2, ay2, tx, ty);
        lastCtrl = [ax2, ay2];
        px = tx; py = ty;
      }
    } else if (upper === 'Q') {
      while (i < tokens.length && tokens[i].op === undefined) {
        const x1 = grab(), y1 = grab(), x = grab(), y = grab();
        const ax1 = rel ? px + x1 : x1, ay1 = rel ? py + y1 : y1;
        const tx = rel ? px + x : x, ty = rel ? py + y : y;
        flatQuad(px, py, ax1, ay1, tx, ty);
        lastCtrl = [ax1, ay1];
        px = tx; py = ty;
      }
    } else if (upper === 'T') {
      while (i < tokens.length && tokens[i].op === undefined) {
        const x = grab(), y = grab();
        const ax1 = lastCtrl ? 2 * px - lastCtrl[0] : px;
        const ay1 = lastCtrl ? 2 * py - lastCtrl[1] : py;
        const tx = rel ? px + x : x, ty = rel ? py + y : y;
        flatQuad(px, py, ax1, ay1, tx, ty);
        lastCtrl = [ax1, ay1];
        px = tx; py = ty;
      }
    } else if (upper === 'Z') {
      if (cur.length > 2) {
        if (cur[0][0] !== px || cur[0][1] !== py) cur.push([sx, sy]);
        polys.push(cur);
      }
      cur = [];
      px = sx; py = sy;
      lastCtrl = null;
    } else {
      // Unsupported (e.g. A arc) — skip until next op
      while (i < tokens.length && tokens[i].op === undefined) i++;
    }
  }
  if (cur.length > 2) polys.push(cur);
  return polys;
}

function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return Math.abs(a) / 2;
}

// Douglas-Peucker simplification
function simplify(poly, epsilon) {
  if (poly.length < 3) return poly;
  function dperp(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx*dx + dy*dy);
    const tt = Math.max(0, Math.min(1, t));
    const xx = a[0] + tt * dx, yy = a[1] + tt * dy;
    return Math.hypot(p[0] - xx, p[1] - yy);
  }
  function rec(pts, first, last, keep) {
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = dperp(pts[i], pts[first], pts[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilon) {
      rec(pts, first, idx, keep);
      rec(pts, idx, last, keep);
    } else {
      keep.push(last);
    }
  }
  const keep = [0];
  rec(poly, 0, poly.length - 1, keep);
  return keep.sort((a, b) => a - b).map(i => poly[i]);
}

// Pull the SVG viewport (width/height) so we can normalize the polygon to 0..1.
function svgDims(svg) {
  const wm = svg.match(/<svg[^>]+width="([\d.]+)"/);
  const hm = svg.match(/<svg[^>]+height="([\d.]+)"/);
  return { w: wm ? parseFloat(wm[1]) : 1024, h: hm ? parseFloat(hm[1]) : 1024 };
}

function svgPathD(svg) {
  const m = svg.match(/<path[^>]*d="([^"]+)"/);
  return m ? m[1] : '';
}

async function ensurePiece(themeId, piece, apiKey) {
  const dir = path.join(SIL_DIR, safe(themeId));
  fs.mkdirSync(dir, { recursive: true });
  const base = safe(pieceLabel(piece).toUpperCase());
  const rawPng = path.join(dir, `${base}.raw.png`);
  const cleanPng = path.join(dir, `${base}.png`);
  const jsonPath = path.join(dir, `${base}.json`);

  // 0. Cached final polygon? Use it.
  if (fs.existsSync(jsonPath)) {
    try { return JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {}
  }

  // 1. Source PNG (cached if AI already produced one).
  if (!fs.existsSync(rawPng)) {
    if (!apiKey) throw new Error('OPENROUTER_API_KEY required for silhouette generation');
    const buf = await callGeminiImage(buildPrompt(piece), apiKey);
    fs.writeFileSync(rawPng, buf);
  }

  // 2. Clean threshold mask.
  await preprocessSilhouette(rawPng, cleanPng);

  // 3. Trace.
  const svg = await tracePng(cleanPng);
  const dims = svgDims(svg);
  const d = svgPathD(svg);
  if (!d) throw new Error('potrace returned no path');
  const polys = pathToPolygons(d);
  if (!polys.length) throw new Error('no polygons traced');

  // Pick the largest polygon by area as the outer silhouette.
  polys.sort((a, b) => polygonArea(b) - polygonArea(a));
  const outer = polys[0];

  // Normalize to 0..1 within SVG bounds (Y-flip so DXF Y is up).
  let normalized = outer.map(([x, y]) => [x / dims.w, 1 - y / dims.h]);

  // Simplify to ~100 vertices (target).
  let eps = 0.0008;
  for (let attempt = 0; attempt < 6; attempt++) {
    const simplified = simplify(normalized, eps);
    if (simplified.length <= 160) { normalized = simplified; break; }
    eps *= 1.5;
  }
  // Close the polygon if not closed
  if (normalized.length > 1) {
    const a = normalized[0], b = normalized[normalized.length - 1];
    if (Math.abs(a[0] - b[0]) > 1e-6 || Math.abs(a[1] - b[1]) > 1e-6) normalized.push([a[0], a[1]]);
  }

  const out = {
    pieceName: pieceLabel(piece),
    emoji: piece.emoji,
    vertexCount: normalized.length,
    polygon: normalized,
    srcPng: path.relative(ROOT, rawPng),
    cleanPng: path.relative(ROOT, cleanPng),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  return out;
}

async function getThemeSilhouettes(theme, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
  const results = {};
  const onProgress = opts.onProgress || (() => {});
  let idx = 0;
  for (const piece of theme.pieces || []) {
    idx++;
    onProgress({ idx, total: theme.pieces.length, piece });
    try {
      results[pieceLabel(piece)] = await ensurePiece(theme.id, piece, apiKey);
    } catch (err) {
      results[pieceLabel(piece)] = { error: err.message, pieceName: pieceLabel(piece), emoji: piece.emoji };
    }
  }
  return results;
}

module.exports = { getThemeSilhouettes, ensurePiece, SIL_DIR };

if (require.main === module) {
  const args = process.argv.slice(2);
  const themeIdx = args.indexOf('--theme');
  if (themeIdx === -1) { console.error('Usage: --theme <id>'); process.exit(1); }
  const themeId = args[themeIdx + 1];
  const catalog = require(path.join(ROOT, 'data', 'puzzle-catalog.json'));
  const theme = catalog.find(t => t.id === themeId);
  if (!theme) { console.error('theme not found'); process.exit(1); }
  console.log('Generating silhouettes for', theme.name);
  getThemeSilhouettes(theme, {
    onProgress: ({ idx, total, piece }) => console.log(`  [${idx}/${total}] ${piece.emoji} ${piece.name}`),
  }).then(r => {
    const ok = Object.values(r).filter(v => !v.error).length;
    console.log(`done: ${ok}/${Object.keys(r).length} ok`);
    for (const [k, v] of Object.entries(r)) {
      if (v.error) console.log(`  FAIL ${k}: ${v.error}`);
      else console.log(`  ${k}: ${v.vertexCount} verts`);
    }
  }).catch(e => { console.error(e.stack || e.message); process.exit(1); });
}
