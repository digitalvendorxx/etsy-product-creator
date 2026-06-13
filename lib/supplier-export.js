// Supplier-export: per-draft files for the laser-cut shop.
// Inputs: chosen alternative PNG + theme metadata + child name.
// Outputs:
//   output/{sku}/{sku}-cizgi.dxf   - 415x275mm board: outer frame + piece slots + name letter outlines
//   output/{sku}/{sku}-isim.dxf    - just name letter outlines (same coords)
//   output/{sku}/{sku}-baski.pdf   - 425x285mm print sheet (5mm bleed each side) with the AI artwork
// Notes:
//   - All DXF coordinates are in millimeters, AutoCAD-compatible AC1009 (R12).
//   - Letter outlines come from Fredoka (Google Fonts OFL) via opentype.js, Q-curves
//     flattened to a polyline.
//   - Piece slots are rounded-rectangle approximations (not theme silhouettes).

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const opentype = require('opentype.js');
const { getThemeSilhouettes } = require('./silhouette-generator');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
// Mali Bold matches typical Etsy busy-puzzle letter shapes (thick, chunky, rounded).
// Fallback to Fredoka if Mali missing.
const FONT_CANDIDATES = [
  path.join(ROOT, 'assets', 'fonts', 'Mali-Bold.ttf'),
  path.join(ROOT, 'assets', 'fonts', 'BalooBhai2-Bold.ttf'),
  path.join(ROOT, 'assets', 'fonts', 'Fredoka.ttf'),
];
const FONT_PATH = FONT_CANDIDATES.find(p => fs.existsSync(p));

// Board geometry (mm) — matched to Leonard-R reference: page 425×280, board 420×275 centered.
const BOARD_W = 420;
const BOARD_H = 275;
const BLEED_X = 2.5;
const BLEED_Y = 2.5;
const PRINT_W = BOARD_W + 2 * BLEED_X;  // 425
const PRINT_H = BOARD_H + 2 * BLEED_Y;  // 280

const MARGIN_X = 18;
const MARGIN_Y = 18;
const ROW_GAP = 6;
const COL_GAP = 6;

// ── Font loading (lazy) ──────────────────────────────────────────────────
let _font = null;
function getFont() {
  if (_font) return _font;
  const buf = fs.readFileSync(FONT_PATH);
  _font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return _font;
}

// ── Layout: split N pieces into top/bottom rows ──────────────────────────
function layoutSlots(pieceCount) {
  const top = Math.ceil(pieceCount / 2);
  const bot = Math.floor(pieceCount / 2);
  const cols = Math.max(top, bot);
  const slotW = (BOARD_W - 2 * MARGIN_X - (cols - 1) * COL_GAP) / cols;
  const usableH = BOARD_H - 2 * MARGIN_Y - 2 * ROW_GAP;
  const slotH = usableH / 3; // three bands: top pieces, name, bottom pieces

  const yBotPieces = MARGIN_Y;
  const yName = yBotPieces + slotH + ROW_GAP;
  const yTopPieces = yName + slotH + ROW_GAP;

  const slot = (i, total, y) => {
    const offset = (cols - total) / 2; // center if short row
    const x = MARGIN_X + (i + offset) * (slotW + COL_GAP);
    return { x, y, w: slotW, h: slotH };
  };
  return {
    topSlots: Array.from({ length: top }, (_, i) => slot(i, top, yTopPieces)),
    botSlots: Array.from({ length: bot }, (_, i) => slot(i, bot, yBotPieces)),
    nameBand: { x: MARGIN_X, y: yName, w: BOARD_W - 2 * MARGIN_X, h: slotH },
  };
}

// ── Flatten Q-curve to polyline (recursive subdivision) ──────────────────
function flattenQ(x0, y0, cx, cy, x1, y1, tol, out) {
  const ex = (x0 + 2 * cx + x1) / 4 - (x0 + x1) / 2;
  const ey = (y0 + 2 * cy + y1) / 4 - (y0 + y1) / 2;
  if (ex * ex + ey * ey < tol * tol) {
    out.push([x1, y1]);
    return;
  }
  const x01 = (x0 + cx) / 2, y01 = (y0 + cy) / 2;
  const x12 = (cx + x1) / 2, y12 = (cy + y1) / 2;
  const xm = (x01 + x12) / 2, ym = (y01 + y12) / 2;
  flattenQ(x0, y0, x01, y01, xm, ym, tol, out);
  flattenQ(xm, ym, x12, y12, x1, y1, tol, out);
}

