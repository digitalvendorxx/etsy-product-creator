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
const { generateDescription, wrapWithTemplate, optimizeTags, enforceThirteenTags, generateAltTexts } = require('./lib/optimize');
const { generateAiDescription, appendCommonFooter } = require('./lib/ai-description');
const { uploadToEtsy } = require('./lib/upload-etsy');
const { pinToPinterest } = require('./lib/pin-to-pinterest');
const { uploadToEtsyWithCookies } = require('./lib/upload-etsy-cookies');
const { pinToPinterestWithCookies } = require('./lib/pin-to-pinterest-cookies');
const { detectBrowser, detectAll } = require('./lib/browser-detect');
const { execFile, spawn } = require('child_process');

const APP_ROOT = path.basename(__dirname) === "dist" ? path.resolve(__dirname, "..") : __dirname;
const CONFIG_PATH = path.join(APP_ROOT, 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
function writeConfig(patch) {
  const cur = readConfig();
  const next = { ...cur, ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
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
// Dedicated CDP profile - keeps user's main browser running side-by-side.
// Etsy/Pinterest/Alura need a one-time login here, then it persists.
// Always use a separate profile so launching CDP doesn't force-close the main browser.
function getCdpProfileDir() {
  const dir = path.join(APP_ROOT, 'data', 'cdp-profile');
  const isFirstLaunch = !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
  fs.mkdirSync(dir, { recursive: true });
  return { dir, isFirstLaunch };
}

async function killBrowserProcessesIfNeeded(browserPath) {
  if (process.platform !== 'win32') return;
  const exeName = path.basename(browserPath);
  // Kill main browser exe + Opera's auto-restart watchdog. Use cmd /c so PATH
  // resolves taskkill reliably and stderr is suppressed.
  const targets = [exeName, 'opera_crashreporter.exe', 'opera_autoupdate.exe'];
  async function killOnce() {
    for (const t of targets) {
      await new Promise(r => execFile('cmd', ['/c', 'taskkill', '/F', '/IM', t, '/T'], () => r()));
    }
  }
  async function isAlive() {
    return new Promise(r => {
      execFile('cmd', ['/c', 'tasklist', '/FI', `IMAGENAME eq ${exeName}`, '/NH'], (err, stdout) => {
        r(!!stdout && stdout.toLowerCase().includes(exeName.toLowerCase()));
      });
    });
  }
  // Up to 3 kill attempts in case Opera respawns from a watchdog
  for (let i = 0; i < 3; i++) {
    await killOnce();
    await new Promise(r => setTimeout(r, 800));
    if (!(await isAlive())) return;
  }
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
const PORT = process.env.PORT || 3001;

// Ensure directories exist
['designs', 'output', 'uploads', 'mockups', 'data', 'data/batches', 'data/jobs', 'data/qc-results'].forEach(dir => {
  fs.mkdirSync(path.join(APP_ROOT, dir), { recursive: true });
});

// ── Presets (file-based) ──
const PRESETS_FILE = path.join(APP_ROOT, 'data', 'presets.json');
const STATS_FILE = path.join(APP_ROOT, 'data', 'stats.json');
const QC_DIR = path.join(APP_ROOT, 'data', 'qc-results');

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
  const outputDir = path.join(APP_ROOT, 'output');
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
        const absPath = path.join(APP_ROOT, mp.replace(/^\//, ''));
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

  const batchesDir = path.join(APP_ROOT, 'data', 'batches');
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
  const outputDir = path.join(APP_ROOT, 'output');
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
  const batchesDir = path.join(APP_ROOT, 'data', 'batches');
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
    try { fs.unlinkSync(path.join(APP_ROOT, 'output', f.name)); deleted++; } catch {}
  }
  for (const j of preview.failedJobs) {
    try { fs.unlinkSync(path.join(JOBS_DIR, j.sku + '.json')); deleted++; } catch {}
  }
  for (const b of preview.oldBatches) {
    try { fs.unlinkSync(path.join(APP_ROOT, 'data', 'batches', b.name)); deleted++; } catch {}
  }

  return { deleted, totalSize: preview.totalSize };
}

// ── Job Queue (file-based) ──
const JOBS_DIR = path.join(APP_ROOT, 'data', 'jobs');

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
  dest: path.join(APP_ROOT, 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024, files: 25 },
});

const createUpload = upload.fields([
  { name: 'ref', maxCount: 1 },
  { name: 'backDesign', maxCount: 1 },
  { name: 'mockups', maxCount: 20 },
  { name: 'productPhotos', maxCount: 5 },
]);

// SSE response opener — must run BEFORE multer so the browser receives response
// headers + initial padding immediately, instead of waiting for multipart parsing.
// Connection: close forces a fresh TCP socket per request, working around Chromium
// keep-alive sockets that get stuck after a previous broken response.
function openCreateSse(req, res, next) {
  req.setTimeout(0);
  res.setTimeout(0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'close',
    'X-Accel-Buffering': 'no',
  });
  if (res.socket && typeof res.socket.setNoDelay === 'function') res.socket.setNoDelay(true);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(':' + ' '.repeat(2049) + '\n\n');
  next();
}

function parseCreateUpload(req, res, next) {
  createUpload(req, res, (err) => {
    if (!err) return next();
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Yukleme basarisiz' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  });
}

// Parse JSON body
app.use(express.json());

// flowiqa.com lisans middleware - sonraki tum route'lari korur
const { mountLicense } = require('./lib/license');
mountLicense(app);

// API key middleware
app.use((req, res, next) => {
  req.apiKey = process.env.OPENROUTER_API_KEY || '';
  next();
});

// Quick CDP check helper
async function isCdpAvailable() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'config.json'), 'utf8'));
    const port = config.cdpPort || 9333;
    // Use lightweight HTTP check instead of full Playwright connect (avoids conflicts)
    const resp = await fetch(`http://localhost:${port}/json/version`);
    if (resp.ok) return true;
    return false;
  } catch { return false; }
}

