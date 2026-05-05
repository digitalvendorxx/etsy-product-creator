#!/usr/bin/env node
// Kurulum saglik kontrolu. "npm run doctor" ile cagrilir.
// Tum gerekli env, config, browser, lisans cache, network durumunu kontrol eder.

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

require('dotenv').config();

const ROOT = path.resolve(__dirname, '..');
const checks = [];
let hasError = false;

function check(name, fn) {
  try {
    const result = fn();
    if (result === true || result?.ok) {
      checks.push({ name, status: 'ok', detail: result?.detail });
    } else {
      checks.push({ name, status: 'warn', detail: result?.detail || 'kontrol basarisiz' });
    }
  } catch (err) {
    checks.push({ name, status: 'fail', detail: err.message });
    hasError = true;
  }
}

async function checkAsync(name, fn) {
  try {
    const result = await fn();
    if (result === true || result?.ok) {
      checks.push({ name, status: 'ok', detail: result?.detail });
    } else {
      checks.push({ name, status: 'warn', detail: result?.detail || 'kontrol basarisiz' });
    }
  } catch (err) {
    checks.push({ name, status: 'fail', detail: err.message });
    hasError = true;
  }
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function fileExists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

async function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
    sock.connect(port, host);
  });
}

async function httpHead(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    return { ok: true, detail: `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('=== Etsy Product Creator - Saglik Kontrolu ===');
  console.log('');

  // 1. Node version
  check('Node 18+', () => {
    const major = parseInt(process.version.slice(1).split('.')[0], 10);
    return { ok: major >= 18, detail: process.version };
  });

  // 2. .env varligi + zorunlu key'ler
  check('.env dosyasi', () => {
    const exists = fileExists(path.join(ROOT, '.env'));
    return { ok: exists, detail: exists ? '.env mevcut' : '.env yok - kopyala: cp .env.example .env' };
  });

  for (const key of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY']) {
    check(`env: ${key}`, () => {
      const v = process.env[key];
      if (!v || v.includes('your-') || v.includes('sk-or-v1-your')) {
        return { ok: false, detail: 'placeholder veya bos - .env doldur' };
      }
      return { ok: true, detail: v.slice(0, 10) + '...' };
    });
  }

  // 3. config.json + zorunlu alanlar
  check('config.json', () => {
    const p = path.join(ROOT, 'config.json');
    if (!fileExists(p)) return { ok: false, detail: 'yok - cp config.example.json config.json' };
    const c = readJson(p);
    const missing = [];
    if (!c.operaPath || !fileExists(c.operaPath)) missing.push('operaPath');
    if (!c.cdpPort) missing.push('cdpPort');
    if (!c.templateListingId || c.templateListingId.startsWith('REPLACE_')) missing.push('templateListingId');
    if (missing.length) return { ok: false, detail: 'eksik/gecersiz: ' + missing.join(', ') };
    return { ok: true, detail: `port=${c.cdpPort} template=${c.templateListingId}` };
  });

  // 4. Klasorler
  check('Calisma klasorleri', () => {
    const dirs = ['designs', 'mockups', 'output', 'data', 'logs', 'reports', 'uploads', 'templates'];
    const missing = dirs.filter(d => !fileExists(path.join(ROOT, d)));
    if (missing.length) {
      missing.forEach(d => fs.mkdirSync(path.join(ROOT, d), { recursive: true }));
      return { ok: true, detail: 'eksik klasorler olusturuldu: ' + missing.join(', ') };
    }
    return { ok: true, detail: 'hepsi var' };
  });

  // 5. node_modules
  check('node_modules', () => {
    const ok = fileExists(path.join(ROOT, 'node_modules', 'express'));
    return { ok, detail: ok ? 'var' : 'yok - npm install' };
  });

  // 6. Playwright chromium
  check('Playwright Chromium', () => {
    const candidates = [
      path.join(os.homedir(), 'Library/Caches/ms-playwright'),
      path.join(os.homedir(), '.cache/ms-playwright'),
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    ].filter(Boolean);
    const found = candidates.find(p => fileExists(p));
    return { ok: !!found, detail: found || 'yok - npx playwright install chromium' };
  });

  // 7. Mockup positions
  check('mockup-positions.json', () => {
    const p = path.join(ROOT, 'mockup-positions.json');
    if (!fileExists(p)) return { ok: false, detail: 'yok - mockup yukledikten sonra calibrate ekraninda set et' };
    const c = readJson(p);
    const n = Object.keys(c).length;
    return { ok: n > 0, detail: `${n} pozisyon kayitli` };
  });

  // 8. CDP port serbest mi (browser zaten acik mi)
  let config;
  try { config = readJson(path.join(ROOT, 'config.json')); } catch {}
  if (config?.cdpPort) {
    await checkAsync('CDP port', async () => {
      const ok = await tcpProbe('localhost', config.cdpPort, 500);
      if (ok) {
        const r = await httpHead(`http://localhost:${config.cdpPort}/json/version`, 1500);
        return r.ok
          ? { ok: true, detail: `CDP browser acik (port ${config.cdpPort})` }
          : { ok: false, detail: `port ${config.cdpPort} dolu ama CDP degil - baska process` };
      }
      return { ok: true, detail: `port ${config.cdpPort} bos (browser kapali, ./start-browser.sh ile ac)` };
    });
  }

  // 9. Lisans durumu
  await checkAsync('Lisans (flowiqa.com)', async () => {
    try {
      const lic = require(path.join(ROOT, 'lib/license'));
      const s = lic.getStatus();
      if (s.bypass) return { ok: false, detail: 'LICENSE_BYPASS=1 (dev mode) - production icin kaldir' };
      if (s.valid) return { ok: true, detail: `aktif - plan=${s.plan} expires=${s.expires}` };
      return { ok: false, detail: `gecersiz - reason=${s.reason} (http://localhost:3001/activate)` };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  });

  // 10. Lisans sunucu erisilebilir mi
  await checkAsync('flowiqa lisans server erisim', async () => {
    const lic = require(path.join(ROOT, 'lib/license'));
    const r = await httpHead(lic.SERVER_URL + '/api/pubkey', 3000);
    return r;
  });

  // 11. Cookie dosyalari
  check('Etsy/Pinterest cookies', () => {
    const cookies = path.join(ROOT, 'data', 'cookies.json');
    if (!fileExists(cookies)) return { ok: true, detail: 'cookies.json yok (CDP modu kullaniliyorsa OK)' };
    try {
      const c = readJson(cookies);
      const has = (k) => c[k] && c[k].length > 0;
      return { ok: true, detail: `etsy:${has('etsy') ? 'var' : 'yok'} pinterest:${has('pinterest') ? 'var' : 'yok'}` };
    } catch {
      return { ok: false, detail: 'cookies.json corrupt' };
    }
  });

  // ── Rapor ─────────────────────────────────────────────────────────
  console.log('Sonuc:');
  console.log('');
  for (const c of checks) {
    const icon = c.status === 'ok' ? '[OK]   ' : c.status === 'warn' ? '[WARN] ' : '[FAIL] ';
    const detail = c.detail ? `  -- ${c.detail}` : '';
    console.log(`  ${icon}${c.name}${detail}`);
  }
  console.log('');

  const fails = checks.filter(c => c.status === 'fail').length;
  const warns = checks.filter(c => c.status === 'warn').length;

  if (fails === 0 && warns === 0) {
    console.log('Hersey iyi. App uretime hazir.');
    process.exit(0);
  } else if (fails === 0) {
    console.log(`${warns} uyari var. Calismaya engel degil ama bak.`);
    process.exit(0);
  } else {
    console.log(`${fails} kritik hata, ${warns} uyari. Yukaridaki adimlari uygula.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Doctor crashed:', err);
  process.exit(2);
});