function pathToPolylines(path, tol = 0.012) {
  const polys = [];
  let cur = null;
  let lastX = 0, lastY = 0;
  for (const c of path.commands) {
    if (c.type === 'M') {
      if (cur && cur.length > 1) polys.push(cur);
      cur = [[c.x, c.y]];
      lastX = c.x; lastY = c.y;
    } else if (c.type === 'L') {
      cur.push([c.x, c.y]);
      lastX = c.x; lastY = c.y;
    } else if (c.type === 'Q') {
      flattenQ(lastX, lastY, c.x1, c.y1, c.x, c.y, tol, cur);
      lastX = c.x; lastY = c.y;
    } else if (c.type === 'C') {
      // Approximate cubic as 4 line segments — Fredoka doesn't use C but be safe.
      cur.push([c.x1, c.y1], [c.x2, c.y2], [c.x, c.y]);
      lastX = c.x; lastY = c.y;
    } else if (c.type === 'Z') {
      if (cur && cur.length > 1) {
        const [fx, fy] = cur[0];
        if (cur[cur.length - 1][0] !== fx || cur[cur.length - 1][1] !== fy) cur.push([fx, fy]);
        polys.push(cur);
      }
      cur = null;
    }
  }
  if (cur && cur.length > 1) polys.push(cur);
  return polys;
}

// ── Letter outlines for the name ─────────────────────────────────────────
function nameGlyphsPolylines(name, band) {
  const font = getFont();
  const cap = (name || 'NAME').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'NAME';
  // Pick font size so the name fits inside the band with vertical padding.
  const verticalPad = 8;
  const horizontalPad = 8;
  const maxHeight = band.h - 2 * verticalPad;
  const maxWidth = band.w - 2 * horizontalPad;

  // Probe at 100u → measure → scale
  const probe = font.getPath(cap, 0, 0, 100);
  const pbox = probe.getBoundingBox();
  const probeW = pbox.x2 - pbox.x1;
  const probeH = pbox.y2 - pbox.y1;
  const scale = Math.min(maxWidth / probeW, maxHeight / probeH);
  const size = 100 * scale;

  const finalPath = font.getPath(cap, 0, 0, size);
  const fbox = finalPath.getBoundingBox();
  const w = fbox.x2 - fbox.x1;
  const h = fbox.y2 - fbox.y1;

  // Center within band; DXF Y-up so flip Y.
  const offsetX = band.x + (band.w - w) / 2 - fbox.x1;
  const offsetY = band.y + (band.h - h) / 2 - fbox.y1; // we still need to flip
  // opentype path uses Y-down. To convert to DXF Y-up, negate y after offset.
  const polys = pathToPolylines(finalPath);
  return polys.map(poly => poly.map(([px, py]) => {
    const x = px + offsetX;
    // Reflect Y around band center: y' = band.y + band.h - (py + (offsetY - band.y))
    const y = band.y + band.h - (py + offsetY - band.y);
    return [round(x), round(y)];
  }));
}

function round(v) { return Math.round(v * 1000) / 1000; }

// ── DXF emit helpers (AC1009, mm) ────────────────────────────────────────
function dxfHeader() {
  return [
    '  0', 'SECTION',
    '  2', 'HEADER',
    '  9', '$ACADVER', '  1', 'AC1009',
    '  9', '$INSUNITS', ' 70', '     4', // millimeters
    '  9', '$EXTMIN', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
    '  9', '$EXTMAX', ' 10', String(BOARD_W), ' 20', String(BOARD_H), ' 30', '0.0',
    '  0', 'ENDSEC',
    '  0', 'SECTION',
    '  2', 'TABLES',
    '  0', 'TABLE', '  2', 'LAYER', ' 70', '     3',
    '  0', 'LAYER', '  2', 'CUT',     ' 70', '     0', ' 62', '     1', '  6', 'CONTINUOUS',
    '  0', 'LAYER', '  2', 'FRAME',   ' 70', '     0', ' 62', '     5', '  6', 'CONTINUOUS',
    '  0', 'LAYER', '  2', 'NAME',    ' 70', '     0', ' 62', '     3', '  6', 'CONTINUOUS',
    '  0', 'ENDTAB',
    '  0', 'ENDSEC',
    '  0', 'SECTION',
    '  2', 'ENTITIES',
  ].join('\n');
}

