const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { generateDesign } = require('./lib/generate-design');
const { composeMockup, composeMockupSharp, composeSingleMockupSharp, removeBackground, detectGarmentArea, normalizePos, POSITIONS_FILE } = require('./lib/compose-mockup');
const { scrapeTags, generateSEOTitle } = require('./lib/scrape-tags');
const { scrapeEtsyHunt } = require('./lib/scrape-etsyhunt');
const { runTagLabPipeline } = require('./lib/tag-lab-pipeline');
const { extractKeywords } = require('./tag-lab/extract-keywords');
const { analyzeMockup } = require('./lib/analyze-mockup');
const { generateMockupFromImage } = require('./lib/generate-mockup-from-image');
const { generateLifestyleMockups } = require('./lib/lifestyle-mockup');
const { generateDescription, appendStyleTemplate, padTagsTo13, optimizeTags, generateAltTexts } = require('./lib/optimize');
const { uploadToEtsy } = require('./lib/upload-etsy');
const { pinToPinterest } = require('./lib/pin-to-pinterest');
const { uploadToEtsyWithCookies } = require('./lib/upload-etsy-cookies');
const { pinToPinterestWithCookies } = require('./lib/pin-to-pinterest-cookies');
const { detectBrowser, detectAll } = require('./lib/browser-detect');
const {
  createOAuthStart,
  exchangeOAuthCode,
  refreshOAuthToken,
  getEtsyOperationalSnapshot,
  getPublicEtsyApiStatus,
  listShopSections,
  writeEnvValues,
} = require('./lib/etsy-api');
const { applyEtsy2026Listing } = require('./lib/etsy-2026-rules');
const { execFile, spawn } = require('child_process');
const puzzleGen = require('./lib/puzzle-generator');
const supplierExport = require('./lib/supplier-export');
// Leather tooling lives in the separate /Users/berkayyalinkilic/leather project.
const getLeatherListing = () => null;
const mergeLeatherDescription = (dynamicIntro, lockedDescription) => String(dynamicIntro || lockedDescription || '');

// Static listing-template photos appended after every mockup batch (see
// memory/project_post_mockup_templates.md). Order matters and never changes.
const LISTING_TEMPLATE_DIR = path.join(__dirname, 'assets', 'listing-templates');
const LISTING_TEMPLATE_FILES = ['01-product-info.png', '02-how-to-customize.png', '03-thank-you.png'];
function getListingTemplatePaths() {
  return LISTING_TEMPLATE_FILES
    .map(name => path.join(LISTING_TEMPLATE_DIR, name))
    .filter(p => fs.existsSync(p));
}
function appendListingTemplates(mockupPaths) {
  const templates = getListingTemplatePaths();
  if (!templates.length) return mockupPaths;
  const seen = new Set(mockupPaths.map(p => path.basename(p)));
  const filtered = templates.filter(p => !seen.has(path.basename(p)));
  return [...mockupPaths, ...filtered];
}

const CONFIG_PATH = path.join(__dirname, 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
function writeConfig(patch) {
  const cur = readConfig();
  const next = { ...cur, ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}
function isBabyPuzzleProduct(productContext, title = '') {
  const text = `${productContext || ''} ${title || ''}`.toLowerCase();
  return /\b(baby|toddler|montessori|nursery|name)\b.*\bpuzzle\b|\bpuzzle\b.*\b(baby|toddler|montessori|nursery|name)\b|wooden baby name puzzle/.test(text);
}
function cleanProductContext(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}
function getConfiguredProductContext(productContext, productType) {
  const direct = cleanProductContext(productContext);
  if (direct) return direct;
  const type = cleanProductContext(productType);
  if (type) return type;
  const cfg = readConfig();
  return cleanProductContext(cfg.defaultProductContext || '');
}
function composeDescription(dynamicDescription, title, productContext) {
  if (isBabyPuzzleProduct(productContext, title)) return appendStyleTemplate(dynamicDescription, title);
  return String(dynamicDescription || '').trim();
}
function normalizeTag(raw) {
  return String(raw || '').toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}
function padTagsForProduct(rawTags, productContext, title = '') {
  if (isBabyPuzzleProduct(productContext, title)) return padTagsTo13(rawTags);
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const tag = normalizeTag(raw);
    if (!tag || tag.length < 3 || tag.length > 20 || seen.has(tag)) return;
    if (/\b(baby|toddler|montessori|nursery)\b.*\bpuzzle\b|\bpuzzle\b.*\b(baby|toddler|montessori|nursery)\b|name puzzle|wooden baby/.test(tag)) return;
    seen.add(tag);
    out.push(tag);
  };
  (rawTags || []).forEach(push);
  if (out.length >= 13) return out.slice(0, 13);

  const words = normalizeTag(`${productContext || ''} ${title || ''}`)
    .split(/\s+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'from', 'this', 'that', 'etsy', 'urun', 'gorseli'].includes(w));
  for (let i = 0; i < words.length; i++) {
    for (let n = 3; n >= 1; n--) {
      if (out.length >= 13) break;
      push(words.slice(i, i + n).join(' '));
    }
  }
  [
    'handmade gift',
    'custom gift',
    'kids gift',
    'playroom decor',
    'outdoor play',
    'made to order',
    'personalized gift',
    'children gift',
    'learning toy',
    'wooden toy',
    'home decor gift',
    'unique gift',
    'gift for kids',
  ].forEach(push);
  return out.slice(0, 13);
}
function resolveBrowserPath() {
  const cfg = readConfig();
  if (cfg.operaPath && fs.existsSync(cfg.operaPath)) return { path: cfg.operaPath, name: nameFromPath(cfg.operaPath), source: 'config' };
  if (cfg.chromePath && fs.existsSync(cfg.chromePath)) return { path: cfg.chromePath, name: nameFromPath(cfg.chromePath), source: 'config' };
  const det = detectBrowser();
  if (det) return { path: det.path, name: det.name, source: 'detected' };
  return null;
}
function nameFromPath(p) {
  const s = (p || '').toLowerCase();
  if (s.includes('opera gx')) return 'Opera GX';
  if (s.includes('opera')) return 'Opera';
  if (s.includes('chrome')) return 'Chrome';
  if (s.includes('edge') || s.includes('msedge')) return 'Edge';
  if (s.includes('brave')) return 'Brave';
  return 'Tarayici';
}
// Dedicated CDP profile - keeps user's main browser profile untouched.
// Etsy/Pinterest/Alura need a one-time login here, then it persists.
function getCdpProfileDir() {
  const dir = path.join(__dirname, 'data', 'cdp-profile');
  const isFirstLaunch = !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
  fs.mkdirSync(dir, { recursive: true });
  return { dir, isFirstLaunch };
}

// Helper: load mockup position data for a template
function getPositionForTemplate(templatePath) {
  try {
    const positions = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
    return positions[path.basename(templatePath)] || null;
  } catch { return null; }
}

// Prevent server crash on unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message || err);
});

// Global upload lock — prevents concurrent Etsy uploads from fighting over the same Chrome tab
let etsyUploadInProgress = false;
async function withEtsyUploadLock(fn) {
  if (etsyUploadInProgress) {
    throw new Error('Baska bir Etsy yuklemesi suruyor — bitmesini bekleyin veya sayfayi yenileyin.');
  }
  etsyUploadInProgress = true;
  try { return await fn(); }
  finally { etsyUploadInProgress = false; }
}

// Retry wrapper for OpenRouter API calls (handles 502/503/429 transient errors)
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok || attempt === maxRetries) return response;
    const status = response.status;
    if (status === 502 || status === 503 || status === 429 || status === 500) {
      const wait = attempt * 5000;
      console.warn(`  [retry] OpenRouter ${status}, retrying in ${wait / 1000}s (attempt ${attempt}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, wait));
    } else {
      return response;
    }
  }
}

const app = express();
app.set('etag', false);
const PORT = process.env.PORT || 3001;

// Ensure directories exist
['designs', 'output', 'uploads', 'mockups', 'data', 'data/batches', 'data/jobs', 'data/qc-results'].forEach(dir => {
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
});

// ── Presets (file-based) ──
const PRESETS_FILE = path.join(__dirname, 'data', 'presets.json');
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');
const QC_DIR = path.join(__dirname, 'data', 'qc-results');

function loadPresets() {
  try { return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')); }
  catch { return { presets: {}, favorites: { mockups: [] }, mockupUsage: {} }; }
}
function savePresets(data) {
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(data, null, 2));
}
function getPreset(id) {
  return loadPresets().presets[id] || null;
}
function createPreset(preset) {
  const data = loadPresets();
  const id = 'preset-' + Date.now();
  preset.id = id;
  preset.createdAt = Date.now();
  preset.updatedAt = Date.now();
  preset.usageCount = 0;
  preset.lastUsedAt = null;
  data.presets[id] = preset;
  savePresets(data);
  return preset;
}
function updatePreset(id, updates) {
  const data = loadPresets();
  if (!data.presets[id]) return null;
  Object.assign(data.presets[id], updates, { updatedAt: Date.now() });
  savePresets(data);
  return data.presets[id];
}
function deletePreset(id) {
  const data = loadPresets();
  if (!data.presets[id]) return false;
  delete data.presets[id];
  savePresets(data);
  return true;
}
function markPresetUsed(id) {
  const data = loadPresets();
  if (!data.presets[id]) return;
  data.presets[id].usageCount = (data.presets[id].usageCount || 0) + 1;
  data.presets[id].lastUsedAt = Date.now();
  savePresets(data);
}
function toggleMockupFavorite(name, favorite) {
  const data = loadPresets();
  if (!data.favorites) data.favorites = { mockups: [] };
  const idx = data.favorites.mockups.indexOf(name);
  if (favorite && idx === -1) data.favorites.mockups.push(name);
  if (!favorite && idx !== -1) data.favorites.mockups.splice(idx, 1);
  savePresets(data);
}
function trackMockupUsage(names) {
  const data = loadPresets();
  if (!data.mockupUsage) data.mockupUsage = {};
  const now = Date.now();
  for (const name of names) {
    if (!data.mockupUsage[name]) data.mockupUsage[name] = { count: 0, lastUsed: 0 };
    data.mockupUsage[name].count++;
    data.mockupUsage[name].lastUsed = now;
  }
  savePresets(data);
}

// ── Stats tracking ──
function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
  catch { return { daily: {} }; }
}
function saveStats(data) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
}
function trackStat(category) {
  const data = loadStats();
  const today = new Date().toISOString().slice(0, 10);
  if (!data.daily[today]) data.daily[today] = { designs: 0, mockups: 0, uploads: 0, pins: 0, errors: 0 };
  if (data.daily[today][category] !== undefined) data.daily[today][category]++;
  saveStats(data);
}
function getTodayStats() {
  const data = loadStats();
  const today = new Date().toISOString().slice(0, 10);
  return data.daily[today] || { designs: 0, mockups: 0, uploads: 0, pins: 0, errors: 0 };
}
function getWeekStats() {
  const data = loadStats();
  const result = { designs: 0, mockups: 0, uploads: 0, pins: 0, errors: 0 };
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (data.daily[key]) {
      for (const k of Object.keys(result)) result[k] += (data.daily[key][k] || 0);
    }
  }
  return result;
}

// ── Quality Control ──
async function runQualityCheck(sku, preset) {
  const issues = [];
  const warnings = [];
  const outputDir = path.join(__dirname, 'output');
  const metaPath = path.join(outputDir, sku + '.meta.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}

  const mockupPaths = meta.mockupPaths || [];
  const tags = meta.tags || [];
  const title = meta.title || '';

  // Min mockup count
  const minMockups = preset?.quality?.minMockupCount || 4;
  if (mockupPaths.length < minMockups) {
    issues.push({ type: 'mockup_count', message: `${mockupPaths.length}/${minMockups} mockup - yetersiz`, severity: 'warning' });
  }

  // Min tag count
  const minTags = preset?.quality?.minTagCount || 13;
  if (tags.length < minTags) {
    issues.push({ type: 'tag_count', message: `${tags.length}/${minTags} tag - yetersiz`, severity: 'warning' });
  }

  // Check dimensions & transparency with sharp
  if (preset?.quality?.checkDimensions || preset?.quality?.checkTransparency) {
    try {
      const sharp = require('sharp');
      for (const mp of mockupPaths) {
        const absPath = path.join(__dirname, mp.replace(/^\//, ''));
        if (!fs.existsSync(absPath)) continue;
        const metadata = await sharp(absPath).metadata();
        if (preset?.quality?.checkDimensions && (metadata.width < 1500 || metadata.height < 1500)) {
          warnings.push({ type: 'dimensions', file: path.basename(mp), message: `${metadata.width}x${metadata.height} - dusuk cozunurluk`, severity: 'warning' });
        }
        if (preset?.quality?.checkTransparency && metadata.hasAlpha) {
          const { data: raw, info } = await sharp(absPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          let transCnt = 0;
          for (let pi = 3; pi < raw.length; pi += 4) { if (raw[pi] < 10) transCnt++; }
          const transRatio = transCnt / (info.width * info.height);
          if (transRatio > 0.1) {
            warnings.push({ type: 'transparency', file: path.basename(mp), message: `%${(transRatio*100).toFixed(0)} seffaf piksel - mockup sorunu olabilir`, severity: 'info' });
          }
        }
      }
    } catch (err) {
      warnings.push({ type: 'sharp_error', message: 'Gorsel analiz hatasi: ' + err.message, severity: 'info' });
    }
  }

  // Check duplicate title
  if (preset?.quality?.checkDuplicateTitle && title) {
    try {
      const metaFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.meta.json') && f !== sku + '.meta.json');
      for (const f of metaFiles) {
        try {
          const other = JSON.parse(fs.readFileSync(path.join(outputDir, f), 'utf8'));
          if (other.title && other.title.toLowerCase() === title.toLowerCase()) {
            issues.push({ type: 'duplicate_title', message: `Ayni baslik: ${f.replace('.meta.json', '')}`, severity: 'error' });
            break;
          }
        } catch {}
      }
    } catch {}
  }

  const result = {
    sku,
    timestamp: Date.now(),
    pass: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    warnings,
    stats: { mockupCount: mockupPaths.length, tagCount: tags.length, hasTitle: !!title, hasDescription: !!meta.description }
  };

  // Save QC result
  fs.writeFileSync(path.join(QC_DIR, sku + '.json'), JSON.stringify(result, null, 2));
  return result;
}

// ── Content variations (SEO styles) ──
async function generateContentVariations(title, tags, apiKey, style) {
  const stylePrompts = {
    broad: 'Generate BROAD, high-volume search tags that appeal to a wide audience. Focus on general category terms, popular gifting occasions, and universal descriptors.',
    niche: 'Generate NICHE, specific tags targeting a particular audience. Focus on unique descriptors, specific styles, and targeted demographics.',
    seasonal: 'Generate SEASONAL tags tied to current and upcoming holidays/events. Focus on seasonal occasions, holiday gifting, and time-relevant terms.',
    gift: 'Generate GIFT-FOCUSED tags emphasizing gifting occasions. Focus on recipient types (mom, dad, friend), occasions (birthday, anniversary), and gift-related terms.',
  };

  const prompt = `You are an Etsy SEO expert. ${stylePrompts[style] || stylePrompts.broad}

Current title: "${title}"
Current tags: ${tags.join(', ')}

Generate:
1. A new optimized title (max 140 chars)
2. Exactly 13 new tags (each max 20 chars)

Output ONLY valid JSON: {"title": "...", "tags": ["tag1", ...]}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-maverick',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) throw new Error('AI API failed');
  const data = await response.json();
  let content = data.choices?.[0]?.message?.content || '';
  if (typeof content !== 'string' && Array.isArray(content)) {
    content = content.filter(p => p.type === 'text').map(p => p.text).join('');
  }
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI response parse failed');
  const parsed = JSON.parse(match[0]);
  return { title: parsed.title || title, tags: (parsed.tags || []).slice(0, 13), style };
}

// ── Cleanup helpers ──
// Collect filenames referenced by any resumable job (anything not failed/completed)
// and by batches that still have non-completed rows. Never delete these.
function collectProtectedFiles() {
  const protectedFiles = new Set();
  const protectedBatches = new Set();

  const addPath = (p) => {
    if (!p || typeof p !== 'string') return;
    const base = path.basename(p);
    if (base) protectedFiles.add(base);
  };

  try {
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf8'));
        // Protect files for anything not explicitly failed (running, paused, interrupted, completed)
        if (job.status !== 'failed') {
          addPath(job.designPath);
          addPath(job.backDesignPath);
          (job.mockupPaths || []).forEach(addPath);
          (job.mockupTemplatePaths || []).forEach(addPath);
        }
      } catch {}
    }
  } catch {}

  const batchesDir = path.join(__dirname, 'data', 'batches');
  try {
    const files = fs.readdirSync(batchesDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const batch = JSON.parse(fs.readFileSync(path.join(batchesDir, f), 'utf8'));
        const items = batch.items || batch.rows || [];
        const hasPending = items.some(it => it && it.status !== 'completed' && it.status !== 'done');
        if (hasPending || items.length === 0) {
          protectedBatches.add(f);
          for (const it of items) {
            if (!it) continue;
            addPath(it.designPath);
            addPath(it.backDesignPath);
            (it.mockupPaths || []).forEach(addPath);
            (it.mockupTemplatePaths || []).forEach(addPath);
          }
        }
      } catch {}
    }
  } catch {}

  return { protectedFiles, protectedBatches };
}

function getCleanupPreview(maxAgeDays = 30) {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const result = { oldOutputs: [], failedJobs: [], oldBatches: [], totalSize: 0 };
  const { protectedFiles, protectedBatches } = collectProtectedFiles();

  // Old output files — skip any referenced by a resumable job or pending batch
  const outputDir = path.join(__dirname, 'output');
  try {
    const files = fs.readdirSync(outputDir);
    for (const f of files) {
      if (protectedFiles.has(f)) continue;
      const fp = path.join(outputDir, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) {
        result.oldOutputs.push({ name: f, size: stat.size, mtime: stat.mtimeMs });
        result.totalSize += stat.size;
      }
    }
  } catch {}

  // Failed jobs — only if their referenced files are already gone, never block resume
  try {
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf8'));
        if (job.status === 'failed' && job.updatedAt < cutoff) {
          result.failedJobs.push({ sku: job.sku, status: job.status, error: job.error, updatedAt: job.updatedAt });
        }
      } catch {}
    }
  } catch {}

  // Old batches — skip any with non-completed rows
  const batchesDir = path.join(__dirname, 'data', 'batches');
  try {
    const files = fs.readdirSync(batchesDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      if (protectedBatches.has(f)) continue;
      const fp = path.join(batchesDir, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) {
        result.oldBatches.push({ name: f, size: stat.size, mtime: stat.mtimeMs });
        result.totalSize += stat.size;
      }
    }
  } catch {}

  return result;
}

function executeCleanup(maxAgeDays = 30) {
  const preview = getCleanupPreview(maxAgeDays);
  let deleted = 0;

  for (const f of preview.oldOutputs) {
    try { fs.unlinkSync(path.join(__dirname, 'output', f.name)); deleted++; } catch {}
  }
  for (const j of preview.failedJobs) {
    try { fs.unlinkSync(path.join(JOBS_DIR, j.sku + '.json')); deleted++; } catch {}
  }
  for (const b of preview.oldBatches) {
    try { fs.unlinkSync(path.join(__dirname, 'data', 'batches', b.name)); deleted++; } catch {}
  }

  return { deleted, totalSize: preview.totalSize };
}

// ── Job Queue (file-based) ──
const JOBS_DIR = path.join(__dirname, 'data', 'jobs');

function createJob(sku, metadata = {}) {
  const job = {
    sku,
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedSteps: [],
    currentStep: null,
    error: null,
    ...metadata,
  };
  fs.writeFileSync(path.join(JOBS_DIR, `${sku}.json`), JSON.stringify(job, null, 2));
  return job;
}

function updateJob(sku, updates) {
  const filePath = path.join(JOBS_DIR, `${sku}.json`);
  let job = {};
  try { job = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
  Object.assign(job, updates, { updatedAt: Date.now() });
  fs.writeFileSync(filePath, JSON.stringify(job, null, 2));
  return job;
}

function readJob(sku) {
  try {
    return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, `${sku}.json`), 'utf8'));
  } catch { return null; }
}

function listJobs(filter = {}) {
  try {
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    let jobs = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf8')); }
      catch { return null; }
    }).filter(Boolean);
    if (filter.status) {
      const statuses = filter.status.split(',');
      jobs = jobs.filter(j => statuses.includes(j.status));
    }
    return jobs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch { return []; }
}

// Crash recovery: mark running jobs as interrupted on startup
(function recoverJobs() {
  try {
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    let recovered = 0;
    for (const f of files) {
      try {
        const filePath = path.join(JOBS_DIR, f);
        const job = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (job.status === 'running') {
          job.status = 'interrupted';
          job.updatedAt = Date.now();
          job.interruptedAt = Date.now();
          fs.writeFileSync(filePath, JSON.stringify(job, null, 2));
          console.log(`  [recovery] Job ${job.sku} marked interrupted (was running)`);
          recovered++;
        }
      } catch {}
    }
    if (recovered > 0) console.log(`  [recovery] ${recovered} interrupted job(s) found`);
  } catch {}
})();

// Pipeline concurrency lock
let pipelineLock = false;

// Multer config
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024, files: 25 },
});

// Parse JSON body
app.use(express.json());

// API key middleware
app.use((req, res, next) => {
  req.apiKey = process.env.OPENROUTER_API_KEY || '';
  next();
});

// Quick CDP check helper
async function isCdpAvailable() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    const port = config.cdpPort || 9333;
    // Use lightweight HTTP check instead of full Playwright connect (avoids conflicts)
    const resp = await fetch(`http://localhost:${port}/json/version`);
    if (resp.ok) return true;
    return false;
  } catch { return false; }
}

