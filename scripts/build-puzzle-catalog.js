#!/usr/bin/env node
// One-shot: extract the 20 existing puzzle themes from puzzle-katalog/index.html
// and merge with 30 new themes defined here. Writes data/puzzle-catalog.json.
//
// Usage: node scripts/build-puzzle-catalog.js [path/to/puzzle-katalog/index.html]

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || '/tmp/puzzle-katalog-main/index.html';
const OUT = path.join(__dirname, '..', 'data', 'puzzle-catalog.json');

function extractExisting(html) {
  const start = html.indexOf('const PUZZLES = [');
  if (start === -1) throw new Error('Could not locate "const PUZZLES = ["');
  // Find the matching closing bracket of the top-level array
  let depth = 0;
  let i = html.indexOf('[', start);
  const arrStart = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const arrSrc = html.slice(arrStart, i);
  // eslint-disable-next-line no-new-func
  const puzzles = new Function('return ' + arrSrc)();
  return puzzles.map(simplify);
}

function simplify(p) {
  const base = {
    id: p.id,
    name: p.name,
    nameEn: themeEnglishName(p),
    emoji: p.emoji,
    status: p.status,
    audience: inferAudience(p),
    competitionLevel: p.competitionLevel || 'mid',
    priceRange: p.priceRange || '',
    pieces: (p.pieces || []).map(piece => ({
      emoji: piece.emoji,
      name: piece.name,
      tr: piece.tr || '',
      colors: piece.colors || [],
      note: piece.note || '',
    })),
    palette: pickPalette(p),
    tags: p.tags || [],
    priceHint: p.price?.target || p.price?.entry || '',
  };
  const listing = buildListing(base);
  return { ...base, titleTemplate: listing.title, descriptionTemplate: listing.description };
}

// English theme name lookup (covers existing puzzle-katalog entries that ship with Turkish names)
function themeEnglishName(p) {
  const lower = (p.id || '').toLowerCase();
  const map = {
    'numbers-pattern': 'Number & Animal Pattern',
    'baptism': 'Baptism Christening',
    'christmas': 'Christmas',
    'cars': 'Cars Vehicle',
    'vehicles': 'Cars Vehicle',
    'construction': 'Construction Vehicle',
    'nature': 'Nature Rainbow Weather',
    'shapes': 'Numbers & Shapes',
    'fruits': 'Fruit',
    'space': 'Space Astronaut',
    'dinosaur': 'Dinosaur',
    'ocean': 'Ocean Sea Animal',
    'farm': 'Farm Animal',
    'safari': 'Safari Animal',
    'sports': 'Sports',
    'easter': 'Easter',
    'halloween': 'Halloween',
    'valentine': "Valentine's Day",
    'princess': 'Princess Fairy Tale',
  };
  if (map[lower]) return map[lower];
  // Fallback: titlecase the Turkish-ish name with diacritics dropped
  return (p.name || lower)
    .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g').replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c');
}

// ── Listing template builder ─────────────────────────────────────────────
// User-supplied template - see memory/project_listing_template.md
// Title <=70 chars (drop audience to fit). Description is verbatim from user;
// only the theme noun is substituted into the two "{theme}" slots.
function buildListing(theme) {
  const themeLabel = theme.nameEn || theme.name;
  const themeLower = themeLabel.toLowerCase();
  const audience = theme.audience === 'boy' ? 'Boy' : theme.audience === 'girl' ? 'Girl' : '';

  // Title - try with audience first, drop it if >70 chars.
  const withAudience = `Personalized ${themeLabel} Name Puzzle, Wooden Baby ${audience} Gift`.replace(/  +/g, ' ').trim();
  const withoutAudience = `Personalized ${themeLabel} Name Puzzle, Wooden Baby Gift`;
  let title = withAudience.length <= 70 ? withAudience : withoutAudience;
  if (title.length > 70) title = `${themeLabel} Name Puzzle, Wooden Baby Gift`;
  if (title.length > 70) title = title.slice(0, 70).trim();

  const description = USER_TEMPLATE
    .replace('{theme-design}', `${themeLower} design`)
    .replace('{theme-themed}', `${themeLower}-themed`);

  return { title, description };
}

const USER_TEMPLATE = `Personalized wooden baby name puzzle with colorful {theme-design} – a fun, educational toy that helps toddlers learn while playing.
Custom-made with your child's name, this puzzle turns learning into a personal and meaningful experience.

Perfect for early childhood development, this Montessori-inspired toy helps improve fine motor skills, hand-eye coordination, and letter recognition. At the same time, it creates a beautiful keepsake you can keep for years.

📏 PRODUCT DETAILS
Size: 27.5 cm x 41.5 cm (10.8 x 16.3 inches)
Material: Premium natural wood
Paint: Non-toxic, child-safe
Surface: Smooth, rounded edges (safe for toddlers)
Design: Colorful {theme-themed} learning board
Customization: Name is fully personalized
🧠 DEVELOPMENT BENEFITS
Improves fine motor skills
Supports early letter recognition
Helps children learn their own name
Encourages independent play
Montessori-style learning
🎁 PERFECT FOR
Baby shower gift
First birthday gift
Newborn keepsake
Toddler educational toy
Nursery decoration
🛠️ HOW TO ORDER
Enter the name in the personalization box
Double-check spelling (we copy exactly)
Place your order
We produce and ship your custom puzzle
🚚 SHIPPING & DELIVERY
Processing time: 1–3 business days
Shipping time (USA): 3–5 business days
Shipping time (Europe): 4–7 business days
Worldwide shipping available

✔ Tracking number provided
✔ Secure, protective packaging

📦 PACKAGING
Carefully packed to avoid damage
Gift-ready presentation
No invoice included (safe for gifting)
⚠️ IMPORTANT NOTES
Each item is handmade → slight wood variations may occur
Colors may vary slightly due to screen differences
This is a personalized product → no returns unless damaged
❤️ WHY CUSTOMERS LOVE IT
Unique & personalized
High-quality wood finish
Educational + decorative
Perfect gift option
📌 CALL TO ACTION

Add to cart now and create a one-of-a-kind gift your child will love every day.`;