function dxfFooter() {
  return ['  0', 'ENDSEC', '  0', 'EOF', ''].join('\n');
}

function emitPolyline(layer, pts, closed = true) {
  if (!pts || pts.length < 2) return '';
  const out = [
    '  0', 'POLYLINE',
    '  8', layer,
    ' 66', '     1',
    ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
    ' 70', String(closed ? '     1' : '     0'),
  ];
  for (const [x, y] of pts) {
    out.push('  0', 'VERTEX', '  8', layer, ' 10', String(x), ' 20', String(y), ' 30', '0.0');
  }
  out.push('  0', 'SEQEND');
  return out.join('\n');
}

// Rounded rectangle (approximated as line segments)
function roundedRectPoints(x, y, w, h, r, steps = 8) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  // start at left edge above bottom-left arc, go counter-clockwise
  const arc = (cx, cy, a0, a1) => {
    for (let i = 0; i <= steps; i++) {
      const t = a0 + (a1 - a0) * (i / steps);
      pts.push([round(cx + r * Math.cos(t)), round(cy + r * Math.sin(t))]);
    }
  };
  arc(x + r,     y + r,     Math.PI,         1.5 * Math.PI); // bottom-left
  arc(x + w - r, y + r,     1.5 * Math.PI,   2 * Math.PI);   // bottom-right
  arc(x + w - r, y + h - r, 0,               0.5 * Math.PI); // top-right
  arc(x + r,     y + h - r, 0.5 * Math.PI,   Math.PI);       // top-left
  return pts;
}