// Default page: new minimal UI. Legacy at /legacy.
// POST + multer SSE smoke test (mirrors /api/create middleware)
app.post('/api/sse-test-post', upload.fields([{ name: 'ref', maxCount: 1 }]), async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  try { res.socket && res.socket.setNoDelay(true); } catch {}
  res.write(': open\n\n');
  for (let i = 1; i <= 5; i++) {
    res.write(`data: ${JSON.stringify({ n: i, t: Date.now() })}\n\n`);
    await new Promise(r => setTimeout(r, 500));
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

// SSE streaming smoke test
app.get('/api/sse-test', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  try { res.socket && res.socket.setNoDelay(true); } catch {}
  res.write(': open\n\n');
  for (let i = 1; i <= 5; i++) {
    res.write(`data: ${JSON.stringify({ n: i, t: Date.now() })}\n\n`);
    await new Promise(r => setTimeout(r, 500));
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

function sendNoStoreHtml(res, fileName) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Read + send manually so no ETag/Last-Modified leaks back through sendFile.
  const html = fs.readFileSync(path.join(__dirname, 'public', fileName), 'utf8');
  res.removeHeader('ETag');
  res.removeHeader('Last-Modified');
  res.type('html').send(html);
}

app.get('/', (req, res) => sendNoStoreHtml(res, 'baby-puzzle.html'));
app.get('/baby-puzzle', (req, res) => sendNoStoreHtml(res, 'baby-puzzle.html'));
app.get('/legacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const TOOL_SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@etsyokulu.com';
const LEGAL_DISCLAIMER = 'Etsy is a registered trademark of Etsy, Inc. EtsyOkulu Product Creator uses Etsy\'s API but is not endorsed, certified, sponsored by, or affiliated with Etsy, Inc.';
const LEGAL_PAGES = {
  '/commercial-application': {
    title: 'Commercial Application Detail',
    kicker: 'Etsy review summary',
    body: 'EtsyOkulu Product Creator is a seller operations tool opened from EtsyOkulu Tools as a separate Product Creator workspace. It helps authorized Etsy sellers prepare draft listings, compliant product media, fulfillment files, pricing checks, order context, and shipping workflow notes after the seller connects an Etsy shop with OAuth.',
    bullets: [
      'Primary users are Etsy sellers who authorize their own shop through Etsy OAuth; the tool does not collect Etsy passwords.',
      'Core API use: read shop context, read shop sections, create or update draft listings, read sales/order context for fulfillment, and align shipping/tracking operations.',
      'The application is draft-first: sellers review generated titles, tags, descriptions, media, pricing, production files, and policy fit before publishing.',
      'The application displays the Etsy trademark disclaimer and keeps Etsy branding less prominent than the application branding.',
      `Seller support is available through ${TOOL_SUPPORT_EMAIL}; security concerns are escalated promptly and credentials are rotated when needed.`,
    ],
  },
  '/connect-etsy': {
    title: 'Connect Etsy',
    kicker: 'OAuth connection',
    body: 'Connect an Etsy shop through Etsy OAuth 2.0 with PKCE. The tool can create draft listings, read shop context, read order data for fulfillment, manage delivery profile alignment, and sync tracking after shipment.',
    bullets: [
      'Authorization happens on Etsy; this tool never sees the seller password.',
      'Listings are created as drafts by default so the seller reviews before publishing.',
      'Sellers can revoke access in this tool or from Etsy connected apps.',
      'Required scopes: shops_r, listings_r, listings_w, transactions_r, transactions_w.',
      'The exact redirect URI must use HTTPS and match the callback URL registered in Etsy developer settings.',
    ],
  },
  '/integrations': {
    title: 'Etsy Integration',
    kicker: 'Open API use',
    body: 'This application uses the official Etsy Open API for seller operations: draft listing creation, mockup/listing alignment, order fulfillment context, shipping profile references, and shipment tracking updates.',
    bullets: [
      'No Etsy checkout bypassing, marketplace replacement, scraping, or password collection.',
      'Buyer order and address data is used only for fulfillment, support, security, and legal compliance.',
      'API calls are cached where appropriate and rate-limit headers are respected.',
      'Commercial access readiness depends on Etsy developer approval.',
      'The tool requests only the scopes needed for seller listing, shop, transaction, and fulfillment workflows.',
    ],
  },
  '/terms': {
    title: 'Terms of Service',
    kicker: 'Use rules',
    body: 'By using EtsyOkulu Product Creator, sellers remain responsible for their listings, original content, production partners, pricing, shipping, taxes, Etsy policies, and final publishing decisions.',
    bullets: [
      'Use only artwork, text, trademarks, and product data you have rights to use.',
      'Do not use the tool for fraud, spam, IP infringement, scraping, or Etsy policy bypassing.',
      'Etsy API availability, scopes, limits, and approval are controlled by Etsy.',
      'The tool provides drafts and operational assistance, not legal, tax, or Etsy support advice.',
      'Users must accept these application terms before using connected Etsy API operations.',
    ],
  },
  '/privacy': {
    title: 'Privacy Policy',
    kicker: 'Data boundaries',
    body: 'Account, shop, listing, order, shipping, support, and operational data are used only to provide the seller workflow, maintain security, support fulfillment, and satisfy legal obligations.',
    bullets: [
      'Etsy buyer data is not used for marketing, enrichment, resale, or unrelated analytics.',
      'OAuth tokens and app secrets must be stored outside source control and protected in environment variables.',
      'Cached Etsy data is deleted after disconnect or when no longer needed for the workflow.',
      'Data breach concerns should be handled promptly and escalated to Etsy and affected sellers where required.',
      'Etsy member personal information is processed only as needed for the seller workflow and is not sold or transferred.',
    ],
  },
  '/data-deletion': {
    title: 'Data Deletion',
    kicker: 'Disconnect and purge',
    body: 'Sellers can disconnect their Etsy shop, revoke authorization from Etsy connected apps, and request deletion of cached account, listing, order, and fulfillment data.',
    bullets: [
      'Disconnect removes active OAuth access from the tool.',
      'Revoking access on Etsy stops future API calls immediately.',
      'Cached operational data is purged unless retention is required for security, logs, disputes, or law.',
      'Local generated files can be cleaned from the Operations > Cleanup screen.',
    ],
  },
  '/security': {
    title: 'Security',
    kicker: 'Operational controls',
    body: 'The tool is designed around least-privilege OAuth scopes, PKCE authorization, revocable access, draft-first listing creation, and no credential sharing.',
    bullets: [
      'OAuth 2.0 Authorization Code flow with PKCE S256 is used for seller authorization.',
      'API keys, shared secrets, access tokens, and refresh tokens must not be committed to git.',
      'Rate limits and retry-after responses should be respected for every Etsy API operation.',
      'No screen scraping is required for approved Etsy API operations.',
      'The application blocks Product Creator actions until API key, HTTPS redirect, OAuth token, and shop id are configured.',
    ],
  },
  '/support': {
    title: 'Support',
    kicker: 'Seller support',
    body: 'Etsy sellers using EtsyOkulu Product Creator can request help with account connection, OAuth scopes, draft listing workflow, fulfillment files, data deletion, and security concerns.',
    bullets: [
      `Monitored support contact: ${TOOL_SUPPORT_EMAIL}.`,
      'Security and credential concerns should include the shop name, approximate time, and affected workflow; never send raw access tokens by email.',
      'Operational bugs are handled through reproduction steps, affected SKU/job id, and browser/server logs where available.',
      'Commercial API review questions can reference the Commercial Application Detail, Terms, Privacy, Data Deletion, Security, and Copyright pages.',
    ],
  },
  '/copyright': {
    title: 'Copyright and IP',
    kicker: 'Original seller content',
    body: 'Sellers are responsible for ensuring that product designs, photos, text, trademarks, and personalization assets are original or properly licensed before creating Etsy drafts.',
    bullets: [
      'Do not upload protected brand names, characters, logos, or artwork without authorization.',
      'IP complaints can require removal from this tool and separate action on Etsy.',
      'Production files should be used only for the seller order or listing they were created for.',
      'Etsy remains a separate platform with its own IP reporting and appeal procedures.',
    ],
  },
};

const COMMERCIAL_REVIEW_SECTIONS = [
  {
    id: 'tool-detail',
    tab: 'Tool Detail',
    title: 'EtsyOkulu Product Creator',
    kicker: 'Separate EtsyOkulu tool',
    body: 'EtsyOkulu Product Creator is presented as its own tool workspace opened from EtsyOkulu Tools. The tool is not a general landing page; it is a seller operations surface for preparing Etsy-ready product media, draft listings, pricing, fulfillment files, and order workflow context after a seller connects their own Etsy shop.',
    bullets: [
      'The tool is visually separated from EtsyOkulu school/course pages and appears as a dedicated Product Creator workspace.',
      'The first screen shows API readiness and keeps production actions locked until Etsy API connection is complete.',
      'The workflow is draft-first: sellers review generated output before publishing on Etsy.',
      'Generated assets remain tied to the seller SKU/job and can be cleaned from the operations panel.',
    ],
  },
  {
    id: 'etsy-api-use',
    tab: 'Etsy API Use',
    title: 'Official Etsy Open API operations',
    kicker: 'Commercial API purpose',
    body: 'The application uses Etsy Open API access only for seller-authorized shop operations. It is not a marketplace replacement, checkout bypass, scraping product, password collector, or buyer data enrichment product.',
    bullets: [
      'Read shop context, shop sections, listings, sales/order context, and shipping profile references.',
      'Create or update draft listing data only after seller authorization.',
      'Use order and shipping data only for fulfillment, support, security, and legal compliance.',
      'Respect Etsy API availability, approval, rate limits, token revocation, and scope boundaries.',
    ],
  },
  {
    id: 'oauth-scopes',
    tab: 'OAuth & Scopes',
    title: 'OAuth connection and requested scopes',
    kicker: 'Seller authorization',
    body: 'Connection starts with Etsy OAuth 2.0 Authorization Code flow with PKCE. The seller authorizes on Etsy; this application never asks for or stores an Etsy password.',
    bullets: [
      'Required callback must be the exact HTTPS redirect URI registered in Etsy developer settings.',
      'Default requested scopes: shops_r, listings_r, listings_w, transactions_r, transactions_w.',
      'Access can be revoked from the application or from Etsy connected apps.',
      'Refresh tokens are stored outside source control and rotated when a security concern exists.',
    ],
  },
  {
    id: 'data-privacy',
    tab: 'Data',
    title: 'Data handling and deletion',
    kicker: 'Least necessary seller data',
    body: 'Shop, listing, order, shipping, support, and operational data is used only for the seller workflow that the connected seller initiated.',
    bullets: [
      'Buyer/order data is not sold, transferred, enriched, or used for unrelated marketing.',
      'Cached Etsy data is deleted after disconnect or when no longer needed for the workflow, unless legal/security retention is required.',
      'Local generated files can be cleaned through Operations > Cleanup.',
      'The public Data Deletion page explains disconnect, revoke, and purge behavior.',
    ],
  },
  {
    id: 'security-controls',
    tab: 'Security',
    title: 'Security controls',
    kicker: 'Operational safeguards',
    body: 'Product Creator is built around least-privilege API usage, token-based authorization, environment-based secrets, and locked production actions until required API settings are present.',
    bullets: [
      'API keys, shared secrets, access tokens, and refresh tokens must not be committed to git.',
      'The UI and backend both block Product Creator operations until commercial readiness checks pass.',
      'No Etsy screen scraping is required for approved API operations.',
      'Security issues can be reported through the support page and escalated with affected shop/workflow details.',
    ],
  },
  {
    id: 'trademark',
    tab: 'Trademark',
    title: 'Etsy trademark and affiliation disclaimer',
    kicker: 'Brand boundary',
    body: LEGAL_DISCLAIMER,
    bullets: [
      'Etsy branding is used only to identify the integration target and seller workflow.',
      'EtsyOkulu Product Creator is branded as EtsyOkulu, not as an Etsy-owned or Etsy-certified product.',
      'The disclaimer is displayed on the tool/API page and all public compliance pages.',
      'Etsy remains a separate platform with its own policies, developer review, and user terms.',
    ],
  },
];

function isAllowedOAuthRedirect(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && host === 'localhost';
  } catch {
    return false;
  }
}

function getCommercialReadiness() {
  const status = getPublicEtsyApiStatus();
  const requiredPages = ['/commercial-application', '/connect-etsy', '/integrations', '/terms', '/privacy', '/data-deletion', '/security', '/support', '/copyright'];
  const redirectReady = isAllowedOAuthRedirect(status.redirectUri);
  const checks = [
    { id: 'api_key', label: 'Etsy keystring + shared secret configured', ok: !!status.apiKey },
    { id: 'redirect', label: 'Exact OAuth redirect URI configured (HTTPS public or localhost dev)', ok: redirectReady },
    { id: 'oauth', label: 'OAuth access token available', ok: !!status.accessToken },
    { id: 'shop', label: 'Shop ID available', ok: !!status.shopId },
    { id: 'tool_details', label: 'Commercial application detail page available', ok: true },
    { id: 'terms', label: 'Terms, privacy, deletion, security, support and IP pages available', ok: true },
    { id: 'trademark', label: 'Etsy registered trademark disclaimer displayed', ok: true },
    { id: 'drafts', label: 'Listing workflow is draft-first', ok: true },
    { id: 'support', label: `Monitored seller support contact configured (${TOOL_SUPPORT_EMAIL})`, ok: true },
  ];
  return {
    ready: checks.every(c => c.ok),
    status,
    checks,
    requiredPages,
    missing: checks.filter(c => !c.ok),
  };
}

function requireEtsyToolReady(req, res, next) {
  const gate = getCommercialReadiness();
  if (gate.ready) return next();
  return res.status(403).json({
    ok: false,
    error: 'Etsy Product Creator is locked until Etsy API commercial readiness is complete.',
    message: 'Configure Etsy keystring:shared_secret, an exact OAuth redirect URI, OAuth access token, and Shop ID before running Product Creator operations.',
    missing: gate.missing.map(c => ({ id: c.id, label: c.label })),
    status: gate.status,
  });
}

function renderLegalPage(page) {
  const links = ['/commercial-application', '/connect-etsy', '/integrations', '/terms', '/privacy', '/data-deletion', '/security', '/support', '/copyright'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${page.title} - EtsyOkulu Product Creator</title><style>
body{margin:0;font-family:Inter,Arial,sans-serif;background:#f6f7f9;color:#17202a}main{max-width:1040px;margin:0 auto;padding:42px 20px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}a{color:#0f766e}nav a{border:1px solid #dce3ea;background:#fff;border-radius:8px;padding:8px 10px;text-decoration:none;font-weight:700;font-size:12px}section{background:#fff;border:1px solid #dce3ea;border-radius:8px;padding:28px;box-shadow:0 1px 2px rgba(26,23,20,.04)}.kicker{color:#0f766e;text-transform:uppercase;font-size:12px;font-weight:800;letter-spacing:.08em}h1{font-size:38px;line-height:1.06;margin:8px 0 16px}p,li{font-size:15px;line-height:1.65;color:#5e6a78}.cta{display:inline-flex;margin-top:16px;background:#0f766e;color:#fff;border-radius:8px;padding:12px 16px;text-decoration:none;font-weight:800}.notice{margin-top:24px;border-left:3px solid #0f766e;background:#edf1f5;padding:12px 14px;font-size:13px;color:#5e6a78}</style></head><body><main><nav><a href="/baby-puzzle">Tool</a>${links.map(h => `<a href="${h}">${LEGAL_PAGES[h].title}</a>`).join('')}</nav><section><div class="kicker">${page.kicker}</div><h1>${page.title}</h1><p>${page.body}</p><ul>${page.bullets.map(b => `<li>${b}</li>`).join('')}</ul>${page.title === 'Connect Etsy' ? '<a class="cta" href="/api/etsy/oauth/start">Start Etsy OAuth</a>' : ''}<p class="notice">${LEGAL_DISCLAIMER}</p></section></main></body></html>`;
}

for (const [route, page] of Object.entries(LEGAL_PAGES)) {
  app.get(route, (req, res) => res.type('html').send(renderLegalPage(page)));
}

// Static files (no-store on HTML so cache never serves stale wizard)
app.use((req, res, next) => {
  if (/\.html?$/i.test(req.path) || req.path === '/' || req.path === '/legacy' || req.path === '/baby-puzzle') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0, index: false }));
app.use('/designs', express.static(path.join(__dirname, 'designs')));
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use('/mockups', express.static(path.join(__dirname, 'mockups')));

// Cookie storage (file-based, no auth needed)
const COOKIES_FILE = path.join(__dirname, 'data', 'cookies.json');
function loadCookies() {
  try { return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8')); } catch { return {}; }
}
function saveCookiesFile(data) {
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(data, null, 2));
}

app.post('/api/etsy-cookies', (req, res) => {
  const { cookies } = req.body;
  if (!cookies) return res.status(400).json({ error: 'Cookie verisi gerekli' });
  const data = loadCookies();
  data.etsy = cookies;
  saveCookiesFile(data);
  res.json({ ok: true });
});

app.post('/api/pinterest-cookies', (req, res) => {
  const { cookies } = req.body;
  if (!cookies) return res.status(400).json({ error: 'Cookie verisi gerekli' });
  const data = loadCookies();
  data.pinterest = cookies;
  saveCookiesFile(data);
  res.json({ ok: true });
});

app.get('/api/cookie-status', (req, res) => {
  const data = loadCookies();
  res.json({ hasEtsy: !!data.etsy, hasPinterest: !!data.pinterest });
});

// List designs
app.get('/api/designs', (req, res) => {
  const dir = path.join(__dirname, 'designs');
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp|avif)$/i.test(f))
    .map(f => ({ name: f, path: '/designs/' + f }));
  res.json(files);
});

// List output mockups
app.get('/api/output', (req, res) => {
  const dir = path.join(__dirname, 'output');
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp|avif)$/i.test(f))
    .map(f => ({ name: f, path: '/output/' + f }));
  res.json(files);
});

// ── CDP Browser Launch ──
let cdpChildPid = null;

app.get('/api/cdp-status', async (req, res) => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const port = config.cdpPort || 9333;
  try {
    const resp = await fetch(`http://localhost:${port}/json/version`);
    const data = await resp.json();
    res.json({ running: true, browser: data.Browser || 'unknown', port });
  } catch {
    res.json({ running: false, port });
  }
});

app.post('/api/cdp-launch', (req, res) => {
  const config = readConfig();
  const port = config.cdpPort || 9333;
  const resolved = resolveBrowserPath();
  if (!resolved) {
    return res.status(400).json({ error: 'Tarayici bulunamadi - ayarlardan yolu girin.' });
  }
  const browserPath = resolved.path;
  const { dir: cdpProfile, isFirstLaunch } = getCdpProfileDir();
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${cdpProfile}`, '--no-first-run', '--no-default-browser-check'];
  const child = execFile(browserPath, args, { detached: true, stdio: 'ignore' });
  cdpChildPid = child.pid;
  child.unref();
  setTimeout(async () => {
    try {
      const resp = await fetch(`http://localhost:${port}/json/version`);
      const data = await resp.json();
      res.json({ ok: true, browser: data.Browser || 'unknown', port, firstLaunch: isFirstLaunch });
    } catch {
      res.json({ ok: true, message: 'Baslatildi, baglanti bekleniyor...', port, firstLaunch: isFirstLaunch });
    }
  }, 3000);
});

app.post('/api/cdp-close', async (req, res) => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const port = config.cdpPort || 9333;
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`, { timeout: 3000 });
    await browser.close().catch(() => {});
  } catch {}
  if (cdpChildPid) {
    try { process.kill(cdpChildPid); } catch {}
    cdpChildPid = null;
  }
  setTimeout(async () => {
    try {
      await fetch(`http://localhost:${port}/json/version`);
      res.json({ ok: false, message: 'Kapatilamadi, hala calisiyor' });
    } catch {
      res.json({ ok: true, message: 'Kapatildi' });
    }
  }, 1500);
});

// ── Browser detection + smart launch ──
app.get('/api/browser/status', async (req, res) => {
  const cfg = readConfig();
  const port = cfg.cdpPort || 9333;
  const resolved = resolveBrowserPath();
  let cdpRunning = false;
  let browserVersion = '';
  try {
    const r = await fetch(`http://localhost:${port}/json/version`);
    if (r.ok) {
      cdpRunning = true;
      const data = await r.json();
      browserVersion = data.Browser || '';
    }
  } catch {}
  res.json({
    detected: resolved,
    available: detectAll(),
    cdpRunning,
    cdpPort: port,
    browserVersion,
  });
});

app.post('/api/browser/start', (req, res) => {
  const cfg = readConfig();
  const port = cfg.cdpPort || 9333;
  const resolved = resolveBrowserPath();
  if (!resolved) {
    return res.status(400).json({ ok: false, error: 'Tarayici bulunamadi. Lutfen ayarlardan yolu girin.' });
  }
  // If already running, return immediately
  fetch(`http://localhost:${port}/json/version`).then(r => {
    if (r.ok) return res.json({ ok: true, alreadyRunning: true, port, browser: resolved.name });
    spawnAndWait();
  }).catch(() => spawnAndWait());

  function spawnAndWait() {
    const { dir: cdpProfile, isFirstLaunch } = getCdpProfileDir();
    const startUrl = `http://localhost:${process.env.PORT || PORT}/`;
    const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${cdpProfile}`, '--no-first-run', '--no-default-browser-check', startUrl];
    let child;
    try {
      child = execFile(resolved.path, args, { detached: true, stdio: 'ignore' });
      cdpChildPid = child.pid;
      child.unref();
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Tarayici baslatilamadi: ' + e.message });
    }
    let elapsed = 0;
    const tick = setInterval(async () => {
      elapsed += 1000;
      try {
        const r = await fetch(`http://localhost:${port}/json/version`);
        if (r.ok) {
          clearInterval(tick);
          // Ensure a visible page exists — Opera with custom user-data-dir sometimes
          // launches without auto-opening a window. PUT /json/new forces one.
          try {
            const pages = await (await fetch(`http://localhost:${port}/json`)).json();
            const hasVisible = Array.isArray(pages) && pages.some(p => p.type === 'page');
            if (!hasVisible) {
              await fetch(`http://localhost:${port}/json/new?${encodeURIComponent(startUrl)}`, { method: 'PUT' });
            }
          } catch {}
          return res.json({ ok: true, port, browser: resolved.name, firstLaunch: isFirstLaunch });
        }
      } catch {}
      if (elapsed >= 30000) {
        clearInterval(tick);
        return res.status(504).json({ ok: false, error: `Tarayici acildi ama CDP portu (${port}) yanit vermedi.` });
      }
    }, 1000);
  }
});