function titleCase(s) {
  if (!s) return '';
  return String(s).toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function inferAudience(p) {
  const blob = ((p.desc || '') + ' ' + (p.title || '')).toLowerCase();
  if (/boy/.test(blob) && !/girl/.test(blob)) return 'boy';
  if (/girl/.test(blob) && !/boy/.test(blob)) return 'girl';
  if (/neutral|gender[- ]neutral/.test(blob)) return 'neutral';
  return 'neutral';
}

function pickPalette(p) {
  const all = new Set();
  (p.pieces || []).forEach(pc => (pc.colors || []).forEach(c => all.add(c)));
  return [...all].slice(0, 6);
}

// ─── 30 new themes ────────────────────────────────────────────────────────
const NEW_THEMES = [
  {
    id: 'jungle', name: 'Tropikal Orman', emoji: '🌴', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$28-40',
    pieces: [
      ['🐯','TIGER',['#F9A825','#1A1A1A'],'Turuncu-siyah çizgili'],
      ['🦜','PARROT',['#E53935','#1565C0'],'Renkli papağan'],
      ['🐍','SNAKE',['#388E3C','#FDD835'],'Yeşil sarı yılan'],
      ['🦥','SLOTH',['#8D6E63','#D7CCC8'],'Kahve tembel hayvan'],
      ['🐸','FROG',['#388E3C','#FDD835'],'Yeşil kurbağa'],
      ['🌺','HIBISCUS',['#EC407A','#FDD835'],'Pembe çiçek'],
      ['🌴','PALM',['#8D6E63','#388E3C'],'Palmiye ağacı'],
      ['🦋','BUTTERFLY',['#EC407A','#FDD835'],'Renkli kelebek'],
    ],
    tags: ['jungle name puzzle','tropical baby gift','tiger parrot puzzle','rainforest wooden toy','gender neutral jungle gift','tropical nursery decor','personalized jungle puzzle','exotic animal puzzle','baby first jungle','montessori jungle toy','tropical baby shower','custom tropical name board','wooden rainforest puzzle'],
    titleTemplate: 'Tropical Jungle Name Puzzle – Personalized Tiger Parrot Wooden Baby Gift – Rainforest Montessori Toy',
    descriptionTemplate: 'Welcome to the rainforest, little explorer!\n\n8 jungle creatures + name letters in bright tropical colors.',
  },
  {
    id: 'arctic', name: 'Kutup Hayvanları', emoji: '🐧', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['🐧','PENGUIN',['#1A1A1A','#FFFFFF'],'Siyah beyaz penguen'],
      ['🐻‍❄️','POLAR BEAR',['#FFFFFF','#90CAF9'],'Beyaz kutup ayısı'],
      ['🦭','SEAL',['#9E9E9E','#ECEFF1'],'Gri fok'],
      ['🐺','WOLF',['#90A4AE','#FFFFFF'],'Gri-beyaz kurt'],
      ['🦊','ARCTIC FOX',['#FFFFFF','#90CAF9'],'Beyaz tilki'],
      ['🐋','WHALE',['#1565C0','#90CAF9'],'Mavi balina'],
      ['❄️','SNOWFLAKE',['#FFFFFF','#E3F2FD'],'Kar tanesi'],
      ['🏔️','MOUNTAIN',['#ECEFF1','#90A4AE'],'Karlı dağ'],
    ],
    tags: ['arctic name puzzle','polar bear puzzle baby','penguin wooden toy','winter baby gift','personalized arctic puzzle','snow animal puzzle','christmas baby gift','arctic nursery decor','winter baby shower','montessori arctic toy','custom polar baby board','wooden penguin puzzle','cold weather animal gift'],
    titleTemplate: 'Arctic Animal Name Puzzle – Personalized Penguin Polar Bear Wooden Baby Gift – Winter Montessori Toy',
    descriptionTemplate: 'Chill out with the coolest puzzle in the nursery!\n\n8 arctic animals + name letters in icy winter palette.',
  },
  {
    id: 'pets', name: 'Evcil Hayvanlar', emoji: '🐶', status: 'new', audience: 'neutral',
    competitionLevel: 'mid', priceRange: '$26-36',
    pieces: [
      ['🐶','DOG',['#8D6E63','#FFCCBC'],'Kahve köpek'],
      ['🐱','CAT',['#F9A825','#FFFFFF'],'Sarı-beyaz kedi'],
      ['🐰','RABBIT',['#ECEFF1','#F8BBD9'],'Beyaz-pembe tavşan'],
      ['🐹','HAMSTER',['#FFE0B2','#8D6E63'],'Krem hamster'],
      ['🐦','BIRD',['#FDD835','#F9A825'],'Sarı kanarya'],
      ['🐢','TURTLE',['#388E3C','#F9A825'],'Yeşil kaplumbağa'],
      ['🐠','FISH',['#F57C00','#FFFFFF'],'Turuncu balık'],
      ['🦎','LIZARD',['#388E3C','#FDD835'],'Yeşil kertenkele'],
    ],
    tags: ['pet name puzzle','dog cat puzzle baby','personalized pet gift','wooden pet puzzle','furry friends baby toy','pet lover baby gift','puppy kitten puzzle','montessori pet toy','baby first pet','custom pet name board','pet themed nursery','wooden animal puzzle','my little friends puzzle'],
    titleTemplate: 'Pet Animal Name Puzzle – Personalized Dog Cat Rabbit Wooden Baby Gift – My First Pets Montessori',
    descriptionTemplate: 'Baby\'s very first best friends — all in one puzzle!\n\n8 favorite pets + name letters in warm friendly tones.',
  },
  {
    id: 'forest', name: 'Orman Hayvanları', emoji: '🦊', status: 'new', audience: 'neutral',
    competitionLevel: 'mid', priceRange: '$26-38',
    pieces: [
      ['🦊','FOX',['#E65100','#FFFFFF'],'Turuncu tilki'],
      ['🦌','DEER',['#8D6E63','#FFCCBC'],'Kahve geyik'],
      ['🐻','BEAR',['#5D4037','#FFCCBC'],'Kahve ayı'],
      ['🦉','OWL',['#8D6E63','#F9A825'],'Kahve baykuş'],
      ['🐿️','SQUIRREL',['#8D6E63','#FFCCBC'],'Kızıl sincap'],
      ['🦡','BADGER',['#FFFFFF','#1A1A1A'],'Siyah-beyaz porsuk'],
      ['🍄','MUSHROOM',['#E53935','#FFFFFF'],'Kırmızı-beyaz mantar'],
      ['🌲','PINE',['#1B5E20','#5D4037'],'Çam ağacı'],
    ],
    tags: ['woodland name puzzle','forest animal baby gift','fox deer bear puzzle','personalized woodland toy','rustic baby puzzle','woodland nursery decor','forest baby shower','montessori woodland toy','wooden forest puzzle','custom woodland board','baby first forest','owl squirrel puzzle','enchanted forest baby gift'],
    titleTemplate: 'Woodland Forest Animal Name Puzzle – Personalized Fox Deer Bear Wooden Baby Gift – Montessori',
    descriptionTemplate: 'A walk through the enchanted forest with [Name]!\n\n8 woodland creatures + name letters in warm forest tones.',
  },
  {
    id: 'birds', name: 'Kuşlar', emoji: '🦜', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$24-34',
    pieces: [
      ['🦅','EAGLE',['#5D4037','#FFFFFF'],'Kahve-beyaz kartal'],
      ['🦉','OWL',['#8D6E63','#F9A825'],'Kahve baykuş'],
      ['🦜','PARROT',['#E53935','#1565C0'],'Renkli papağan'],
      ['🦩','FLAMINGO',['#F48FB1','#EC407A'],'Pembe flamingo'],
      ['🐧','PENGUIN',['#1A1A1A','#FFFFFF'],'Siyah-beyaz penguen'],
      ['🦢','SWAN',['#FFFFFF','#FFCCBC'],'Beyaz kuğu'],
      ['🐦','SPARROW',['#8D6E63','#FFCCBC'],'Kahve serçe'],
      ['🦚','PEACOCK',['#00897B','#1565C0'],'Mavi-yeşil tavus'],
    ],
    tags: ['bird name puzzle','wooden bird toy','eagle owl puzzle baby','personalized bird gift','feathered friends puzzle','bird watcher baby toy','montessori bird toy','aviary nursery decor','custom bird name board','baby first bird puzzle','colorful bird puzzle','parrot flamingo puzzle','wooden aviary puzzle'],
    titleTemplate: 'Bird Name Puzzle – Personalized Eagle Owl Parrot Wooden Baby Gift – Feathered Friends Montessori',
    descriptionTemplate: 'Take flight with [Name]\'s feathered friends!\n\n8 bird species + name letters in vibrant plumage colors.',
  },
  {
    id: 'bugs', name: 'Böcekler & Çiçekler', emoji: '🐞', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$24-32',
    pieces: [
      ['🐞','LADYBUG',['#E53935','#1A1A1A'],'Kırmızı-siyah uğur böceği'],
      ['🐝','BEE',['#F9A825','#1A1A1A'],'Sarı-siyah arı'],
      ['🦋','BUTTERFLY',['#EC407A','#FDD835'],'Renkli kelebek'],
      ['🐛','CATERPILLAR',['#388E3C','#FDD835'],'Yeşil tırtıl'],
      ['🐜','ANT',['#1A1A1A','#5D4037'],'Siyah karınca'],
      ['🕷️','SPIDER',['#1A1A1A','#FFFFFF'],'Siyah örümcek'],
      ['🌸','BLOSSOM',['#F8BBD9','#EC407A'],'Pembe çiçek'],
      ['🌼','DAISY',['#FDD835','#FFFFFF'],'Sarı papatya'],
    ],
    tags: ['bug name puzzle','insect baby gift','ladybug bee puzzle','garden bugs puzzle','personalized insect toy','butterfly caterpillar puzzle','montessori bug toy','wooden insect puzzle','spring baby gift','custom bug name board','nature baby puzzle','garden nursery decor','tiny creatures puzzle'],
    titleTemplate: 'Bug & Flower Name Puzzle – Personalized Ladybug Bee Butterfly Wooden Baby Gift – Garden Montessori',
    descriptionTemplate: 'Discover the secret garden world with [Name]!\n\n8 tiny creatures + name letters in bright spring colors.',
  },
  {
    id: 'reptiles', name: 'Sürüngenler', emoji: '🦎', status: 'new', audience: 'boy',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🦎','LIZARD',['#388E3C','#FDD835'],'Yeşil kertenkele'],
      ['🐍','SNAKE',['#388E3C','#FFFFFF'],'Yeşil yılan'],
      ['🐢','TURTLE',['#388E3C','#F9A825'],'Yeşil kaplumbağa'],
      ['🐊','CROC',['#558B2F','#33691E'],'Koyu yeşil timsah'],
      ['🦖','T-REX',['#2E7D32','#1B5E20'],'Yeşil dinozor'],
      ['🦕','BRACHIO',['#558B2F','#33691E'],'Uzun boyun dino'],
      ['🐉','DRAGON',['#C0392B','#FDD835'],'Kırmızı ejderha'],
      ['🥚','EGG',['#ECEFF1','#90A4AE'],'Sürüngen yumurtası'],
    ],
    tags: ['reptile name puzzle','lizard snake puzzle','dragon puzzle baby boy','personalized reptile toy','wooden reptile puzzle','dinosaur dragon puzzle','montessori reptile toy','baby boy 1st birthday reptile','custom reptile name board','exotic animal puzzle','scaly friends puzzle','wooden lizard toy','reptile nursery decor'],
    titleTemplate: 'Reptile & Dragon Name Puzzle Boy – Personalized Lizard Snake Wooden Baby Gift – Scaly Montessori',
    descriptionTemplate: 'A scaly adventure for your little explorer!\n\n8 reptiles + dragon + name letters in earthy greens and golds.',
  },
  {
    id: 'vehicles-speed', name: 'Hız Araçları', emoji: '🚗', status: 'new', audience: 'boy',
    competitionLevel: 'mid', priceRange: '$26-38',
    pieces: [
      ['🚗','CAR',['#E53935','#1A1A1A'],'Kırmızı araba'],
      ['🚓','POLICE',['#1565C0','#FFFFFF'],'Mavi polis arabası'],
      ['🚑','AMBULANCE',['#FFFFFF','#E53935'],'Beyaz-kırmızı ambulans'],
      ['🚒','FIRETRUCK',['#E53935','#FFD600'],'Kırmızı itfaiye'],
      ['🚌','BUS',['#F9A825','#1A1A1A'],'Sarı okul otobüsü'],
      ['🚕','TAXI',['#F9A825','#1A1A1A'],'Sarı taksi'],
      ['🏎️','RACECAR',['#E53935','#FFFFFF'],'Yarış arabası'],
      ['🏍️','MOTO',['#1A1A1A','#E53935'],'Siyah-kırmızı motosiklet'],
    ],
    tags: ['vehicle name puzzle','car puzzle baby boy','fire truck name puzzle','personalized car toy','wooden vehicle puzzle','police car baby gift','race car puzzle toddler','montessori vehicle toy','transportation puzzle','custom car name board','baby boy 1st birthday car','wooden truck puzzle','little driver puzzle'],
    titleTemplate: 'Vehicle Name Puzzle Boy – Personalized Car Fire Truck Wooden Baby Gift – Transportation Montessori',
    descriptionTemplate: 'Vroom vroom — [Name]\'s favorite ride is here!\n\n8 vehicles + name letters in bold primary colors.',
  },
  {
    id: 'aircraft', name: 'Uçaklar & Helikopterler', emoji: '✈️', status: 'new', audience: 'boy',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['✈️','PLANE',['#1565C0','#FFFFFF'],'Mavi-beyaz uçak'],
      ['🚁','HELI',['#E53935','#FDD835'],'Kırmızı helikopter'],
      ['🛩️','PROP',['#F57C00','#FFFFFF'],'Pervaneli uçak'],
      ['🛸','UFO',['#B0BEC5','#76FF03'],'UFO'],
      ['🪂','PARACHUTE',['#E53935','#FDD835'],'Renkli paraşüt'],
      ['🎈','BALLOON',['#E53935','#FDD835'],'Sıcak hava balonu'],
      ['🪁','KITE',['#E53935','#FDD835'],'Renkli uçurtma'],
      ['☁️','CLOUD',['#FFFFFF','#90CAF9'],'Beyaz bulut'],
    ],
    tags: ['airplane name puzzle','aircraft baby gift','helicopter puzzle baby boy','personalized plane toy','wooden airplane puzzle','aviation baby gift','sky transport puzzle','montessori aircraft toy','pilot baby puzzle','custom plane name board','baby boy 1st birthday plane','wooden helicopter toy','flying machines puzzle'],
    titleTemplate: 'Aircraft Name Puzzle Boy – Personalized Airplane Helicopter Wooden Baby Gift – Aviation Montessori',
    descriptionTemplate: 'Up, up and away with [Name]!\n\n8 flying machines + name letters in sky blue and sunset palette.',
  },
  {
    id: 'trains', name: 'Trenler & Raylar', emoji: '🚂', status: 'new', audience: 'boy',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🚂','STEAM',['#1A1A1A','#E53935'],'Siyah-kırmızı buhar treni'],
      ['🚆','BULLET',['#FFFFFF','#1565C0'],'Beyaz-mavi hızlı tren'],
      ['🚇','METRO',['#F9A825','#1A1A1A'],'Sarı metro'],
      ['🚃','WAGON',['#8D6E63','#1A1A1A'],'Kahve vagon'],
      ['🚉','STATION',['#8D6E63','#E53935'],'İstasyon'],
      ['🛤️','TRACK',['#5D4037','#9E9E9E'],'Tren rayı'],
      ['🚦','SIGNAL',['#E53935','#388E3C'],'Tren sinyali'],
      ['⛽','FUEL',['#F9A825','#1A1A1A'],'Yakıt'],
    ],
    tags: ['train name puzzle','locomotive baby gift','wooden train puzzle boy','personalized railway toy','steam train baby puzzle','choo choo train puzzle','montessori train toy','railroad baby gift','custom train name board','baby boy 1st birthday train','wooden locomotive toy','train themed nursery','little engineer puzzle'],
    titleTemplate: 'Train Name Puzzle Boy – Personalized Steam Locomotive Wooden Baby Gift – Railway Montessori',
    descriptionTemplate: 'All aboard the [Name] express!\n\n8 train pieces + name letters in classic railway colors.',
  },
  {
    id: 'music', name: 'Müzik Aletleri', emoji: '🎵', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🎸','GUITAR',['#5D4037','#FFFFFF'],'Kahve gitar'],
      ['🎹','PIANO',['#1A1A1A','#FFFFFF'],'Siyah-beyaz piyano'],
      ['🥁','DRUM',['#E53935','#FDD835'],'Kırmızı bateri'],
      ['🎺','TRUMPET',['#FDD835','#D4A843'],'Altın trompet'],
      ['🎷','SAX',['#D4A843','#5D4037'],'Altın saksafon'],
      ['🎻','VIOLIN',['#8D6E63','#5D4037'],'Kahve keman'],
      ['🪕','BANJO',['#8D6E63','#FDD835'],'Banjo'],
      ['🎤','MIC',['#1A1A1A','#9E9E9E'],'Mikrofon'],
    ],
    tags: ['music name puzzle','instrument baby gift','guitar piano puzzle','personalized music toy','wooden instrument puzzle','little musician puzzle','montessori music toy','baby first instrument','custom music name board','rock band puzzle','classical music baby gift','wooden guitar puzzle','sound exploration puzzle'],
    titleTemplate: 'Music Instrument Name Puzzle – Personalized Guitar Piano Drum Wooden Baby Gift – Little Musician',
    descriptionTemplate: 'Set [Name]\'s rhythm in motion!\n\n8 musical instruments + name letters in stage-lit colors.',
  },
  {
    id: 'sweets', name: 'Tatlılar & Pasta', emoji: '🍰', status: 'new', audience: 'girl',
    competitionLevel: 'mid', priceRange: '$24-34',
    pieces: [
      ['🍰','CAKE',['#F8BBD9','#FFFFFF'],'Pembe pasta'],
      ['🧁','CUPCAKE',['#F48FB1','#FDD835'],'Pembe-sarı cupcake'],
      ['🍩','DONUT',['#F48FB1','#F9A825'],'Pembe donut'],
      ['🍪','COOKIE',['#8D6E63','#5D4037'],'Çikolatalı kurabiye'],
      ['🍦','ICECREAM',['#FFCCBC','#F9A825'],'Çilek külah dondurma'],
      ['🍫','CHOCOLATE',['#5D4037','#8D6E63'],'Çikolata bar'],
      ['🍭','LOLLIPOP',['#EC407A','#FFFFFF'],'Pembe lolipop'],
      ['🍬','CANDY',['#E53935','#FDD835'],'Renkli şeker'],
    ],
    tags: ['sweets name puzzle','cake cupcake puzzle','candy baby gift girl','personalized dessert toy','wooden sweets puzzle','bakery baby puzzle','montessori dessert toy','sugar cute baby gift','custom sweets name board','baby girl 1st birthday cake','wooden cupcake puzzle','dessert nursery decor','sweet tooth puzzle'],
    titleTemplate: 'Sweets & Cake Name Puzzle Girl – Personalized Cupcake Donut Wooden Baby Gift – Bakery Montessori',
    descriptionTemplate: 'Sweet treats for the sweetest little one!\n\n8 desserts + name letters in pastel candy colors.',
  },
  {
    id: 'breakfast', name: 'Kahvaltı', emoji: '🥐', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$24-32',
    pieces: [
      ['🥐','CROISSANT',['#D4A843','#8D6E63'],'Altın kruvasan'],
      ['🥞','PANCAKE',['#D4A843','#8D6E63'],'Pankek'],
      ['🍳','EGG',['#FFFFFF','#FDD835'],'Yumurta'],
      ['🥓','BACON',['#E53935','#FFCCBC'],'Pastırma'],
      ['🍞','BREAD',['#D4A843','#8D6E63'],'Ekmek'],
      ['🥛','MILK',['#FFFFFF','#90CAF9'],'Süt'],
      ['🧇','WAFFLE',['#D4A843','#8D6E63'],'Waffle'],
      ['🍯','HONEY',['#D4A843','#F9A825'],'Bal'],
    ],
    tags: ['breakfast name puzzle','food puzzle baby','pancake croissant puzzle','personalized food toy','wooden breakfast puzzle','foodie baby gift','morning meal puzzle','montessori food toy','custom breakfast name board','baby first foods','wooden pancake puzzle','breakfast nursery puzzle','little chef puzzle'],
    titleTemplate: 'Breakfast Food Name Puzzle – Personalized Pancake Croissant Wooden Baby Gift – Little Foodie',
    descriptionTemplate: 'Good morning, [Name]!\n\n8 breakfast favorites + name letters in warm bakery tones.',
  },
  {
    id: 'vegetables', name: 'Sebzeler', emoji: '🥕', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$24-32',
    pieces: [
      ['🥕','CARROT',['#E65100','#2E7D32'],'Turuncu havuç'],
      ['🍅','TOMATO',['#E53935','#388E3C'],'Kırmızı domates'],
      ['🥦','BROCCOLI',['#388E3C','#1B5E20'],'Yeşil brokoli'],
      ['🌽','CORN',['#FDD835','#388E3C'],'Sarı mısır'],
      ['🫑','PEPPER',['#388E3C','#1B5E20'],'Yeşil biber'],
      ['🍆','EGGPLANT',['#7B1FA2','#388E3C'],'Mor patlıcan'],
      ['🥒','CUCUMBER',['#388E3C','#FFFFFF'],'Yeşil salatalık'],
      ['🥔','POTATO',['#D4A843','#8D6E63'],'Patates'],
    ],
    tags: ['vegetable name puzzle','veggie baby toy','carrot tomato puzzle','personalized veggie gift','wooden vegetable puzzle','healthy food baby puzzle','garden veggie toy','montessori vegetable toy','custom veggie name board','baby first vegetables','wooden carrot puzzle','garden nursery puzzle','little gardener puzzle'],
    titleTemplate: 'Vegetable Name Puzzle – Personalized Carrot Tomato Wooden Baby Gift – Garden Veggie Montessori',
    descriptionTemplate: 'Eat the rainbow with [Name]!\n\n8 fresh vegetables + name letters in vibrant garden colors.',
  },
  {
    id: 'tools', name: 'Aletler & İnşaat', emoji: '🔧', status: 'new', audience: 'boy',
    competitionLevel: 'low', priceRange: '$26-34',
    pieces: [
      ['🔨','HAMMER',['#E53935','#8D6E63'],'Kırmızı saplı çekiç'],
      ['🔧','WRENCH',['#9E9E9E','#1A1A1A'],'Gri ingiliz anahtarı'],
      ['🪛','SCREWDRIVER',['#F9A825','#1A1A1A'],'Sarı tornavida'],
      ['🪚','SAW',['#9E9E9E','#8D6E63'],'Testere'],
      ['⛏️','PICKAXE',['#5D4037','#9E9E9E'],'Kazma'],
      ['🪓','AXE',['#9E9E9E','#8D6E63'],'Balta'],
      ['🧲','MAGNET',['#E53935','#1565C0'],'Mıknatıs'],
      ['🔩','SCREW',['#9E9E9E','#1A1A1A'],'Vida'],
    ],
    tags: ['tools name puzzle','construction baby gift','hammer wrench puzzle','personalized tool toy','wooden tools puzzle','little builder puzzle','montessori construction toy','baby first tools','custom tool name board','baby boy 1st birthday tools','wooden hammer toy','construction nursery decor','workshop baby puzzle'],
    titleTemplate: 'Tools Name Puzzle Boy – Personalized Hammer Wrench Wooden Baby Gift – Little Builder Montessori',
    descriptionTemplate: 'Time to build, [Name]!\n\n8 workshop tools + name letters in primary builder colors.',
  },
  {
    id: 'science', name: 'Bilim & Lab', emoji: '🔬', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['🔬','MICROSCOPE',['#1A1A1A','#1565C0'],'Siyah mikroskop'],
      ['🧪','TUBE',['#1565C0','#FDD835'],'Test tüpü'],
      ['⚗️','FLASK',['#7B1FA2','#FDD835'],'Mor flask'],
      ['🧬','DNA',['#1565C0','#E53935'],'DNA sarmal'],
      ['🪐','PLANET',['#F9A825','#8D6E63'],'Gezegen'],
      ['🧲','MAGNET',['#E53935','#1565C0'],'Mıknatıs'],
      ['💡','BULB',['#FDD835','#FFFFFF'],'Ampul'],
      ['🌡️','THERMO',['#E53935','#FFFFFF'],'Termometre'],
    ],
    tags: ['science name puzzle','little scientist baby gift','microscope puzzle baby','personalized stem toy','wooden science puzzle','laboratory baby toy','montessori stem toy','baby first scientist','custom science name board','stem nursery puzzle','wooden lab puzzle','science themed gift','little einstein puzzle'],
    titleTemplate: 'Science STEM Name Puzzle – Personalized Microscope Lab Wooden Baby Gift – Little Scientist Montessori',
    descriptionTemplate: 'Curiosity starts here, [Name]!\n\n8 science icons + name letters in lab-fresh palette.',
  },
  {
    id: 'medical', name: 'Doktor & Hemşire', emoji: '🩺', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🩺','STETHO',['#1A1A1A','#FFFFFF'],'Stetoskop'],
      ['💊','PILL',['#E53935','#FFFFFF'],'Hap'],
      ['💉','SYRINGE',['#9E9E9E','#FDD835'],'Şırınga'],
      ['🩹','BANDAGE',['#FFCCBC','#FFFFFF'],'Bandaj'],
      ['🦷','TOOTH',['#FFFFFF','#90CAF9'],'Diş'],
      ['🧴','BOTTLE',['#1565C0','#FFFFFF'],'İlaç şişesi'],
      ['❤️','HEART',['#E53935','#C62828'],'Kalp'],
      ['🏥','HOSPITAL',['#FFFFFF','#E53935'],'Hastane'],
    ],
    tags: ['doctor name puzzle','medical baby gift','stethoscope puzzle baby','personalized doctor toy','wooden medical puzzle','future doctor baby gift','nurse baby puzzle','montessori medical toy','custom doctor name board','baby first checkup','wooden stetho toy','medical nursery decor','little doc puzzle'],
    titleTemplate: 'Doctor & Medical Name Puzzle – Personalized Stethoscope Wooden Baby Gift – Future Doctor Montessori',
    descriptionTemplate: 'For the little healer in the making!\n\n8 medical icons + name letters in clean clinical palette.',
  },
  {
    id: 'fairy', name: 'Peri Bahçesi', emoji: '🧚', status: 'new', audience: 'girl',
    competitionLevel: 'mid', priceRange: '$28-40',
    pieces: [
      ['🧚','FAIRY',['#CE93D8','#F8BBD9'],'Mor peri'],
      ['🍄','MUSHROOM',['#E53935','#FFFFFF'],'Kırmızı-beyaz mantar'],
      ['🌸','BLOSSOM',['#F8BBD9','#EC407A'],'Pembe çiçek'],
      ['🦋','BUTTERFLY',['#EC407A','#FDD835'],'Renkli kelebek'],
      ['🌟','STAR',['#FDD835','#FFFFFF'],'Sarı yıldız'],
      ['🐝','BEE',['#FDD835','#1A1A1A'],'Sarı arı'],
      ['🌿','LEAF',['#388E3C','#1B5E20'],'Yeşil yaprak'],
      ['💫','SPARKLE',['#FDD835','#FFFFFF'],'Pırıltı'],
    ],
    tags: ['fairy name puzzle','fairy garden baby gift','enchanted puzzle girl','personalized fairy toy','wooden fairy puzzle','magical baby puzzle','fairy nursery decor','montessori fairy toy','custom fairy name board','baby girl 1st birthday fairy','wooden enchanted puzzle','fairy tale baby gift','garden fairy puzzle'],
    titleTemplate: 'Fairy Garden Name Puzzle Girl – Personalized Magical Wooden Baby Gift – Enchanted Montessori',
    descriptionTemplate: 'Sprinkle some fairy dust on [Name]\'s nursery!\n\n8 magical garden pieces + name letters in pastel pinks and purples.',
  },
  {
    id: 'knight', name: 'Şövalye & Kale', emoji: '⚔️', status: 'new', audience: 'boy',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['⚔️','SWORD',['#9E9E9E','#D4A843'],'Kılıç'],
      ['🛡️','SHIELD',['#1565C0','#D4A843'],'Mavi-altın kalkan'],
      ['🏰','CASTLE',['#9E9E9E','#1565C0'],'Gri kale'],
      ['🐉','DRAGON',['#C0392B','#FDD835'],'Kırmızı ejderha'],
      ['👑','CROWN',['#D4A843','#E53935'],'Altın taç'],
      ['🏹','BOW',['#8D6E63','#388E3C'],'Yay'],
      ['🐴','HORSE',['#8D6E63','#FFFFFF'],'Şövalye atı'],
      ['🪙','COIN',['#D4A843','#F9A825'],'Altın sikke'],
    ],
    tags: ['knight name puzzle','castle dragon puzzle','personalized knight toy','wooden castle puzzle','medieval baby gift','sword shield puzzle baby','montessori knight toy','little hero puzzle','custom knight name board','baby boy 1st birthday knight','wooden dragon toy','fairy tale knight puzzle','castle nursery decor'],
    titleTemplate: 'Knight & Castle Name Puzzle Boy – Personalized Dragon Sword Wooden Baby Gift – Medieval Montessori',
    descriptionTemplate: 'Brave Sir [Name] rides into adventure!\n\n8 knightly pieces + name letters in royal blue and gold.',
  },
  {
    id: 'pirate', name: 'Korsanlar', emoji: '🏴‍☠️', status: 'new', audience: 'boy',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['🏴‍☠️','FLAG',['#1A1A1A','#FFFFFF'],'Korsan bayrağı'],
      ['⚓','ANCHOR',['#9E9E9E','#5D4037'],'Çapa'],
      ['🦜','PARROT',['#E53935','#1565C0'],'Renkli papağan'],
      ['💰','TREASURE',['#D4A843','#5D4037'],'Hazine sandığı'],
      ['🗺️','MAP',['#D4A843','#5D4037'],'Hazine haritası'],
      ['🦈','SHARK',['#546E7A','#FFFFFF'],'Köpekbalığı'],
      ['🏝️','ISLAND',['#388E3C','#FDD835'],'Tropik ada'],
      ['🪙','COIN',['#D4A843','#F9A825'],'Altın sikke'],
    ],
    tags: ['pirate name puzzle','treasure baby gift boy','ahoy matey puzzle','personalized pirate toy','wooden pirate puzzle','treasure hunter baby gift','montessori pirate toy','custom pirate name board','baby boy 1st birthday pirate','wooden treasure puzzle','sea adventure puzzle','pirate nursery decor','little captain puzzle'],
    titleTemplate: 'Pirate Adventure Name Puzzle Boy – Personalized Treasure Wooden Baby Gift – Ahoy Montessori',
    descriptionTemplate: 'Ahoy, Captain [Name]!\n\n8 pirate treasures + name letters in seafaring browns and golds.',
  },
  {
    id: 'circus', name: 'Sirk', emoji: '🎪', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🎪','TENT',['#E53935','#FDD835'],'Sirk çadırı'],
      ['🤡','CLOWN',['#E53935','#FFFFFF'],'Palyaço'],
      ['🐘','ELEPHANT',['#9E9E9E','#F8BBD9'],'Sirk fili'],
      ['🦁','LION',['#F9A825','#8D6E63'],'Sirk aslanı'],
      ['🎈','BALLOON',['#E53935','#FDD835'],'Renkli balon'],
      ['🎠','CAROUSEL',['#F48FB1','#D4A843'],'Atlıkarınca'],
      ['🤹','JUGGLER',['#E53935','#FDD835'],'Hokkabaz'],
      ['🎟️','TICKET',['#D4A843','#E53935'],'Sirk bileti'],
    ],
    tags: ['circus name puzzle','clown elephant puzzle','personalized circus toy','wooden circus puzzle','big top baby gift','carnival baby puzzle','montessori circus toy','custom circus name board','baby first circus','wooden carousel puzzle','circus nursery decor','little entertainer puzzle','classic circus baby gift'],
    titleTemplate: 'Circus Name Puzzle – Personalized Big Top Clown Wooden Baby Gift – Carnival Montessori',
    descriptionTemplate: 'Step right up — it\'s the [Name] show!\n\n8 circus icons + name letters in red, gold and stripes.',
  },
  {
    id: 'sports-extreme', name: 'Ekstrem Sporlar', emoji: '🏄', status: 'new', audience: 'boy',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['🏄','SURFER',['#1565C0','#FDD835'],'Sörfçü'],
      ['🛹','SKATE',['#5D4037','#E53935'],'Kaykay'],
      ['🚴','BIKE',['#E53935','#1A1A1A'],'BMX bisiklet'],
      ['⛷️','SKI',['#FFFFFF','#1565C0'],'Kayak'],
      ['🏂','SNOWBOARD',['#E53935','#FFFFFF'],'Snowboard'],
      ['🧗','CLIMB',['#E53935','#8D6E63'],'Tırmanıcı'],
      ['🪂','PARAGLIDE',['#E53935','#FDD835'],'Yamaç paraşütü'],
      ['🏋️','LIFT',['#1A1A1A','#9E9E9E'],'Halter'],
    ],
    tags: ['extreme sports name puzzle','skateboard surf puzzle','personalized extreme toy','wooden sports puzzle','little daredevil puzzle','adventure baby gift','montessori extreme toy','custom sports name board','baby boy 1st birthday sport','wooden surfer puzzle','action sports puzzle','sports nursery decor','adrenaline baby puzzle'],
    titleTemplate: 'Extreme Sports Name Puzzle Boy – Personalized Surf Skate Wooden Baby Gift – Adventure Montessori',
    descriptionTemplate: 'Action-packed adventures for little daredevil [Name]!\n\n8 extreme sports + name letters in bold action palette.',
  },
  {
    id: 'olympics', name: 'Olimpiyat Sporları', emoji: '🥇', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🥇','GOLD',['#D4A843','#F9A825'],'Altın madalya'],
      ['🏊','SWIM',['#1565C0','#FFFFFF'],'Yüzücü'],
      ['🏃','RUN',['#E53935','#FDD835'],'Koşucu'],
      ['🚴','CYCLE',['#388E3C','#1A1A1A'],'Bisikletçi'],
      ['🤸','GYM',['#7B1FA2','#FDD835'],'Jimnastik'],
      ['🏌️','GOLF',['#388E3C','#FFFFFF'],'Golfçü'],
      ['🥊','BOX',['#E53935','#1A1A1A'],'Boks'],
      ['🏹','ARCHERY',['#8D6E63','#388E3C'],'Okçuluk'],
    ],
    tags: ['olympic sports name puzzle','medal puzzle baby','personalized athlete toy','wooden olympic puzzle','future champion puzzle','sport nursery puzzle','montessori sport toy','custom olympic name board','baby first olympics','wooden medal puzzle','athletic baby gift','sports themed nursery','little champion puzzle'],
    titleTemplate: 'Olympic Sports Name Puzzle – Personalized Medal Champion Wooden Baby Gift – Athlete Montessori',
    descriptionTemplate: 'Go for gold, [Name]!\n\n8 olympic sports + name letters in podium gold-silver-bronze.',
  },
  {
    id: 'camping', name: 'Kamp & Doğa', emoji: '🏕️', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🏕️','TENT',['#E65100','#388E3C'],'Kamp çadırı'],
      ['🔥','FIRE',['#E53935','#FDD835'],'Kamp ateşi'],
      ['🌲','PINE',['#1B5E20','#5D4037'],'Çam ağacı'],
      ['🎒','BACKPACK',['#E65100','#1A1A1A'],'Sırt çantası'],
      ['🧭','COMPASS',['#D4A843','#8D6E63'],'Pusula'],
      ['🔦','FLASHLIGHT',['#9E9E9E','#FDD835'],'El feneri'],
      ['🐻','BEAR',['#5D4037','#FFCCBC'],'Orman ayısı'],
      ['🦌','DEER',['#8D6E63','#FFCCBC'],'Geyik'],
    ],
    tags: ['camping name puzzle','outdoor baby gift','tent fire puzzle','personalized camping toy','wooden camp puzzle','nature explorer baby gift','little adventurer puzzle','montessori camping toy','custom camping name board','baby first camping','wooden tent puzzle','outdoor nursery decor','wilderness baby puzzle'],
    titleTemplate: 'Camping Adventure Name Puzzle – Personalized Tent Campfire Wooden Baby Gift – Outdoor Montessori',
    descriptionTemplate: 'Pack your bag, [Name] — adventure awaits!\n\n8 camping essentials + name letters in earthy outdoor tones.',
  },
  {
    id: 'beach', name: 'Plaj & Tatil', emoji: '🏖️', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🏖️','BEACH',['#FDD835','#0288D1'],'Plaj'],
      ['🌊','WAVE',['#0288D1','#FFFFFF'],'Dalga'],
      ['☀️','SUN',['#FDD835','#F9A825'],'Güneş'],
      ['🌴','PALM',['#388E3C','#8D6E63'],'Palmiye'],
      ['🍉','WATERMELON',['#388E3C','#E53935'],'Karpuz'],
      ['🍦','ICECREAM',['#FFCCBC','#F48FB1'],'Dondurma'],
      ['🩴','FLIPFLOP',['#EC407A','#FDD835'],'Terlik'],
      ['🪣','BUCKET',['#E53935','#FFFFFF'],'Kova'],
    ],
    tags: ['beach name puzzle','summer baby gift','sun wave puzzle','personalized beach toy','wooden beach puzzle','vacation baby puzzle','tropical baby gift','montessori beach toy','custom beach name board','baby first summer','wooden palm puzzle','beach nursery decor','seaside baby puzzle'],
    titleTemplate: 'Beach Summer Name Puzzle – Personalized Sun Wave Palm Wooden Baby Gift – Seaside Montessori',
    descriptionTemplate: 'Sun, sea and [Name]!\n\n8 beach favorites + name letters in tropical sunset palette.',
  },
  {
    id: 'weather', name: 'Hava Olayları', emoji: '⛈️', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$24-32',
    pieces: [
      ['☀️','SUN',['#FDD835','#F9A825'],'Güneş'],
      ['⛅','PARTLY',['#FDD835','#FFFFFF'],'Parçalı bulutlu'],
      ['☁️','CLOUD',['#FFFFFF','#90CAF9'],'Bulut'],
      ['🌧️','RAIN',['#0288D1','#90CAF9'],'Yağmur'],
      ['⛈️','STORM',['#5D4037','#FDD835'],'Fırtına'],
      ['🌨️','SNOW',['#FFFFFF','#90CAF9'],'Kar'],
      ['🌈','RAINBOW',['#E53935','#1565C0'],'Gökkuşağı'],
      ['🌪️','TORNADO',['#9E9E9E','#5D4037'],'Hortum'],
    ],
    tags: ['weather name puzzle','rain sun rainbow puzzle','personalized weather toy','wooden weather puzzle','little meteorologist puzzle','climate baby gift','montessori weather toy','custom weather name board','baby first weather','wooden cloud puzzle','sky themed nursery','weather chart baby puzzle','seasons puzzle baby'],
    titleTemplate: 'Weather Name Puzzle – Personalized Sun Rain Rainbow Wooden Baby Gift – Little Meteorologist Montessori',
    descriptionTemplate: 'Today\'s forecast: 100% chance of fun with [Name]!\n\n8 weather elements + name letters in sky-bright palette.',
  },
  {
    id: 'gardening', name: 'Bahçıvanlık', emoji: '🌻', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$24-32',
    pieces: [
      ['🌻','SUNFLOWER',['#FDD835','#5D4037'],'Ayçiçeği'],
      ['🌹','ROSE',['#E53935','#388E3C'],'Gül'],
      ['🌷','TULIP',['#EC407A','#388E3C'],'Lale'],
      ['🌼','DAISY',['#FFFFFF','#FDD835'],'Papatya'],
      ['🪴','POT',['#8D6E63','#388E3C'],'Saksı'],
      ['🌱','SPROUT',['#388E3C','#1B5E20'],'Filiz'],
      ['🐌','SNAIL',['#8D6E63','#FFCCBC'],'Salyangoz'],
      ['💧','WATER',['#0288D1','#90CAF9'],'Su damlası'],
    ],
    tags: ['garden name puzzle','flower baby gift','sunflower rose puzzle','personalized garden toy','wooden garden puzzle','little gardener puzzle','spring baby gift','montessori garden toy','custom garden name board','baby first garden','wooden flower puzzle','garden nursery decor','botanical baby puzzle'],
    titleTemplate: 'Garden Flower Name Puzzle – Personalized Sunflower Rose Wooden Baby Gift – Little Gardener Montessori',
    descriptionTemplate: 'Watch [Name] grow like a flower!\n\n8 garden blossoms + name letters in fresh spring colors.',
  },
  {
    id: 'shapes-colors', name: 'Renkler & Şekiller', emoji: '🎨', status: 'new', audience: 'neutral',
    competitionLevel: 'mid', priceRange: '$22-30',
    pieces: [
      ['🟥','RED',['#E53935'],'Kırmızı kare'],
      ['🟧','ORANGE',['#F57C00'],'Turuncu kare'],
      ['🟨','YELLOW',['#FDD835'],'Sarı kare'],
      ['🟩','GREEN',['#388E3C'],'Yeşil kare'],
      ['🟦','BLUE',['#1565C0'],'Mavi kare'],
      ['🟪','PURPLE',['#7B1FA2'],'Mor kare'],
      ['⭕','CIRCLE',['#E53935'],'Daire'],
      ['🔺','TRIANGLE',['#FDD835'],'Üçgen'],
    ],
    tags: ['colors shapes name puzzle','rainbow learning puzzle','personalized color toy','wooden color puzzle','first colors baby gift','montessori color toy','primary color puzzle','custom color name board','baby first colors','wooden rainbow puzzle','educational color toy','shapes recognition puzzle','color sorting baby'],
    titleTemplate: 'Colors & Shapes Name Puzzle – Personalized Rainbow Wooden Baby Gift – First Colors Montessori',
    descriptionTemplate: 'Learn colors with [Name]!\n\n6 primary colors + 2 shapes + name letters in pure rainbow palette.',
  },
  {
    id: 'alphabet', name: 'Alfabe Hayvanları', emoji: '🔤', status: 'new', audience: 'neutral',
    competitionLevel: 'mid', priceRange: '$28-38',
    pieces: [
      ['🦊','A FOX',['#E65100','#FFFFFF'],'A is for Fox'],
      ['🐻','B BEAR',['#5D4037','#FFCCBC'],'B is for Bear'],
      ['🐱','C CAT',['#F9A825','#FFFFFF'],'C is for Cat'],
      ['🐶','D DOG',['#8D6E63','#FFCCBC'],'D is for Dog'],
      ['🐘','E ELEPHANT',['#9E9E9E','#757575'],'E is for Elephant'],
      ['🐸','F FROG',['#388E3C','#FDD835'],'F is for Frog'],
      ['🦒','G GIRAFFE',['#F9A825','#8D6E63'],'G is for Giraffe'],
      ['🐴','H HORSE',['#8D6E63','#FFFFFF'],'H is for Horse'],
    ],
    tags: ['alphabet name puzzle','animal abc puzzle','personalized letter toy','wooden alphabet puzzle','abc learning baby gift','montessori alphabet toy','first letters baby puzzle','custom abc name board','animal alphabet wood','baby first letters','phonics baby puzzle','educational abc gift','letter recognition puzzle'],
    titleTemplate: 'Alphabet Animal Name Puzzle – Personalized ABC Wooden Baby Gift – Phonics Animals Montessori',
    descriptionTemplate: 'A is for Adventure, [Name] is for fun!\n\n8 letter-animals + name letters in classic primary colors.',
  },
  {
    id: 'birthday', name: 'Doğum Günü', emoji: '🎂', status: 'seasonal', audience: 'neutral',
    competitionLevel: 'mid', priceRange: '$26-36',
    pieces: [
      ['🎂','CAKE',['#F48FB1','#FFFFFF'],'Doğum günü pastası'],
      ['🎈','BALLOON',['#E53935','#FDD835'],'Balon'],
      ['🎁','GIFT',['#E53935','#FDD835'],'Hediye'],
      ['🎉','PARTY',['#EC407A','#FDD835'],'Parti'],
      ['🕯️','CANDLE',['#FDD835','#E53935'],'Mum'],
      ['🎊','CONFETTI',['#E53935','#1565C0'],'Konfeti'],
      ['🎀','RIBBON',['#EC407A','#F48FB1'],'Kurdele'],
      ['👑','CROWN',['#D4A843','#E53935'],'Taç'],
    ],
    tags: ['birthday name puzzle','1st birthday gift puzzle','party baby gift','personalized birthday toy','wooden birthday puzzle','smash cake baby gift','montessori birthday toy','custom birthday name board','baby first birthday','wooden party puzzle','celebration baby puzzle','birthday nursery decor','milestone baby gift'],
    titleTemplate: 'Birthday Party Name Puzzle – Personalized First Birthday Wooden Baby Gift – Cake Smash Montessori',
    descriptionTemplate: 'Hooray — it\'s [Name]\'s big day!\n\n8 party pieces + name letters in confetti-bright palette.',
  },

  // ─── KIZ TEMALARI ────────────────────────────────────────────────────────
  {
    id: 'unicorn', name: 'Unicorn & Gokkusagi', emoji: '🦄', status: 'new', audience: 'girl',
    competitionLevel: 'mid', priceRange: '$30-44',
    pieces: [
      ['🦄','UNICORN',['#FFFFFF','#F48FB1'],'Beyaz at, gokkusagi yele'],
      ['🌈','RAINBOW',['#EC407A','#FDD835'],'Pastel gokkusagi'],
      ['☁️','CLOUD',['#F8BBD9','#FFFFFF'],'Pembe pamuk bulut'],
      ['⭐','STAR',['#FDD835','#FFFFFF'],'Parlak yildiz'],
      ['💖','HEART',['#EC407A','#F48FB1'],'Pembe kalp'],
      ['🍭','LOLLIPOP',['#EC407A','#FFFFFF'],'Pembe lolipop'],
      ['🍩','DONUT',['#F48FB1','#F9A825'],'Pembe donut'],
      ['💎','GEM',['#CE93D8','#90CAF9'],'Mor-mavi elmas'],
    ],
    tags: ['unicorn name puzzle','rainbow unicorn baby gift','magical unicorn toy girl','personalized unicorn puzzle','wooden unicorn puzzle','pastel rainbow baby gift','montessori unicorn toy','baby girl unicorn shower','custom unicorn name board','baby girl 1st birthday unicorn','wooden rainbow puzzle','unicorn nursery decor','fairytale unicorn baby'],
    titleTemplate: "Unicorn Rainbow Name Puzzle Girl – Personalized Pastel Wooden Baby Gift – Magical Montessori",
    descriptionTemplate: "Sprinkle some unicorn magic on [Name]'s nursery!\n\n8 magical pastel pieces + name letters in rainbow + pink palette.",
  },
  {
    id: 'ballet', name: 'Bale & Dans', emoji: '🩰', status: 'new', audience: 'girl',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['🩰','BALLET',['#F48FB1','#FFFFFF'],'Pembe bale ayakkabisi'],
      ['👯','DANCERS',['#EC407A','#CE93D8'],'Iki dansci silueti'],
      ['🎵','NOTE',['#1A1A1A','#FDD835'],'Mufzik notasi'],
      ['🎀','BOW',['#EC407A','#F48FB1'],'Pembe fiyonk'],
      ['💃','DANCER',['#E53935','#FDD835'],'Flamenko dansci'],
      ['🌹','ROSE',['#E53935','#388E3C'],'Tek gul'],
      ['👑','TIARA',['#D4A843','#EC407A'],'Pembe taht taci'],
      ['⭐','STAR',['#FDD835','#FFFFFF'],'Sahne yildizi'],
    ],
    tags: ['ballet name puzzle','dancer baby gift girl','ballerina puzzle baby','personalized ballet toy','wooden ballet puzzle','pink ballerina nursery','dance themed baby gift','montessori ballet toy','tutu baby puzzle','custom ballet name board','baby girl 1st birthday dance','wooden ballerina toy','prima donna baby gift'],
    titleTemplate: 'Ballet Ballerina Name Puzzle Girl – Personalized Dance Wooden Baby Gift – Pink Montessori',
    descriptionTemplate: 'En pointe, little dancer [Name]!\n\n8 ballet motifs + name letters in soft pink and blush tones.',
  },
  {
    id: 'fashion', name: 'Moda & Stil', emoji: '👗', status: 'new', audience: 'girl',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['👗','DRESS',['#EC407A','#FDD835'],'Pembe elbise'],
      ['👠','HEEL',['#E53935','#1A1A1A'],'Kirmizi topuklu'],
      ['👜','BAG',['#D4A843','#5D4037'],'Altin canta'],
      ['💄','LIPSTICK',['#E53935','#D4A843'],'Kirmizi-altin ruj'],
      ['💍','RING',['#D4A843','#FFFFFF'],'Altin yuzuk, elmas'],
      ['🕶️','GLASSES',['#1A1A1A','#FDD835'],'Siyah-altin gozluk'],
      ['👒','HAT',['#F48FB1','#D4A843'],'Pembe sapka'],
      ['💐','BOUQUET',['#EC407A','#FDD835'],'Pembe buket'],
    ],
    tags: ['fashion name puzzle','little fashionista baby gift','dress shoe puzzle girl','personalized fashion toy','wooden fashion puzzle','glam baby puzzle','montessori fashion toy','baby girl style puzzle','custom fashion name board','baby girl 1st birthday fashion','wooden style puzzle','glamour nursery decor','trendy baby gift girl'],
    titleTemplate: 'Fashion Style Name Puzzle Girl – Personalized Dress Heels Wooden Baby Gift – Little Fashionista Montessori',
    descriptionTemplate: 'Sashay through the day, [Name]!\n\n8 chic style icons + name letters in glam pink and gold palette.',
  },
  {
    id: 'tea-party', name: 'Cay Partisi', emoji: '🫖', status: 'new', audience: 'girl',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🫖','TEAPOT',['#F48FB1','#FFFFFF'],'Pembe demlik, beyaz cicek'],
      ['☕','TEACUP',['#FFFFFF','#F48FB1'],'Beyaz fincan, pembe kenar'],
      ['🍰','CAKE',['#F8BBD9','#FFFFFF'],'Pembe pasta dilimi'],
      ['🍪','BISCUIT',['#D4A843','#8D6E63'],'Tereyagli kurabiye'],
      ['🍓','STRAWBERRY',['#E53935','#388E3C'],'Cilek'],
      ['🌹','ROSE',['#E53935','#388E3C'],'Tek gul'],
      ['🍯','HONEY',['#D4A843','#F9A825'],'Bal kavanozu'],
      ['🦋','BUTTERFLY',['#EC407A','#CE93D8'],'Pembe-mor kelebek'],
    ],
    tags: ['tea party name puzzle','little hostess baby gift','teacup puzzle girl','personalized tea party toy','wooden tea set puzzle','garden party baby gift','montessori tea party toy','baby girl high tea puzzle','custom tea name board','baby girl 1st birthday tea','wooden teapot puzzle','english tea nursery','high tea baby gift'],
    titleTemplate: 'Tea Party Name Puzzle Girl – Personalized Teapot Cake Wooden Baby Gift – Little Hostess Montessori',
    descriptionTemplate: 'Pinkies up, [Name] — it\'s tea time!\n\n8 tea-party treasures + name letters in soft rose and cream palette.',
  },
  {
    id: 'beauty', name: 'Guzellik & Makyaj', emoji: '💄', status: 'new', audience: 'girl',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['💄','LIPSTICK',['#E53935','#D4A843'],'Kirmizi ruj'],
      ['💅','POLISH',['#EC407A','#FFFFFF'],'Pembe oje'],
      ['👁️','MIRROR',['#D4A843','#FFFFFF'],'Altin cerceveli ayna'],
      ['🌸','BLUSH',['#F8BBD9','#EC407A'],'Pembe allik cicegi'],
      ['💎','GEM',['#CE93D8','#FFFFFF'],'Mor elmas'],
      ['🌟','GLITTER',['#FDD835','#FFFFFF'],'Altin pirilti'],
      ['🧴','BOTTLE',['#F48FB1','#FFFFFF'],'Pembe parfum'],
      ['🦋','BUTTERFLY',['#EC407A','#CE93D8'],'Pembe-mor kelebek'],
    ],
    tags: ['beauty name puzzle','makeup baby gift girl','lipstick puzzle baby','personalized beauty toy','wooden makeup puzzle','girly glam baby gift','montessori beauty toy','baby girl beauty puzzle','custom makeup name board','baby girl 1st birthday glam','wooden glam puzzle','beauty nursery decor','vanity baby gift'],
    titleTemplate: 'Beauty Makeup Name Puzzle Girl – Personalized Lipstick Polish Wooden Baby Gift – Glam Montessori',
    descriptionTemplate: 'Glow up, [Name]!\n\n8 beauty icons + name letters in pink, gold and sparkle palette.',
  },
  {
    id: 'kittens', name: 'Sevimli Kediler', emoji: '🐱', status: 'new', audience: 'girl',
    competitionLevel: 'mid', priceRange: '$26-36',
    pieces: [
      ['🐱','CAT',['#F9A825','#FFFFFF'],'Sari-beyaz kedi'],
      ['🐈','TABBY',['#8D6E63','#FFCCBC'],'Tekir kedi'],
      ['🐈‍⬛','BLACK CAT',['#1A1A1A','#FDD835'],'Siyah kedi, sari goz'],
      ['🐾','PAW',['#F48FB1','#FFFFFF'],'Pembe pati izi'],
      ['🎀','BOW',['#EC407A','#F48FB1'],'Pembe fiyonk'],
      ['🧶','YARN',['#EC407A','#F48FB1'],'Pembe yum yumagi'],
      ['🐟','FISH',['#F57C00','#FFFFFF'],'Turuncu balik'],
      ['🥛','MILK',['#FFFFFF','#90CAF9'],'Sut tabagi'],
    ],
    tags: ['kitten name puzzle','cute cat baby gift girl','kitty puzzle baby','personalized cat toy','wooden kitten puzzle','cat lover baby gift','montessori cat toy','baby girl kitten puzzle','custom kitten name board','baby girl 1st birthday cat','wooden cat puzzle','kitty nursery decor','meow baby gift'],
    titleTemplate: 'Kitten Cat Name Puzzle Girl – Personalized Kitty Wooden Baby Gift – Pretty Kitty Montessori',
    descriptionTemplate: 'Purrfect day for [Name]!\n\n8 kitten motifs + name letters in soft pink and cream palette.',
  },
  {
    id: 'mermaid', name: 'Deniz Kizi', emoji: '🧜‍♀️', status: 'new', audience: 'girl',
    competitionLevel: 'low', priceRange: '$30-42',
    pieces: [
      ['🧜‍♀️','MERMAID',['#00ACC1','#EC407A'],'Pembe sacli deniz kizi'],
      ['🐚','SHELL',['#F48FB1','#FFFFFF'],'Pembe deniz kabugu'],
      ['🌊','WAVE',['#00ACC1','#FFFFFF'],'Mavi dalga'],
      ['🐠','FISH',['#FF8A65','#EC407A'],'Renkli mercan baligi'],
      ['🐬','DOLPHIN',['#80DEEA','#FFFFFF'],'Mavi yunus'],
      ['⭐','STARFISH',['#FFD600','#F57C00'],'Sari denizyildizi'],
      ['🫧','BUBBLES',['#E3F2FD','#FFFFFF'],'Hava kabarciklari'],
      ['🪸','CORAL',['#EC407A','#FFCCBC'],'Pembe mercan'],
    ],
    tags: ['mermaid name puzzle','under the sea baby gift girl','mermaid puzzle baby','personalized mermaid toy','wooden mermaid puzzle','ocean princess baby gift','montessori mermaid toy','baby girl mermaid shower','custom mermaid name board','baby girl 1st birthday mermaid','wooden sea puzzle','mermaid nursery decor','little mermaid baby'],
    titleTemplate: 'Mermaid Name Puzzle Girl – Personalized Under the Sea Wooden Baby Gift – Pink Ocean Montessori',
    descriptionTemplate: 'Splash into magic with [Name]!\n\n8 mermaid treasures + name letters in coral pink and ocean blue palette.',
  },
  {
    id: 'flower-garden', name: 'Cicek Bahcesi', emoji: '🌷', status: 'new', audience: 'girl',
    competitionLevel: 'low', priceRange: '$26-34',
    pieces: [
      ['🌷','TULIP',['#EC407A','#388E3C'],'Pembe lale'],
      ['🌹','ROSE',['#E53935','#388E3C'],'Kirmizi gul'],
      ['🌸','BLOSSOM',['#F8BBD9','#EC407A'],'Pembe sakura cicegi'],
      ['🌺','HIBISCUS',['#EC407A','#FDD835'],'Tropikal pembe cicek'],
      ['🌻','SUNFLOWER',['#FDD835','#5D4037'],'Aycicegi'],
      ['🌼','DAISY',['#FFFFFF','#FDD835'],'Beyaz papatya'],
      ['💐','BOUQUET',['#EC407A','#FDD835'],'Pembe-sari buket'],
      ['🦋','BUTTERFLY',['#EC407A','#CE93D8'],'Pembe-mor kelebek'],
    ],
    tags: ['flower garden name puzzle','blossom baby gift girl','floral puzzle baby','personalized flower toy','wooden flower puzzle','rose tulip baby gift','montessori floral toy','baby girl flower puzzle','custom flower name board','baby girl 1st birthday floral','wooden bouquet puzzle','floral nursery decor','spring blossom baby'],
    titleTemplate: 'Flower Garden Name Puzzle Girl – Personalized Rose Tulip Wooden Baby Gift – Blossom Montessori',
    descriptionTemplate: 'Bloom where you are planted, [Name]!\n\n8 garden flowers + name letters in rose pink and meadow green palette.',
  },
  {
    id: 'baking', name: 'Pasta Sefi', emoji: '🧁', status: 'new', audience: 'girl',
    competitionLevel: 'low', priceRange: '$26-34',
    pieces: [
      ['🧁','CUPCAKE',['#F48FB1','#FDD835'],'Pembe cupcake'],
      ['🍰','SLICE',['#F8BBD9','#FFFFFF'],'Pasta dilimi'],
      ['🍪','COOKIE',['#D4A843','#5D4037'],'Damla cikolatali kurabiye'],
      ['🥐','CROISSANT',['#D4A843','#8D6E63'],'Tereyagli kruvasan'],
      ['🍩','DONUT',['#F48FB1','#EC407A'],'Pembe donut'],
      ['🍫','CHOCO',['#5D4037','#D4A843'],'Cikolata kare'],
      ['🍯','HONEY',['#D4A843','#F9A825'],'Bal kavanozu'],
      ['🥄','SPOON',['#9E9E9E','#FFFFFF'],'Kasik'],
    ],
    tags: ['baking name puzzle','little baker baby gift','cupcake puzzle girl','personalized baking toy','wooden baker puzzle','pastry baby puzzle','montessori baking toy','baby girl bakery puzzle','custom baking name board','baby girl 1st birthday bake','wooden cupcake puzzle','bakery nursery decor','sweet baker baby'],
    titleTemplate: 'Little Baker Name Puzzle Girl – Personalized Cupcake Cookie Wooden Baby Gift – Pastry Chef Montessori',
    descriptionTemplate: 'Sweetest baker in town, [Name]!\n\n8 bakery treats + name letters in butter cream and rose palette.',
  },
  {
    id: 'kawaii', name: 'Kawaii / Sevimli', emoji: '🍡', status: 'new', audience: 'girl',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🍡','DANGO',['#F48FB1','#FDD835'],'Renkli mochi sis'],
      ['🍣','SUSHI',['#E53935','#FFFFFF'],'Pembe sushi'],
      ['🌸','SAKURA',['#F8BBD9','#FFFFFF'],'Pembe kiraz cicegi'],
      ['🥢','STICKS',['#5D4037','#D4A843'],'Yemek cubuklari'],
      ['🍵','MATCHA',['#388E3C','#FFFFFF'],'Yesil matcha'],
      ['🐱','NEKO',['#FFFFFF','#F48FB1'],'Sevimli beyaz kedi'],
      ['🎏','CARP',['#E53935','#1565C0'],'Renkli koi bayragi'],
      ['🍙','RICEBALL',['#FFFFFF','#1A1A1A'],'Onigiri'],
    ],
    tags: ['kawaii name puzzle','japan baby gift','sushi puzzle baby girl','personalized kawaii toy','wooden japan puzzle','cute japanese baby gift','montessori kawaii toy','baby girl kawaii puzzle','custom japan name board','baby girl 1st birthday kawaii','wooden sushi puzzle','japan nursery decor','sakura baby gift'],
    titleTemplate: 'Kawaii Japan Name Puzzle Girl – Personalized Sakura Sushi Wooden Baby Gift – Cute Montessori',
    descriptionTemplate: 'Kawaii vibes for sweet [Name]!\n\n8 Japanese cuteness icons + name letters in cherry blossom palette.',
  },

  // ─── EXTRA TEMALAR ───────────────────────────────────────────────────────
  {
    id: 'robots', name: 'Robotlar & Teknoloji', emoji: '🤖', status: 'new', audience: 'boy',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['🤖','ROBOT',['#9E9E9E','#1565C0'],'Gri-mavi robot'],
      ['⚙️','GEAR',['#9E9E9E','#1A1A1A'],'Disli'],
      ['🔋','BATTERY',['#388E3C','#FDD835'],'Yesil-sari pil'],
      ['💡','BULB',['#FDD835','#FFFFFF'],'Sari ampul'],
      ['🛸','UFO',['#9E9E9E','#76FF03'],'Gumus UFO'],
      ['📡','ANTENNA',['#1565C0','#9E9E9E'],'Anten'],
      ['🔧','WRENCH',['#9E9E9E','#FDD835'],'Anahtar'],
      ['⚡','BOLT',['#FDD835','#FF8F00'],'Sari simsek'],
    ],
    tags: ['robot name puzzle','tech baby gift boy','robot puzzle baby','personalized robot toy','wooden robot puzzle','little engineer baby gift','montessori tech toy','baby boy robot puzzle','custom robot name board','baby boy 1st birthday robot','wooden tech puzzle','robot nursery decor','stem baby gift'],
    titleTemplate: 'Robot Tech Name Puzzle Boy – Personalized Gear Bolt Wooden Baby Gift – Little Engineer Montessori',
    descriptionTemplate: 'Beep boop — circuits powered for [Name]!\n\n8 robotic icons + name letters in steel gray and electric blue palette.',
  },
  {
    id: 'superhero', name: 'Süper Kahramanlar', emoji: '🦸', status: 'new', audience: 'neutral',
    competitionLevel: 'mid', priceRange: '$28-38',
    pieces: [
      ['🦸','HERO',['#1565C0','#E53935'],'Mavi-kirmizi kahraman'],
      ['🦹','SHIELD',['#D4A843','#1565C0'],'Altin-mavi kalkan'],
      ['⚡','LIGHTNING',['#FDD835','#FFFFFF'],'Sari simsek'],
      ['💥','BOOM',['#E53935','#FDD835'],'Patlama efekti'],
      ['🎭','MASK',['#1A1A1A','#FDD835'],'Siyah maske'],
      ['💪','STRENGTH',['#FFCCBC','#E53935'],'Kuvvet kolu'],
      ['🌟','STAR',['#FDD835','#FFFFFF'],'Yildiz'],
      ['🔥','FLAME',['#E53935','#F9A825'],'Kahraman alevi'],
    ],
    tags: ['superhero name puzzle','hero baby gift','cape puzzle baby','personalized superhero toy','wooden hero puzzle','little hero baby gift','montessori hero toy','baby superhero puzzle','custom hero name board','baby 1st birthday hero','wooden superhero puzzle','hero nursery decor','comic book baby gift'],
    titleTemplate: 'Superhero Name Puzzle – Personalized Hero Wooden Baby Gift – Little Hero Montessori',
    descriptionTemplate: 'Up, up and away — Captain [Name] saves the day!\n\n8 heroic icons + name letters in primary hero palette.',
  },
  {
    id: 'ninjas', name: 'Ninjalar', emoji: '🥷', status: 'new', audience: 'boy',
    competitionLevel: 'low', priceRange: '$28-38',
    pieces: [
      ['🥷','NINJA',['#1A1A1A','#E53935'],'Siyah-kirmizi ninja'],
      ['⚔️','KATANA',['#9E9E9E','#1A1A1A'],'Gumus katana'],
      ['🎯','SHURIKEN',['#9E9E9E','#1A1A1A'],'Atma yildiz'],
      ['🏯','DOJO',['#5D4037','#E53935'],'Japon kale dojo'],
      ['🐉','DRAGON',['#1B5E20','#D4A843'],'Yesil ejderha'],
      ['🌸','SAKURA',['#F8BBD9','#FFFFFF'],'Kiraz cicegi'],
      ['🔥','FIRE',['#E53935','#FDD835'],'Ates'],
      ['👁️','EYE',['#FDD835','#1A1A1A'],'Sari ninja gozu'],
    ],
    tags: ['ninja name puzzle','samurai baby gift','katana puzzle boy','personalized ninja toy','wooden ninja puzzle','warrior baby gift','montessori ninja toy','baby boy ninja puzzle','custom ninja name board','baby boy 1st birthday ninja','wooden warrior puzzle','dojo nursery decor','silent hero baby'],
    titleTemplate: 'Ninja Warrior Name Puzzle Boy – Personalized Katana Dragon Wooden Baby Gift – Stealth Montessori',
    descriptionTemplate: 'Silent and swift — ninja [Name] strikes!\n\n8 ninja icons + name letters in deep black and crimson palette.',
  },
  {
    id: 'food-world', name: 'Dunya Yemekleri', emoji: '🍕', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$26-34',
    pieces: [
      ['🍕','PIZZA',['#E53935','#FDD835'],'Pizza dilimi'],
      ['🍔','BURGER',['#D4A843','#388E3C'],'Hamburger'],
      ['🌮','TACO',['#F57C00','#388E3C'],'Meksika taco'],
      ['🍜','RAMEN',['#F57C00','#FFFFFF'],'Japon ramen kasesi'],
      ['🥖','BAGUETTE',['#D4A843','#8D6E63'],'Fransiz ekmek'],
      ['🍝','PASTA',['#FDD835','#E53935'],'Italyan makarna'],
      ['🍣','SUSHI',['#E53935','#FFFFFF'],'Sushi'],
      ['🥨','PRETZEL',['#D4A843','#5D4037'],'Pretzel'],
    ],
    tags: ['world food name puzzle','foodie baby gift','pizza burger puzzle','personalized food toy','wooden food puzzle','international baby puzzle','montessori food toy','baby foodie puzzle','custom food name board','baby 1st birthday food','wooden cuisine puzzle','food nursery decor','little chef baby'],
    titleTemplate: 'World Food Name Puzzle – Personalized Pizza Sushi Wooden Baby Gift – Little Foodie Montessori',
    descriptionTemplate: 'A passport on a plate for [Name]!\n\n8 international dishes + name letters in deli-warm palette.',
  },
  {
    id: 'asian-animals', name: 'Asya Hayvanlari', emoji: '🐼', status: 'new', audience: 'neutral',
    competitionLevel: 'low', priceRange: '$26-36',
    pieces: [
      ['🐼','PANDA',['#FFFFFF','#1A1A1A'],'Siyah-beyaz panda'],
      ['🐨','KOALA',['#9E9E9E','#1A1A1A'],'Gri koala'],
      ['🐯','TIGER',['#F9A825','#1A1A1A'],'Turuncu kaplan'],
      ['🐒','MONKEY',['#8D6E63','#FFCCBC'],'Maymun'],
      ['🦏','RHINO',['#9E9E9E','#616161'],'Gergedan'],
      ['🐍','SNAKE',['#388E3C','#FDD835'],'Yesil yilan'],
      ['🦜','PARROT',['#E53935','#1565C0'],'Renkli papagan'],
      ['🐦','PEACOCK',['#00897B','#1565C0'],'Tavus kusu'],
    ],
    tags: ['asian animal name puzzle','panda baby gift','tiger koala puzzle','personalized asian animal toy','wooden panda puzzle','exotic baby gift','montessori panda toy','baby panda puzzle','custom panda name board','baby 1st birthday panda','wooden tiger puzzle','asian nursery decor','jungle baby gift'],
    titleTemplate: 'Asian Animal Name Puzzle – Personalized Panda Tiger Wooden Baby Gift – Exotic Montessori',
    descriptionTemplate: 'A trip across Asia with [Name]!\n\n8 iconic Asian animals + name letters in bamboo green and tiger orange palette.',
  },
  {
    id: 'pop-star', name: 'Pop Yildizi & Karaoke', emoji: '🎤', status: 'new', audience: 'girl',
    competitionLevel: 'low', priceRange: '$26-34',
    pieces: [
      ['🎤','MIC',['#EC407A','#1A1A1A'],'Pembe mikrofon'],
      ['🎧','HEADPHONES',['#EC407A','#1A1A1A'],'Pembe kulaklik'],
      ['🎵','NOTE',['#1A1A1A','#FDD835'],'Muzik notasi'],
      ['🎶','NOTES',['#1A1A1A','#EC407A'],'Coklu nota'],
      ['💿','DISC',['#9E9E9E','#FFFFFF'],'CD plak'],
      ['🌟','STAR',['#FDD835','#FFFFFF'],'Yildiz'],
      ['👓','SHADES',['#1A1A1A','#FDD835'],'Yildiz gozluk'],
      ['💃','DANCE',['#E53935','#FDD835'],'Dansci silueti'],
    ],
    tags: ['pop star name puzzle','little singer baby gift girl','microphone puzzle baby','personalized music toy','wooden pop puzzle','karaoke baby gift','montessori pop toy','baby girl singer puzzle','custom pop name board','baby girl 1st birthday pop','wooden mic puzzle','music nursery decor','little diva baby'],
    titleTemplate: 'Pop Star Name Puzzle Girl – Personalized Microphone Headphones Wooden Baby Gift – Little Diva Montessori',
    descriptionTemplate: 'Grab the mic, [Name] — you\'re the star!\n\n8 pop-stage icons + name letters in hot pink and stage-light gold palette.',
  },
];