// Fit a normalized [0..1, 0..1] polygon into a slot rectangle, preserving aspect.
function fitPolygonToSlot(polygon, slot, padding = 5) {
  if (!polygon || !polygon.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pw = maxX - minX, ph = maxY - minY;
  if (pw <= 0 || ph <= 0) return null;
  const availW = slot.w - 2 * padding;
  const availH = slot.h - 2 * padding;
  const s = Math.min(availW / pw, availH / ph);
  const drawnW = pw * s, drawnH = ph * s;
  const offX = slot.x + (slot.w - drawnW) / 2 - minX * s;
  const offY = slot.y + (slot.h - drawnH) / 2 - minY * s;
  return polygon.map(([x, y]) => [round(x * s + offX), round(y * s + offY)]);
}

// ── Public: build all three supplier files for one draft ─────────────────
async function exportSupplierFiles({ sku, theme, childName, altPngPath, apiKey, onProgress }) {
  if (!sku || !theme || !altPngPath) throw new Error('sku, theme, altPngPath required');
  if (!fs.existsSync(altPngPath)) throw new Error('Alt PNG not found: ' + altPngPath);

  const dir = path.join(OUTPUT_DIR, sku);
  fs.mkdirSync(dir, { recursive: true });

  const pieces = theme.pieces || [];
  const pieceCount = pieces.length || 8;
  const layout = layoutSlots(pieceCount);
  const namePolys = nameGlyphsPolylines(childName, layout.nameBand);

  // Resolve real silhouettes for this theme (cached on disk, generated on first call).
  let silhouettes = {};
  let silhouetteErrors = [];
  try {
    silhouettes = await getThemeSilhouettes(theme, { apiKey, onProgress });
    silhouetteErrors = Object.entries(silhouettes)
      .filter(([, v]) => v && v.error)
      .map(([k, v]) => `${k}: ${v.error}`);
  } catch (err) {
    silhouetteErrors.push('silhouette pipeline failed: ' + err.message);
  }

  // Build cizgi.dxf
  let cizgi = dxfHeader();
  // Frame
  cizgi += '\n' + emitPolyline('FRAME', [
    [0, 0], [BOARD_W, 0], [BOARD_W, BOARD_H], [0, BOARD_H],
  ], true);

  // Map pieces to slots: top row uses first ceil(N/2), bottom uses the rest.
  const topCount = layout.topSlots.length;
  const slotsInOrder = [...layout.topSlots, ...layout.botSlots];
  for (let i = 0; i < pieces.length && i < slotsInOrder.length; i++) {
    const piece = pieces[i];
    const slot = slotsInOrder[i];
    const sil = silhouettes[(piece.name || '').replace(/[_]+/g, ' ').trim()] || silhouettes[piece.name];
    let pts = null;
    if (sil && !sil.error && sil.polygon && sil.polygon.length > 3) {
      pts = fitPolygonToSlot(sil.polygon, slot, 5);
    }
    if (!pts) {
      // Fallback: rounded rectangle when silhouette unavailable.
      pts = roundedRectPoints(slot.x, slot.y, slot.w, slot.h, Math.min(slot.w, slot.h) * 0.18);
    }
    cizgi += '\n' + emitPolyline('CUT', pts, true);
  }

  // Name letter outlines
  for (const poly of namePolys) {
    cizgi += '\n' + emitPolyline('NAME', poly, true);
  }
  cizgi += '\n' + dxfFooter();
  const cizgiPath = path.join(dir, `${sku}-cizgi.dxf`);
  fs.writeFileSync(cizgiPath, cizgi);

  // Build isim.dxf (name only)
  let isim = dxfHeader();
  for (const poly of namePolys) {
    isim += '\n' + emitPolyline('NAME', poly, true);
  }
  isim += '\n' + dxfFooter();
  const isimPath = path.join(dir, `${sku}-isim.dxf`);
  fs.writeFileSync(isimPath, isim);

  // Build baski.pdf (425x285 mm, full-bleed AI artwork)
  const baskiPath = path.join(dir, `${sku}-baski.pdf`);
  await new Promise((resolve, reject) => {
    const mmToPt = 72 / 25.4;
    const doc = new PDFDocument({
      size: [PRINT_W * mmToPt, PRINT_H * mmToPt],
      margin: 0,
    });
    const stream = fs.createWriteStream(baskiPath);
    doc.pipe(stream);
    try {
      doc.image(altPngPath, 0, 0, {
        width: PRINT_W * mmToPt,
        height: PRINT_H * mmToPt,
      });
    } catch (e) { reject(e); return; }
    // Cut-line guides (optional, dashed) — comment in if needed:
    // doc.save().lineWidth(0.3).dash(2, { space: 2 }).strokeColor('#FF0000');
    // doc.rect(BLEED_X * mmToPt, BLEED_X * mmToPt, BOARD_W * mmToPt, BOARD_H * mmToPt).stroke();
    // doc.restore();
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return {
    cizgi: cizgiPath,
    isim: isimPath,
    baski: baskiPath,
    layout: { board: { w: BOARD_W, h: BOARD_H }, print: { w: PRINT_W, h: PRINT_H, bleed: BLEED_X }, slots: layout },
    silhouettes: Object.fromEntries(
      Object.entries(silhouettes || {}).map(([k, v]) => [k, v && v.error ? { error: v.error } : { vertexCount: v?.vertexCount }])
    ),
    silhouetteErrors,
  };
}

module.exports = { exportSupplierFiles, BOARD_W, BOARD_H, PRINT_W, PRINT_H, BLEED_X };

if (require.main === module) {
  // CLI: node lib/supplier-export.js --sku <sku> --theme <id> --name <child> --alt <path>
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
  const sku = get('--sku') || 'cli-test';
  const themeId = get('--theme') || 'farm';
  const childName = get('--name') || 'TEST';
  const altPath = get('--alt');
  const catalog = require(path.join(ROOT, 'data', 'puzzle-catalog.json'));
  const theme = catalog.find(t => t.id === themeId);
  if (!theme) { console.error('theme not found'); process.exit(1); }
  if (!altPath) { console.error('--alt path required'); process.exit(1); }
  exportSupplierFiles({ sku, theme, childName, altPngPath: altPath })
    .then(out => console.log(JSON.stringify(out, null, 2)))
    .catch(err => { console.error(err.stack || err.message); process.exit(1); });
}