// ── Settings (data/config.json overrides) ──
app.get('/api/settings', (req, res) => {
  const cfg = readConfig();
  res.json({
    operaPath: cfg.operaPath || '',
    chromePath: cfg.chromePath || '',
    cdpPort: cfg.cdpPort || 9333,
    keepPhotoCount: cfg.keepPhotoCount || 6,
    templateListingId: cfg.templateListingId || '',
    shopScope: cfg.shopScope || 'children_products',
    defaultProductContext: cfg.defaultProductContext || '',
    productTypes: Array.isArray(cfg.productTypes) ? cfg.productTypes : [],
    geminiKey: process.env.GEMINI_API_KEY ? '***configured***' : '',
    openrouterKey: process.env.OPENROUTER_API_KEY ? '***configured***' : '',
    etsy: getPublicEtsyApiStatus(),
    detected: detectBrowser(),
  });
});

app.post('/api/settings', (req, res) => {
  const allowed = ['operaPath', 'chromePath', 'cdpPort', 'keepPhotoCount', 'templateListingId', 'shopScope', 'defaultProductContext', 'productTypes'];
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined && req.body[k] !== '') patch[k] = req.body[k];
  }
  if (patch.cdpPort) patch.cdpPort = parseInt(patch.cdpPort, 10) || 9333;
  if (patch.keepPhotoCount) patch.keepPhotoCount = parseInt(patch.keepPhotoCount, 10) || 6;
  if (typeof patch.productTypes === 'string') {
    patch.productTypes = patch.productTypes.split('\n').map(s => s.trim()).filter(Boolean);
  }
  writeEnvValues({
    ETSY_API_KEY: req.body.etsyApiKey,
    ETSY_ACCESS_TOKEN: req.body.etsyAccessToken,
    ETSY_REFRESH_TOKEN: req.body.etsyRefreshToken,
    ETSY_USER_ID: req.body.etsyUserId,
    ETSY_SHOP_ID: req.body.etsyShopId,
    ETSY_SHOP_NAME: req.body.etsyShopName,
    ETSY_REDIRECT_URI: req.body.etsyRedirectUri,
    ETSY_SCOPES: req.body.etsyScopes,
  });
  const next = writeConfig(patch);
  res.json({ ok: true, config: next, etsy: getPublicEtsyApiStatus() });
});

app.get('/api/etsy/commercial-readiness', (req, res) => {
  const gate = getCommercialReadiness();
  const status = gate.status;
  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({
    ready: gate.ready,
    status,
    checks: gate.checks,
    missing: gate.missing,
    requiredPages: gate.requiredPages.map(pathname => ({ pathname, url: origin + pathname })),
    callbackUrl: status.redirectUri || origin + '/oauth/etsy/callback',
    disclaimer: LEGAL_DISCLAIMER,
    supportEmail: TOOL_SUPPORT_EMAIL,
    scopes: (status.scopes || '').split(/\s+/).filter(Boolean),
    toolDetail: {
      name: 'EtsyOkulu Product Creator',
      placement: 'Separate tool tab opened from EtsyOkulu Tools',
      purpose: 'Draft-first listing, media, fulfillment, pricing, and seller operations workspace for authorized Etsy sellers.',
      dataUse: 'Shop, listing, order, shipping, and support data are used only for the connected seller workflow.',
    },
    complianceSections: COMMERCIAL_REVIEW_SECTIONS,
  });
});

app.get('/api/etsy/tool-gate', (req, res) => {
  const gate = getCommercialReadiness();
  res.json({
    ready: gate.ready,
    missing: gate.missing,
    status: gate.status,
    disclaimer: LEGAL_DISCLAIMER,
    supportEmail: TOOL_SUPPORT_EMAIL,
  });
});