// Default page: new minimal UI. Legacy at /legacy.
// Read + send manually so no ETag / Last-Modified is attached — those let the
// browser send a conditional request and receive a 304, serving stale HTML
// even with `Cache-Control: no-cache`.
// Build identifier: changes whenever the server restarts. Page contains a
// script that compares this to a stored value and force-reloads the page on
// mismatch — guarantees the user is never stuck on a cached old build.
const BUILD_ID = String(Date.now());

function sendHtmlNoCache(res, filePath) {
  let html = fs.readFileSync(filePath, 'utf8');
  // Inject the build id + a self-healing reload script just after <head>.
  const reloadScript = `<meta name="build-id" content="${BUILD_ID}"><script>(function(){var b='${BUILD_ID}';try{var k='etsy_build_id';var prev=sessionStorage.getItem(k);if(prev&&prev!==b){sessionStorage.setItem(k,b);location.reload();return;}sessionStorage.setItem(k,b);}catch(e){}})();</script>`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, m => m + reloadScript);
  } else {
    html = reloadScript + html;
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Build-Id', BUILD_ID);
  res.removeHeader('ETag');
  res.removeHeader('Last-Modified');
  res.status(200).end(html);
}
app.get('/', (req, res) => sendHtmlNoCache(res, path.join(APP_ROOT, 'public', 'app.html')));
app.get('/legacy', (req, res) => sendHtmlNoCache(res, path.join(APP_ROOT, 'public', 'index.html')));
app.get('/api/build', (req, res) => res.json({ buildId: BUILD_ID }));

// Static files (no-store on HTML so cache never serves stale wizard)
app.use((req, res, next) => {
  if (/\.html?$/i.test(req.path) || req.path === '/' || req.path === '/legacy') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(APP_ROOT, 'public'), { etag: false, maxAge: 0, index: false }));
app.use('/designs', express.static(path.join(APP_ROOT, 'designs')));
app.use('/output', express.static(path.join(APP_ROOT, 'output')));
app.use('/mockups', express.static(path.join(APP_ROOT, 'mockups')));
app.use('/templates', express.static(path.join(APP_ROOT, 'templates')));

// Cookie storage (file-based, no auth needed)
const COOKIES_FILE = path.join(APP_ROOT, 'data', 'cookies.json');
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
  const dir = path.join(APP_ROOT, 'designs');
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp|avif)$/i.test(f))
    .map(f => ({ name: f, path: '/designs/' + f }));
  res.json(files);
});

// List output mockups
app.get('/api/output', (req, res) => {
  const dir = path.join(APP_ROOT, 'output');
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp|avif)$/i.test(f))
    .map(f => ({ name: f, path: '/output/' + f }));
  res.json(files);
});

// ── CDP Browser Launch ──
let cdpChildPid = null;

app.get('/api/cdp-status', async (req, res) => {
  const config = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'config.json'), 'utf8'));
  const port = config.cdpPort || 9333;
  try {
    const resp = await fetch(`http://localhost:${port}/json/version`);
    const data = await resp.json();
    res.json({ running: true, browser: data.Browser || 'unknown', port });
  } catch {
    res.json({ running: false, port });
  }
});

app.post('/api/cdp-launch', async (req, res) => {
  const config = readConfig();
  const port = config.cdpPort || 9333;
  const resolved = resolveBrowserPath();
  if (!resolved) {
    return res.status(400).json({ error: 'Tarayici bulunamadi - ayarlardan yolu girin.' });
  }
  const browserPath = resolved.path;
  const { dir: cdpProfile, isFirstLaunch } = getCdpProfileDir();
  // Don't kill existing browser — separate --user-data-dir spawns a side-by-side instance.
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${cdpProfile}`, '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check'];
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
  const config = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'config.json'), 'utf8'));
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

  async function spawnAndWait() {
    const { dir: cdpProfile, isFirstLaunch } = getCdpProfileDir();
    // Don't kill existing browser — separate --user-data-dir spawns a side-by-side instance.
    const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${cdpProfile}`, '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check'];
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
    geminiKey: process.env.GEMINI_API_KEY ? '***configured***' : '',
    openrouterKey: process.env.OPENROUTER_API_KEY ? '***configured***' : '',
    detected: detectBrowser(),
  });
});

