const { chromium } = require('playwright');
const fs = require('fs');

const optimized = JSON.parse(fs.readFileSync('./listings_optimized.json', 'utf8'));

const PROGRESS_FILE = './progress.json';
let progress = fs.existsSync(PROGRESS_FILE)
  ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
  : { completed: [] };

const remaining = optimized.filter(l => !progress.completed.includes(l.id));

const DEBUG_PORT = 9333;

async function connectBrowser() {
  for (let i = 0; i < 15; i++) {
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
      return browser;
    } catch(e) {
      if (i < 14) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

(async () => {
  console.log(`\n🚀 Etsy Listing Updater`);
  console.log(`📋 Toplam: ${optimized.length} | Tamamlanan: ${progress.completed.length} | Kalan: ${remaining.length}\n`);

  if (remaining.length === 0) {
    console.log('✅ Tüm listingler zaten güncellendi!');
    return;
  }

  let browser = await connectBrowser();
  if (!browser) { console.log('❌ Bağlanamadı.'); process.exit(1); }
  console.log('✅ Bağlandı\n');

  let errors = 0;

  for (let i = 0; i < remaining.length; i++) {
    const listing = remaining[i];
    console.log(`\n✏️  [${i+1}/${remaining.length}] ${listing.id} - ${listing.title?.substring(0, 55)}`);

    try {
      // Bağlantıyı kontrol et, kopmuşsa yeniden bağlan
      let context, page;
      try {
        context = browser.contexts()[0];
        page = context.pages()[0] || await context.newPage();
        // Test connection
        await page.evaluate(() => document.title);
      } catch(e) {
        console.log('    🔄 Yeniden bağlanılıyor...');
        try { await browser.close(); } catch(e2) {}
        await new Promise(r => setTimeout(r, 3000));
        browser = await connectBrowser();
        if (!browser) { console.log('    ❌ Yeniden bağlanamadı'); break; }
        context = browser.contexts()[0];
        page = context.pages()[0] || await context.newPage();
        console.log('    ✅ Yeniden bağlandı');
      }

      const editUrl = listing.editUrl || `https://www.etsy.com/your/shops/me/tools/listings/${listing.id}`;
      await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);

      // ── DESCRIPTION ──
      let descDone = false;
      try {
        const el = await page.$('textarea#listing-description-textarea');
        if (el) {
          await el.evaluate(node => { node.focus(); node.select(); });
          await el.fill(listing.description);
          descDone = true;
        }
      } catch(e) {}
      console.log(descDone ? '    ✅ Desc' : '    ⚠️ Desc');
      await page.waitForTimeout(500);

      // ── TAGS ──
      let tagsDone = 0;
      try {
        await page.evaluate(() => {
          document.querySelectorAll('button[aria-label*="Remove"]').forEach(btn => btn.click());
        });
        await page.waitForTimeout(600);

        for (const tag of (listing.tags || [])) {
          await page.evaluate((t) => {
            const input = document.querySelector('#listing-tags-input');
            if (!input) return;
            input.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, t);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }, tag);
          await page.waitForTimeout(200);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(400);
          tagsDone++;
        }
      } catch(e) {}
      console.log(tagsDone > 0 ? `    ✅ Tags (${tagsDone})` : '    ⚠️ Tags');
      await page.waitForTimeout(500);

      // ── ALT TEXTS ──
      const altTexts = listing.altTexts || [];
      let altsDone = 0;

      if (altTexts.length > 0) {
        // Photo & Video sekmesine geç
        await page.evaluate(() => {
          const tab = Array.from(document.querySelectorAll('a, button, [role="tab"]'))
            .find(l => l.textContent?.trim().includes('Photo') && l.textContent?.trim().includes('Video'));
          if (tab) tab.click();
        });
        await page.waitForTimeout(3000);

        // Listing thumbnail butonlarını bul
        const thumbCount = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('button')).filter(b => {
            const img = b.querySelector('img');
            if (!img || !img.src || !img.src.includes('etsystatic')) return false;
            const alt = img.alt || '';
            return alt.includes('Listing') || alt.includes('Primary') || alt.includes('listing');
          }).length;
        });

        const maxAlts = Math.min(altTexts.length, thumbCount);

        for (let imgIdx = 0; imgIdx < maxAlts; imgIdx++) {
          try {
            // 1. Thumbnail'a tıkla
            await page.evaluate((idx) => {
              const thumbBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const img = b.querySelector('img');
                if (!img || !img.src || !img.src.includes('etsystatic')) return false;
                const alt = img.alt || '';
                return alt.includes('Listing') || alt.includes('Primary') || alt.includes('listing');
              });
              if (thumbBtns[idx]) thumbBtns[idx].click();
            }, imgIdx);
            await page.waitForTimeout(2000);

            // 2. "Alt text" butonuna tıkla
            const altClicked = await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Alt text');
              if (btn) { btn.click(); return true; }
              return false;
            });

            if (!altClicked) {
              await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                  b.textContent?.trim() === 'Done' || b.textContent?.trim() === 'Dismiss');
                if (btn) btn.click();
              });
              await page.waitForTimeout(1000);
              continue;
            }
            await page.waitForTimeout(1500);

            // 3. #alt-text-input'a yaz
            let filled = false;
            try {
              const altInput = page.locator('#alt-text-input');
              await altInput.waitFor({ state: 'visible', timeout: 5000 });
              await altInput.click();
              await page.waitForTimeout(200);
              await page.keyboard.press('Control+a');
              await page.keyboard.press('Delete');
              await page.waitForTimeout(100);
              await page.keyboard.type(altTexts[imgIdx], { delay: 5 });
              await page.waitForTimeout(300);
              const val = await altInput.inputValue();
              filled = val.length > 5;
            } catch(e) {}

            if (filled) {
              // 4. Apply tıkla
              await page.waitForTimeout(300);
              const applyBtn = page.locator('button').filter({ hasText: /^Apply$/ });
              const applyCount = await applyBtn.count();
              for (let ai = 0; ai < applyCount; ai++) {
                if (await applyBtn.nth(ai).isVisible()) {
                  await applyBtn.nth(ai).click();
                  break;
                }
              }
              await page.waitForTimeout(1500);

              // 5. Done tıkla
              const doneBtn = page.locator('button').filter({ hasText: /^Done$/ });
              const doneCount = await doneBtn.count();
              let doneDone = false;
              for (let di = 0; di < doneCount; di++) {
                if (await doneBtn.nth(di).isVisible()) {
                  await doneBtn.nth(di).click();
                  doneDone = true;
                  break;
                }
              }
              if (!doneDone) await page.keyboard.press('Escape');
              await page.waitForTimeout(1200);
              altsDone++;
            } else {
              await page.keyboard.press('Escape');
              await page.waitForTimeout(500);
              await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Done');
                if (btn) btn.click();
              });
              await page.waitForTimeout(1000);
            }
          } catch(e) {
            try { await page.keyboard.press('Escape'); } catch(e2) {}
            await page.waitForTimeout(500);
            try {
              await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Done');
                if (btn) btn.click();
              });
            } catch(e3) {}
            await page.waitForTimeout(500);
          }
        }

        console.log(altsDone > 0 ? `    ✅ Alts (${altsDone}/${maxAlts})` : '    ⚠️ Alts');
      }

      await page.waitForTimeout(500);

      // ── SAVE ──
      const saved = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b =>
          ['Publish changes', 'Save and continue', 'Save', 'Publish', 'Update'].includes(b.textContent?.trim()));
        if (btn && !btn.disabled) { btn.click(); return btn.textContent?.trim(); }
        return null;
      });

      if (saved) {
        console.log(`    💾 ${saved}`);
        // Sayfa yenilenene kadar bekle
        await page.waitForTimeout(6000);
      } else {
        console.log('    ⚠️ Save bulunamadı');
      }

      progress.completed.push(listing.id);
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      errors = 0;

    } catch (err) {
      console.log(`    ❌ ${err.message?.substring(0, 80)}`);
      errors++;
      if (errors >= 3) {
        // Bağlantı kopmuş olabilir, yeniden bağlanmayı dene
        console.log('    🔄 Bağlantı kopmuş olabilir, yeniden bağlanılıyor...');
        try { await browser.close(); } catch(e) {}
        await new Promise(r => setTimeout(r, 3000));
        browser = await connectBrowser();
        if (browser) {
          console.log('    ✅ Yeniden bağlandı, devam ediliyor');
          errors = 0;
          i--; // Bu listing'i tekrar dene
          continue;
        } else {
          console.log('    ❌ Bağlanamadı, durduruluyor');
          break;
        }
      }
    }
  }

  console.log('\n═══════════════════════════════════');
  console.log(`✅ Tamamlanan: ${progress.completed.length}/${optimized.length}`);
  if (progress.completed.length < optimized.length) {
    console.log('👉 Kaldığı yerden devam: node apply.js');
  } else {
    console.log('🎉 Tüm listingler güncellendi!');
  }

  try { await browser.close(); } catch(e) {}
})();