app.get('/api/etsy/oauth/start', (req, res) => {
  try {
    const start = createOAuthStart({
      redirectUri: req.query.redirectUri,
      scopes: req.query.scopes,
    });
    if (req.query.json === '1') return res.json(start);
    res.redirect(start.url);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/oauth/etsy/callback', async (req, res) => {
  try {
    if (req.query.error) {
      return res.status(400).type('html').send(`<h1>Etsy OAuth error</h1><p>${String(req.query.error_description || req.query.error)}</p>`);
    }
    const result = await exchangeOAuthCode({ code: req.query.code, state: req.query.state });
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Etsy connected</title></head><body style="font-family:Arial,sans-serif;padding:32px"><h1>Etsy OAuth connected</h1><p>Access token saved locally. You can close this tab and return to Product Creator.</p><pre>${JSON.stringify(result, null, 2)}</pre><p><a href="/baby-puzzle#api">Back to API dashboard</a></p></body></html>`);
  } catch (err) {
    res.status(400).type('html').send(`<h1>Etsy OAuth failed</h1><p>${String(err.message || err)}</p><p><a href="/baby-puzzle#api">Back</a></p>`);
  }
});

app.post('/api/etsy/oauth/refresh', async (req, res) => {
  try {
    const result = await refreshOAuthToken();
    res.json({ ok: true, result, etsy: getPublicEtsyApiStatus() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message, etsy: getPublicEtsyApiStatus() });
  }
});

app.get('/api/etsy/operations', async (req, res) => {
  try {
    res.json(await getEtsyOperationalSnapshot());
  } catch (err) {
    res.status(400).json({
      ready: false,
      status: getPublicEtsyApiStatus(),
      error: err.message,
      message: 'Etsy API operasyonlari calismadi. OAuth token, shop id ve scope izinlerini kontrol edin.',
    });
  }
});

app.get('/api/sections', async (req, res) => {
  try {
    const sections = await listShopSections();
    res.json(sections);
  } catch (err) {
    res.set('X-Etsy-Sections-Error', String(err.message || '').slice(0, 200));
    res.json([]);
  }
});

// ── Mockup Library ──
app.get('/api/mockups', (req, res) => {
  const dir = path.join(__dirname, 'mockups');
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp|avif)$/i.test(f))
    .map(f => ({ name: f, path: '/mockups/' + f, thumb: '/api/mockups/thumb/' + encodeURIComponent(f) }));
  res.json(files);
});

app.get('/api/mockups/thumb/:name', async (req, res) => {
  const safeName = path.basename(req.params.name);
  const srcPath = path.join(__dirname, 'mockups', safeName);
  if (!fs.existsSync(srcPath)) return res.status(404).end();
  const thumbDir = path.join(__dirname, 'mockups', '.thumbs');
  fs.mkdirSync(thumbDir, { recursive: true });
  const thumbPath = path.join(thumbDir, safeName + '.webp');
  try {
    const srcStat = fs.statSync(srcPath);
    if (!fs.existsSync(thumbPath) || fs.statSync(thumbPath).mtimeMs < srcStat.mtimeMs) {
      const sharp = require('sharp');
      await sharp(srcPath, { failOn: 'none' })
        .rotate()
        .resize(200, 200, { fit: 'cover' })
        .webp({ quality: 70 })
        .toFile(thumbPath);
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Content-Type', 'image/webp');
    fs.createReadStream(thumbPath).pipe(res);
  } catch (e) {
    console.error('Thumb error', safeName, e.message);
    res.status(500).end();
  }
});

app.post('/api/mockups/upload', requireEtsyToolReady, upload.array('mockups', 20), (req, res) => {
  const dir = path.join(__dirname, 'mockups');
  const saved = [];
  for (const file of req.files) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(dir, safeName);
    fs.renameSync(file.path, dest);
    saved.push({ name: safeName, path: '/mockups/' + safeName, thumb: '/api/mockups/thumb/' + encodeURIComponent(safeName) });
  }
  res.json(saved);
});

app.delete('/api/mockups/:name', (req, res) => {
  const safeName = path.basename(req.params.name);
  const filePath = path.join(__dirname, 'mockups', safeName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Helper: rename uploaded file with proper extension
function renameWithExt(file) {
  const ext = path.extname(file.originalname) || '.png';
  const newPath = file.path + ext;
  fs.renameSync(file.path, newPath);
  return newPath;
}

// ── Get meta info for a SKU ──
app.get('/api/meta/:sku', (req, res) => {
  const sku = req.params.sku;
  let meta = {};
  const metaPath = path.join(__dirname, 'output', sku + '.meta.json');
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}

  // Fill in designPath if missing - scan designs/ dir
  if (!meta.designPath) {
    try {
      const designsDir = path.join(__dirname, 'designs');
      const designFile = fs.readdirSync(designsDir).find(f => f.startsWith(sku + '_design'));
      if (designFile) meta.designPath = '/designs/' + designFile;
    } catch {}
  }

  // Fallback: if mockupTemplatePaths missing, scan mockups/ dir for available templates
  if (!meta.mockupTemplatePaths || meta.mockupTemplatePaths.length === 0) {
    try {
      const mockupsDir = path.join(__dirname, 'mockups');
      const files = fs.readdirSync(mockupsDir).filter(f => /\.(png|jpg|jpeg|webp|avif)$/i.test(f));
      meta.mockupTemplatePaths = files.map(f => '/mockups/' + f);
    } catch {
      meta.mockupTemplatePaths = [];
    }
  }

  res.json(meta);
});

// ── Mockup positions CRUD ──
app.get('/api/mockup-positions', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
    res.json(data);
  } catch {
    res.json({});
  }
});

app.post('/api/mockup-positions', requireEtsyToolReady, (req, res) => {
  try {
    const { template, x, y, w, h, width, height, rotation, source } = req.body;
    if (!template) return res.status(400).json({ error: 'template required' });
    let data = {};
    try { data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch {}
    data[template] = {
      x: Number(x),
      y: Number(y),
      width: Number(width != null ? width : w),
      height: Number(height != null ? height : h),
      rotation: Number(rotation) || 0,
      source: source || 'manual',
    };
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true, positions: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Calibration endpoints ──
const MOCKUPS_DIR = path.join(__dirname, 'mockups');

app.get('/api/calibrate/status', (req, res) => {
  try {
    const templates = fs.readdirSync(MOCKUPS_DIR).filter(f => /\.(jpg|jpeg|png|webp|avif)$/i.test(f));
    let positions = {};
    try { positions = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch {}
    const presets = loadPresets();
    const usage = presets.mockupUsage || {};
    const favs = (presets.favorites && presets.favorites.mockups) || [];
    const list = templates.map(name => {
      const pos = positions[name];
      const norm = pos ? normalizePos(pos) : null;
      const u = usage[name];
      return {
        name,
        calibrated: !!pos,
        source: norm?.source || null,
        usageCount: u ? u.count : 0,
        lastUsed: u ? u.lastUsed : 0,
        favorite: favs.includes(name),
      };
    });
    const calibrated = list.filter(t => t.calibrated).length;
    res.json({ total: list.length, calibrated, uncalibrated: list.length - calibrated, templates: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/calibrate/:template', async (req, res) => {
  try {
    const sharp = require('sharp');
    const tpl = req.params.template;
    const tplPath = path.join(MOCKUPS_DIR, tpl);
    if (!fs.existsSync(tplPath)) return res.status(404).json({ error: 'Template not found' });

    const x = parseInt(req.query.x);
    const y = parseInt(req.query.y);
    const w = parseInt(req.query.width || req.query.w);
    const h = parseInt(req.query.height || req.query.h);
    const hasParams = !isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h);

    if (!hasParams) {
      // Return raw mockup image
      return res.sendFile(tplPath);
    }

    // Return mockup with debug overlay
    const meta = await sharp(tplPath).metadata();
    const debugSvg = Buffer.from(`<svg width="${meta.width}" height="${meta.height}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="rgba(255,0,0,0.15)" stroke="red" stroke-width="4" stroke-dasharray="20,10" />
      <line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="red" stroke-width="2" opacity="0.3" />
      <line x1="${x + w}" y1="${y}" x2="${x}" y2="${y + h}" stroke="red" stroke-width="2" opacity="0.3" />
      <text x="${x + 8}" y="${y - 8}" fill="red" font-size="28" font-family="sans-serif">
        ${w}x${h} @ (${x},${y})
      </text>
    </svg>`);

    const result = await sharp(tplPath)
      .composite([{ input: debugSvg, left: 0, top: 0, blend: 'over' }])
      .jpeg({ quality: 80 })
      .toBuffer();

    res.set('Content-Type', 'image/jpeg');
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calibrate/batch-auto', requireEtsyToolReady, async (req, res) => {
  try {
    const templates = fs.readdirSync(MOCKUPS_DIR).filter(f => /\.(jpg|jpeg|png|webp|avif)$/i.test(f));
    let positions = {};
    try { positions = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch {}

    const uncalibrated = templates.filter(t => !positions[t]);
    const results = { success: 0, failed: 0, errors: [] };

    for (const tpl of uncalibrated) {
      try {
        const tplPath = path.join(MOCKUPS_DIR, tpl);
        const autoPos = await detectGarmentArea(tplPath);
        if (autoPos) {
          const norm = normalizePos(autoPos);
          positions[tpl] = { x: autoPos.x, y: autoPos.y, width: norm.width, height: norm.height, source: 'auto' };
          results.success++;
        } else {
          results.failed++;
          results.errors.push({ template: tpl, error: 'Auto-detect returned null' });
        }
      } catch (err) {
        results.failed++;
        results.errors.push({ template: tpl, error: err.message });
      }
    }

    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
    res.json({ ok: true, ...results, total: uncalibrated.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calibrate/auto-single', requireEtsyToolReady, async (req, res) => {
  try {
    const { template } = req.body;
    if (!template) return res.status(400).json({ error: 'template required' });
    const tplPath = path.join(MOCKUPS_DIR, template);
    if (!fs.existsSync(tplPath)) return res.status(404).json({ error: 'Template not found' });

    const autoPos = await detectGarmentArea(tplPath);
    if (!autoPos) return res.status(422).json({ error: 'Auto-detect failed for this template' });

    const norm = normalizePos(autoPos);
    let positions = {};
    try { positions = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch {}
    positions[template] = { x: autoPos.x, y: autoPos.y, width: norm.width, height: norm.height, source: 'auto' };
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));

    res.json({ ok: true, position: positions[template] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Remove background from a design upload (returns PNG with alpha) ──
app.post('/api/remove-bg', requireEtsyToolReady, multer({ storage: multer.memoryStorage() }).single('design'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'design required' });
    const cleaned = await removeBackground(req.file.buffer);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(cleaned);
  } catch (err) {
    console.error('[remove-bg]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Calibration preview: compose design onto mockup with given position ──
app.post('/api/calibrate/preview', requireEtsyToolReady, multer({ storage: multer.memoryStorage() }).single('design'), async (req, res) => {
  try {
    const sharp = require('sharp');
    const tpl = req.body.template;
    if (!tpl || !req.file) return res.status(400).json({ error: 'template and design required' });
    const tplPath = path.join(MOCKUPS_DIR, tpl);
    if (!fs.existsSync(tplPath)) return res.status(404).json({ error: 'Template not found' });

    const x = parseInt(req.body.x) || 0;
    const y = parseInt(req.body.y) || 0;
    const w = parseInt(req.body.width) || 200;
    const h = parseInt(req.body.height) || 200;

    const mockupMeta = await sharp(tplPath).metadata();
    const mw = mockupMeta.width;
    const mh = mockupMeta.height;

    // Resize design to fit within the print area
    const resizedDesign = await sharp(req.file.buffer)
      .rotate()
      .resize(w, h, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
      .ensureAlpha()
      .png()
      .toBuffer();

    const resizedMeta = await sharp(resizedDesign).metadata();
    const actualLeft = Math.round(x + (w - resizedMeta.width) / 2);
    const actualTop = Math.round(y + (h - resizedMeta.height) / 2);

    // Debug overlay SVG
    const debugSvg = Buffer.from(`<svg width="${mw}" height="${mh}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="none" stroke="red" stroke-width="3" stroke-dasharray="16,8" />
      <text x="${x + 8}" y="${y - 6}" fill="red" font-size="24" font-family="sans-serif">
        ${w}x${h} @ (${x},${y})
      </text>
    </svg>`);

    const result = await sharp(tplPath)
      .composite([
        { input: resizedDesign, left: actualLeft, top: actualTop, blend: 'over' },
        { input: debugSvg, left: 0, top: 0, blend: 'over' },
      ])
      .jpeg({ quality: 85 })
      .toBuffer();

    res.set('Content-Type', 'image/jpeg');
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Regenerate a single mockup ──
app.post('/api/regenerate-mockup',
  requireEtsyToolReady,
  upload.fields([
    { name: 'design', maxCount: 1 },
    { name: 'backDesign', maxCount: 1 },
    { name: 'mockupTemplate', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const designFile = req.files?.design?.[0];
      const backDesignFile = req.files?.backDesign?.[0];
      const mockupTemplateFile = req.files?.mockupTemplate?.[0];
      const sku = req.body.sku || `SKU${Date.now()}`;
      const index = parseInt(req.body.index) || 0;
      const mode = req.body.mode || 'single';

      // Regen options
      const regenScale = req.body.scale ? parseFloat(req.body.scale) : undefined;
      const regenPosition = req.body.position || undefined;
      const regenWhiteMode = req.body.whiteMode === 'true' || req.body.whiteMode === '1';
      const sharpOpts = {};
      if (regenScale) sharpOpts.scale = regenScale;
      if (regenPosition) sharpOpts.position = regenPosition;
      if (regenWhiteMode) sharpOpts.whiteMode = true;

      // Accept either uploaded files or existing paths
      const designPath = designFile ? renameWithExt(designFile) : req.body.designPath;
      const backDesignPath = backDesignFile ? renameWithExt(backDesignFile) : req.body.backDesignPath;
      const mockupTemplatePath = mockupTemplateFile ? renameWithExt(mockupTemplateFile) : req.body.mockupTemplatePath;

      console.log(`[regen] index=${index}, mode=${mode}, designPath=${designPath}, mockupTemplatePath=${mockupTemplatePath}, opts=${JSON.stringify(sharpOpts)}`);

      if (!designPath || !mockupTemplatePath) {
        return res.status(400).json({ error: 'designPath and mockupTemplatePath required' });
      }

      const toAbs = (p) => p.match(/^[a-zA-Z]:/) ? p : path.join(__dirname, p.replace(/^\//, ''));
      const absDesign = toAbs(designPath);
      const absBack = backDesignPath ? toAbs(backDesignPath) : null;
      const absMockup = toAbs(mockupTemplatePath);
      console.log(`[regen] resolved template: ${absMockup}`);

      // Use Sharp for regen when options are specified (scale, position, whiteMode)
      let outputPaths;
      if (mode === 'front-back' && absBack) {
        outputPaths = await composeMockupSharp(absDesign, [absMockup], sku, sharpOpts);
        try {
          await composeSingleMockupSharp(absBack, absMockup, outputPaths[0], sharpOpts);
        } catch (backErr) {
          console.warn(`  Regen back design error: ${backErr.message}`);
        }
      } else {
        outputPaths = await composeMockupSharp(absDesign, [absMockup], sku, sharpOpts);
      }

      // composeMockup always names output _mockup1.png (i=0) since we pass a single template.
      // Rename to the correct index so it replaces the right mockup file.
      const rawOutput = outputPaths[0];
      const correctName = `${sku}_mockup${index + 1}.png`;
      const correctPath = path.join(path.dirname(rawOutput), correctName);
      if (rawOutput !== correctPath) {
        fs.renameSync(rawOutput, correctPath);
      }
      // Update meta file so upload uses the regenerated mockup
      const metaPath = path.join(__dirname, 'output', `${sku}.meta.json`);
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.mockupPaths && meta.mockupPaths[index] !== undefined) {
          meta.mockupPaths[index] = '/output/' + correctName;
          fs.writeFileSync(metaPath, JSON.stringify(meta));
        }
      } catch {}
      res.json({ path: '/output/' + correctName, name: correctName });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Generate tags with AI ──
app.post('/api/generate-tags-ai', requireEtsyToolReady, async (req, res) => {
  try {
    const { title, tags: existingTags } = req.body;
    const apiKey = req.apiKey;
    if (!apiKey) return res.status(500).json({ error: 'API key not set. Ayarlar sayfasindan API anahtarinizi girin.' });

    const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-maverick',
        messages: [{
          role: 'user',
          content: `You are an Etsy SEO expert. Generate exactly 13 optimized tags for this Etsy listing.

Title: "${title || 'T-shirt design'}"
${existingTags?.length ? `Current tags for reference: ${existingTags.slice(0, 5).join(', ')}` : ''}

RULES:
1. Each tag max 20 characters
2. Mix broad + niche keywords
3. Include style, occasion, and target audience terms
4. No repetition across tags
5. Think like a buyer searching on Etsy

Output ONLY a JSON array of 13 strings, nothing else. Example: ["tag1","tag2",...]`,
        }],
      }),
    });

    if (!response.ok) throw new Error('AI API failed');
    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    if (typeof content !== 'string' && Array.isArray(content)) {
      content = content.filter(p => p.type === 'text').map(p => p.text).join('');
    }
    // Extract JSON array from response
    const match = content.match(/\[[\s\S]*?\]/);
    const tags = match ? JSON.parse(match[0]) : [];
    res.json({ tags: tags.slice(0, 13) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate title with AI ──
app.post('/api/generate-title-ai', requireEtsyToolReady, async (req, res) => {
  try {
    const { title, tags } = req.body;
    const newTitle = await generateSEOTitle(title || '', tags || [], req.apiKey);
    res.json({ title: newTitle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate description with template ──
app.post('/api/generate-description-ai', requireEtsyToolReady, async (req, res) => {
  try {
    const { title, tags } = req.body;
    const description = generateDescription(title || '', tags || []);
    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert a mockup image to a 5-second Ken Burns MP4 video for Etsy listings
app.post('/api/mockup-to-video', requireEtsyToolReady, express.json(), async (req, res) => {
  try {
    const { src } = req.body || {};
    if (!src || typeof src !== 'string') return res.status(400).json({ error: 'src required' });
    // src expected to be /output/filename.ext — resolve safely
    const filename = path.basename(src);
    const inputPath = path.join(__dirname, 'output', filename);
    if (!fs.existsSync(inputPath)) return res.status(404).json({ error: 'mockup not found: ' + filename });

    const videosDir = path.join(__dirname, 'output', 'videos');
    if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
    const outName = filename.replace(/\.[^.]+$/, '') + '.mp4';
    const outPath = path.join(videosDir, outName);

    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    // Ken Burns: slow zoom-in from 1.0 -> 1.15 over 5 seconds at 30fps (150 frames)
    // Output 1080x1080 H.264 MP4 — Etsy-compatible
    const args = [
      '-y',
      '-loop', '1',
      '-i', inputPath,
      '-vf', "scale=3000:3000:force_original_aspect_ratio=increase,crop=3000:3000,zoompan=z='min(zoom+0.0010,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1080:fps=30",
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-t', '5',
      '-preset', 'medium',
      '-crf', '20',
      '-movflags', '+faststart',
      outPath,
    ];

    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) { console.error('[video] ffmpeg error:', stderr?.toString().slice(-500) || err.message); reject(err); }
        else resolve();
      });
    });

    res.json({ video: '/output/videos/' + outName, name: outName });
  } catch (err) {
    res.status(500).json({ error: err.message || 'video generation failed' });
  }
});

// Main pipeline endpoint — SSE response
app.post('/api/create',
  requireEtsyToolReady,
  upload.fields([
    { name: 'ref', maxCount: 1 },
    { name: 'backDesign', maxCount: 1 },
    { name: 'mockups', maxCount: 20 },
    { name: 'productPhotos', maxCount: 5 },
  ]),
  async (req, res) => {
    // Disable request timeout — pipeline can take several minutes
    req.setTimeout(0);
    res.setTimeout(0);

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    // Disable Nagle's algorithm so each SSE event hits the wire immediately
    // instead of being coalesced and held back by TCP. Without this, events
    // generated rapidly during synchronous stretches of the pipeline can
    // arrive in one batch at res.end() instead of streaming.
    try { res.socket && res.socket.setNoDelay(true); } catch {}
    // Immediate prelude so the browser starts receiving body chunks right away
    // (some clients refuse to surface the response until the first data lands).
    res.write(': stream-open\n\n');

    // Pipeline concurrency lock
    if (pipelineLock) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Baska bir pipeline zaten calisiyor. Lutfen bekleyin.' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      return res.end();
    }
    pipelineLock = true;
    // Release lock on client disconnect (browser close, network drop) so the
    // next request isn't blocked forever.
    res.on('close', () => { pipelineLock = false; });

    // Every code path below must release the lock — wrap in try/finally so
    // unexpected exceptions during body parsing, file copy, job writes, etc.
    // cannot leave pipelineLock stuck at true and brick subsequent requests.
    let allTempFiles = [];
    try {

    const send = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // SSE keepalive — prevent browser from dropping idle connection
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);
    res.on('close', () => clearInterval(keepalive));

    // Only product-mockup mode is supported. Legacy values ('single', 'front-back')
    // are coerced to product-mockup; any other unknown value is rejected.
    let mode = req.body.mode || 'product-mockup';
    if (mode === 'single' || mode === 'front-back') mode = 'product-mockup';
    if (mode !== 'product-mockup') {
      send({ type: 'error', message: `Desteklenmeyen mod: ${mode}. Sadece urun gorseli (product-mockup) modu aktif.` });
      pipelineLock = false;
      return res.end();
    }
    let refFile = req.files?.ref?.[0];
    if (!refFile && req.files?.productPhotos?.[0]) refFile = req.files.productPhotos[0];
    const backDesignFile = req.files?.backDesign?.[0];

    // DEBUG: log what server receives
    console.log('[REQ] body keys:', Object.keys(req.body));
    console.log('[REQ] resumeFrom:', req.body.resumeFrom, '| continueFrom:', req.body.continueFrom);
    console.log('[REQ] existingTags:', req.body.existingTags ? req.body.existingTags.substring(0, 80) : 'NULL');
    console.log('[REQ] existingTitle:', req.body.existingTitle ? req.body.existingTitle.substring(0, 60) : 'NULL');
    console.log('[REQ] existingMockups:', req.body.existingMockups ? 'YES' : 'NULL');
    console.log('[REQ] existingListingUrl:', req.body.existingListingUrl || 'NULL');

    const isResume = !!req.body.resumeFrom || !!req.body.continueFrom;

    if (!refFile && !isResume) {
      send({ type: 'error', message: 'No reference image uploaded' });
      pipelineLock = false;
      return res.end();
    }

    if (mode === 'front-back' && !backDesignFile && !isResume) {
      send({ type: 'error', message: 'Front-back mode requires a back design image' });
      pipelineLock = false;
      return res.end();
    }

    const sku = req.body.sku || `SKU${Date.now()}`;
    const competitor = req.body.competitor || '';
    const prompt = req.body.prompt || undefined;
    const skipTags = req.body.skipTags === '1';
    const fullAuto = req.body.fullAuto === '1';
    const removeBg = req.body.removeBg === '1';
    const mockupFiles = req.files?.mockups || [];
    const tagSource = req.body.tagSource || 'alura'; // 'alura' | 'etsyhunt'
    const etsyhuntKeyword = (req.body.etsyhuntKeyword || '').trim();
    const titleSource = req.body.titleSource || 'scrape'; // 'scrape' | 'image-analyze'
    const productType = cleanProductContext(req.body.productType || '');
    const productContext = getConfiguredProductContext(req.body.productContext, productType);
    const imgMockupCount = Math.max(1, Math.min(parseInt(req.body.mockupCount || req.body.imgMockupCount || '3', 10) || 3, 6));
    const leatherProductKey = '';
    const leatherListing = null;
    if (productContext) send({ type: 'log', message: '[urun] ' + productContext });

    // Library mockups: resolve paths from mockups/ directory
    const libraryMockupPaths = (req.body.libraryMockups || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => path.join(__dirname, 'mockups', path.basename(p)));

    // Resume support: skip already-completed steps
    const resumeFrom = req.body.resumeFrom || null; // 'mockup' | 'tags' | 'upload' | 'pinterest'
    const existingDesign = req.body.existingDesign || null;       // /designs/xxx.png
    const existingMockups = req.body.existingMockups || null;     // comma-separated /output/xxx.png
    const existingTags = req.body.existingTags || null;           // comma-separated tags
    const existingTitle = req.body.existingTitle || null;
    const existingDescription = req.body.existingDescription || null;
    const existingListingUrl = req.body.existingListingUrl || null;
    const continueFrom = req.body.continueFrom || null;

    const STEP_ORDER = ['generate', 'mockup', 'tags', 'upload', 'pinterest'];
    // continueFrom maps to resumeFrom equivalent for step skipping
    const effectiveResumeFrom = resumeFrom
      || (continueFrom === 'placement-approve' ? 'mockup' : null)
      || (continueFrom === 'mockup-approve' ? 'tags' : null)
      || (continueFrom === 'upload' ? 'upload' : null)
      || (continueFrom === 'upload-and-pin' ? 'upload' : null)
      || (continueFrom === 'pinterest' ? 'pinterest' : null);
    const resumeIdx = effectiveResumeFrom ? STEP_ORDER.indexOf(effectiveResumeFrom) : 0;
    const shouldRun = (step) => STEP_ORDER.indexOf(step) >= resumeIdx;

    // Rename files with proper extensions
    const refPath = refFile ? renameWithExt(refFile) : null;
    const backDesignPath = backDesignFile ? renameWithExt(backDesignFile) : null;
    // Save uploaded mockup templates to mockups/ so they persist for regeneration
    const mockupsDir = path.join(__dirname, 'mockups');
    const uploadedMockupPaths = mockupFiles.map(f => {
      const tmp = renameWithExt(f);
      const safeName = f.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(mockupsDir, safeName);
      // Skip copy if identical file already in mockups/ (same size+mtime), and
      // fall back to unlink+retry on Windows EBUSY/UNKNOWN when the cached file
      // is locked by another process (indexer, prior Sharp handle, etc.).
      let shouldCopy = true;
      try {
        if (fs.existsSync(dest)) {
          const [a, b] = [fs.statSync(tmp), fs.statSync(dest)];
          if (a.size === b.size) shouldCopy = false;
        }
      } catch {}
      if (shouldCopy) {
        try {
          fs.copyFileSync(tmp, dest);
        } catch (copyErr) {
          try { fs.unlinkSync(dest); } catch {}
          try { fs.copyFileSync(tmp, dest); }
          catch { if (!fs.existsSync(dest)) throw copyErr; }
        }
      }
      return dest;
    });
    let mockupPaths = [...uploadedMockupPaths, ...libraryMockupPaths];
    // Send template paths to client for regeneration
    let mockupTemplatePaths = mockupPaths.map(p => '/mockups/' + path.basename(p));

    allTempFiles = mockupFiles.map(f => f.path + (path.extname(f.originalname) || '.png'));
    if (refPath) allTempFiles.push(refPath);
    if (backDesignPath) allTempFiles.push(backDesignPath);

    // Save metadata for resume — preserve existing meta when resuming
    const metaPath = path.join(__dirname, 'output', sku + '.meta.json');
    let meta;
    if (isResume && fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { meta = {}; }
      meta.timestamp = Date.now();
      if (competitor) meta.competitor = competitor;
      if (mockupTemplatePaths.length > 0) meta.mockupTemplatePaths = mockupTemplatePaths;
    } else {
      meta = { sku, competitor, mode, productType, productContext, timestamp: Date.now(), mockupTemplatePaths };
    }
    if (productContext) meta.productContext = productContext;
    if (productType) meta.productType = productType;
    // Write meta immediately so mockupTemplatePaths is always persisted
    try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch {}

    send({ type: 'sku', sku });

    // Create or update job for this pipeline run
    const existingJob = readJob(sku);
    if (existingJob && (existingJob.status === 'interrupted' || existingJob.status === 'paused' || existingJob.status === 'failed')) {
      updateJob(sku, { status: 'running', error: null, mode, competitor });
    } else if (!existingJob) {
      createJob(sku, { mode, competitor, fullAuto: !!fullAuto });
    } else {
      updateJob(sku, { status: 'running', error: null });
    }

    try {
      // ── Step 1: Design ──
      let designPath;
      let backDesignFinalPath = null;

      if (!shouldRun('generate') && existingDesign) {
        // Resume: use existing design
        designPath = path.join(__dirname, existingDesign.replace(/^\//, ''));
        send({ type: 'step-done', step: 'generate', message: 'Tasarım (önceden hazır)' });
        send({ type: 'design', path: existingDesign, name: path.basename(existingDesign) });
        send({ type: 'log', message: 'Tasarım adımı atlandı (devam)' });
        // Restore back design from meta for front-back mode
        if (mode === 'front-back' && meta.backDesignPath) {
          backDesignFinalPath = path.join(__dirname, meta.backDesignPath.replace(/^\//, ''));
        }
      } else if (!shouldRun('generate')) {
        // Resume without design - try to find design by SKU
        send({ type: 'step-done', step: 'generate', message: 'Tasarım adımı atlandı' });
        try {
          const designsDir = path.join(__dirname, 'designs');
          const found = fs.readdirSync(designsDir).find(f => f.startsWith(sku + '_design'));
          if (found) {
            designPath = path.join(designsDir, found);
            send({ type: 'design', path: '/designs/' + found, name: found });
          }
        } catch {}
      } else {
        const designExt = path.extname(refFile.originalname) || '.png';
        const designName = `${sku}_design${designExt}`;
        designPath = path.join(__dirname, 'designs', designName);
        fs.copyFileSync(refPath, designPath);
        send({ type: 'step-done', step: 'generate', message: 'Design ready' });
        send({ type: 'design', path: '/designs/' + designName, name: designName });

        if (mode === 'front-back' && backDesignPath) {
          const backExt = path.extname(backDesignFile.originalname) || '.png';
          const backName = `${sku}_back${backExt}`;
          backDesignFinalPath = path.join(__dirname, 'designs', backName);
          fs.copyFileSync(backDesignPath, backDesignFinalPath);
          send({ type: 'design', path: '/designs/' + backName, name: backName });
        }
      }


      // Recover backDesignFinalPath from meta or disk if not set (e.g. continueFrom placement-approve)
      if (!backDesignFinalPath && mode === 'front-back') {
        if (meta.backDesignPath) {
          const recovered = path.join(__dirname, meta.backDesignPath.replace(/^\//, ''));
          if (fs.existsSync(recovered)) backDesignFinalPath = recovered;
        }
        if (!backDesignFinalPath) {
          try {
            const designsDir = path.join(__dirname, 'designs');
            const found = fs.readdirSync(designsDir).find(f => f.startsWith(sku + '_back'));
            if (found) backDesignFinalPath = path.join(designsDir, found);
          } catch {}
        }
      }

      // Save meta with design info
      meta.designPath = designPath ? '/designs/' + path.basename(designPath) : null;
      if (backDesignFinalPath) meta.backDesignPath = '/designs/' + path.basename(backDesignFinalPath);
      try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch {}
      updateJob(sku, { currentStep: 'generate', completedSteps: ['generate'], designPath: meta.designPath, backDesignPath: meta.backDesignPath || null });
      if (shouldRun('generate')) trackStat('designs');

      // Helper to persist meta updates
      const saveMeta = () => {
        try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch {}
      };

      // ── Step 1.5: Remove background from design(s) ──
      if (designPath && shouldRun('generate') && removeBg) {
        try {
          send({ type: 'step-start', step: 'bg-remove', message: 'Arkaplan kaldiriliyor...' });
          const designBuf = fs.readFileSync(designPath);
          const cleanBuf = await removeBackground(designBuf);
          const pngPath = designPath.replace(/\.[^.]+$/, '.png');
          fs.writeFileSync(pngPath, cleanBuf);
          if (pngPath !== designPath) designPath = pngPath;
          meta.designPath = '/designs/' + path.basename(designPath);
          saveMeta();
          send({ type: 'step-done', step: 'bg-remove', message: 'Arkaplan kaldirildi' });
          send({ type: 'design', path: meta.designPath, name: path.basename(designPath) });
        } catch (bgErr) {
          console.error('Background removal error:', bgErr.message);
          send({ type: 'log', message: 'Arkaplan kaldirma basarisiz: ' + bgErr.message });
        }

        if (backDesignFinalPath) {
          try {
            send({ type: 'log', message: 'Arka tasarim arkaplani kaldiriliyor...' });
            const backBuf = fs.readFileSync(backDesignFinalPath);
            const cleanBack = await removeBackground(backBuf);
            const backPng = backDesignFinalPath.replace(/\.[^.]+$/, '.png');
            fs.writeFileSync(backPng, cleanBack);
            if (backPng !== backDesignFinalPath) backDesignFinalPath = backPng;
            meta.backDesignPath = '/designs/' + path.basename(backDesignFinalPath);
            saveMeta();
            send({ type: 'log', message: 'Arka tasarim arkaplani kaldirildi' });
          } catch (bgErr2) {
            console.error('Back design bg removal error:', bgErr2.message);
            send({ type: 'log', message: 'Arka tasarim bg kaldirma basarisiz: ' + bgErr2.message });
          }
        }
      }

      // ── Step 2: Compose Mockups ──
      let mockupOutputs = [];
      let imageToMockupHandled = false;

      // Image-to-Mockup mode: generate lifestyle mockups via Gemini (angle + scene rotation)
      if (mode === 'product-mockup' && designPath && !existingMockups) {
        if (shouldRun('mockup')) {
          send({ type: 'step-start', step: 'mockup', message: 'Gorselden lifestyle mockup uretiliyor (acilara gore donen)...' });
          // Extract theme from the product photo first so scene picker hits the right pool
          let themeWords = [];
          try {
            if (leatherListing) {
              themeWords = [leatherListing.keyword, 'full-grain leather', 'handmade leather'];
              send({ type: 'log', message: `[leather] urun turu kilitlendi: ${leatherProductKey}` });
            } else {
            const buf = fs.readFileSync(designPath);
            const ext = path.extname(designPath).toLowerCase();
            const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            const apiKey = req.apiKey || process.env.OPENROUTER_API_KEY;
            const themeRes = await extractKeywords(buf, mime, apiKey, { productContext });
            themeWords = themeRes.themeWords || [];
            if (themeWords.length) send({ type: 'log', message: '[mockup-theme] ' + themeWords.slice(0, 12).join(', ') });
            }
          } catch (themeErr) {
            send({ type: 'log', message: '[mockup-theme] cikartilamadi: ' + themeErr.message + ' (default prompt)' });
          }
          try {
            const productDescription = leatherListing
              ? leatherListing.mockupHint
              : (productContext || (themeWords.length ? themeWords.slice(0, 8).join(', ') : 'product from uploaded photo'));
            let themesSpec = null;
            try { themesSpec = req.body.themes ? JSON.parse(req.body.themes) : null; } catch {}
            const lsResult = await generateLifestyleMockups({
              productImagePath: designPath,
              productDescription,
              themeWords,
              themes: Array.isArray(themesSpec) && themesSpec.length ? themesSpec : undefined,
              sku,
              count: imgMockupCount,
              // rotate-angles: her mockup farkli kamera acisi + sahne. Once urun vision ile
              // tarif edilip her kare farkli acidan yeniden kurgulanir (Etsy galerisi tek
              // acida sikismaz). bg-replace acisi kilitliyordu; deri urunlerde cesitlilik sart.
              mode: 'rotate-angles',
              apiKey: req.apiKey,
              onProgress: (ev) => {
                if (ev.type === 'mockup-start') send({ type: 'log', message: `[mockup ${ev.idx}/${ev.total}] ${ev.angle} | ${ev.scene}` });
                else if (ev.type === 'mockup-done') send({ type: 'log', message: `[mockup ${ev.idx}/${ev.total}] hazir: ${path.basename(ev.path)}` });
                else if (ev.type === 'mockup-error') send({ type: 'log', message: `[mockup ${ev.idx}/${ev.total}] HATA: ${ev.error}` });
                else if (ev.type === 'step-done') send({ type: 'log', message: '[' + ev.step + '] ' + ev.message });
                else if (ev.type === 'step-start') send({ type: 'log', message: '[' + ev.step + '] ' + ev.message });
              },
            });
            const generated = lsResult.outputs;
            mockupOutputs = generated;
            meta.mockupPaths = mockupOutputs.map(p => '/output/' + path.basename(p));
            saveMeta();
            updateJob(sku, { currentStep: 'mockup', completedSteps: ['generate', 'mockup'], mockupPaths: meta.mockupPaths });
            for (let mi = 0; mi < mockupOutputs.length; mi++) trackStat('mockups');
            send({ type: 'step-done', step: 'mockup', message: `${mockupOutputs.length} mockup uretildi` });
            mockupOutputs.forEach((p) => {
              const name = path.basename(p);
              send({ type: 'mockup', path: '/output/' + name, name, templatePath: '' });
              send({ type: 'log', message: 'Mockup ready: ' + name });
            });
          } catch (err) {
            console.error('Image-to-mockup error:', err.message);
            send({ type: 'step-error', step: 'mockup', message: 'Gorselden mockup uretimi basarisiz: ' + err.message });
            updateJob(sku, { status: 'failed', error: err.message, currentStep: 'mockup' });
          }
        }
        imageToMockupHandled = true;
      }

      const _dbg = {continueFrom, resumeFrom, effectiveResumeFrom, mockupPathsLen: mockupPaths.length, existingMockups: !!existingMockups, shouldRunMockup: shouldRun('mockup'), mockupNames: mockupPaths.map(p=>path.basename(p)), fullAuto};
      fs.writeFileSync(path.join(__dirname, 'mockup-debug.log'), JSON.stringify(_dbg, null, 2));
      send({ type: 'log', message: '[DEBUG] ' + JSON.stringify(_dbg) });

      if (imageToMockupHandled) {
        // Already handled above
      } else if ((!shouldRun('mockup') || (continueFrom && continueFrom !== 'placement-approve')) && existingMockups) {
        // Resume or continueFrom: use existing mockups
        mockupOutputs = existingMockups.split(',').map(p => path.join(__dirname, p.trim().replace(/^\//, '')));
        send({ type: 'step-done', step: 'mockup', message: `Mockup (${mockupOutputs.length} adet hazır)` });
        // Use saved template paths from meta if no new uploads
        const resumeTemplatePaths = mockupTemplatePaths.length > 0 ? mockupTemplatePaths : (meta.mockupTemplatePaths || []);
        send({ type: 'mockupTemplates', paths: resumeTemplatePaths });
        // Send mockup events to frontend
        mockupOutputs.forEach((p, i) => {
          const name = path.basename(p);
          send({ type: 'mockup', path: '/output/' + name, name, templatePath: resumeTemplatePaths[i] || '' });
        });
        send({ type: 'log', message: 'Mockup adımı atlandı (devam)' });
      } else if (!shouldRun('mockup')) {
        send({ type: 'step-done', step: 'mockup', message: 'Mockup adımı atlandı' });
      } else if (mockupPaths.length > 0) {
        // Pre-flight: check calibration for all selected mockups
        const positions = (() => { try { return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch { return {}; } })();
        const uncalibrated = mockupPaths.filter(p => !positions[path.basename(p)]);
        if (uncalibrated.length > 0) {
          // Auto-calibrate missing ones; if detection fails, fall back to a
          // centered default so user-selected mockups are never dropped.
          send({ type: 'log', message: `${uncalibrated.length} mockup kalibre edilmemis, otomatik algilaniyor...` });
          const sharp = require('sharp');
          for (const mp of uncalibrated) {
            const base = path.basename(mp);
            let placed = false;
            try {
              const autoPos = await detectGarmentArea(mp);
              if (autoPos) {
                const norm = normalizePos(autoPos);
                positions[base] = { x: autoPos.x, y: autoPos.y, width: norm.width, height: norm.height, source: 'auto' };
                send({ type: 'log', message: `Otomatik kalibre edildi: ${base} (${norm.width}x${norm.height})` });
                placed = true;
              }
            } catch (autoErr) {
              send({ type: 'log', message: `Otomatik algilama hatasi (${base}): ${autoErr.message}` });
            }
            if (!placed) {
              try {
                const meta = await sharp(mp).metadata();
                const w = Math.round(meta.width * 0.5);
                const h = Math.round(meta.height * 0.5);
                const x = Math.round((meta.width - w) / 2);
                const y = Math.round((meta.height - h) / 2);
                positions[base] = { x, y, width: w, height: h, source: 'fallback' };
                send({ type: 'warning', message: `Otomatik algilama basarisiz, varsayilan merkez pozisyon atandi: ${base} (${w}x${h})` });
              } catch (metaErr) {
                send({ type: 'warning', message: `Mockup okunamadi, atlandi: ${base} (${metaErr.message})` });
              }
            }
          }
          // Save positions (including fallbacks) so future runs and calibration screen see them
          try { fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2)); } catch {}
          // Drop only the ones that couldn't even be read
          const stillUncalibrated = mockupPaths.filter(p => !positions[path.basename(p)]);
          if (stillUncalibrated.length > 0) {
            const names = stillUncalibrated.map(p => path.basename(p));
            send({ type: 'warning', message: `${names.length} mockup okunamadi, atlandi: ${names.join(', ')}` });
            mockupPaths = mockupPaths.filter(p => positions[path.basename(p)]);
            mockupTemplatePaths = mockupTemplatePaths.filter(p => positions[path.basename(p)]);
          }
        }
        if (mockupPaths.length === 0) {
          send({ type: 'step-done', step: 'mockup', message: 'Kalibre edilmis mockup yok - atlandi' });
        } else {

        // Parse custom positions from placement approval
        let customPositions = null;
        if (continueFrom === 'placement-approve') {
          try { customPositions = JSON.parse(req.body.customPositions || 'null'); } catch {}
        }

        send({ type: 'step-start', step: 'mockup', message: 'Composing mockups...' });
        try {
          const composeOpts = customPositions
            ? { positionOverrides: customPositions, sendSSE: send, removeBg }
            : { sendSSE: send, removeBg };
          if (mode === 'front-back' && backDesignFinalPath) {
            send({ type: 'log', message: `Mockup modu: front-back (Sharp)` });
            // Compose front design on all mockups
            const frontOutputs = await composeMockupSharp(designPath, mockupPaths, sku, composeOpts);
            // Now overlay back design on top of the FRONT-COMPOSED images.
            // Read positions for the original templates so position lookup still works
            // even though the source image is now an SKU output file.
            const savedPositions = (() => { try { return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch { return {}; } })();
            const backOpts = { ...composeOpts, whiteMode: false };
            for (let fi = 0; fi < frontOutputs.length; fi++) {
              try {
                const tplBase = path.basename(mockupPaths[fi]);
                const backPos =
                  (customPositions && (customPositions[tplBase + ':back'] || customPositions[tplBase])) ||
                  savedPositions[tplBase + ':back'] ||
                  savedPositions[tplBase];
                if (!backPos) {
                  send({ type: 'log', message: `${tplBase}: arka pozisyon yok, atlandi` });
                  continue;
                }
                // Source AND output = the front-composed image so back overlays on top of front.
                await composeSingleMockupSharp(backDesignFinalPath, frontOutputs[fi], frontOutputs[fi], { ...backOpts, position: backPos });
              } catch (backErr) {
                send({ type: 'log', message: `Arka tasarim yerlestirme hatasi (${path.basename(mockupPaths[fi])}): ${backErr.message}` });
              }
            }
            mockupOutputs = frontOutputs;
          } else {
            send({ type: 'log', message: `Mockup modu: ${mode} (Sharp - birebir yerlestirme)` });
            mockupOutputs = await composeMockupSharp(designPath, mockupPaths, sku, composeOpts);
          }
          send({ type: 'step-done', step: 'mockup', message: 'Mockups composed' });
          send({ type: 'mockupTemplates', paths: mockupTemplatePaths });
          meta.mockupPaths = mockupOutputs.map(p => '/output/' + path.basename(p));
          saveMeta();
          updateJob(sku, { currentStep: 'mockup', completedSteps: ['generate', 'mockup'], mockupPaths: meta.mockupPaths });
          for (let mi = 0; mi < mockupOutputs.length; mi++) trackStat('mockups');
          trackMockupUsage(mockupPaths.map(p => path.basename(p)));
          mockupOutputs.forEach((p, i) => {
            const name = path.basename(p);
            send({ type: 'mockup', path: '/output/' + name, name, templatePath: mockupTemplatePaths[i] || '' });
            send({ type: 'log', message: 'Mockup ready: ' + name });
          });
        } catch (err) {
          console.error('AI mockup error:', err.message);
          send({ type: 'step-error', step: 'mockup', message: 'AI mockup basarisiz: ' + err.message });
          updateJob(sku, { status: 'failed', error: err.message, currentStep: 'mockup' });
        }
        } // close calibration check else
      }

      // ── Pause after mockup (manual mode) ──
      if (!fullAuto && (!continueFrom || continueFrom === 'placement-approve') && mockupOutputs.length > 0) {
        updateJob(sku, { status: 'paused', currentStep: 'mockup', completedSteps: ['generate', 'mockup'], mockupPaths: mockupOutputs.map(p => '/output/' + path.basename(p)) });
        send({ type: 'pause', step: 'mockup', message: 'Mockup\'lar hazir — kontrol edin ve devam edin' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        pipelineLock = false;
        return res.end();
      }

      // ── Step 3: Scrape Tags & Title ──
      let tags = [];
      let title = '';
      let description = '';
      const finalizeTags = (rawTags) => {
        if (!leatherListing) return (rawTags || []).map(normalizeTag).filter(Boolean);
        const out = [];
        const seen = new Set();
        for (const raw of [...(rawTags || []), ...leatherListing.tags]) {
          const tag = String(raw || '').toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
          if (!tag || tag.length < 3 || tag.length > 20 || seen.has(tag)) continue;
          if (/\b(baby|puzzle|toddler|montessori|nursery)\b/i.test(tag)) continue;
          seen.add(tag);
          out.push(tag);
          if (out.length === 13) break;
        }
        return out;
      };

      console.log(`  [tags] shouldRun=${shouldRun('tags')}, competitor=${competitor ? competitor.substring(0, 40) : 'NULL'}, skipTags=${skipTags}, existingTags=${existingTags ? 'YES' : 'NULL'}`);

      if (continueFrom === 'pinterest') {
        // Pinterest-only: skip tags entirely
        send({ type: 'log', message: 'Tag adimi atlandi (sadece Pinterest)' });
      } else if (skipTags && (existingTitle || existingDescription || existingTags)) {
        // Puzzle Taslak handoff: client supplied locked listing (catalog template).
        // Use it verbatim, skip AI generation entirely.
        if (existingTags) {
          tags = padTagsForProduct(existingTags.split(',').map(t => t.trim()).filter(Boolean), productContext, existingTitle || '');
          send({ type: 'tags', tags });
        }
        if (existingTitle) {
          title = existingTitle;
          send({ type: 'title', title });
        }
        if (existingDescription) {
          description = existingDescription;
          send({ type: 'description', description });
        }
        meta.tags = tags; meta.title = title; meta.description = description;
        saveMeta();
        send({ type: 'step-done', step: 'tags', message: 'Tag/title/description hazir sablonundan alindi' });
      } else if (!shouldRun('tags')) {
        // Resume: tag adimi atlandi, mevcut verileri kullan
        if (existingTags) {
          tags = existingTags.split(',').map(t => t.trim()).filter(Boolean);
        } else if (meta.tags && meta.tags.length > 0) {
          tags = meta.tags;
        }
        title = existingTitle || meta.title || '';
        description = existingDescription || meta.description || '';
        if (tags.length > 0) {
          send({ type: 'step-done', step: 'tags', message: `Etiketler (onceden hazir: ${tags.length})` });
          send({ type: 'tags', tags });
          send({ type: 'title', title });
          send({ type: 'description', description });
        } else {
          send({ type: 'step-done', step: 'tags', message: 'Tag adimi atlandi' });
        }
        send({ type: 'log', message: 'Etiket adimi atlandi (devam)' });
        meta.title = title;
        meta.tags = tags;
        meta.description = description;
        saveMeta();
      } else if (tagSource === 'etsyhunt' && !skipTags) {
        send({ type: 'step-start', step: 'tags', message: 'Tag Lab pipeline (mockup + EtsyHunt + Gemini) basliyor...' });
        try {
          // pipeline tetigi: ilk mockup hazir olunca onu analiz et
          const sourceImagePath = (mockupOutputs && mockupOutputs[0])
            || (meta.mockupPaths && meta.mockupPaths[0] ? path.join(__dirname, meta.mockupPaths[0].replace(/^\//, '')) : null)
            || designPath
            || (meta.designPath ? path.join(__dirname, meta.designPath.replace(/^\//, '')) : null);
          if (!sourceImagePath || !fs.existsSync(sourceImagePath)) {
            throw new Error('Mockup veya design image bulunamadi (Tag Lab pipeline icin gerekli)');
          }
          send({ type: 'log', message: '[tag-lab] kaynak: ' + path.basename(sourceImagePath) });
          const imageBuffer = fs.readFileSync(sourceImagePath);
          const ext = path.extname(sourceImagePath).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

          const result = await runTagLabPipeline({
            imageBuffer, mime,
            apiKey: req.apiKey || process.env.OPENROUTER_API_KEY,
            targetCount: 13,
            productContext: leatherListing ? `${leatherListing.title}. ${leatherListing.mockupHint}` : productContext,
            lockedDescription: leatherListing ? leatherListing.description : '',
            fallbackTags: leatherListing ? leatherListing.tags : [],
            onLog: (message) => send({ type: 'log', message: '[tag-lab] ' + message }),
            onKeywords: (kws, retry) => send({ type: 'log', message: '[tag-lab] keywords' + (retry ? ' (retry)' : '') + ': ' + kws.join(' | ') }),
            onResult: (kw, count, _top, error) => send({ type: 'log', message: '[tag-lab] "' + kw + '" -> ' + count + ' row' + (error ? ' (' + error + ')' : '') }),
            onProgress: (count, avgScore) => send({ type: 'log', message: '[tag-lab] aday=' + count + ' avg=' + avgScore.toFixed(1) }),
          });

          if (!result.tags || result.tags.length === 0) {
            send({ type: 'step-error', step: 'tags', message: 'EtsyHunt: tag bulunamadi - pipeline durduruldu (fallback yok)' });
            updateJob(sku, { status: 'paused', currentStep: 'tags', error: 'EtsyHunt tag bulunamadi', completedSteps: ['generate', 'mockup'], mockupPaths: mockupOutputs.map(p => '/output/' + path.basename(p)) });
            send({ type: 'pause', step: 'tags', message: 'EtsyHunt tag cekemedi. Yarim Kalanlar\'dan elle duzeltip devam edin.' });
            send({ type: 'done' });
            cleanup(allTempFiles);
            pipelineLock = false;
            return res.end();
          } else {
            tags = padTagsForProduct(finalizeTags(result.tags), productContext, result.title || title);
            send({ type: 'step-done', step: 'tags', message: 'Tag Lab: ' + tags.length + ' tag' });
            send({ type: 'tags', tags });
            meta.tags = tags;
            if (result.title) {
              title = result.title;
              meta.title = title;
              send({ type: 'title', title });
            }
            if (result.description) {
              description = leatherListing ? result.description : composeDescription(result.description, title, productContext);
              meta.description = description;
              send({ type: 'description', description });
            }
            if (leatherListing && !title) {
              title = leatherListing.title;
              meta.title = title;
              send({ type: 'title', title });
            }
            if (leatherListing && !description) {
              description = leatherListing.description;
              meta.description = description;
              send({ type: 'description', description });
            }
            saveMeta();
            updateJob(sku, { currentStep: 'tags', completedSteps: ['generate', 'mockup', 'tags'], tags });
          }
        } catch (err) {
          console.error('  [TAG-LAB ERROR]', err.message);
          send({ type: 'step-error', step: 'tags', message: 'EtsyHunt/Tag Lab hata: ' + err.message + ' - pipeline durduruldu' });
          updateJob(sku, { status: 'paused', currentStep: 'tags', error: 'EtsyHunt: ' + err.message, completedSteps: ['generate', 'mockup'], mockupPaths: mockupOutputs.map(p => '/output/' + path.basename(p)) });
          send({ type: 'pause', step: 'tags', message: 'EtsyHunt hata verdi. Yarim Kalanlar\'dan elle duzeltip devam edin.' });
          send({ type: 'done' });
          cleanup(allTempFiles);
          pipelineLock = false;
          return res.end();
        }
      } else if (tagSource === 'ai' && !skipTags) {
        send({ type: 'step-start', step: 'tags', message: 'AI tag/title/description (composed mockup uzerinden)...' });
        try {
          const sourceImagePath = (mockupOutputs && mockupOutputs[0])
            || (meta.mockupPaths && meta.mockupPaths[0] ? path.join(__dirname, meta.mockupPaths[0].replace(/^\//, '')) : null)
            || designPath
            || (meta.designPath ? path.join(__dirname, meta.designPath.replace(/^\//, '')) : null);
          if (!sourceImagePath || !fs.existsSync(sourceImagePath)) {
            throw new Error('Mockup veya design image bulunamadi');
          }
          send({ type: 'log', message: '[ai] kaynak: ' + path.basename(sourceImagePath) });
          const analysis = await analyzeMockup(sourceImagePath, {
            apiKey: req.apiKey,
            includeTags: true,
            productContext: leatherListing ? `${leatherListing.title}. ${leatherListing.mockupHint}` : productContext,
          });
          if (analysis.tags && analysis.tags.length) {
            tags = padTagsForProduct(finalizeTags(analysis.tags), productContext, analysis.title || title);
            meta.tags = tags;
            send({ type: 'tags', tags });
          }
          if (analysis.title) {
            title = analysis.title;
            meta.title = title;
            send({ type: 'title', title });
          }
          if (analysis.description) {
            description = leatherListing
              ? mergeLeatherDescription(analysis.description, leatherListing.description)
              : composeDescription(analysis.description, title, productContext);
            meta.description = description;
            send({ type: 'description', description });
          }
          if (leatherListing && !title) {
            title = leatherListing.title;
            meta.title = title;
            send({ type: 'title', title });
          }
          if (leatherListing && !description) {
            description = leatherListing.description;
            meta.description = description;
            send({ type: 'description', description });
          }
          saveMeta();
          send({ type: 'step-done', step: 'tags', message: 'AI: ' + tags.length + ' tag + title + description' });
          updateJob(sku, { currentStep: 'tags', completedSteps: ['generate', 'mockup', 'tags'], tags, title, description });
        } catch (err) {
          console.error('  [AI ANALYZE ERROR]', err.message);
          send({ type: 'step-error', step: 'tags', message: 'AI analiz hatasi: ' + err.message });
        }
      } else if (competitor && !skipTags) {
        send({ type: 'step-start', step: 'tags', message: 'Etsy Hunt ile etiketler arastiriliyor...' });
        let tagSuccess = false;
        try {
          // Intercept console.log from scrapeTags to send debug info to frontend
          const origLog = console.log;
          console.log = (...args) => {
            origLog(...args);
            const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
            if (msg.includes('[alura') || msg.includes('[report-wait') || msg.includes('[tag-') || msg.includes('[post-cdp') || msg.includes('Launcher') || msg.includes('WARNING')) {
              send({ type: 'log', message: msg.trim() });
            }
          };
          let result;
          try {
            result = await scrapeTags(competitor);
          } finally {
            console.log = origLog;
          }
          const rawCount = result.rawTagCount || 0;
          if (rawCount > 0 && result.tags && result.tags.length > 0) {
            tags = padTagsForProduct(result.tags, productContext, result.title || title);
            title = result.title;
            description = result.description;
            tagSuccess = true;
            send({ type: 'step-done', step: 'tags', message: `${tags.length} tags (${rawCount} scraped), description ready` });
          } else {
            send({ type: 'step-error', step: 'tags', message: `Alura ${rawCount} raw tag buldu - basarisiz` });
          }
        } catch (err) {
          console.error('  [TAG ERROR]', err.message, err.stack?.split('\n')[1]);
          send({ type: 'step-error', step: 'tags', message: `CDP/Alura hata: ${err.message}` });
        }
        if (tagSuccess) {
          send({ type: 'tags', tags });
          send({ type: 'title', title });
          send({ type: 'description', description });
          meta.title = title;
          meta.tags = tags;
          meta.description = description;
          saveMeta();
          updateJob(sku, { currentStep: 'tags', completedSteps: ['generate', 'mockup', 'tags'], tags, title, description });
        } else {
          // Alura failed: hard stop. User explicitly does NOT want silent AI fallback in alura mode.
          send({ type: 'step-error', step: 'tags', message: 'Alura basarisiz - pipeline durduruldu (fallback yok)' });
          updateJob(sku, { status: 'paused', currentStep: 'tags', error: 'Alura basarisiz', completedSteps: ['generate', 'mockup'], mockupPaths: mockupOutputs.map(p => '/output/' + path.basename(p)) });
          send({ type: 'pause', step: 'tags', message: 'Alura tag cekemedi. Yarim Kalanlar\'dan elle duzeltip devam edin.' });
          send({ type: 'done' });
          cleanup(allTempFiles);
          pipelineLock = false;
          return res.end();
        }
      } else if (shouldRun('tags') && !competitor && tagSource !== 'etsyhunt' && tagSource !== 'ai' && tagSource !== 'taglab') {
        // No tag source picked: do NOT silently fall back to AI. User explicitly
        // selects "AI urun" mode if they want AI tags.
        send({ type: 'step-error', step: 'tags', message: 'Tag kaynagi secilmemis - pipeline durduruldu (silent AI fallback yok)' });
        updateJob(sku, { status: 'paused', currentStep: 'tags', error: 'Tag kaynagi secilmemis', completedSteps: ['generate', 'mockup'], mockupPaths: mockupOutputs.map(p => '/output/' + path.basename(p)) });
        send({ type: 'pause', step: 'tags', message: 'Tag kaynagi yok. Tek tasarim icin AI urun / Alura / EtsyHunt secin ve tekrar deneyin.' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        pipelineLock = false;
        return res.end();
      }

      // Image-analyze: override title/description by analyzing the first mockup
      // (skipped when Tag Lab or AI pipeline already produced title/description)
      if (titleSource === 'image-analyze' && shouldRun('tags') && mockupOutputs.length > 0 && !skipTags && !((tagSource === 'etsyhunt' || tagSource === 'ai') && title && description)) {
        send({ type: 'step-start', step: 'analyze', message: 'Mockup analiz ediliyor (Gemini)...' });
        try {
          const analysis = await analyzeMockup(mockupOutputs[0], {
            tags,
            apiKey: req.apiKey,
            includeTags: true,
            productContext: leatherListing ? `${leatherListing.title}. ${leatherListing.mockupHint}` : productContext,
          });
          if (analysis.title) {
            title = analysis.title;
            send({ type: 'title', title });
          }
          if (analysis.description) {
            description = leatherListing
              ? mergeLeatherDescription(analysis.description, leatherListing.description)
              : composeDescription(analysis.description, title, productContext);
            send({ type: 'description', description });
          }
          if (analysis.tags && analysis.tags.length && (!tags || tags.length === 0)) {
            tags = padTagsForProduct(finalizeTags(analysis.tags), productContext, title);
            send({ type: 'tags', tags });
          }
          send({ type: 'step-done', step: 'analyze', message: 'Title, description, tags gorsel analizinden olusturuldu' });
          meta.title = title;
          meta.description = description;
          meta.tags = tags;
          saveMeta();
          updateJob(sku, { currentStep: 'tags', completedSteps: ['generate', 'mockup', 'tags'], tags, title, description });
        } catch (err) {
          console.error('  [ANALYZE ERROR]', err.message);
          send({ type: 'step-error', step: 'analyze', message: 'Mockup analiz basarisiz: ' + err.message });
        }
      }

      // Etsy 2026 algorithm rule gate. Every title/tag/description source goes
      // through the same final pass before pause or upload.
      if (title || tags.length > 0 || description) {
        const before = { title, tags: tags.slice(), description };
        const enforced = applyEtsy2026Listing(
          { title, tags, description },
          { productContext: leatherListing ? `${leatherListing.title}. ${leatherListing.mockupHint}` : productContext }
        );
        title = enforced.title;
        tags = enforced.tags;
        description = enforced.description;
        meta.title = title;
        meta.tags = tags;
        meta.description = description;
        saveMeta();
        updateJob(sku, { title, tags, description });
        if (before.title !== title) send({ type: 'title', title });
        if (before.tags.join('|') !== tags.join('|')) send({ type: 'tags', tags });
        if (before.description !== description) send({ type: 'description', description });
        if (before.title !== title || before.tags.join('|') !== tags.join('|') || before.description !== description) {
          send({ type: 'log', message: '[etsy-2026] Title, tags ve description 13 Haziran 2026 algoritma kuralina gore normalize edildi.' });
        }
      }

      // Check CDP availability for upload/pinterest steps
      const cdpReady = await isCdpAvailable();
      console.log(`  [upload-check] cdpReady=${cdpReady}, hasCookies=${!!loadCookies().etsy}`);

      // ── HARD BLOCK: ASLA tag olmadan devam etme ──
      console.log(`  [pause-check] fullAuto=${fullAuto}, continueFrom=${continueFrom}, tags=${tags.length}, title="${(title||'').substring(0,30)}"`);
      if (continueFrom !== 'upload-and-pin' && continueFrom !== 'pinterest' && (tags.length === 0 || !title)) {
        updateJob(sku, { status: 'paused', currentStep: 'tags', error: 'Tag veya baslik eksik', completedSteps: ['generate', 'mockup'], mockupPaths: mockupOutputs.map(p => '/output/' + path.basename(p)) });
        send({ type: 'step-error', step: 'tags', message: 'Tag veya baslik cekilemedi — pipeline durduruluyor' });
        send({ type: 'pause', step: 'tags', message: 'Etiketler ve baslik olmadan devam edilemez — manuel girin veya AI ile uretin' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        pipelineLock = false;
        return res.end();
      }
      // ── Pause after tags (manual mode) ──
      if (!fullAuto && continueFrom !== 'upload' && continueFrom !== 'upload-and-pin' && continueFrom !== 'pinterest' && tags.length > 0 && title) {
        updateJob(sku, { status: 'paused', currentStep: 'tags', completedSteps: ['generate', 'mockup', 'tags'], mockupPaths: mockupOutputs.map(p => '/output/' + path.basename(p)) });
        send({ type: 'pause', step: 'tags', message: 'Etiketler ve baslik hazir — duzenleyin ve devam edin' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        pipelineLock = false;
        return res.end();
      }

      // ── Step 4: Upload to Etsy ──
      let listingUrl = existingListingUrl || '';

      if ((continueFrom === 'upload-and-pin' || continueFrom === 'pinterest') && isValidListingUrl(existingListingUrl)) {
        // Coming from "Pin to Pinterest" button — upload already done, use existing URL
        listingUrl = existingListingUrl;
        send({ type: 'step-done', step: 'upload', message: 'Etsy (önceden yüklendi)' });
        send({ type: 'listingUrl', url: listingUrl });
        send({ type: 'log', message: 'Upload atlandı — mevcut listing kullanılıyor: ' + listingUrl });
      } else if ((continueFrom === 'upload-and-pin' || continueFrom === 'pinterest') && !existingListingUrl) {
        // Pin requested but no listing URL — cannot continue
        send({ type: 'step-error', step: 'upload', message: 'Listing URL bulunamadı — pin iptal edildi' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        pipelineLock = false;
        return res.end();
      } else if (!shouldRun('upload') && existingListingUrl) {
        send({ type: 'step-done', step: 'upload', message: 'Etsy (önceden yüklendi)' });
        send({ type: 'log', message: 'Etsy adımı atlandı (devam)' });
      } else if (tags.length > 0 && title) {
        // Hard block: never upload without tags and title
        if (tags.length === 0 || !title) {
          send({ type: 'step-error', step: 'upload', message: 'Tag veya baslik bos — upload iptal edildi' });
          send({ type: 'pause', step: 'tags', message: 'Tag/baslik eksik — ekleyip tekrar deneyin' });
          send({ type: 'done' });
          cleanup(allTempFiles);
          return res.end();
        }
        // Hard block: never upload without mockups
        if (mockupOutputs.length === 0) {
          send({ type: 'step-error', step: 'upload', message: 'Mockup yok — upload iptal edildi' });
          send({ type: 'pause', step: 'mockup', message: 'Mockup bulunamadi — once mockup olusturun' });
          send({ type: 'done' });
          cleanup(allTempFiles);
          return res.end();
        }
        // Append the static listing-template photos (product-info, how-to, thank-you)
        // after the mockups. See memory/project_post_mockup_templates.md.
        mockupOutputs = appendListingTemplates(mockupOutputs);
        // Final safety clamp: Etsy 2026 rule prefers short, readable titles.
        if (title && title.length > 110) {
          const original = title;
          let trimmed = title.slice(0, 110);
          const lastComma = trimmed.lastIndexOf(',');
          if (lastComma > 30) trimmed = trimmed.slice(0, lastComma);
          title = trimmed.trim();
          send({ type: 'log', message: `[title-clamp] ${original.length} -> ${title.length} char` });
        }
        send({ type: 'step-start', step: 'upload', message: 'Etsy\'ye yükleniyor...' });
        console.log(`  [upload] title="${(title||'').substring(0,50)}", tags=${tags.length}, desc=${(description||'').length} chars, photos=${mockupOutputs.length} (mockups + ${getListingTemplatePaths().length} template)`);
        const origUploadLog = console.log;
        const origUploadErr = console.error;
        const uploadIntercept = (label, ...args) => {
          const msg = args.map(a => typeof a === 'string' ? a : (a && a.stack) || JSON.stringify(a)).join(' ');
          send({ type: 'log', message: (label ? '[' + label + '] ' : '') + msg.trim() });
        };
        console.log = (...args) => { origUploadLog(...args); uploadIntercept('upload', ...args); };
        console.error = (...args) => { origUploadErr(...args); uploadIntercept('upload-err', ...args); };
        try {
          const altTexts = meta.altTexts || [];
          const uploadConfig = readConfig();
          const uploadOpts = {
            sku,
            mockupPaths: mockupOutputs,
            tags,
            title,
            description,
            altTexts,
            templateListingId: uploadConfig.templateListingId,
          };
          const result = await withEtsyUploadLock(async () => {
            if (cdpReady) {
              return uploadToEtsy(uploadOpts);
            } else if (loadCookies().etsy) {
              return uploadToEtsyWithCookies({ ...uploadOpts, etsyCookies: loadCookies().etsy });
            } else {
              throw new Error('Etsy hesabi bagli degil. Ayarlardan Etsy cookie\'lerinizi ekleyin.');
            }
          });
          listingUrl = result.listingUrl || '';
          if (!listingUrl || listingUrl === 'about:blank' || !listingUrl.includes('etsy.com')) {
            send({ type: 'step-error', step: 'upload', message: 'Etsy yükleme dogrulanamadi — listing URL alinamadi' });
            updateJob(sku, { status: 'failed', error: 'Listing URL alinamadi', currentStep: 'upload' });
          } else if (result.orphan) {
            send({ type: 'step-done', step: 'upload', message: 'Etsy\'ye yuklendi (dogrulama basarisiz)' });
            send({ type: 'listingUrl', url: listingUrl });
            send({ type: 'warning', message: `ORPHAN LISTING: ${listingUrl} — listing dogrulanamadi, manuel kontrol edin` });
            meta.listingUrl = listingUrl;
            meta.orphan = true;
            saveMeta();
            updateJob(sku, { currentStep: 'upload', completedSteps: ['generate', 'mockup', 'tags', 'upload'], listingUrl, orphan: true });
            trackStat('uploads');
          } else {
            const isDraft = !!result.isDraft;
            const msg = isDraft
              ? 'Etsy\'ye DRAFT olarak kaydedildi — Etsy\'den manuel Publish edin'
              : 'Etsy\'ye yuklendi';
            send({ type: 'step-done', step: 'upload', message: msg });
            send({ type: 'listingUrl', url: listingUrl });
            if (isDraft) {
              send({ type: 'log', message: 'NOT: Listing draft olarak kaydedildi. Publish etmek icin Etsy listing manager\'a gidin ve manuel olarak yayinlayin. Draft listing\'ler ucret odemez.' });
            }
            meta.listingUrl = listingUrl;
            meta.isDraft = isDraft;
            saveMeta();
            updateJob(sku, { currentStep: 'upload', completedSteps: ['generate', 'mockup', 'tags', 'upload'], listingUrl });
            trackStat('uploads');
          }
        } catch (err) {
          send({ type: 'step-error', step: 'upload', message: 'Etsy: ' + err.message });
          if (err.stack) send({ type: 'log', message: '[upload-stack] ' + err.stack.split('\n').slice(0, 4).join(' | ') });
          trackStat('errors');
          updateJob(sku, { status: 'failed', error: err.message, currentStep: 'upload' });
        } finally {
          console.log = origUploadLog;
          console.error = origUploadErr;
        }
      }

      // ── Pause after upload — ask about Pinterest (manual mode) ──
      if (!fullAuto && continueFrom !== 'upload-and-pin' && continueFrom !== 'pinterest' && listingUrl && listingUrl.includes('etsy.com')) {
        updateJob(sku, { status: 'paused', currentStep: 'upload', completedSteps: ['generate', 'mockup', 'tags', 'upload'], listingUrl });
        send({ type: 'pause', step: 'upload', message: 'Etsy\'ye yuklendi — Pinterest\'e pinlemek ister misiniz?' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        pipelineLock = false;
        return res.end();
      }

      // ── Step 5: Pin to Pinterest (SKU ile aratarak bulur) ──
      let pinterestDone = false;
      if (listingUrl && listingUrl.includes('etsy.com')) {
        if (!shouldRun('pinterest')) {
          send({ type: 'step-done', step: 'pinterest', message: 'Pinterest (önceden pinlendi)' });
          pinterestDone = true;
        } else {
          console.log(`  [pinterest] sku="${sku}"`);
          send({ type: 'step-start', step: 'pinterest', message: 'Pinterest\'e pinleniyor...' });
          try {
            if (cdpReady) {
              const pinResult = await pinToPinterest({ sku, listingUrl });
              if (pinResult.listingUrl) {
                listingUrl = pinResult.listingUrl;
                send({ type: 'listingUrl', url: listingUrl });
              }
            } else if (loadCookies().pinterest) {
              const firstMockup = mockupOutputs[0];
              await pinToPinterestWithCookies({ listingUrl, mockupPath: firstMockup, title, description, pinterestCookies: loadCookies().pinterest });
            } else {
              throw new Error('Pinterest hesabi bagli degil. Ayarlardan Pinterest cookie\'lerinizi ekleyin.');
            }
            send({ type: 'step-done', step: 'pinterest', message: 'Pinterest\'e pinlendi' });
            pinterestDone = true;
            trackStat('pins');
            updateJob(sku, { currentStep: 'pinterest', completedSteps: ['generate', 'mockup', 'tags', 'upload', 'pinterest'] });
          } catch (err) {
            send({ type: 'step-error', step: 'pinterest', message: 'Pinterest: ' + err.message });
            trackStat('errors');
            updateJob(sku, { status: 'failed', error: err.message, currentStep: 'pinterest' });
          }
        }
      }

      // Mark pipeline as completed only if both upload and pinterest succeeded
      if (isValidListingUrl(listingUrl)) {
        // Update meta with listingUrl
        try {
          const mp = path.join(__dirname, 'output', sku + '.meta.json');
          const existing = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf-8')) : {};
          existing.listingUrl = listingUrl;
          if (pinterestDone) existing.pinterestDone = true;
          existing.completedAt = Date.now();
          fs.writeFileSync(mp, JSON.stringify(existing));
        } catch {}
        // Only write .done marker when pinterest is also completed
        if (pinterestDone) {
          const donePath = path.join(__dirname, 'output', sku + '.done');
          try { fs.writeFileSync(donePath, listingUrl); } catch {}
        }
      }

      // Mark job as completed or failed
      if (listingUrl && listingUrl.includes('etsy.com')) {
        updateJob(sku, { status: 'completed', listingUrl });
      } else {
        // Pipeline ended without a listing URL — mark as failed so it shows in "Yarim Kalanlar"
        const job = readJob(sku);
        if (job && job.status === 'running') {
          updateJob(sku, { status: 'failed', error: 'Pipeline hatalarla tamamlandi', mockupPaths: mockupOutputs.map(p => '/output/' + path.basename(p)), completedSteps: job.completedSteps || [] });
        }
      }

      send({ type: 'done' });
    } catch (err) {
      console.error('Pipeline error stack:', err.stack);
      try { send({ type: 'error', message: 'Pipeline error: ' + err.message }); } catch {}
      try { send({ type: 'done' }); } catch {}
      try { updateJob(sku, { status: 'failed', error: err.message }); } catch {}
    } finally {
      cleanup(allTempFiles);
      pipelineLock = false;
      try { res.end(); } catch {}
    }

    } catch (outerErr) {
      console.error('Pipeline outer error:', outerErr && outerErr.stack || outerErr);
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: 'Pipeline outer error: ' + (outerErr && outerErr.message || outerErr) })}\n\n`); } catch {}
      try { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); } catch {}
    } finally {
      try { cleanup(allTempFiles); } catch {}
      pipelineLock = false;
      try { res.end(); } catch {}
    }
  }
);