function fillNewTheme(t) {
  const palette = new Set();
  const pieces = t.pieces.map(([emoji, name, colors, note]) => {
    (colors || []).forEach(c => palette.add(c));
    return { emoji, name, tr: '', colors: colors || [], note: note || '' };
  });
  const base = {
    id: t.id,
    name: t.name,
    nameEn: newThemeEnglishName(t),
    emoji: t.emoji,
    status: t.status,
    audience: t.audience,
    competitionLevel: t.competitionLevel,
    priceRange: t.priceRange,
    pieces,
    palette: [...palette].slice(0, 6),
    tags: t.tags,
    priceHint: '',
  };
  const listing = buildListing(base);
  return { ...base, titleTemplate: listing.title, descriptionTemplate: listing.description };
}

function newThemeEnglishName(t) {
  const map = {
    'jungle': 'Tropical Jungle',
    'arctic': 'Arctic Animal',
    'pets': 'Pet Animal',
    'forest': 'Woodland Forest Animal',
    'birds': 'Bird',
    'bugs': 'Bug & Flower',
    'reptiles': 'Reptile & Dragon',
    'vehicles-speed': 'Speed Vehicle Racer',
    'aircraft': 'Aircraft',
    'trains': 'Train Locomotive',
    'music': 'Music Instrument',
    'sweets': 'Sweets & Cake',
    'breakfast': 'Breakfast Food',
    'vegetables': 'Vegetable',
    'tools': 'Tools & Builder',
    'science': 'Science STEM',
    'medical': 'Doctor & Medical',
    'fairy': 'Fairy Garden',
    'knight': 'Knight & Castle',
    'pirate': 'Pirate Adventure',
    'circus': 'Circus',
    'sports-extreme': 'Extreme Sports',
    'olympics': 'Olympic Sports',
    'camping': 'Camping Adventure',
    'beach': 'Beach Summer',
    'weather': 'Weather',
    'gardening': 'Garden Flower',
    'shapes-colors': 'Colours & Shapes',
    'alphabet': 'Alphabet Animal',
    'birthday': 'Birthday Party',
    'unicorn': 'Unicorn Rainbow',
    'ballet': 'Ballet Ballerina',
    'fashion': 'Fashion Style',
    'tea-party': 'Tea Party',
    'beauty': 'Beauty Makeup',
    'kittens': 'Kitten Cat',
    'mermaid': 'Mermaid',
    'flower-garden': 'Flower Garden',
    'baking': 'Little Baker',
    'kawaii': 'Kawaii Japan',
    'robots': 'Robot Tech',
    'superhero': 'Superhero',
    'ninjas': 'Ninja Warrior',
    'food-world': 'World Food',
    'asian-animals': 'Asian Animal',
    'pop-star': 'Pop Star',
  };
  return map[t.id] || t.name;
}

const html = fs.readFileSync(SRC, 'utf8');
const existing = extractExisting(html);
const fresh = NEW_THEMES.map(fillNewTheme);

const combined = [...existing, ...fresh];

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(combined, null, 2));
console.log(`Wrote ${combined.length} themes -> ${OUT}`);
console.log(`  existing: ${existing.length}`);
console.log(`  new:      ${fresh.length}`);
