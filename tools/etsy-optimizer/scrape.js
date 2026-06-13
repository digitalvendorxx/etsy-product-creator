const { chromium } = require('playwright');
const fs = require('fs');
const { execSync, exec } = require('child_process');

(async () => {
  console.log('\n🚀 Etsy Listing Scraper başlıyor...\n');

  const OPERA_EXE = 'C:/Users/berka/AppData/Local/Programs/Opera GX/opera.exe';
  const USER_DATA = 'C:/Users/berka/AppData/Roaming/Opera Software/Opera GX Stable';
  const DEBUG_PORT = 9333;

  // Opera GX'i kapat
  console.log('🔄 Opera GX yeniden başlatılıyor (debug modunda)...');
  try {
    execSync('taskkill /F /IM opera.exe /T', { stdio: 'ignore' });
  } catch(e) {}
  await new Promise(r => setTimeout(r, 2000));

  // Opera GX'i remote debug portayla başlat
  exec(`"${OPERA_EXE}" --remote-debugging-port=${DEBUG_PORT} --user-data-dir="${USER_DATA}" --no-first-run --start-maximized`);

  // Başlamasını bekle
  console.log('⏳ Opera GX başlatılıyor...');
  await new Promise(r => setTimeout(r, 4000));

  // CDP ile bağlan
  let browser;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
      console.log('✅ Opera GX\'e bağlandı!\n');
      break;
    } catch(e) {
      console.log(`   Bağlanıyor... (${attempt + 1}/10)`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!browser) {
    console.log('❌ Opera GX\'e bağlanılamadı. Scripti tekrar çalıştır.');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  // Etsy listings sayfasına git
  console.log('📦 Etsy listings sayfasına gidiliyor...');
  await page.goto('https://www.etsy.com/your/shops/me/tools/listings', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.waitForTimeout(3000);

  // Giriş yapılmamışsa bekle
  let url = page.url();
  if (url.includes('signin') || url.includes('login')) {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  Etsy\'ye giriş yap, kapatma!         ║');
    console.log('╚══════════════════════════════════════╝\n');

    for (let t = 0; t < 120; t++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        url = page.url();
        if (!url.includes('signin') && !url.includes('login')) {
          console.log('✅ Giriş başarılı!\n');
          break;
        }
      } catch(e) { break; }
    }
  } else {
    console.log('✅ Etsy\'de oturum açık!\n');
  }

  await page.waitForTimeout(2000);

  // Tüm listing URL'lerini topla
  console.log('🔍 Listing\'ler taranıyor...');
  let allListingUrls = [];
  let pageNum = 1;

  while (true) {
    try {
      const pageUrl = `https://www.etsy.com/your/shops/me/tools/listings?page=${pageNum}&sort_order=asc`;
      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const urls = await page.evaluate(() => {
        const links = new Set();
        document.querySelectorAll('a[href]').forEach(a => {
          if (/\/your\/shops\/[^/]+\/tools\/listings\/\d+/.test(a.href)) {
            links.add(a.href.split('?')[0]);
          }
        });
        // JSON içinden de çek
        const scripts = document.querySelectorAll('script');
        scripts.forEach(s => {
          const matches = (s.textContent || '').matchAll(/"listing_id"\s*:\s*(\d+)/g);
          for (const m of matches) {
            links.add(`https://www.etsy.com/your/shops/me/tools/listings/${m[1]}`);
          }
        });
        return [...links];
      });

      const newUrls = urls.filter(u => !allListingUrls.includes(u));
      if (newUrls.length === 0) break;

      allListingUrls.push(...newUrls);
      console.log(`   Sayfa ${pageNum}: ${newUrls.length} listing bulundu`);
      pageNum++;
    } catch(e) {
      console.log(`   Sayfa ${pageNum} hatası: ${e.message}`);
      break;
    }
  }

  console.log(`\n✅ Toplam ${allListingUrls.length} listing bulundu!\n`);

  if (allListingUrls.length === 0) {
    console.log('❌ Listing bulunamadı. Etsy\'de oturum açık mı?');
    process.exit(1);
  }

  const listings = [];

  for (let i = 0; i < allListingUrls.length; i++) {
    const url = allListingUrls[i];
    const listingId = url.match(/(\d+)\/?$/)?.[1];

    console.log(`\n📝 [${i + 1}/${allListingUrls.length}] Çekiliyor... ID: ${listingId}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2500);

      const data = await page.evaluate(() => {
        // BAŞLIK
        let title = '';
        for (const sel of ['input[name="title"]','input[id*="title"]','textarea[name="title"]']) {
          const el = document.querySelector(sel);
          if (el?.value) { title = el.value; break; }
        }

        // AÇIKLAMA
        let description = '';
        for (const sel of ['textarea[name="description"]','textarea[id*="description"]','div[contenteditable="true"]']) {
          const el = document.querySelector(sel);
          if (el) { description = el.value || el.innerText || ''; if(description) break; }
        }

        // FİYAT
        const priceEl = document.querySelector('input[name="price"],input[id*="price"]');
        const price = priceEl?.value || '';

        // TAG'LER
        const tags = [];
        document.querySelectorAll('[class*="tag"],[class*="Tag"]').forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length > 1 && text.length < 45 && !/\n/.test(text)) {
            if (!el.querySelector('[class*="tag"],[class*="Tag"]')) {
              if (!text.toLowerCase().includes('add') && !text.toLowerCase().startsWith('tag')) {
                tags.push(text);
              }
            }
          }
        });

        // HTML'den de dene
        const html = document.documentElement.innerHTML;
        const tagMatch = html.match(/"tags"\s*:\s*(\[[^\]]+\])/);
        let jsonTags = [];
        if (tagMatch) {
          try { jsonTags = JSON.parse(tagMatch[1]); } catch(e) {}
        }

        const allTags = [...new Set([...tags, ...jsonTags].filter(t => t && t.length > 1 && t.length < 45))];

        // JSON'dan başlık da dene
        const titleMatch = html.match(/"title"\s*:\s*"([^"]{5,})"/);
        if (!title && titleMatch) title = titleMatch[1];

        // Açıklama JSON'dan
        const descMatch = html.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (!description && descMatch) {
          description = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }

        return { title, description: description.trim(), price, tags: allTags };
      });

      data.id = listingId;
      data.editUrl = url;
      listings.push(data);

      console.log(`   ✅ Başlık : ${data.title?.substring(0, 65) || 'ALINAMADI'}`);
      console.log(`   🏷️  Tag   : ${data.tags?.length || 0} adet ${data.tags?.length ? '→ ' + data.tags.slice(0,3).join(', ') : ''}`);
      console.log(`   💰 Fiyat : $${data.price || '?'}`);

    } catch (err) {
      console.log(`   ❌ Hata: ${err.message}`);
      listings.push({ id: listingId, editUrl: url, error: err.message });
    }
  }

  // Kaydet
  const outputPath = 'C:/Users/berka/etsy-optimizer/listings_raw.json';
  fs.writeFileSync(outputPath, JSON.stringify(listings, null, 2), 'utf8');

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ TÜM LİSTİNGLER ÇEKİLDİ!');
  console.log(`📁 ${outputPath}`);
  console.log('═══════════════════════════════════════════');
  listings.forEach((l, i) => {
    const s = l.error ? '❌' : '✅';
    console.log(`  ${s} ${i+1}. ${l.title?.substring(0,70) || 'HATA: ' + l.error}`);
  });

  await browser.close();
  console.log('\n✅ Tamamlandı! Claude optimize edilmiş versiyonları üretecek.\n');
})();
