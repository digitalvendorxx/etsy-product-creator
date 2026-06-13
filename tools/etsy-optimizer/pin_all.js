const { chromium } = require('playwright');
const fs = require('fs');
const { execSync, exec } = require('child_process');

const DEBUG_PORT = 9333;
const PROGRESS_FILE = './pin_progress_all.json';
const DATA_FILE = './listings_all_with_images.json';
const OPERA_EXE = 'C:/Users/berka/AppData/Local/Programs/Opera GX/opera.exe';
const USER_DATA = 'C:/Users/berka/AppData/Roaming/Opera Software/Opera GX Stable';

function shortTitle(original) {
  if (!original) return '';
  const removeWords = [
    'Graphic Tee', 'Graphic T-Shirt', 'T-Shirt', 'Tee Shirt', 'Tee,',
    'Sweatshirt', 'Hoodie', 'Hooded Sweatshirt', 'Crewneck',
    'Unisex', 'Mens', 'Womens', "Men's", "Women's",
    'Gift For Her', 'Gift For Him', 'Gift Idea', 'Birthday Gift',
    'Trendy', 'Aesthetic', 'Oversized', 'Comfort Colors',
    'DTF Print', 'Screen Print',
  ];
  let t = original;
  for (const w of removeWords) {
    t = t.replace(new RegExp(w, 'gi'), '');
  }
  t = t.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').replace(/,\s*$/, '').replace(/^\s*,/, '').trim();
  if (t.length > 50) {
    const parts = t.split(',').map(s => s.trim());
    let result = '';
    for (const part of parts) {
      const next = result ? result + ', ' + part : part;
      if (next.length <= 50) result = next;
      else break;
    }
    t = result || t.substring(0, 50).trim();
  }
  if (t.length > 50) t = t.substring(0, 47).trim() + '...';
  return t;
}

(async () => {
  console.log('\n📌 Pinterest Pinner (HNA354-383 Birleşik)\n');

  if (!fs.existsSync(DATA_FILE)) {
    console.error('❌ Önce pinterest_scrape_all.js çalıştır.');
    process.exit(1);
  }

  let progress = fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    : { pinned: [], lastUpdated: null };

  const listings = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const pinnedIds = new Set(progress.pinned.map(p => p.id));
  const toPin = listings.filter(l => l.imageUrl && !pinnedIds.has(l.id));

  console.log(`  Toplam: ${listings.length} | Pinlenmiş: ${progress.pinned.length} | Kalan: ${toPin.length}\n`);
  if (toPin.length === 0) { console.log('✅ Hepsi zaten pinlenmiş!'); return; }

  // Opera GX başlat (port 9333)
  console.log('🔄 Opera GX başlatılıyor (port 9333)...');
  try { execSync('taskkill /F /IM opera.exe /T', { stdio: 'ignore' }); } catch(e) {}
  await new Promise(r => setTimeout(r, 3000));
  exec(`"${OPERA_EXE}" --remote-debugging-port=${DEBUG_PORT} --user-data-dir="${USER_DATA}" --no-first-run --start-maximized`);
  await new Promise(r => setTimeout(r, 6000));

  let browser;
  for (let i = 0; i < 15; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
      console.log('✅ Bağlandı!\n');
      break;
    } catch(e) {
      console.log(`   Deneme ${i + 1}/15...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (!browser) { console.log('❌ Bağlanamadı!'); process.exit(1); }

  const context = browser.contexts()[0];
  let page = context.pages()[0] || await context.newPage();
  await page.waitForTimeout(3000);

  for (let i = 0; i < toPin.length; i++) {
    const listing = toPin[i];
    console.log(`\n[${i+1}/${toPin.length}] ${listing.sku || listing.id} — Pinterest pin`);

    try {
      // Bağlantı kontrolü
      try {
        await page.evaluate(() => document.title);
      } catch(e) {
        console.log('  🔄 Yeniden bağlanılıyor...');
        try { await browser.close(); } catch(e2) {}
        await new Promise(r => setTimeout(r, 3000));
        for (let retry = 0; retry < 10; retry++) {
          try {
            browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
            break;
          } catch(e3) { await new Promise(r => setTimeout(r, 2000)); }
        }
        const ctx = browser.contexts()[0];
        page = ctx.pages()[0] || await ctx.newPage();
      }

      const etsyUrl = listing.listingUrl || `https://www.etsy.com/listing/${listing.id}`;
      await page.goto(etsyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      const pageTitle = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        return h1?.textContent?.trim() || '';
      });

      const pinDesc = shortTitle(pageTitle || listing.title);
      console.log(`  📌 Pin title: "${pinDesc}"`);

      const pinSaveUrl = `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(etsyUrl)}&description=${encodeURIComponent(pinDesc)}`;
      await page.goto(pinSaveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Pinterest giriş kontrolü
      const pinUrl = page.url();
      if (pinUrl.includes('login') || pinUrl.includes('signin')) {
        console.log('  ⚠️  Pinterest\'e giriş yap! 120 saniye bekliyorum...');
        for (let t = 0; t < 120; t++) {
          await new Promise(r => setTimeout(r, 1000));
          const u = page.url();
          if (u.includes('pin/create')) break;
        }
        await page.waitForTimeout(2000);
      }

      await page.waitForTimeout(1000);
      const kaydetPos = await page.evaluate(() => {
        const els = document.querySelectorAll('div, button, span, a');
        for (const el of els) {
          const style = window.getComputedStyle(el);
          const bg = style.backgroundColor;
          const rect = el.getBoundingClientRect();
          if (bg === 'rgb(230, 0, 35)' && rect.width > 30 && rect.width < 200 && rect.height > 20 && rect.height < 60) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
        return null;
      });

      if (!kaydetPos) {
        console.log('  ❌ Kaydet butonu bulunamadı');
        continue;
      }

      await page.mouse.click(kaydetPos.x, kaydetPos.y);

      let confirmed = false;
      for (let wait = 0; wait < 20; wait++) {
        await page.waitForTimeout(1000);
        confirmed = await page.evaluate(() => {
          const text = document.body?.innerText || '';
          return text.includes('kaydedildi') || text.includes('kaydettiniz') ||
                 text.includes('Saved to') || text.includes('saved to') || text.includes('panosuna');
        });
        if (confirmed) break;
      }

      if (confirmed) {
        console.log('  ✅ Pinterest\'e kaydedildi!');
        progress.pinned.push({
          id: listing.id,
          sku: listing.sku,
          title: listing.title,
          pinTitle: pinDesc,
          pinnedAt: new Date().toISOString()
        });
        progress.lastUpdated = new Date().toISOString();
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      } else {
        console.log('  ❌ Confirmation gelmedi');
      }

      const delay = 15000 + Math.random() * 15000;
      console.log(`  ⏳ ${Math.round(delay / 1000)}s bekleniyor...`);
      await new Promise(r => setTimeout(r, delay));

    } catch(err) {
      console.log(`  ❌ ${err.message?.substring(0, 80)}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(`✅ Pinterest: ${progress.pinned.length}/${listings.length} pinlendi`);
  console.log('═══════════════════════════════════════════\n');
})();
