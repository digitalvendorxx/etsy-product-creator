const fs = require('fs');
const { optimizeTitle2026, optimizeTags2026 } = require('./etsy_2026_rules');

const listings = JSON.parse(fs.readFileSync('./listings_raw.json', 'utf8'));

// Optimizasyon kuralları:
// 1. Başlık: Ana ürün öne, 70 karakter altı, doğal dil
// 2. Tag: 13 slot dolu, başlıkla çakışmayan, farklı niyetleri kapsayan

function optimizeTitle(title) {
  if (!title) return '';
  // Virgülle ayrılmış parçaları al
  const parts = title.split(',').map(p => p.trim());
  // İlk parça genellikle ana ürün
  let main = parts[0];
  // 70 karakter altında tut
  if (main.length <= 110) return optimizeTitle2026(main);
  // Çok uzunsa kırp
  return optimizeTitle2026(main);
}

function generateTags(listing) {
  const title = listing.title || '';
  const existingTags = listing.tags || [];
  const desc = listing.description || '';

  // Mevcut tag'leri temizle
  let cleanTags = existingTags.filter(t =>
    t && t.length > 1 && t.length <= 20 &&
    t.toLowerCase() !== 'sweatshirt' &&
    t.toLowerCase() !== 'shirt' &&
    t.toLowerCase() !== 't-shirt'
  );

  // Başlıktan gelen jenerik kelimeleri filtrele
  const titleLower = title.toLowerCase();

  // Kategoriye göre ek tag önerileri
  const extraTags = [];

  if (titleLower.includes('disney')) {
    extraTags.push('disney vacation tee', 'disney trip shirt', 'disney family gift', 'magic kingdom tee');
  }
  if (titleLower.includes('easter')) {
    extraTags.push('easter gift', 'easter outfit', 'spring shirt', 'happy easter tee');
  }
  if (titleLower.includes("patrick") || titleLower.includes('irish') || titleLower.includes('shamrock')) {
    extraTags.push('st patricks day tee', 'irish gift', 'lucky shirt', 'green shirt gift');
  }
  if (titleLower.includes('hockey') || titleLower.includes('rivalry') || titleLower.includes('hollander') || titleLower.includes('rozanov')) {
    extraTags.push('hockey fan shirt', 'hockey romance gift', 'booktok merch', 'sports romance tee');
  }
  if (titleLower.includes('mom') || titleLower.includes('mama')) {
    extraTags.push('gift for mom', 'mothers day gift', 'new mom gift', 'mama shirt');
  }
  if (titleLower.includes('teacher')) {
    extraTags.push('teacher gift', 'teacher appreciation', 'school gift', 'educator shirt');
  }
  if (titleLower.includes('custom') || titleLower.includes('personalized')) {
    extraTags.push('personalized gift', 'custom shirt gift', 'custom apparel', 'name shirt');
  }
  if (titleLower.includes('cat') || titleLower.includes('kitten')) {
    extraTags.push('cat lover gift', 'cat mom shirt', 'funny cat tee', 'cat graphic shirt');
  }
  if (titleLower.includes('vintage') || titleLower.includes('retro')) {
    extraTags.push('retro graphic tee', 'vintage style shirt', 'nostalgic shirt', 'retro gift');
  }
  if (titleLower.includes('funny') || titleLower.includes('meme') || titleLower.includes('sarcastic')) {
    extraTags.push('funny gift idea', 'humor graphic tee', 'meme shirt gift', 'sarcastic tee');
  }

  // Tag'leri birleştir, tekrarları kaldır
  let allTags = [...new Set([...cleanTags, ...extraTags])];

  // 20 karakter üstündekileri kırp
  allTags = allTags.map(t => t.substring(0, 20).trim());

  // Tekrar temizle
  allTags = [...new Set(allTags)];

  // Tam olarak 13 tag olsun
  if (allTags.length > 13) allTags = allTags.slice(0, 13);

  // 13'ten azsa genel tag'ler ekle
  const generalTags = [
    'unisex tee', 'graphic tee gift', 'gift for her', 'gift for him',
    'trendy shirt', 'casual tee', 'comfort colors tee', 'unique gift tee'
  ];
  let gi = 0;
  while (allTags.length < 13 && gi < generalTags.length) {
    if (!allTags.includes(generalTags[gi])) allTags.push(generalTags[gi]);
    gi++;
  }

  return optimizeTags2026(allTags, title);
}

const optimized = listings.map(listing => {
  const newTitle = optimizeTitle(listing.title);
  const newTags = generateTags(listing);

  return {
    id: listing.id,
    editUrl: listing.editUrl,
    original: {
      title: listing.title,
      tags: listing.tags
    },
    optimized: {
      title: newTitle,
      tags: newTags
    }
  };
});

fs.writeFileSync('./listings_optimized.json', JSON.stringify(optimized, null, 2), 'utf8');

console.log(`\n✅ ${optimized.length} listing optimize edildi!`);
console.log('📁 listings_optimized.json kaydedildi\n');

// Önizleme
console.log('═══ ÖNİZLEME (İlk 5 listing) ═══\n');
optimized.slice(0, 5).forEach((l, i) => {
  console.log(`${i+1}. ID: ${l.id}`);
  console.log(`   ESKİ: ${l.original.title?.substring(0, 80)}`);
  console.log(`   YENİ: ${l.optimized.title}`);
  console.log(`   TAG : ${l.optimized.tags.join(' | ')}`);
  console.log('');
});