app.post('/api/settings', (req, res) => {
  const allowed = ['operaPath', 'chromePath', 'cdpPort', 'keepPhotoCount'];
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined && req.body[k] !== '') patch[k] = req.body[k];
  }
  if (patch.cdpPort) patch.cdpPort = parseInt(patch.cdpPort, 10) || 9333;
  if (patch.keepPhotoCount) patch.keepPhotoCount = parseInt(patch.keepPhotoCount, 10) || 6;
  const next = writeConfig(patch);
  res.json({ ok: true, config: next });
});

// ── Mockup Library ──
app.get('/api/mockups', (req, res) => {
  const dir = path.join(APP_ROOT, 'mockups');
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp|avif)$/i.test(f))
    .map(f => ({ name: f, path: '/mockups/' + f, thumb: '/api/mockups/thumb/' + encodeURIComponent(f) }));
  res.json(files);
});

app.get('/api/mockups/thumb/:name', async (req, res) => {
  const safeName = path.basename(req.params.name);
  const srcPath = path.join(APP_ROOT, 'mockups', safeName);
  if (!fs.existsSync(srcPath)) return res.status(404).end();
  const thumbDir = path.join(APP_ROOT, 'mockups', '.thumbs');
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

app.post('/api/mockups/upload', upload.array('mockups', 20), (req, res) => {
  const dir = path.join(APP_ROOT, 'mockups');
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
  const filePath = path.join(APP_ROOT, 'mockups', safeName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ── Sticky template images (sabit gorseller) ──
// Files in templates/ get appended to every Etsy listing after the mockups,
// sorted by numeric prefix (1.webp, 2.webp, ...). Used for size charts,
// shipping info, care instructions, etc.
const TEMPLATES_DIR = path.join(APP_ROOT, 'templates');

function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => /\.(webp|png|jpg|jpeg)$/i.test(f))
    .sort((a, b) => (parseInt(a) || 9999) - (parseInt(b) || 9999))
    .map(name => {
      const full = path.join(TEMPLATES_DIR, name);
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      return { name, path: '/templates/' + name, size };
    });
}

function nextTemplateIndex() {
  if (!fs.existsSync(TEMPLATES_DIR)) return 1;
  const nums = fs.readdirSync(TEMPLATES_DIR)
    .map(f => parseInt(f))
    .filter(n => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

app.get('/api/templates', (req, res) => {
  try { res.json(listTemplates()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/templates/upload', upload.array('templates', 20), (req, res) => {
  if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  let nextIdx = nextTemplateIndex();
  const saved = [];
  for (const file of req.files || []) {
    let ext = (path.extname(file.originalname) || '.webp').toLowerCase();
    if (!/^\.(webp|png|jpg|jpeg)$/.test(ext)) ext = '.webp';
    const name = nextIdx + ext;
    const dest = path.join(TEMPLATES_DIR, name);
    try {
      fs.renameSync(file.path, dest);
      saved.push({ name, path: '/templates/' + name });
      nextIdx++;
    } catch (err) {
      try { fs.unlinkSync(file.path); } catch {}
    }
  }
  res.json({ ok: true, saved, all: listTemplates() });
});

app.delete('/api/templates/:name', (req, res) => {
  const safeName = path.basename(req.params.name);
  const filePath = path.join(TEMPLATES_DIR, safeName);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); res.json({ ok: true, all: listTemplates() }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Reorder: caller posts { order: ['3.webp', '1.webp', '5.webp', ...] }, files
// get renumbered to match the new sequence (1, 2, 3, ...). Two-pass rename
// via temp names so we never collide.
app.post('/api/templates/reorder', express.json(), (req, res) => {
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  if (!order.length) return res.status(400).json({ error: 'order array gerekli' });
  try {
    const temps = [];
    order.forEach((name, i) => {
      const safe = path.basename(name);
      const src = path.join(TEMPLATES_DIR, safe);
      if (!fs.existsSync(src)) return;
      const tmp = path.join(TEMPLATES_DIR, '__reorder_' + i + path.extname(safe));
      fs.renameSync(src, tmp);
      temps.push({ tmp, finalIdx: i + 1, ext: path.extname(safe) });
    });
    temps.forEach(t => {
      const final = path.join(TEMPLATES_DIR, t.finalIdx + t.ext);
      fs.renameSync(t.tmp, final);
    });
    res.json({ ok: true, all: listTemplates() });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  const metaPath = path.join(APP_ROOT, 'output', sku + '.meta.json');
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}

  // Fill in designPath if missing - scan designs/ dir
  if (!meta.designPath) {
    try {
      const designsDir = path.join(APP_ROOT, 'designs');
      const designFile = fs.readdirSync(designsDir).find(f => f.startsWith(sku + '_design'));
      if (designFile) meta.designPath = '/designs/' + designFile;
    } catch {}
  }

  // Fallback: if mockupTemplatePaths missing, scan mockups/ dir for available templates
  if (!meta.mockupTemplatePaths || meta.mockupTemplatePaths.length === 0) {
    try {
      const mockupsDir = path.join(APP_ROOT, 'mockups');
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

app.post('/api/mockup-positions', (req, res) => {
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
const MOCKUPS_DIR = path.join(APP_ROOT, 'mockups');

app.get('/api/calibrate/status', (req, res) => {
  try {
    const templates = fs.readdirSync(MOCKUPS_DIR).filter(f => /\.(jpg|jpeg|png|webp|avif)$/i.test(f));
    let positions = {};
    try { positions = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch {}
    const presets = loadPresets();
    const usage = presets.mockupUsage || {};
    const favSet = new Set(presets.favorites?.mockups || []);
    const list = templates.map(name => {
      const pos = positions[name];
      const norm = pos ? normalizePos(pos) : null;
      return {
        name,
        calibrated: !!pos,
        source: norm?.source || null,
        usageCount: usage[name]?.count || 0,
        lastUsed: usage[name]?.lastUsed || 0,
        favorited: favSet.has(name),
      };
    });
    const calibrated = list.filter(t => t.calibrated).length;
    const used = list.filter(t => t.usageCount > 0 || t.favorited).length;
    res.json({ total: list.length, calibrated, uncalibrated: list.length - calibrated, used, templates: list });
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

app.post('/api/calibrate/batch-auto', async (req, res) => {
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

app.post('/api/calibrate/auto-single', async (req, res) => {
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
app.post('/api/remove-bg', multer({ storage: multer.memoryStorage() }).single('design'), async (req, res) => {
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
app.post('/api/calibrate/preview', multer({ storage: multer.memoryStorage() }).single('design'), async (req, res) => {
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

      const toAbs = (p) => p.match(/^[a-zA-Z]:/) ? p : path.join(APP_ROOT, p.replace(/^\//, ''));
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
      const metaPath = path.join(APP_ROOT, 'output', `${sku}.meta.json`);
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
app.post('/api/generate-tags-ai', async (req, res) => {
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
    const rawTags = match ? JSON.parse(match[0]) : [];
    res.json({ tags: enforceThirteenTags(rawTags, title) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate title with AI ──
app.post('/api/generate-title-ai', async (req, res) => {
  try {
    const { title, tags } = req.body;
    const newTitle = await generateSEOTitle(title || '', tags || [], req.apiKey);
    res.json({ title: newTitle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate description with template ──
app.post('/api/generate-description-ai', async (req, res) => {
  try {
    const { title, tags } = req.body;
    const description = generateDescription(title || '', tags || []);
    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert a mockup image to a 5-second Ken Burns MP4 video for Etsy listings
app.post('/api/mockup-to-video', express.json(), async (req, res) => {
  try {
    const { src } = req.body || {};
    if (!src || typeof src !== 'string') return res.status(400).json({ error: 'src required' });
    // src expected to be /output/filename.ext — resolve safely
    const filename = path.basename(src);
    const inputPath = path.join(APP_ROOT, 'output', filename);
    if (!fs.existsSync(inputPath)) return res.status(404).json({ error: 'mockup not found: ' + filename });

    const videosDir = path.join(APP_ROOT, 'output', 'videos');
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
  openCreateSse,
  parseCreateUpload,
  async (req, res) => {
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

    const mode = req.body.mode || 'single'; // single | front-back | product-mockup
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
    const imgMockupCount = Math.max(1, Math.min(parseInt(req.body.mockupCount || req.body.imgMockupCount || '3', 10) || 3, 6));
    const productType = (req.body.productType || '').trim();
    const productDetail = (req.body.productDetail || '').trim();

    // Library mockups: resolve paths from mockups/ directory
    const libraryMockupPaths = (req.body.libraryMockups || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => path.join(APP_ROOT, 'mockups', path.basename(p)));

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
    const mockupsDir = path.join(APP_ROOT, 'mockups');
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
    const metaPath = path.join(APP_ROOT, 'output', sku + '.meta.json');
    let meta;
    if (isResume && fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { meta = {}; }
      meta.timestamp = Date.now();
      if (competitor) meta.competitor = competitor;
      if (mockupTemplatePaths.length > 0) meta.mockupTemplatePaths = mockupTemplatePaths;
    } else {
      meta = { sku, competitor, mode, timestamp: Date.now(), mockupTemplatePaths };
    }
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
        designPath = path.join(APP_ROOT, existingDesign.replace(/^\//, ''));
        send({ type: 'step-done', step: 'generate', message: 'Tasarım (önceden hazır)' });
        send({ type: 'design', path: existingDesign, name: path.basename(existingDesign) });
        send({ type: 'log', message: 'Tasarım adımı atlandı (devam)' });
        // Restore back design from meta for front-back mode
        if (mode === 'front-back' && meta.backDesignPath) {
          backDesignFinalPath = path.join(APP_ROOT, meta.backDesignPath.replace(/^\//, ''));
        }
      } else if (!shouldRun('generate')) {
        // Resume without design - try to find design by SKU
        send({ type: 'step-done', step: 'generate', message: 'Tasarım adımı atlandı' });
        try {
          const designsDir = path.join(APP_ROOT, 'designs');
          const found = fs.readdirSync(designsDir).find(f => f.startsWith(sku + '_design'));
          if (found) {
            designPath = path.join(designsDir, found);
            send({ type: 'design', path: '/designs/' + found, name: found });
          }
        } catch {}
      } else {
        const designExt = path.extname(refFile.originalname) || '.png';
        const designName = `${sku}_design${designExt}`;
        designPath = path.join(APP_ROOT, 'designs', designName);
        fs.copyFileSync(refPath, designPath);
        send({ type: 'step-done', step: 'generate', message: 'Design ready' });
        send({ type: 'design', path: '/designs/' + designName, name: designName });

        if (mode === 'front-back' && backDesignPath) {
          const backExt = path.extname(backDesignFile.originalname) || '.png';
          const backName = `${sku}_back${backExt}`;
          backDesignFinalPath = path.join(APP_ROOT, 'designs', backName);
          fs.copyFileSync(backDesignPath, backDesignFinalPath);
          send({ type: 'design', path: '/designs/' + backName, name: backName });
        }
      }


      // Recover backDesignFinalPath from meta or disk if not set (e.g. continueFrom placement-approve)
      if (!backDesignFinalPath && mode === 'front-back') {
        if (meta.backDesignPath) {
          const recovered = path.join(APP_ROOT, meta.backDesignPath.replace(/^\//, ''));
          if (fs.existsSync(recovered)) backDesignFinalPath = recovered;
        }
        if (!backDesignFinalPath) {
          try {
            const designsDir = path.join(APP_ROOT, 'designs');
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
            const buf = fs.readFileSync(designPath);
            const ext = path.extname(designPath).toLowerCase();
            const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            const apiKey = req.apiKey || process.env.OPENROUTER_API_KEY;
            const themeRes = await extractKeywords(buf, mime, apiKey);
            themeWords = themeRes.themeWords || [];
            if (themeWords.length) send({ type: 'log', message: '[mockup-theme] ' + themeWords.slice(0, 12).join(', ') });
          } catch (themeErr) {
            send({ type: 'log', message: '[mockup-theme] cikartilamadi: ' + themeErr.message + ' (default prompt)' });
          }
          try {
            const productDescription = themeWords.length ? themeWords.slice(0, 8).join(', ') : 'product from uploaded photo';
            let themesSpec = null;
            try { themesSpec = req.body.themes ? JSON.parse(req.body.themes) : null; } catch {}
            if (productType) send({ type: 'log', message: '[mockup-type] ' + productType + (productDetail ? ' / ' + productDetail : '') });
            const lsResult = await generateLifestyleMockups({
              productImagePath: designPath,
              productDescription,
              productType,
              productDetail,
              themeWords,
              themes: Array.isArray(themesSpec) && themesSpec.length ? themesSpec : undefined,
              sku,
              count: imgMockupCount,
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
      fs.writeFileSync(path.join(APP_ROOT, 'mockup-debug.log'), JSON.stringify(_dbg, null, 2));
      send({ type: 'log', message: '[DEBUG] ' + JSON.stringify(_dbg) });

      if (imageToMockupHandled) {
        // Already handled above
      } else if ((!shouldRun('mockup') || (continueFrom && continueFrom !== 'placement-approve')) && existingMockups) {
        // Resume or continueFrom: use existing mockups
        mockupOutputs = existingMockups.split(',').map(p => path.join(APP_ROOT, p.trim().replace(/^\//, '')));
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
            // Compose back design on the front-composed outputs (overlay back on same mockups)
            const backOpts = { ...composeOpts, whiteMode: false };
            // Use back-specific positions (key: "templateName:back") if available, fallback to front position
            for (let fi = 0; fi < frontOutputs.length; fi++) {
              try {
                const tplBase = path.basename(mockupPaths[fi]);
                const backPos = customPositions ? (customPositions[tplBase + ':back'] || customPositions[tplBase]) : undefined;
                await composeSingleMockupSharp(backDesignFinalPath, mockupPaths[fi], frontOutputs[fi], { ...backOpts, position: backPos });
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

      // For image-to-mockup mode, swap the t-shirt boilerplate description for
      // an AI-written one keyed off productType. Other modes keep the legacy
      // tee/sweatshirt template.
      const buildProductDescription = async (rawIntro) => {
        send({ type: 'log', message: '[desc-helper] mode=' + mode + ' productType=' + (productType || '(empty)') + ' rawIntroLen=' + (rawIntro ? rawIntro.length : 0) });
        if (mode !== 'product-mockup') {
          send({ type: 'log', message: '[desc-helper] -> wrapWithTemplate (legacy tee template) — mode is not product-mockup!' });
          return wrapWithTemplate(rawIntro || '', title);
        }
        try {
          send({ type: 'log', message: '[ai-desc] ' + (productType || 'auto') + ' icin description yaziliyor...' });
          const aiIntro = await generateAiDescription({ productType, productDetail, title, tags, apiKey: req.apiKey });
          send({ type: 'log', message: '[ai-desc] OK len=' + (aiIntro ? aiIntro.length : 0) + ' prefix="' + (aiIntro || '').slice(0, 60).replace(/\n/g, ' ') + '"' });
          return appendCommonFooter(aiIntro, title);
        } catch (err) {
          send({ type: 'log', message: '[ai-desc] hata: ' + err.message + ' (fallback intro)' });
          return appendCommonFooter(rawIntro || '', title);
        }
      };

      console.log(`  [tags] shouldRun=${shouldRun('tags')}, competitor=${competitor ? competitor.substring(0, 40) : 'NULL'}, skipTags=${skipTags}, existingTags=${existingTags ? 'YES' : 'NULL'}`);

      if (continueFrom === 'pinterest') {
        // Pinterest-only: skip tags entirely
        send({ type: 'log', message: 'Tag adimi atlandi (sadece Pinterest)' });
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
            || (meta.mockupPaths && meta.mockupPaths[0] ? path.join(APP_ROOT, meta.mockupPaths[0].replace(/^\//, '')) : null)
            || designPath
            || (meta.designPath ? path.join(APP_ROOT, meta.designPath.replace(/^\//, '')) : null);
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
            productType: mode === 'product-mockup' ? productType : null,
            productDetail: mode === 'product-mockup' ? productDetail : '',
            onLog: (message) => send({ type: 'log', message: '[tag-lab] ' + message }),
            onKeywords: (kws, retry) => send({ type: 'log', message: '[tag-lab] keywords' + (retry ? ' (retry)' : '') + ': ' + kws.join(' | ') }),
            onResult: (kw, count, _top, error) => send({ type: 'log', message: '[tag-lab] "' + kw + '" -> ' + count + ' row' + (error ? ' (' + error + ')' : '') }),
            onProgress: (count, avgScore) => send({ type: 'log', message: '[tag-lab] aday=' + count + ' avg=' + avgScore.toFixed(1) }),
          });

          if (!result.tags || result.tags.length === 0) {
            send({ type: 'step-error', step: 'tags', message: 'Tag Lab: tag bulunamadi' });
          } else {
            tags = enforceThirteenTags(result.tags, result.title || title, mode === 'product-mockup' ? productType : null);
            send({ type: 'step-done', step: 'tags', message: 'Tag Lab: ' + tags.length + ' tag' });
            send({ type: 'tags', tags });
            meta.tags = tags;
            if (result.title) {
              title = result.title;
              meta.title = title;
              send({ type: 'title', title });
            }
            if (result.description || mode === 'product-mockup') {
              description = await buildProductDescription(result.description);
              meta.description = description;
              send({ type: 'description', description });
            }
            saveMeta();
            updateJob(sku, { currentStep: 'tags', completedSteps: ['generate', 'mockup', 'tags'], tags });
          }
        } catch (err) {
          console.error('  [TAG-LAB ERROR]', err.message);
          send({ type: 'step-error', step: 'tags', message: 'Tag Lab hata: ' + err.message });
        }
      } else if (tagSource === 'ai' && !skipTags) {
        send({ type: 'step-start', step: 'tags', message: 'AI tag/title/description (composed mockup uzerinden)...' });
        try {
          const sourceImagePath = (mockupOutputs && mockupOutputs[0])
            || (meta.mockupPaths && meta.mockupPaths[0] ? path.join(APP_ROOT, meta.mockupPaths[0].replace(/^\//, '')) : null)
            || designPath
            || (meta.designPath ? path.join(APP_ROOT, meta.designPath.replace(/^\//, '')) : null);
          if (!sourceImagePath || !fs.existsSync(sourceImagePath)) {
            throw new Error('Mockup veya design image bulunamadi');
          }
          send({ type: 'log', message: '[ai] kaynak: ' + path.basename(sourceImagePath) });
          const analysis = await analyzeMockup(sourceImagePath, {
            apiKey: req.apiKey, includeTags: true,
            productType: mode === 'product-mockup' ? productType : null,
            productDetail: mode === 'product-mockup' ? productDetail : '',
          });
          if (analysis.title) {
            title = analysis.title;
            meta.title = title;
            send({ type: 'title', title });
          }
          if (analysis.tags && analysis.tags.length) {
            tags = enforceThirteenTags(analysis.tags, title, mode === 'product-mockup' ? productType : null);
            meta.tags = tags;
            send({ type: 'tags', tags });
          } else {
            tags = enforceThirteenTags([], title, mode === 'product-mockup' ? productType : null);
            meta.tags = tags;
            send({ type: 'tags', tags });
          }
          if (analysis.description || mode === 'product-mockup') {
            description = await buildProductDescription(analysis.description);
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
            title = result.title;
            tags = enforceThirteenTags(result.tags, title, mode === 'product-mockup' ? productType : null);
            description = mode === 'product-mockup'
              ? await buildProductDescription(result.description)
              : result.description;
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
          // AI fallback: Alura basarisiz oldu, AI ile tag uret
          send({ type: 'log', message: 'Alura basarisiz, AI ile tag uretiliyor...' });
          try {
            const slugTitle = competitor.split('/').pop()?.split('?')[0]?.replace(/-/g, ' ') || 'T-shirt design';
            const aiTagResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'meta-llama/llama-4-maverick',
                messages: [{ role: 'user', content: `You are an Etsy SEO expert. Generate exactly 13 optimized tags for this Etsy listing.\n\nTitle: "${slugTitle}"\n\nRULES:\n1. Each tag max 20 characters\n2. Mix broad + niche keywords\n3. Include style, occasion, and target audience terms\n4. No repetition across tags\n5. Think like a buyer searching on Etsy\n\nOutput ONLY a JSON array of 13 strings, nothing else. Example: ["tag1","tag2",...]` }],
              }),
            });
            if (aiTagResp.ok) {
              const aiData = await aiTagResp.json();
              let content = aiData.choices?.[0]?.message?.content || '';
              if (typeof content !== 'string' && Array.isArray(content)) {
                content = content.filter(p => p.type === 'text').map(p => p.text).join('');
              }
              const match = content.match(/\[[\s\S]*?\]/);
              const aiTags = match ? JSON.parse(match[0]).slice(0, 13) : [];
              if (aiTags.length > 0) {
                title = await generateSEOTitle(slugTitle, aiTags, req.apiKey);
                tags = enforceThirteenTags(aiTags, title, mode === 'product-mockup' ? productType : null);
                description = mode === 'product-mockup'
                  ? await buildProductDescription(null)
                  : generateDescription(title, tags);
                send({ type: 'step-done', step: 'tags', message: `AI fallback: ${tags.length} tag uretildi` });
                send({ type: 'tags', tags });
                send({ type: 'title', title });
                send({ type: 'description', description });
                meta.title = title;
                meta.tags = tags;
                meta.description = description;
                saveMeta();
                updateJob(sku, { currentStep: 'tags', completedSteps: ['generate', 'mockup', 'tags'], tags, title, description });
              } else {
                send({ type: 'log', message: 'AI tag uretme bos dondu.' });
              }
            }
          } catch (aiErr) {
            console.error('  [AI TAG FALLBACK ERROR]', aiErr.message);
            send({ type: 'log', message: 'AI tag fallback hatasi: ' + aiErr.message });
          }
        }
      } else if (shouldRun('tags') && !competitor && tagSource !== 'etsyhunt') {
        console.log('  [tags] SKIPPED — no competitor URL provided');
        send({ type: 'log', message: 'Rakip URL girilmedi — tag cekilemedi. Manuel girin veya AI ile uretin.' });
      }

      // Image-analyze: override title/description by analyzing the first mockup
      // (skipped when Tag Lab or AI pipeline already produced title/description).
      // For product-mockup mode this ALWAYS runs so the t-shirt-flavoured Alura
      // result is replaced by a wall-art / mug / candle / etc analysis.
      const forceImageAnalyze = mode === 'product-mockup' && shouldRun('tags') && mockupOutputs.length > 0 && !skipTags
        && !((tagSource === 'etsyhunt' || tagSource === 'ai') && title && description);
      if ((titleSource === 'image-analyze' && shouldRun('tags') && mockupOutputs.length > 0 && !skipTags && !((tagSource === 'etsyhunt' || tagSource === 'ai') && title && description)) || forceImageAnalyze) {
        send({ type: 'step-start', step: 'analyze', message: 'Mockup analiz ediliyor (Gemini)...' });
        try {
          // For product-mockup with productType set, drop tee-flavoured tagsHint
          // so the analyser isn't biased by the Alura competitor's apparel tags.
          const hintTags = (mode === 'product-mockup' && productType) ? [] : tags;
          const analysis = await analyzeMockup(mockupOutputs[0], {
            tags: hintTags, apiKey: req.apiKey, includeTags: true,
            productType: mode === 'product-mockup' ? productType : null,
            productDetail: mode === 'product-mockup' ? productDetail : '',
          });
          if (analysis.title) {
            title = analysis.title;
            send({ type: 'title', title });
          }
          if (analysis.description || mode === 'product-mockup') {
            description = await buildProductDescription(analysis.description);
            send({ type: 'description', description });
          }
          // In product-mockup mode also REPLACE existing tags with analyser output
          // (Alura's tee tags get swapped for wall-art / mug / etc tags).
          if (analysis.tags && analysis.tags.length && (mode === 'product-mockup' || !tags || tags.length === 0)) {
            tags = enforceThirteenTags(analysis.tags, title, mode === 'product-mockup' ? productType : null);
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
      // SAFETY NET (product-mockup only): the tee/sweatshirt boilerplate must
      // NEVER appear when the seller picked a non-apparel productType. Whatever
      // path set description, scrub the boilerplate before the UI sees it.
      if (mode === 'product-mockup' && description) {
        const teeMarkers = /\n*AVAILABLE STYLES|T-SHIRT[\s\S]{0,40}Gildan|SWEATSHIRT[\s\S]{0,40}Gildan|Gildan\s*\d{4,5}/i;
        const m = description.match(teeMarkers);
        if (m && typeof m.index === 'number') {
          const cleanIntro = description.slice(0, m.index).trim();
          send({ type: 'log', message: '[desc-safety] tee/Gildan boilerplate tespit edildi (idx=' + m.index + '), kaldiriliyor' });
          description = appendCommonFooter(cleanIntro, title);
          meta.description = description;
          saveMeta();
          updateJob(sku, { description });
          send({ type: 'description', description });
        }
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
        // Final safety net: hicbir kosulda 13'ten az tag ile yukleme yapilmaz.
        if (!Array.isArray(tags) || tags.length !== 13) {
          tags = enforceThirteenTags(tags || [], title, mode === 'product-mockup' ? productType : null);
          meta.tags = tags;
          saveMeta();
          send({ type: 'tags', tags });
        }
        // SAFETY NET: in product-mockup mode the description must NEVER contain
        // the tee/sweatshirt boilerplate. If it leaked in through any pipeline
        // path, strip it and re-attach the generic non-apparel footer.
        if (mode === 'product-mockup' && description) {
          const teeMarkers = /\n*AVAILABLE STYLES|T-SHIRT[\s\S]*?Gildan|SWEATSHIRT[\s\S]*?Gildan/i;
          const m = description.match(teeMarkers);
          if (m && typeof m.index === 'number') {
            const cleanIntro = description.slice(0, m.index).trim();
            send({ type: 'log', message: '[desc-safety] tee boilerplate tespit edildi (idx=' + m.index + '), kaldiriliyor' });
            description = appendCommonFooter(cleanIntro, title);
            meta.description = description;
            saveMeta();
            send({ type: 'description', description });
          }
        }
        send({ type: 'step-start', step: 'upload', message: 'Etsy\'ye yükleniyor...' });
        console.log(`  [upload] title="${(title||'').substring(0,50)}", tags=${tags.length}, desc=${(description||'').length} chars, mockups=${mockupOutputs.length}`);
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
          const result = await withEtsyUploadLock(async () => {
            if (cdpReady) {
              return uploadToEtsy({ sku, mockupPaths: mockupOutputs, tags, title, description, altTexts });
            } else if (loadCookies().etsy) {
              return uploadToEtsyWithCookies({ sku, mockupPaths: mockupOutputs, tags, title, description, etsyCookies: loadCookies().etsy, altTexts });
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
              const pinResult = await pinToPinterest({ sku });
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
          const mp = path.join(APP_ROOT, 'output', sku + '.meta.json');
          const existing = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf-8')) : {};
          existing.listingUrl = listingUrl;
          if (pinterestDone) existing.pinterestDone = true;
          existing.completedAt = Date.now();
          fs.writeFileSync(mp, JSON.stringify(existing));
        } catch {}
        // Only write .done marker when pinterest is also completed
        if (pinterestDone) {
          const donePath = path.join(APP_ROOT, 'output', sku + '.done');
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

  const OUTPUT_DIR = path.join(APP_ROOT, 'output');

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

app.post('/api/job/:sku/resume', (req, res) => {
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
    const metaPath = path.join(APP_ROOT, 'output', job.sku + '.meta.json');
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
const BATCHES_DIR = path.join(APP_ROOT, 'data', 'batches');

app.post('/api/batch', (req, res) => {
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
    const outputDir = path.join(APP_ROOT, 'output');
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
  const outputDir = path.join(APP_ROOT, 'output');
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
    const outputDir = path.join(APP_ROOT, 'output');
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

app.post('/api/presets', (req, res) => {
  const preset = createPreset(req.body);
  res.json(preset);
});

app.put('/api/presets/:id', (req, res) => {
  const result = updatePreset(req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Preset not found' });
  res.json(result);
});

app.delete('/api/presets/:id', (req, res) => {
  if (deletePreset(req.params.id)) res.json({ ok: true });
  else res.status(404).json({ error: 'Preset not found' });
});

app.post('/api/presets/:id/use', (req, res) => {
  markPresetUsed(req.params.id);
  const preset = getPreset(req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json(preset);
});

// ── Mockup Favorites ──
app.post('/api/mockups/favorite', (req, res) => {
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
app.post('/api/qc/:sku', async (req, res) => {
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
app.post('/api/generate-variations', async (req, res) => {
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
  // Today's stats
  checks.todayStats = getTodayStats();
  // Disk usage
  try {
    const outputDir = path.join(APP_ROOT, 'output');
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
const OPS_SCRIPTS = [
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

app.get('/api/ops/scripts', (req, res) => {
  res.json({ scripts: OPS_SCRIPTS });
});

app.get('/api/ops/run', (req, res) => {
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

  const pkgScripts = require('./package.json').scripts;
  let cmd, args;
  if (script.file) {
    cmd = process.execPath;
    args = [path.join(APP_ROOT, script.file)];
  } else if (pkgScripts[script.id]) {
    cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    args = ['run', script.id];
  } else {
    send('error', { message: `Script ${id} bulunamadi` });
    return res.end();
  }

  send('start', { id: script.id, label: script.label, cmd: `${cmd} ${args.join(' ')}` });
  const child = spawn(cmd, args, { cwd: APP_ROOT, shell: false });

  child.stdout.on('data', d => send('stdout', { line: d.toString() }));
  child.stderr.on('data', d => send('stderr', { line: d.toString() }));
  child.on('error', err => { send('error', { message: err.message }); res.end(); });
  child.on('close', code => { send('done', { code }); res.end(); });

  req.on('close', () => { try { child.kill('SIGTERM'); } catch {} });
});

app.get('/api/ops/rules', (req, res) => {
  const rulesDir = path.join(APP_ROOT, 'etsy-rules');
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
  const filePath = path.join(APP_ROOT, 'etsy-rules', slug, which);
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
    const abs = path.join(APP_ROOT, root.dir);
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
            relPath: path.relative(APP_ROOT, full).replace(/\\/g, '/'),
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
  const abs = path.join(APP_ROOT, rel);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'not found' });
  if (/\.(xlsx|csv|html)$/i.test(rel)) {
    return res.sendFile(abs);
  }
  res.json({ path: rel, content: fs.readFileSync(abs, 'utf8') });
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