// Front-back mockup: places front+back designs on a single mockup template
async function composeFrontBackMockup(frontDesignPath, backDesignPath, mockupPaths, sku, overrideApiKey) {
  const apiKey = overrideApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('API key not set. Ayarlar sayfasindan API anahtarinizi girin.');

  const OUTPUT_DIR = path.join(__dirname, 'output');

  function readAsBase64(filePath) {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { base64: data.toString('base64'), mime };
  }

  // Pre-process front design: remove white background for clean transparent placement
  const sharpMod = require('sharp');
  async function makeTransparent(inputPath) {
    const { data, info } = await sharpMod(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = new Uint8Array(data);
    const threshold = 230;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] >= threshold && pixels[i+1] >= threshold && pixels[i+2] >= threshold)
        pixels[i+3] = 0;
    }
    const outPath = inputPath.replace(/(\.\w+)$/, '_transparent.png');
    await sharpMod(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(outPath);
    return outPath;
  }

  const frontTransparentPath = await makeTransparent(frontDesignPath).catch(() => frontDesignPath);
  const front = readAsBase64(frontTransparentPath);
  const back = readAsBase64(backDesignPath);

  const prompt = `You are given 3 images:
- IMAGE 1 = the FRONT design (goes on the FRONT/CHEST of the shirt — the side where the person faces the camera)
- IMAGE 2 = the BACK design (goes on the BACK of the shirt — the side where the person faces away from the camera)
- IMAGE 3 = the mockup photo (a t-shirt worn by a model, showing both front and back views)

YOUR TASK: Place IMAGE 1 on the FRONT chest area, and IMAGE 2 on the BACK area of the shirt in IMAGE 3.

CRITICAL RULES — READ CAREFULLY:
1. IDENTIFY which part of the mockup is the FRONT (person facing camera / chest visible) and which is the BACK (person facing away / back panel visible). Some mockups show both views side by side or as insets.
2. IMAGE 1 (FRONT design) MUST go on the FRONT/CHEST panel ONLY. NEVER place IMAGE 1 on the back panel.
3. IMAGE 2 (BACK design) MUST go on the BACK panel ONLY. NEVER place IMAGE 2 on the front/chest panel.
4. Do NOT swap the designs. Do NOT place the same design on both sides.
5. If the mockup has a main view + inset: identify which is front and which is back, then place accordingly.
6. IMPORTANT: The content of the design artwork does NOT indicate which panel it belongs to. Even if IMAGE 1 depicts a person's back, a rear view, or anything typically associated with a back view — it is still the FRONT design and MUST be placed on the FRONT chest panel. Trust only the image order (IMAGE 1 = front, IMAGE 2 = back), NOT the artwork content.

PLACEMENT:
- Center each design horizontally on its respective panel.
- Place each design in the upper-middle area (roughly 1/3 from collar, 2/3 from hem).
- Each design width should be approximately 40-50% of the shirt width (seam to seam).
- Maintain original aspect ratio — do NOT stretch or distort.

QUALITY:
- Match the shirt's perspective, angle, lighting, and fabric texture.
- Apply designs at approximately 80% opacity so fabric texture shows through — this creates the natural look of sublimation dye-printing (design is part of the fabric, not a sticker on top).
- Remove any white or solid background from designs — only place the artwork itself (IMAGE 1 already has transparent background).
- Do NOT alter the mockup photo in any other way — same background, colors, everything.
- Do NOT add borders, frames, or extra elements.

OUTPUT: A single high-quality image with IMAGE 1 (80% opacity) on the front chest and IMAGE 2 (80% opacity) on the back.`;

  // Build all valid mockup tasks
  const tasks = [];
  for (let i = 0; i < mockupPaths.length; i++) {
    const mockupPath = path.resolve(mockupPaths[i]);
    if (!fs.existsSync(mockupPath)) continue;
    tasks.push({ index: i, mockupPath });
  }

  // Run ALL mockups in parallel
  console.log(`  Composing ${tasks.length} front-back mockups in PARALLEL...`);
  const results = await Promise.allSettled(tasks.map(async (task) => {
    const mockup = readAsBase64(task.mockupPath);
    console.log(`  [parallel] Starting mockup ${task.index + 1}/${tasks.length}...`);

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
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${front.mime};base64,${front.base64}` } },
            { type: 'image_url', image_url: { url: `data:${back.mime};base64,${back.base64}` } },
            { type: 'image_url', image_url: { url: `data:${mockup.mime};base64,${mockup.base64}` } },
            { type: 'text', text: prompt },
          ],
        }],
        response_modalities: ['IMAGE', 'TEXT'],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Mockup ${task.index + 1} failed: ${errBody.substring(0, 200)}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const imageParts = [];
    if (Array.isArray(message?.content)) imageParts.push(...message.content.filter(p => p.type === 'image_url'));
    if (Array.isArray(message?.images)) imageParts.push(...message.images.filter(p => p.type === 'image_url'));

    for (const part of imageParts) {
      if (part.image_url?.url) {
        const url = part.image_url.url;
        let imgBuffer;
        if (url.startsWith('data:')) {
          imgBuffer = Buffer.from(url.split(',')[1], 'base64');
        } else {
          const imgResp = await fetch(url);
          imgBuffer = Buffer.from(await imgResp.arrayBuffer());
        }
        const outputName = `${sku}_mockup${task.index + 1}.png`;
        const outputPath = path.join(OUTPUT_DIR, outputName);
        fs.writeFileSync(outputPath, imgBuffer);
        console.log(`  [parallel] Mockup ${task.index + 1} saved: ${outputPath}`);
        return outputPath;
      }
    }
    throw new Error(`Mockup ${task.index + 1}: no image in response`);
  }));

  // Collect successful results in order
  const outputPaths = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      outputPaths.push(r.value);
    } else {
      console.warn(`  [parallel] ${r.reason?.message || 'Unknown error'}`);
    }
  }

  if (outputPaths.length === 0) {
    throw new Error('No front-back mockups were generated');
  }

  console.log(`  ${outputPaths.length}/${tasks.length} front-back mockups completed`);
  return outputPaths;
}

// Validate that a URL is an actual Etsy listing (not editor/create/tools pages)
function isValidListingUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // Must match https://www.etsy.com/listing/<digits>
  return /^https:\/\/www\.etsy\.com\/listing\/\d{5,}/.test(url);
}

// Clean up uploaded temp files
function cleanup(paths) {
  paths.forEach(p => {
    try { fs.unlinkSync(p); } catch {}
  });
}

// ── Job Queue API ──
app.get('/api/jobs', (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  res.json(listJobs(filter));
});

app.get('/api/job/:sku', (req, res) => {
  const job = readJob(req.params.sku);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/api/job/:sku/resume', requireEtsyToolReady, (req, res) => {
  const job = readJob(req.params.sku);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'interrupted' && job.status !== 'paused' && job.status !== 'failed') {
    return res.status(400).json({ error: `Job status is ${job.status}, cannot resume` });
  }
  // Return data needed to resume this job from the frontend
  const resumeData = {
    sku: job.sku,
    mode: job.mode || 'single',
    completedSteps: job.completedSteps || [],
    lastCompletedStep: (job.completedSteps || []).slice(-1)[0] || null,
    designPath: job.designPath || null,
    backDesignPath: job.backDesignPath || null,
    mockupPaths: job.mockupPaths || [],
    tags: job.tags || [],
    title: job.title || '',
    description: job.description || '',
    listingUrl: job.listingUrl || '',
    competitor: job.competitor || '',
  };
  res.json(resumeData);
});

// Bulk placement resume: returns all paused-at-placement jobs with meta + positions
app.get('/api/jobs/bulk-placement', (req, res) => {
  const jobs = listJobs({ status: 'paused' }).filter(j => j.currentStep === 'placement');
  const positions = (() => { try { return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch { return {}; } })();
  const items = jobs.map(job => {
    const metaPath = path.join(__dirname, 'output', job.sku + '.meta.json');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
    const mockupTemplates = (meta.mockupTemplatePaths || []).map(p => {
      const name = path.basename(p);
      const pos = positions[name];
      return {
        name,
        path: '/mockups/' + name,
        position: pos ? { x: pos.x, y: pos.y, width: pos.width || pos.w, height: pos.height || pos.h, rotation: pos.rotation || 0 } : null,
      };
    });
    return {
      sku: job.sku,
      mode: job.mode || 'single',
      designPath: job.designPath || meta.designPath || null,
      backDesignPath: job.backDesignPath || meta.backDesignPath || null,
      competitor: job.competitor || meta.competitor || '',
      mockupTemplates,
    };
  });
  // Sort by SKU suffix number
  items.sort((a, b) => {
    const na = parseInt((a.sku.match(/-(\d+)$/) || [])[1]) || 0;
    const nb = parseInt((b.sku.match(/-(\d+)$/) || [])[1]) || 0;
    return na - nb;
  });
  res.json(items);
});

app.delete('/api/job/:sku', (req, res) => {
  const filePath = path.join(JOBS_DIR, `${req.params.sku}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
});

// ── Mockup CRUD on a job (used by Yarim Kalanlar UI) ──
function loadJobAndMeta(sku) {
  const jobPath = path.join(JOBS_DIR, `${sku}.json`);
  const metaPath = path.join(__dirname, 'output', `${sku}.meta.json`);
  if (!fs.existsSync(jobPath)) return { error: 'Job not found' };
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  let meta = {};
  if (fs.existsSync(metaPath)) { try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {} }
  return { job, meta, jobPath, metaPath };
}
function saveJobAndMeta(j) {
  fs.writeFileSync(j.jobPath, JSON.stringify(j.job, null, 2));
  fs.writeFileSync(j.metaPath, JSON.stringify(j.meta));
}
async function composeOneMockupForJob(sku, designAbsPath, mockupTplAbsPath, outputName) {
  const outDir = path.join(__dirname, 'output');
  const tmpOuts = await composeMockupSharp(designAbsPath, [mockupTplAbsPath], sku, {});
  const final = path.join(outDir, outputName);
  if (tmpOuts[0] !== final) {
    if (fs.existsSync(final)) fs.unlinkSync(final);
    fs.renameSync(tmpOuts[0], final);
  }
  return final;
}

// Replace mockup at a given index
app.put('/api/job/:sku/mockup/:index', requireEtsyToolReady, async (req, res) => {
  try {
    const { sku } = req.params;
    const idx = parseInt(req.params.index);
    const { mockupTemplatePath } = req.body;
    if (!mockupTemplatePath) return res.status(400).json({ error: 'mockupTemplatePath required' });
    const data = loadJobAndMeta(sku);
    if (data.error) return res.status(404).json(data);
    const { job, meta } = data;
    if (!job.designPath) return res.status(400).json({ error: 'Job has no designPath' });
    const designAbs = path.join(__dirname, job.designPath.replace(/^\//, ''));
    const tplAbs = path.join(__dirname, mockupTemplatePath.replace(/^\//, ''));
    if (!fs.existsSync(tplAbs)) return res.status(404).json({ error: 'Template not found: ' + mockupTemplatePath });
    const outName = `${sku}_mockup${idx + 1}.png`;
    await composeOneMockupForJob(sku, designAbs, tplAbs, outName);
    const publicPath = '/output/' + outName;
    job.mockupPaths = job.mockupPaths || [];
    job.mockupPaths[idx] = publicPath;
    job.updatedAt = Date.now();
    meta.mockupPaths = job.mockupPaths;
    meta.mockupTemplatePaths = meta.mockupTemplatePaths || [];
    meta.mockupTemplatePaths[idx] = mockupTemplatePath;
    saveJobAndMeta(data);
    res.json({ ok: true, mockupPath: publicPath, index: idx });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Append a new mockup
app.post('/api/job/:sku/mockup', requireEtsyToolReady, async (req, res) => {
  try {
    const { sku } = req.params;
    const { mockupTemplatePath } = req.body;
    if (!mockupTemplatePath) return res.status(400).json({ error: 'mockupTemplatePath required' });
    const data = loadJobAndMeta(sku);
    if (data.error) return res.status(404).json(data);
    const { job, meta } = data;
    if (!job.designPath) return res.status(400).json({ error: 'Job has no designPath' });
    const designAbs = path.join(__dirname, job.designPath.replace(/^\//, ''));
    const tplAbs = path.join(__dirname, mockupTemplatePath.replace(/^\//, ''));
    if (!fs.existsSync(tplAbs)) return res.status(404).json({ error: 'Template not found: ' + mockupTemplatePath });
    const idx = (job.mockupPaths || []).length;
    const outName = `${sku}_mockup${idx + 1}.png`;
    await composeOneMockupForJob(sku, designAbs, tplAbs, outName);
    const publicPath = '/output/' + outName;
    job.mockupPaths = (job.mockupPaths || []).concat(publicPath);
    job.updatedAt = Date.now();
    meta.mockupPaths = job.mockupPaths;
    meta.mockupTemplatePaths = (meta.mockupTemplatePaths || []).concat(mockupTemplatePath);
    saveJobAndMeta(data);
    res.json({ ok: true, mockupPath: publicPath, index: idx });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete mockup at a given index
app.delete('/api/job/:sku/mockup/:index', (req, res) => {
  try {
    const { sku } = req.params;
    const idx = parseInt(req.params.index);
    const data = loadJobAndMeta(sku);
    if (data.error) return res.status(404).json(data);
    const { job, meta } = data;
    if (!job.mockupPaths || idx < 0 || idx >= job.mockupPaths.length) {
      return res.status(400).json({ error: 'Invalid index' });
    }
    const removed = job.mockupPaths[idx];
    // Remove the actual file
    try {
      const abs = path.join(__dirname, removed.replace(/^\//, ''));
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {}
    job.mockupPaths.splice(idx, 1);
    job.updatedAt = Date.now();
    if (meta.mockupPaths) meta.mockupPaths.splice(idx, 1);
    if (meta.mockupTemplatePaths) meta.mockupTemplatePaths.splice(idx, 1);
    // Renumber subsequent files so output naming stays sequential
    for (let i = idx; i < job.mockupPaths.length; i++) {
      const oldName = path.basename(job.mockupPaths[i]);
      const newName = `${sku}_mockup${i + 1}.png`;
      if (oldName !== newName) {
        const oldAbs = path.join(__dirname, 'output', oldName);
        const newAbs = path.join(__dirname, 'output', newName);
        try { if (fs.existsSync(oldAbs)) fs.renameSync(oldAbs, newAbs); } catch {}
        job.mockupPaths[i] = '/output/' + newName;
      }
    }
    if (meta.mockupPaths) meta.mockupPaths = job.mockupPaths;
    saveJobAndMeta(data);
    res.json({ ok: true, removed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Find which batch (if any) contains a given SKU so the UI can route bulk resumes
// back to the bulk screen instead of running a lone pipeline.
app.get('/api/job/:sku/batch', (req, res) => {
  const sku = req.params.sku;
  try {
    const files = fs.readdirSync(BATCHES_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const batch = JSON.parse(fs.readFileSync(path.join(BATCHES_DIR, f), 'utf8'));
        const items = batch.items || [];
        if (items.some(it => it && it.sku === sku)) {
          return res.json({ batchId: batch.batchId });
        }
      } catch {}
    }
    res.json({ batchId: null });
  } catch {
    res.json({ batchId: null });
  }
});

// ── Batch CRUD ──
const BATCHES_DIR = path.join(__dirname, 'data', 'batches');

app.post('/api/batch', requireEtsyToolReady, (req, res) => {
  const batchId = 'batch-' + Date.now();
  const batch = { batchId, createdAt: new Date().toISOString(), items: [] };
  fs.writeFileSync(path.join(BATCHES_DIR, batchId + '.json'), JSON.stringify(batch, null, 2));
  res.json(batch);
});

app.get('/api/batches', (req, res) => {
  try {
    const files = fs.readdirSync(BATCHES_DIR).filter(f => f.endsWith('.json'));
    const batches = files.map(f => {
      try {
        const batch = JSON.parse(fs.readFileSync(path.join(BATCHES_DIR, f), 'utf8'));
        const total = batch.items?.length || 0;
        const completed = (batch.items || []).filter(it => it.status === 'done').length;
        const errors = (batch.items || []).filter(it => it.status === 'error').length;
        const pending = total - completed - errors;
        return { batchId: batch.batchId, createdAt: batch.createdAt, total, completed, errors, pending };
      } catch { return null; }
    }).filter(Boolean);
    res.json(batches);
  } catch {
    res.json([]);
  }
});

app.get('/api/batch/:batchId', (req, res) => {
  const filePath = path.join(BATCHES_DIR, req.params.batchId + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Batch not found' });
  try {
    const batch = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(batch);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/batch/:batchId', (req, res) => {
  const filePath = path.join(BATCHES_DIR, req.params.batchId + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Batch not found' });
  try {
    const batch = req.body;
    if (!batch || typeof batch !== 'object' || !batch.batchId || batch.batchId !== req.params.batchId) {
      return res.status(400).json({ error: 'Gecersiz batch verisi' });
    }
    if (batch.items && !Array.isArray(batch.items)) {
      return res.status(400).json({ error: 'items bir dizi olmali' });
    }
    batch.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(batch, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/batch/:batchId', (req, res) => {
  const filePath = path.join(BATCHES_DIR, req.params.batchId + '.json');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Batch not found' });
  }
});

// ── Bulk History (incomplete pipeline items) ──
app.get('/api/bulk-history', (req, res) => {
  try {
    const includeAll = req.query.all === '1' || req.query.all === 'true';
    const outputDir = path.join(__dirname, 'output');
    const metaFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.meta.json'));
    const items = [];
    for (const f of metaFiles) {
      const sku = f.replace('.meta.json', '');
      const donePath = path.join(outputDir, sku + '.done');
      const isDone = fs.existsSync(donePath);
      if (!includeAll && isDone) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(outputDir, f), 'utf-8'));
        const stat = fs.statSync(path.join(outputDir, f));
        items.push({
          sku,
          mockups: meta.mockupPaths || [],
          design: meta.designPath || '',
          competitor: meta.competitor || '',
          listingUrl: meta.listingUrl || '',
          title: meta.title || '',
          tags: meta.tags || [],
          mode: meta.mode || 'single',
          pinterestDone: !!meta.pinterestDone,
          done: isDone,
          mtime: stat.mtimeMs,
        });
      } catch {}
    }
    res.json(items);
  } catch {
    res.json([]);
  }
});

app.delete('/api/bulk-history/:sku', (req, res) => {
  const sku = req.params.sku;
  const outputDir = path.join(__dirname, 'output');
  // Delete meta, done, and job files
  [sku + '.meta.json', sku + '.done'].forEach(f => {
    const p = path.join(outputDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  // Delete job file
  const jobPath = path.join(JOBS_DIR, sku + '.json');
  if (fs.existsSync(jobPath)) fs.unlinkSync(jobPath);
  // Delete output mockup files for this SKU
  try {
    fs.readdirSync(outputDir)
      .filter(f => f.startsWith(sku + '_') && !f.endsWith('.meta.json'))
      .forEach(f => fs.unlinkSync(path.join(outputDir, f)));
  } catch {}
  res.json({ ok: true });
});

app.delete('/api/bulk-history', (req, res) => {
  // Delete ALL incomplete items
  try {
    const outputDir = path.join(__dirname, 'output');
    const metaFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.meta.json'));
    for (const f of metaFiles) {
      const sku = f.replace('.meta.json', '');
      const donePath = path.join(outputDir, sku + '.done');
      if (fs.existsSync(donePath)) continue; // completed - skip
      // Delete meta
      fs.unlinkSync(path.join(outputDir, f));
      // Delete job
      const jobPath = path.join(JOBS_DIR, sku + '.json');
      if (fs.existsSync(jobPath)) fs.unlinkSync(jobPath);
      // Delete output files
      fs.readdirSync(outputDir)
        .filter(of => of.startsWith(sku + '_'))
        .forEach(of => fs.unlinkSync(path.join(outputDir, of)));
    }
    // Delete all non-completed jobs
    fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json')).forEach(f => {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf-8'));
        if (job.status !== 'completed') fs.unlinkSync(path.join(JOBS_DIR, f));
      } catch {}
    });
  } catch {}
  res.json({ ok: true });
});

// ── Preset CRUD ──
app.get('/api/presets', (req, res) => {
  const data = loadPresets();
  const list = Object.values(data.presets).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  res.json(list);
});

app.post('/api/presets', requireEtsyToolReady, (req, res) => {
  const preset = createPreset(req.body);
  res.json(preset);
});

app.put('/api/presets/:id', requireEtsyToolReady, (req, res) => {
  const result = updatePreset(req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Preset not found' });
  res.json(result);
});

app.delete('/api/presets/:id', (req, res) => {
  if (deletePreset(req.params.id)) res.json({ ok: true });
  else res.status(404).json({ error: 'Preset not found' });
});

app.post('/api/presets/:id/use', requireEtsyToolReady, (req, res) => {
  markPresetUsed(req.params.id);
  const preset = getPreset(req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json(preset);
});

// ── Mockup Favorites ──
app.post('/api/mockups/favorite', requireEtsyToolReady, (req, res) => {
  const { name, favorite } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  toggleMockupFavorite(name, !!favorite);
  res.json({ ok: true });
});

app.get('/api/mockups/stats', (req, res) => {
  const data = loadPresets();
  res.json({
    favorites: data.favorites?.mockups || [],
    usage: data.mockupUsage || {},
  });
});

// ── Quality Control ──
app.post('/api/qc/:sku', requireEtsyToolReady, async (req, res) => {
  try {
    const preset = req.body.preset || null;
    const result = await runQualityCheck(req.params.sku, preset);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/qc/:sku', (req, res) => {
  const fp = path.join(QC_DIR, req.params.sku + '.json');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'No QC results' });
  try { res.json(JSON.parse(fs.readFileSync(fp, 'utf8'))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Content Variations ──
app.post('/api/generate-variations', requireEtsyToolReady, async (req, res) => {
  try {
    const { title, tags, style } = req.body;
    const result = await generateContentVariations(title || '', tags || [], req.apiKey, style || 'broad');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Statistics ──
app.get('/api/stats', (req, res) => {
  const data = loadStats();
  const today = getTodayStats();
  const week = getWeekStats();
  // Top mockups
  const presetsData = loadPresets();
  const mockupUsage = presetsData.mockupUsage || {};
  const topMockups = Object.entries(mockupUsage)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([name, info]) => ({ name, ...info }));
  // Daily breakdown (last 14 days)
  const dailyBreakdown = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyBreakdown.push({ date: key, ...(data.daily[key] || { designs: 0, mockups: 0, uploads: 0, pins: 0, errors: 0 }) });
  }
  res.json({ today, week, topMockups, dailyBreakdown });
});

// ── Enhanced Health Check ──
app.get('/api/health-check', async (req, res) => {
  const checks = {};
  // CDP status
  checks.cdp = await isCdpAvailable();
  // Cookies
  const cookies = loadCookies();
  checks.etsyCookies = !!cookies.etsy;
  checks.pinterestCookies = !!cookies.pinterest;
  // API key
  checks.apiKey = !!process.env.OPENROUTER_API_KEY;
  checks.etsyApi = getPublicEtsyApiStatus().configured;
  // Today's stats
  checks.todayStats = getTodayStats();
  // Disk usage
  try {
    const outputDir = path.join(__dirname, 'output');
    const files = fs.readdirSync(outputDir);
    let totalSize = 0;
    files.forEach(f => { try { totalSize += fs.statSync(path.join(outputDir, f)).size; } catch {} });
    checks.outputFiles = files.length;
    checks.outputSize = totalSize;
  } catch { checks.outputFiles = 0; checks.outputSize = 0; }
  // Active jobs
  checks.activeJobs = listJobs({ status: 'running' }).length;
  checks.pendingJobs = listJobs({ status: 'interrupted,paused,failed' }).length;
  res.json(checks);
});

// ── Cleanup ──
app.get('/api/cleanup/preview', (req, res) => {
  const maxAgeDays = parseInt(req.query.days) || 30;
  res.json(getCleanupPreview(maxAgeDays));
});

app.post('/api/cleanup', (req, res) => {
  const maxAgeDays = req.body.maxAgeDays || 30;
  const result = executeCleanup(maxAgeDays);
  res.json(result);
});

// ── OPS DASHBOARD ──────────────────────────────────────────────────────────
const USER_HOME_DIR = process.env.USERPROFILE || process.env.HOME || __dirname;
const BUNDLED_ETSY_OPTIMIZER_DIR = path.join(__dirname, 'tools', 'etsy-optimizer');
const ETSY_OPTIMIZER_DIR = process.env.ETSY_OPTIMIZER_DIR
  || (fs.existsSync(BUNDLED_ETSY_OPTIMIZER_DIR) ? BUNDLED_ETSY_OPTIMIZER_DIR : path.join(USER_HOME_DIR, 'etsy-optimizer'));

const OPS_SCRIPTS = [
  { id: 'etsy-commercial-readiness', category: 'Etsy API', label: 'Commercial Access Kontrol', desc: 'API key, OAuth, shop id ve legal sayfalari kontrol eder', danger: false, apiAction: 'commercial-readiness' },
  { id: 'etsy-shop-snapshot',        category: 'Etsy API', label: 'Shop Snapshot',              desc: 'Listing, siparis, shipping profile ve section ozetini Etsy API ile ceker', danger: false, apiAction: 'shop-snapshot' },

  { id: 'optimizer-scrape',             category: 'Etsy Optimizer', label: 'Optimizer Scrape',     desc: 'Etsy Optimizer scrape.js ile listing verisi ceker', danger: false, file: 'scrape.js', cwd: ETSY_OPTIMIZER_DIR },
  { id: 'optimizer-optimize',           category: 'Etsy Optimizer', label: 'Optimize Tekil',       desc: 'optimize.js ile title/tag optimizasyonu', danger: false, file: 'optimize.js', cwd: ETSY_OPTIMIZER_DIR },
  { id: 'optimizer-optimize-all',       category: 'Etsy Optimizer', label: 'Optimize All',         desc: 'optimize_all.js ile toplu optimizasyon', danger: false, file: 'optimize_all.js', cwd: ETSY_OPTIMIZER_DIR },
  { id: 'optimizer-apply',              category: 'Etsy Optimizer', label: 'Apply Changes',        desc: 'apply.js ile hazir degisiklikleri uygular', danger: true, file: 'apply.js', cwd: ETSY_OPTIMIZER_DIR },
  { id: 'optimizer-pinterest-scrape',   category: 'Etsy Optimizer', label: 'Pinterest Scrape',     desc: 'Pinterest verisini tarar', danger: false, file: 'pinterest_scrape.js', cwd: ETSY_OPTIMIZER_DIR },
  { id: 'optimizer-pinterest-post',     category: 'Etsy Optimizer', label: 'Pinterest Post',       desc: 'pinterest_post.js ile pin gonderir', danger: true, file: 'pinterest_post.js', cwd: ETSY_OPTIMIZER_DIR },
  { id: 'optimizer-pin-all',            category: 'Etsy Optimizer', label: 'Pin All',              desc: 'pin_all.js ile kalan listingleri pinler', danger: true, file: 'pin_all.js', cwd: ETSY_OPTIMIZER_DIR },

  { id: 'audit-health',       category: 'Denetim',     label: 'Listing Health (100p)',  desc: '100 puanlik listing saglik raporu',         danger: false },
  { id: 'audit-shop',         category: 'Denetim',     label: 'Magaza Denetimi',        desc: 'Aktif listing genel taramasi',              danger: false, file: 'audit-shop.js' },
  { id: 'audit-shop2',        category: 'Denetim',     label: 'Magaza Denetimi v2',     desc: 'Genisletilmis magaza denetimi',             danger: false, file: 'audit-shop2.js' },
  { id: 'decay',              category: 'Denetim',     label: 'Dususteki Listingler',   desc: 'Performansi dusen listingleri tespit',      danger: false },
  { id: 'expiry-check',       category: 'Denetim',     label: 'Suresi Dolacaklar',      desc: 'Yakin zamanda yenilenmesi gerekenler',      danger: false },
  { id: 'listing-stats',      category: 'Denetim',     label: 'Listing Istatistikleri', desc: 'Goruntulenme/satis verilerini cek',         danger: false },
  { id: 'check-alt-texts',    category: 'Denetim',     label: 'Alt-Text Eksikleri',     desc: 'Alt-text olmayan listingleri bul',          danger: false, file: 'check-alt-texts.js' },

  { id: 'daily',              category: 'Raporlama',   label: 'Gunluk Rapor',           desc: 'ETSY-Claude/daily/{date}.md uretir',         danger: false },
  { id: 'weekly',             category: 'Raporlama',   label: 'Haftalik Rapor',         desc: 'ETSY-Claude/weekly/{date}.md uretir',        danger: false },
  { id: 'monthly',            category: 'Raporlama',   label: 'Aylik Rapor',            desc: 'ETSY-Claude/monthly/{date}.md uretir',       danger: false },
  { id: 'pnl',                category: 'Raporlama',   label: 'Kar-Zarar (P&L)',        desc: 'Excel olarak P&L raporu',                    danger: false },

  { id: 'holidays',           category: 'Pazarlama',   label: 'ABD Tatilleri',          desc: 'Yaklasan tatil takvimi',                     danger: false },
  { id: 'holiday-gap',        category: 'Pazarlama',   label: 'Tatil Boslugu',          desc: 'Hangi tatil icin urun eksik',                danger: false },
  { id: 'diversification',    category: 'Pazarlama',   label: 'Cesitlendirme',          desc: 'Portfoy denge analizi',                      danger: false },
  { id: 'competitor-monitor', category: 'Pazarlama',   label: 'Rakip Takibi',           desc: 'Rakip magazalari izle',                      danger: false },
  { id: 'x-digest',           category: 'Pazarlama',   label: 'X (Twitter) Ozeti',      desc: 'X hesaplari icerik ozeti',                   danger: false },

  { id: 'scrape-customhub',   category: 'Scraping',    label: 'Customhub Scrape',       desc: 'Customhub.io rakip verisi',                  danger: false },
  { id: 'scrape-printnest',   category: 'Scraping',    label: 'Printnest Scrape',       desc: 'Printnest rakip verisi',                     danger: false },
  { id: 'scrape-ehunt',       category: 'Scraping',    label: 'eHunt Scrape',           desc: 'eHunt API rakip taramasi',                   danger: false },
  { id: 'scrape-pod-recon',   category: 'Scraping',    label: 'POD Recon',              desc: 'POD rakip kesfi',                            danger: false, file: 'scrape-pod-recon.js' },
  { id: 'scrape-pod-recon2',  category: 'Scraping',    label: 'POD Recon v2',           desc: 'POD rakip kesfi v2',                         danger: false, file: 'scrape-pod-recon2.js' },

  { id: 'auto-pin',           category: 'Pinterest',   label: 'Yeni Listingleri Pinle', desc: 'Pinlemeyen listingleri otomatik pinle',      danger: true },
  { id: 'pin-all',            category: 'Pinterest',   label: 'Tumunu Pinle',           desc: 'TUM listingleri pinle (uzun surer)',         danger: true,  file: 'pin-all.js' },

  { id: 'rules-excel',        category: 'Bilgi',       label: 'Kurallari Excel\'e Dok', desc: 'etsy-rules klasorunu Excel raporu yapar',    danger: false },

  { id: 'build-banners',      category: 'Banner',      label: 'Banner Olustur',         desc: 'Banner gorsellerini uretir',                 danger: false, file: 'build-banners.js' },
  { id: 'generate-banners',   category: 'Banner',      label: 'Banner Generate',        desc: 'AI ile banner uretimi',                      danger: false, file: 'generate-banners.js' },
  { id: 'auto-banner',        category: 'Banner',      label: 'Otomatik Banner',        desc: 'Otomatik banner pipeline',                   danger: true,  file: 'auto-banner.js' },
  { id: 'apply-branding',     category: 'Banner',      label: 'Branding Uygula',        desc: 'Logo/branding uygulamasi',                   danger: true,  file: 'apply-branding.js' },
];

function getPackageScripts() {
  try {
    return require('./package.json').scripts || {};
  } catch {
    return {};
  }
}

function parseNodeScriptTarget(command) {
  const match = /^node(?:\.exe)?\s+("[^"]+"|'[^']+'|[^\s]+)/i.exec(command || '');
  if (!match) return null;
  return match[1].replace(/^['"]|['"]$/g, '');
}

function resolveOpsRunner(script) {
  if (script.apiAction) {
    return {
      available: true,
      reason: '',
      command: `Etsy API: ${script.apiAction}`,
      cmd: 'api',
      args: [script.apiAction],
      target: script.apiAction,
      apiAction: script.apiAction,
    };
  }

  if (script.file) {
    const target = script.file;
    const cwd = script.cwd || __dirname;
    const filePath = path.join(cwd, target);
    return {
      available: fs.existsSync(filePath),
      reason: fs.existsSync(filePath) ? '' : `Dosya bulunamadi: ${path.join(cwd, target)}`,
      command: `node ${target}`,
      cmd: process.execPath,
      args: [filePath],
      target,
      cwd,
    };
  }

  const pkgScripts = getPackageScripts();
  const command = pkgScripts[script.id];
  if (!command) {
    return {
      available: false,
      reason: `Package script bulunamadi: ${script.id}`,
      command: '',
      cmd: null,
      args: [],
      target: '',
    };
  }

  const target = parseNodeScriptTarget(command);
  const filePath = target ? path.join(__dirname, target) : null;
  const available = filePath ? fs.existsSync(filePath) : true;
  return {
    available,
    reason: available ? '' : `Dosya bulunamadi: ${target}`,
    command,
    cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', script.id],
    target: target || '',
    cwd: __dirname,
  };
}

app.get('/api/ops/scripts', (req, res) => {
  res.json({
    scripts: OPS_SCRIPTS.map(script => {
      const runner = resolveOpsRunner(script);
      return {
        ...script,
        available: runner.available,
        missingReason: runner.available ? '' : runner.reason,
        command: runner.command,
      };
    }),
  });
});

async function runOpsApiAction(action, send) {
  if (action === 'commercial-readiness') {
    const status = getPublicEtsyApiStatus();
    const checks = [
      ['API key', !!status.apiKey, status.apiKey || 'Eksik'],
      ['OAuth access token', !!status.accessToken, status.accessToken || 'Eksik'],
      ['Refresh token', !!status.refreshToken, status.refreshToken || 'Eksik'],
      ['Shop ID', !!status.shopId, status.shopId || 'Eksik'],
      ['OAuth redirect URI', isAllowedOAuthRedirect(status.redirectUri), status.redirectUri || 'Eksik'],
    ];
    send('stdout', { line: 'Commercial access hazirlik kontrolu\n' });
    for (const [label, ok, value] of checks) {
      send('stdout', { line: `${ok ? 'OK' : 'MISSING'} - ${label}: ${value}\n` });
    }
    send('stdout', { line: 'Legal pages: /connect-etsy, /terms, /privacy, /data-deletion, /security, /copyright\n' });
    send('stdout', { line: `${LEGAL_DISCLAIMER}\n` });
    return checks.every(([, ok]) => ok) ? 0 : 1;
  }

  if (action === 'shop-snapshot') {
    const snapshot = await getEtsyOperationalSnapshot();
    if (!snapshot.ready) {
      send('stderr', { line: `${snapshot.message || snapshot.error || 'Etsy API hazir degil'}\n` });
      return 1;
    }
    const summary = snapshot.summary || {};
    send('stdout', { line: 'Etsy shop snapshot\n' });
    send('stdout', { line: `Active listings: ${summary.activeListings ?? 0}\n` });
    send('stdout', { line: `Draft listings: ${summary.draftListings ?? 0}\n` });
    send('stdout', { line: `Open receipts: ${summary.openReceipts ?? 0}\n` });
    send('stdout', { line: `Shipping profiles: ${summary.shippingProfiles ?? 0}\n` });
    send('stdout', { line: `Shop sections: ${summary.sections ?? 0}\n` });
    const listings = Array.isArray(snapshot.listings) ? snapshot.listings.slice(0, 10) : [];
    for (const listing of listings) {
      send('stdout', { line: `- ${listing.listingId || ''} ${listing.state || ''} ${listing.title || ''}\n` });
    }
    return 0;
  }

  send('stderr', { line: `Bilinmeyen API operasyonu: ${action}\n` });
  return 1;
}

app.get('/api/ops/run', async (req, res) => {
  const id = req.query.id;
  const script = OPS_SCRIPTS.find(s => s.id === id);
  if (!script) return res.status(404).json({ error: 'unknown script id' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const runner = resolveOpsRunner(script);
  if (!runner.available) {
    send('error', { message: runner.reason || `Script ${id} bulunamadi` });
    return res.end();
  }

  const cmd = runner.cmd;
  const args = runner.args;
  send('start', { id: script.id, label: script.label, cmd: `${cmd} ${args.join(' ')}` });
  if (runner.apiAction) {
    try {
      const code = await runOpsApiAction(runner.apiAction, send);
      send('done', { code });
    } catch (err) {
      send('error', { message: err.message });
    }
    return res.end();
  }

  const child = spawn(cmd, args, { cwd: runner.cwd || __dirname, shell: false });

  child.stdout.on('data', d => send('stdout', { line: d.toString() }));
  child.stderr.on('data', d => send('stderr', { line: d.toString() }));
  child.on('error', err => { send('error', { message: err.message }); res.end(); });
  child.on('close', code => { send('done', { code }); res.end(); });

  req.on('close', () => { try { child.kill('SIGTERM'); } catch {} });
});

app.get('/api/ops/rules', (req, res) => {
  const rulesDir = path.join(__dirname, 'etsy-rules');
  if (!fs.existsSync(rulesDir)) return res.json({ topics: [] });
  const topics = fs.readdirSync(rulesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{2}-/.test(d.name))
    .map(d => {
      const rulesPath = path.join(rulesDir, d.name, 'rules.md');
      const sourcesPath = path.join(rulesDir, d.name, 'sources.md');
      const stat = fs.existsSync(rulesPath) ? fs.statSync(rulesPath) : null;
      return {
        slug: d.name,
        title: d.name.replace(/^\d{2}-/, '').replace(/-/g, ' '),
        hasRules: !!stat,
        hasSources: fs.existsSync(sourcesPath),
        size: stat ? stat.size : 0,
        mtime: stat ? stat.mtimeMs : 0,
      };
    });
  res.json({ topics });
});

app.get('/api/ops/rule/:slug', (req, res) => {
  const slug = req.params.slug;
  if (!/^\d{2}-[a-z0-9-]+$/i.test(slug)) return res.status(400).json({ error: 'bad slug' });
  const which = req.query.which === 'sources' ? 'sources.md' : 'rules.md';
  const filePath = path.join(__dirname, 'etsy-rules', slug, which);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  res.json({ slug, which, content: fs.readFileSync(filePath, 'utf8') });
});

app.get('/api/ops/reports', (req, res) => {
  const roots = [
    { dir: 'reports', label: 'reports' },
    { dir: path.join('etsy-projects', 'ETSY-Claude'), label: 'ETSY-Claude' },
    { dir: path.join('etsy-projects', 'ETSY-Aylin'), label: 'ETSY-Aylin' },
    { dir: 'output', label: 'output' },
  ];
  const items = [];
  for (const root of roots) {
    const abs = path.join(__dirname, root.dir);
    if (!fs.existsSync(abs)) continue;
    const walk = (dir, depth = 0) => {
      if (depth > 4) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full, depth + 1); continue; }
        if (!/\.(md|json|xlsx|csv|txt|html)$/i.test(e.name)) continue;
        try {
          const stat = fs.statSync(full);
          items.push({
            root: root.label,
            relPath: path.relative(__dirname, full).replace(/\\/g, '/'),
            name: e.name,
            size: stat.size,
            mtime: stat.mtimeMs,
          });
        } catch {}
      }
    };
    walk(abs);
  }
  items.sort((a, b) => b.mtime - a.mtime);
  res.json({ items: items.slice(0, 200) });
});

app.get('/api/ops/report', (req, res) => {
  const rel = (req.query.path || '').replace(/\\/g, '/');
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) return res.status(400).json({ error: 'bad path' });
  const allowedRoots = ['reports/', 'etsy-projects/', 'output/'];
  if (!allowedRoots.some(r => rel.startsWith(r))) return res.status(403).json({ error: 'outside allowed roots' });
  const abs = path.join(__dirname, rel);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'not found' });
  if (/\.(xlsx|csv|html)$/i.test(rel)) {
    return res.sendFile(abs);
  }
  res.json({ path: rel, content: fs.readFileSync(abs, 'utf8') });
});

// ─── Puzzle draft (theme catalog → 4 AI alternatives → select) ─────────────
const SUPPLY_CATALOG = [
  {
    id: 'baby-name-puzzle',
    category: 'Wooden toys',
    title: 'Personalized wooden baby name puzzle',
    supplierType: 'laser cut wood + UV print',
    productionDays: '3-5',
    recommendedPrice: 49,
    cost: 14,
    shipping: 8,
    platforms: ['Etsy'],
    tags: ['personalized', 'wooden', 'baby gift'],
  },
  {
    id: 'playground-slide-set',
    category: 'Kids playground',
    title: 'Outdoor kids playground slide set',
    supplierType: 'wood/metal playground equipment',
    productionDays: '7-14',
    recommendedPrice: 249,
    cost: 116,
    shipping: 38,
    platforms: ['Etsy', 'Amazon'],
    tags: ['playground', 'outdoor', 'kids'],
  },
  {
    id: 'swing-climber-set',
    category: 'Kids playground',
    title: 'Backyard swing and climbing set',
    supplierType: 'modular playground kit',
    productionDays: '7-14',
    recommendedPrice: 319,
    cost: 148,
    shipping: 48,
    platforms: ['Etsy', 'Amazon'],
    tags: ['swing set', 'climber', 'backyard'],
  },
  {
    id: 'pikler-triangle',
    category: 'Montessori play',
    title: 'Foldable Pikler triangle climbing toy',
    supplierType: 'wood workshop',
    productionDays: '5-9',
    recommendedPrice: 139,
    cost: 58,
    shipping: 22,
    platforms: ['Etsy'],
    tags: ['montessori', 'climbing toy', 'toddler'],
  },
  {
    id: 'kids-table-chair',
    category: 'Kids furniture',
    title: 'Personalized kids table and chair set',
    supplierType: 'wood furniture workshop',
    productionDays: '6-10',
    recommendedPrice: 179,
    cost: 74,
    shipping: 29,
    platforms: ['Etsy', 'Amazon'],
    tags: ['kids furniture', 'playroom', 'personalized'],
  },
  {
    id: 'sensory-busy-board',
    category: 'Educational toys',
    title: 'Custom sensory busy board',
    supplierType: 'hand assembled educational toy',
    productionDays: '4-7',
    recommendedPrice: 69,
    cost: 24,
    shipping: 11,
    platforms: ['Etsy'],
    tags: ['busy board', 'sensory toy', 'gift'],
  },
  {
    id: 'playhouse-kit',
    category: 'Kids playground',
    title: 'Wooden outdoor playhouse kit',
    supplierType: 'flat pack wood kit',
    productionDays: '10-18',
    recommendedPrice: 449,
    cost: 218,
    shipping: 68,
    platforms: ['Etsy', 'Amazon'],
    tags: ['playhouse', 'outdoor kids', 'backyard'],
  },
  {
    id: 'montessori-shelf',
    category: 'Kids furniture',
    title: 'Montessori toy shelf',
    supplierType: 'wood furniture workshop',
    productionDays: '5-9',
    recommendedPrice: 129,
    cost: 52,
    shipping: 21,
    platforms: ['Etsy', 'Amazon'],
    tags: ['montessori shelf', 'playroom', 'storage'],
  },
  {
    id: 'personalized-wall-art',
    category: 'Wall decor',
    title: 'Personalized nursery wall art set',
    supplierType: 'fine art print + frame partner',
    productionDays: '2-5',
    recommendedPrice: 74,
    cost: 21,
    shipping: 9,
    platforms: ['Etsy', 'Amazon', 'Shopify'],
    tags: ['nursery art', 'wall decor', 'personalized'],
  },
  {
    id: 'custom-name-sign',
    category: 'Wood decor',
    title: 'Custom wooden nursery name sign',
    supplierType: 'CNC wood cut + hand finish',
    productionDays: '4-8',
    recommendedPrice: 89,
    cost: 31,
    shipping: 14,
    platforms: ['Etsy', 'Amazon'],
    tags: ['name sign', 'nursery decor', 'wood sign'],
  },
  {
    id: 'sensory-play-kit',
    category: 'Educational toys',
    title: 'Montessori sensory play kit',
    supplierType: 'assembled toy kit + branded packaging',
    productionDays: '3-6',
    recommendedPrice: 58,
    cost: 19,
    shipping: 10,
    platforms: ['Etsy', 'Amazon', 'TikTok Shop'],
    tags: ['sensory kit', 'montessori toy', 'toddler gift'],
  },
  {
    id: 'kids-floor-bed',
    category: 'Kids furniture',
    title: 'Montessori kids floor bed frame',
    supplierType: 'flat pack wood furniture',
    productionDays: '8-15',
    recommendedPrice: 389,
    cost: 184,
    shipping: 62,
    platforms: ['Etsy', 'Amazon'],
    tags: ['floor bed', 'montessori bed', 'kids room'],
  },
  {
    id: 'wooden-balance-board',
    category: 'Montessori play',
    title: 'Wooden toddler balance board',
    supplierType: 'bent wood workshop',
    productionDays: '4-7',
    recommendedPrice: 96,
    cost: 38,
    shipping: 16,
    platforms: ['Etsy', 'Amazon'],
    tags: ['balance board', 'toddler toy', 'wooden toy'],
  },
];

const REXVEN_SERVICE_STACK = [
  {
    id: 'catalog-research',
    title: 'Product catalog and niche research',
    desc: 'SKU ideas, product families, supplier fit, margin bands, and marketplace channel fit.',
  },
  {
    id: 'mockup-content',
    title: 'Mockup and listing content',
    desc: 'Product media, lifestyle mockups, Etsy title, 13 varied tags, descriptions, and alt-text support.',
  },
  {
    id: 'supplier-files',
    title: 'Supplier file export',
    desc: 'Production PDF/DXF/image outputs, personalization notes, material specs, and order handoff data.',
  },
  {
    id: 'pod-fulfillment',
    title: 'Sell-first fulfillment',
    desc: 'Order intake, production queue, shipping cost planning, tracking sync, and exception handling.',
  },
  {
    id: 'profit-pricing',
    title: 'Profit and pricing calculator',
    desc: 'Etsy fee, payment fee, listing fee, ad spend, shipping, break-even price, and margin estimate.',
  },
  {
    id: 'quality-control',
    title: 'Quality control',
    desc: 'Draft-first review, IP/trademark checks, image completeness, supplier readiness, and listing QA.',
  },
  {
    id: 'channel-expansion',
    title: 'Channel expansion',
    desc: 'Etsy-first workflow with Amazon, Shopify, Pinterest, and TikTok Shop preparation fields.',
  },
  {
    id: 'support-compliance',
    title: 'Support and compliance',
    desc: 'Commercial API review pages, trademark disclaimer, support contact, privacy, data deletion, and security controls.',
  },
];

function numberOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calculateEtsyProfit(input) {
  const product = SUPPLY_CATALOG.find(p => p.id === input.productId) || SUPPLY_CATALOG[0];
  const salePrice = Math.max(0, numberOrDefault(input.salePrice, product.recommendedPrice));
  const productionCost = Math.max(0, numberOrDefault(input.productionCost, product.cost));
  const shippingCost = Math.max(0, numberOrDefault(input.shippingCost, product.shipping));
  const adRate = Math.max(0, numberOrDefault(input.adRate, 10));
  const transactionFee = salePrice * 0.065;
  const paymentFee = salePrice * 0.03 + 0.25;
  const listingFee = 0.20;
  const ads = salePrice * (adRate / 100);
  const fees = transactionFee + paymentFee + listingFee + ads;
  const profit = salePrice - productionCost - shippingCost - fees;
  const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0;
  const variableRate = 0.065 + 0.03 + (adRate / 100);
  const breakEven = variableRate >= 0.95 ? null : (productionCost + shippingCost + 0.45) / (1 - variableRate);
  return {
    product,
    salePrice,
    productionCost,
    shippingCost,
    fees: { transactionFee, paymentFee, listingFee, ads, total: fees },
    profit,
    margin,
    breakEven,
  };
}

app.get('/api/rexven/catalog', (req, res) => {
  const categories = Array.from(new Set(SUPPLY_CATALOG.map(p => p.category)));
  res.json({
    products: SUPPLY_CATALOG,
    categories,
    services: REXVEN_SERVICE_STACK,
    countries: 220,
    model: 'sell first, produce after order',
    channels: ['Etsy', 'Amazon', 'Shopify', 'Pinterest', 'TikTok Shop'],
    workflows: [
      'Catalog research',
      'Mockup and listing generation',
      'Commercial API compliance',
      'Supplier production file export',
      'Profit and fee calculation',
      'Order and fulfillment handoff',
      'Tracking and support operations',
      'Quality/IP review before publishing',
    ],
    qualityChecks: [
      'Draft-first listing review',
      'Trademark and IP risk review',
      'Production file completeness',
      'Shipping profile and margin check',
      'Buyer data minimization',
    ],
    store: getPublicEtsyApiStatus(),
  });
});

app.get('/api/rexven/orders', (req, res) => {
  const jobs = listJobs().slice(0, 12).map(job => ({
    sku: job.sku,
    status: job.status,
    productType: job.productType || job.productContext || 'etsy product',
    currentStep: job.currentStep || '',
    updatedAt: job.updatedAt || job.createdAt || 0,
  }));
  res.json({ jobs });
});

app.post('/api/rexven/profit', express.json(), (req, res) => {
  res.json(calculateEtsyProfit(req.body || {}));
});

app.get('/api/puzzle-themes', (req, res) => {
  try {
    const themes = puzzleGen.loadCatalog().map(t => ({
      id: t.id,
      name: t.name,
      emoji: t.emoji,
      status: t.status,
      audience: t.audience,
      competitionLevel: t.competitionLevel,
      priceRange: t.priceRange,
      palette: t.palette,
      pieces: t.pieces.map(p => ({ emoji: p.emoji, name: p.name })),
    }));
    res.json({ themes, styles: puzzleGen.ART_STYLES.map(s => ({ id: s.id, label: s.label })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/puzzle-alternatives', requireEtsyToolReady, express.json(), async (req, res) => {
  const { themeId, childName, sku } = req.body || {};
  if (!themeId) return res.status(400).json({ error: 'themeId zorunlu' });
  const useSku = sku || `draft-${Date.now()}`;
  try {
    const out = await puzzleGen.generateAlternatives(themeId, childName || 'NAME', useSku, { apiKey: req.apiKey });
    const alternatives = out.alternatives.map(a => ({
      styleId: a.styleId,
      label: a.label,
      url: a.file ? `/designs/alts/${useSku}/${a.styleId}.png?t=${Date.now()}` : null,
      error: a.error,
    }));
    const listing = {
      title: out.theme.titleTemplate,
      tags: out.theme.tags,
      description: (out.theme.descriptionTemplate || '').replace(/\[Name\]/g, out.childName || 'NAME'),
    };
    res.json({ sku: useSku, theme: out.theme, listing, alternatives });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/puzzle-supplier-export', requireEtsyToolReady, express.json(), async (req, res) => {
  const { themeId, sku, styleId, childName } = req.body || {};
  if (!themeId || !sku || !styleId) return res.status(400).json({ error: 'themeId, sku, styleId zorunlu' });
  try {
    const theme = puzzleGen.findTheme(themeId);
    const altPngPath = path.join(__dirname, 'designs', 'alts', sku, `${styleId}.png`);
    const out = await supplierExport.exportSupplierFiles({
      sku, theme,
      childName: childName || 'NAME',
      altPngPath,
      apiKey: req.apiKey,
      onProgress: ({ idx, total, piece }) => {
        console.log(`  silhouette [${idx}/${total}] ${piece.emoji} ${piece.name}`);
      },
    });
    const rel = p => '/' + path.relative(__dirname, p).split(path.sep).join('/');
    res.json({
      sku,
      baski: rel(out.baski),
      cizgi: rel(out.cizgi),
      isim: rel(out.isim),
      layout: out.layout,
      silhouettes: out.silhouettes,
      silhouetteErrors: out.silhouetteErrors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/puzzle-select', requireEtsyToolReady, express.json(), (req, res) => {
  const { themeId, sku, styleId } = req.body || {};
  if (!themeId || !sku || !styleId) return res.status(400).json({ error: 'themeId, sku, styleId zorunlu' });
  try {
    const result = puzzleGen.selectAlternative(themeId, sku, styleId);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Global error handler — catches multer errors etc. so connection doesn't just drop
app.use((err, req, res, next) => {
  console.error('Express error:', err.message || err);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Etsy Product Creator running at http://localhost:${PORT}`);
});
