// Etsy listing optimizer - ported from etsy-optimizer/optimize_all.js
const { applyEtsy2026Tags } = require('./etsy-2026-rules');

const AVAILABLE_STYLES = `

AVAILABLE STYLES

T-SHIRT — Gildan 64000 Softstyle
• 4.2 oz, 100% ringspun cotton — lightweight, breathable, buttery soft
• Athletic Heather & Black Heather: 90% cotton / 10% polyester | Ash: 99% cotton / 1% poly
• Double-needle stitching throughout, seamless collar, heat-transfer neck label
• Semi-relaxed fit — great for tucking or wearing loose

SWEATSHIRT — Gildan 18000 Heavy Blend Crewneck
• 8.0 oz, 50% cotton / 50% polyester — warm but not bulky
• Air-jet yarn for a softer, pill-resistant finish
• Reinforced stitching at shoulders and armholes
• 1x1 rib knit collar, cuffs, and waistband with spandex for shape retention
• Tearaway label for comfort — no scratchy tags
• Note: sweatshirts do not include hood strings or drawcords`;

const SIZING = `

SIZING
Both styles run true to size. For the oversized look shown in the listing photos, we recommend sizing up 1-2 sizes. Not sure which size to grab? Message us your height and usual size — we'll help you pick the right fit for either style.`;

const COLORS = `

COLORS
Listing photos show digital mock-ups. Slight color variations may occur between screens and the final print — but we've made sure the design pops on every colorway.`;

const HOW_TO_ORDER = `

HOW TO ORDER
Select your style (tee or sweatshirt) → Pick your color → Choose your size → Add to cart → Done.
Back print designs available for an additional charge — add that option before checkout.
Want to personalize? Message us first to confirm availability before purchasing.`;

const SHIPPING = `

SHIPPING & HANDLING
Orders ship within 1-3 business days.
Address changes must be requested before the item ships.`;

// ─────────────────────────────────────────────
// ÜRÜNE ÖZEL DESCRIPTION ÜRETİCİ
// ─────────────────────────────────────────────

function generateDescription(title, tags) {
  const t = (title || '').toLowerCase();
  const specific = (title || '').split(',')[0].trim();
  const tagStr = (tags || []).join(' ').toLowerCase();

  let intro = '';

  // ── DISNEY ──
  if (t.includes('disney') || t.includes('mickey') || t.includes('minnie') || t.includes('epcot') || t.includes('disneyland') || t.includes('magic kingdom') || t.includes('toy story') || t.includes('frozen')) {

    if (t.includes('family') || t.includes('matching')) {
      intro = `The ultimate Disney family tee and sweatshirt for your next park day — ${specific}.

Matching with the crew has never looked this good. This design captures everything you love about Disney without going full tourist-mode. Whether you're walking down Main Street, waiting in line at Space Mountain, or grabbing a Dole Whip, this piece is comfortable enough for a full day at the parks and stylish enough for the obligatory castle photo.

Choose between a lightweight tee for those hot Florida days or a cozy crewneck sweatshirt for cool California mornings. Both printed on soft, breathable fabric that holds up wash after wash — because let's be honest, that churro is ending up on someone's shirt.

Perfect for the Disney-obsessed family that coordinates without being too matchy-matchy.`;

    } else if (t.includes('dad') || t.includes('cool dad')) {
      intro = `Finally, a Disney shirt that dads actually want to wear — ${specific}.

This isn't your typical "I'm with the princess" dad shirt. It's a retro-inspired design that looks good whether you're pushing a stroller through EPCOT or grabbing beers at the resort pool. The vintage aesthetic gives it that effortlessly cool vibe — the kind of piece that makes other dads ask "where'd you get that?"

Available as a lightweight tee for park days or a crewneck sweatshirt for those early morning rope drops. Soft, comfortable, and designed for the dad who secretly loves Disney just as much as the kids do.`;

    } else if (t.includes('mom') || t.includes('mama')) {
      intro = `The Disney mom shirt that actually looks cute — ${specific}.

Forget the basic park merch — this design has that retro Disney charm without looking like you grabbed it from a gift shop bin. Whether you're chasing toddlers around Fantasyland or finally getting that adults-only EPCOT food & wine day, this top keeps you comfortable and photo-ready all day.

Pick between a soft tee for warm weather or a cozy crewneck sweatshirt for those chilly early mornings and late-night firework shows. Either way, you'll look like the cool Disney mom who has her aesthetic figured out.`;

    } else if (t.includes('princess')) {
      intro = `Channel your inner Disney princess with this ${specific}.

Whether you're team Cinderella, Rapunzel, or Moana — this design celebrates the magic of Disney royalty with a modern twist. It's cute enough for a Disneyland outfit-of-the-day post but comfortable enough to actually enjoy the rides without adjusting your outfit every five minutes.

Grab the lightweight tee for sunny park days or the crewneck sweatshirt for chilly evenings watching the fireworks. Soft fabric, great print quality, and a fit that flatters — because even at a theme park, you deserve to look good.`;

    } else if (t.includes('retro') || t.includes('vintage') || t.includes('comfort colors')) {
      intro = `Vintage Disney vibes in a modern fit — ${specific}.

This retro-inspired design brings back the golden era of Disney with a distressed, lived-in aesthetic that looks like you've been collecting it since the '90s. It's the kind of piece that gets compliments from strangers at the parks and makes you look like you know something everyone else doesn't.

Available as a lightweight tee for hot park days or a crewneck sweatshirt for cooler evenings. The soft, washed feel gets even better after every wash — like your favorite vintage find, except it actually fits.

If you're tired of the same mass-produced Disney merch, this one's for you.`;

    } else if (t.includes('epcot') || t.includes('world tour')) {
      intro = `Take a trip around the world without leaving your closet — ${specific}.

This EPCOT-inspired design captures the spirit of World Showcase with a fun, retro aesthetic that works just as well on the streets as it does in the parks. Whether you're sipping your way through the countries or just repping your favorite Disney park from home, this piece is a conversation starter.

Choose a soft tee for warm weather exploring or a cozy crewneck sweatshirt for those Air-Conditioned-to-Arctic EPCOT pavilions. Both styles look great layered or on their own.`;

    } else {
      intro = `Your next favorite Disney tee and sweatshirt — ${specific}.

This design captures the magic of Disney with a style that's equal parts nostalgic and modern. It's the kind of piece you throw on for a park day, a Disney movie marathon, or just because you love the magic — no special occasion needed.

Available as a breathable tee for warmer days or a cozy crewneck sweatshirt when you want that extra comfort. The print quality is crisp, the fabric is soft, and it holds up through countless washes and adventures. Whether it's a gift for someone Disney-obsessed or a treat for yourself, this one belongs in your rotation.`;
    }
  }

  // ── ST. PATRICK'S DAY ──
  else if (t.includes('patrick') || t.includes('irish') || t.includes('shamrock') || t.includes('clover') || t.includes('paddy') || t.includes('leprechaun') || t.includes('slainte') || t.includes('lucky') && (t.includes('clover') || t.includes('shamrock') || t.includes('irish'))) {

    if (t.includes('funny') || t.includes('drink') || t.includes('beer') || t.includes('pub')) {
      intro = `The St. Patrick's Day shirt that actually gets laughs at the bar — ${specific}.

This isn't your basic "Kiss Me I'm Irish" nonsense. It's a funny, well-designed graphic that stands out at the parade, the pub crawl, or wherever you end up celebrating. The kind of shirt people ask about — and you get to say you found it on Etsy.

Choose between a lightweight tee for milder days or a cozy crewneck sweatshirt when you want extra warmth. Both printed on quality fabric that won't fall apart after one wash and one too many green beers.

Perfect if you want to celebrate St. Patrick's Day without looking like a leprechaun costume.`;

    } else if (t.includes('teacher')) {
      intro = `The cutest St. Patrick's Day teacher tee — ${specific}.

Show up to school looking festive without going overboard. This design is fun, classroom-appropriate, and way more stylish than whatever the school spirit committee came up with. Your students will love it, your coworkers will ask where you got it, and you'll actually want to wear it again next year.

Available as a soft tee for warmer classrooms or a crewneck sweatshirt for those schools that keep the AC on arctic mode year-round. Comfortable enough for a full day of wrangling tiny humans.`;

    } else if (t.includes('baby tee') || t.includes('crop') || t.includes('y2k') || t.includes('coquette')) {
      intro = `St. Patrick's Day but make it cute — ${specific}.

Forget the oversized novelty shirts. This design brings Y2K energy to Paddy's Day with a look that's trendy, flattering, and Instagram-ready. Whether you're hitting the bars, brunching with friends, or just want a festive outfit that actually looks good — this is it.

Available as a fitted tee or a cozy crewneck sweatshirt depending on the vibe you're going for. The print is high-quality DTF — vibrant colors that pop and hold up wash after wash.`;

    } else if (t.includes('goose') || t.includes('raccoon') || t.includes('dog') || t.includes('animal')) {
      intro = `The most adorable St. Patrick's Day shirt you didn't know you needed — ${specific}.

This design combines everyone's favorite chaotic animal energy with St. Paddy's Day festiveness. It's funny, it's cute, and it's the kind of shirt that makes people smile. Wear it to the parade, the office party, or just around the house while you pretend you have plans.

Grab the lightweight tee for warmer celebrations or the crewneck sweatshirt for those chilly March days. Either way, you'll be the best-dressed person who also loves animals at whatever event you end up at.`;

    } else {
      intro = `Celebrate St. Patrick's Day in style with this ${specific}.

This design hits the sweet spot between festive and fashionable — you'll look like you put thought into your outfit without trying too hard. Whether you're heading to a parade, a bar crawl, or just want to wear something green that doesn't scream "party store," this is your move.

Choose between a lightweight tee for milder days or a cozy crewneck sweatshirt when March decides to stay cold. Both styles feature a high-quality DTF print that stays vibrant through multiple washes.

Not the neon green everyone else is wearing — this one actually looks good.`;
    }
  }

  // ── EASTER ──
  else if (t.includes('easter') || (t.includes('bunny') && !t.includes('hockey')) || t.includes('peeps') || t.includes('egg hunt')) {

    if (t.includes('christian') || t.includes('risen') || t.includes('jesus') || t.includes('cross') || t.includes('faith') || t.includes('matthew') || t.includes('bible')) {
      intro = `Wear your faith this Easter — ${specific}.

This design is a beautiful, meaningful way to celebrate the resurrection with style and intention. It's not loud or over-the-top — it's the kind of piece that quietly speaks volumes about what this holiday really means to you. Perfect for Easter Sunday service, brunch with the family, or as a thoughtful gift for someone who holds their faith close.

Available as a soft tee for spring weather or a crewneck sweatshirt for those still-chilly Easter mornings. Both printed with care on quality fabric that lasts well beyond the holiday.`;

    } else if (t.includes('teacher') || t.includes('reading') || t.includes('book')) {
      intro = `The Easter teacher shirt that's actually cute — ${specific}.

Your students are going to love this one. It's festive, fun, and classroom-appropriate — the perfect way to celebrate spring without wearing bunny ears all day. Pair it with your favorite jeans and you've got an outfit that works from morning circle to afternoon pickup.

Choose between a lightweight tee for warmer classrooms or a cozy crewneck sweatshirt when the AC is cranking. Either way, you'll be the best-dressed teacher at the Easter egg hunt.`;

    } else if (t.includes('toddler') || t.includes('kids') || t.includes('baby') || t.includes('boy') || t.includes('girls')) {
      intro = `The cutest Easter outfit for your little one — ${specific}.

This design is adorable without being over-the-top — perfect for Easter photos, egg hunts, and family gatherings. It's the kind of piece that makes grandparents melt and gets all the comments on your Instagram story.

Printed on soft, comfortable fabric that kids actually want to wear (no scratchy tags, no stiff prints). Because the last thing you need on Easter morning is a meltdown over a shirt.`;

    } else {
      intro = `Spring-ready and Easter-perfect — ${specific}.

This design brings all the Easter vibes without going full pastel explosion. It's cute, it's trendy, and it works whether you're hunting eggs, hosting brunch, or just enjoying the first warm day in months. The kind of piece you'll pull out every spring because it's just that good.

Available as a breathable tee for sunny days or a crewneck sweatshirt for those mornings when spring hasn't quite decided to show up yet. The DTF print is vibrant and durable — no cracking or peeling after multiple washes.`;
    }
  }

  // ── HEATED RIVALRY / HOCKEY ROMANCE ──
  else if (t.includes('rivalry') || t.includes('hollander') || t.includes('rozanov') || t.includes('hollanov') || t.includes('cottage') && t.includes('loser')) {
    if (t.includes('romance') || t.includes('couple') || t.includes('book')) {
      intro = `The Heated Rivalry merch your BookTok feed has been begging for — ${specific}.

If you know, you know. This design is made for the fans who've read the book three times, have strong opinions about who's a top, and need the world to know they're Team Hollanov. Subtle enough for daily wear, obvious enough that fellow fans will stop you on the street.

Available as a lightweight tee for casual days or a crewneck sweatshirt for cozy reading sessions. Because nothing pairs better with a hockey romance reread than a soft, comfortable shirt that represents your fictional love story.

If someone asks what it means, that's your chance to recruit another reader.`;

    } else {
      intro = `Rep your favorite fictional hockey team — ${specific}.

This design is for the Heated Rivalry fans who live and breathe Hollanov content. Whether you're Team Hollander, Team Rozanov, or just here for the tension — this piece lets you wear your fandom with style.

Choose between a tee for game-day energy or a crewneck sweatshirt for those cozy BookTok evenings. The print quality is top-tier — crisp, vibrant, and built to survive multiple washes and heated (pun intended) debates about your favorite ship.

A perfect gift for the hockey romance reader in your life — or, let's be real, for yourself.`;
    }
  }

  // ── HOCKEY / ICE HOCKEY (SPORTS) ──
  else if (t.includes('hockey') || t.includes('ice hockey') || t.includes('penalty box') || t.includes('puck')) {
    intro = `For the hockey fan who lives and breathes the game — ${specific}.

This design captures the grit, speed, and pure adrenaline of ice hockey. Whether you're a player, a die-hard fan, or the parent freezing in the stands at 6 AM practice, this shirt says it all. It's the kind of piece that works at the rink, the watch party, or just running errands on game day.

Available as a lightweight tee for warm-weather training or a cozy crewneck sweatshirt for those freezing arena seats. Both styles are comfortable, durable, and printed with a design that holds up through every season — on and off the ice.

A perfect gift for hockey players, coaches, hockey moms, hockey dads, and anyone who bleeds their team's colors.`;
  }

  // ── KPOP / BTS / CONCERT ──
  else if (t.includes('bts') || t.includes('kpop') || t.includes('k-pop') || t.includes('army fan') || t.includes('blackpink') || t.includes('stray kids') || t.includes('seventeen') || t.includes('twice')) {
    intro = `The concert merch that actually looks good — ${specific}.

This design is for the fans who stream at midnight, learn every choreography, and have strong opinions about bias rankings. Whether you're heading to a concert, a fan meetup, or just want to rep your fandom on a regular Tuesday — this piece makes a statement without screaming "I bought this from a street vendor outside the venue."

Available as a lightweight tee for concert nights (because you will be dancing) or a crewneck sweatshirt for those cozy album-listening sessions at home. The DTF print is vibrant, detailed, and built to last through multiple washes and multiple comebacks.

Perfect gift for your fellow fan, your concert buddy, or yourself — because you deserve merch that matches your dedication.`;
  }

  // ── PIRATES / ADVENTURE ──
  else if (t.includes('pirate') || t.includes('caribbean') || t.includes('captain jack') || t.includes('sparrow')) {
    intro = `Adventure awaits — ${specific}.

This design captures the swashbuckling spirit of the high seas with a vintage aesthetic that looks effortlessly cool. Whether you're a fan of the classic ride, the movie franchise, or just love that rebellious pirate energy — this piece brings the adventure wherever you go.

Available as a breathable tee for sunny days at the parks or a crewneck sweatshirt for those breezy evening strolls. The print has that perfectly distressed, lived-in feel that makes it look like you've had it since your first trip to the parks.

A pirate's life never looked this good. Grab it for your next theme park visit, movie marathon, or just because you refuse to follow the rules.`;
  }

  // ── MOM / MAMA ──
  else if (t.includes('mama') || (t.includes('mom') && !t.includes('common') && !t.includes('democracy'))) {
    if (t.includes('matching') || t.includes('mini')) {
      intro = `Mama and mini, but make it fashion — ${specific}.

This matching set is the cutest way to twin with your little one without looking like you're trying too hard. The design is trendy, the fit is flattering, and your Instagram is about to get a lot cuter. Whether it's a park day, a coffee run, or just hanging at home — you'll both look adorable.

Available as a soft tee or a cozy crewneck sweatshirt for both mama and mini. The fabric is gentle on little skin and comfortable enough that mom actually wants to wear it past the photo op.`;

    } else {
      intro = `The mom shirt that actually looks good — ${specific}.

This isn't another generic "#momlife" tee from a big box store. It's a well-designed piece that says what you're thinking with style and a little bit of humor. Throw it on with jeans and sneakers and you've got an outfit that works for school drop-off, Target runs, and the occasional mom's night out.

Available as a lightweight tee for busy days or a cozy crewneck sweatshirt for when you just want to be comfortable (so, every day). Soft fabric, great fit, and a print that doesn't crack or peel — because you don't have time to baby your clothes when you're too busy babying actual humans.

Perfect gift for Mother's Day, birthdays, or just because she deserves it.`;
    }
  }

  // ── AUTISM / NEURODIVERSITY ──
  else if (t.includes('autism') || t.includes('neurodiv') || t.includes('different') || t.includes('inclusion') || t.includes('sped teacher')) {
    intro = `Celebrating neurodiversity with style and heart — ${specific}.

This design isn't performative — it's personal. Whether you're an advocate, a parent, a teacher, or someone on the spectrum, this piece says something meaningful without saying too much. It's the kind of shirt that sparks the right conversations and makes people feel seen.

Available as a soft tee for awareness walks and everyday wear or a cozy crewneck sweatshirt for sensory-friendly comfort. Both styles are printed with care on gentle, high-quality fabric.

A thoughtful gift for Autism Awareness Month, birthdays, or just because representation matters every single day.`;
  }

  // ── TEACHER ──
  else if (t.includes('teacher') || t.includes('tiny humans')) {
    intro = `The teacher shirt that's cute enough for spirit week and comfortable enough for recess duty — ${specific}.

This design gets it. Teaching is exhausting, rewarding, and somehow both at the same time — and your wardrobe should reflect that energy. Whether it's Teacher Appreciation Week, back to school, or just a regular Tuesday, this piece makes getting dressed one less thing to stress about.

Available as a soft tee for warmer classrooms or a crewneck sweatshirt for those mysteriously freezing teacher lounges. The print is high-quality DTF — no cracking, no peeling, even after the inevitable coffee spill.

Makes a great end-of-year gift, new teacher present, or just a treat-yourself purchase because you definitely deserve it.`;
  }

  // ── CAT / MEME / FUNNY / SARCASTIC ──
  else if (t.includes('cat') || t.includes('kitten') || t.includes('meme') || t.includes('funny') || t.includes('sarcastic') || t.includes('humor')) {
    if (t.includes('cat') || t.includes('kitten')) {
      intro = `The cat shirt that every feline-obsessed human needs — ${specific}.

If your camera roll is 90% cat photos and you've ever canceled plans to stay home with your cat, this shirt was made for you. The design is funny, the print quality is sharp, and it's the kind of piece that starts conversations with fellow cat people everywhere you go.

Choose between a lightweight tee for everyday wear or a crewneck sweatshirt for cozy nights on the couch with your cat (because let's be honest, that's the plan). Both styles are soft, comfortable, and covered in just the right amount of cat energy.

Also makes a perfect gift for the cat lady or cat gentleman in your life — they'll love you almost as much as they love their cat. Almost.`;

    } else {
      intro = `The shirt that says what everyone's thinking — ${specific}.

This design is for the people who use sarcasm as a love language and humor as a coping mechanism. It's funny, it's relatable, and it's going to get reactions everywhere you wear it. The kind of piece that makes strangers laugh and friends say "that's so you."

Available as a lightweight tee for casual days or a cozy crewneck sweatshirt for when you want to be sarcastic AND comfortable. The DTF print is vibrant and durable — because your humor should never fade, and neither should your shirt.

Great gift for the friend who's impossible to shop for. You know the one.`;
    }
  }

  // ── CUSTOM / PERSONALIZED ──
  else if (t.includes('custom') || t.includes('personalized') || t.includes('personalize')) {
    intro = `Made-to-order and made for you — ${specific}.

This isn't off-the-rack generic — it's a personalized piece designed exactly the way you want it. Add your name, your team, your inside joke, whatever makes it yours. The kind of custom apparel that looks like you spent way more than you did.

Available as a soft tee for everyday wear or a crewneck sweatshirt for extra comfort. Both feature high-quality DTF printing that keeps your custom design looking crisp wash after wash.

Perfect for teams, events, gifts, or just because you want something that's uniquely yours. Message us before ordering if you have specific customization requests — we'll work with you to make it exactly right.`;
  }

  // ── VINTAGE / RETRO ──
  else if (t.includes('vintage') || t.includes('retro') || t.includes('comfort colors')) {
    intro = `Vintage vibes, modern comfort — ${specific}.

This retro-inspired design has that perfectly distressed, lived-in look that makes it seem like you found it at the coolest thrift store in town. Except it actually fits well, doesn't smell weird, and the print is crisp. The aesthetic is effortless — throw it on with jeans and you're done.

Available as a soft tee for warmer days or a cozy crewneck sweatshirt for layering season. The fabric gets softer with every wash, and the design holds up beautifully — no cracking, no fading, just that perfect worn-in feel that gets better over time.

If you're the kind of person who appreciates good design and vintage aesthetics, this one's calling your name.`;
  }

  // ── CHRISTIAN / FAITH ──
  else if (t.includes('christian') || t.includes('faith') || t.includes('risen') || t.includes('bible') || t.includes('pray') || t.includes('jesus') || t.includes('cross') && !t.includes('easter')) {
    intro = `Wear your faith with intention — ${specific}.

This design is a quiet, beautiful statement of belief. It's not preachy or in-your-face — it's the kind of piece that speaks through its design and resonates with anyone who sees it. Perfect for church, small group, everyday errands, or as a meaningful gift for someone walking in faith.

Available as a breathable tee for warmer days or a cozy crewneck sweatshirt for those early Sunday mornings. Both styles are soft, comfortable, and printed with a design that lasts — because your faith isn't temporary, and your shirt shouldn't be either.

A thoughtful gift for Easter, Christmas, baptisms, or just because someone in your life needs a reminder that they're loved.`;
  }

  // ── BACHELORETTE / BRIDE ──
  else if (t.includes('bachelorette') || t.includes('bride') || t.includes('bridal') || t.includes('wedding')) {
    intro = `The bachelorette party merch that's actually worth keeping — ${specific}.

Forget the cheap sashes and plastic tiaras. This design is cute, trendy, and something you'll actually want to wear again after the party. Whether you're the bride, the maid of honor, or the friend who's "just here for the drinks," this piece makes the whole crew look coordinated and Instagram-ready.

Available as a lightweight tee for destination bachelorettes or a crewneck sweatshirt for those "getting ready" morning vibes. The print is high-quality and won't peel after one wash — because the memories should last longer than the merch.

Order matching ones for the whole bridal party. Trust us, the group photo is going to be incredible.`;
  }

  // ── ZODIAC / ASTROLOGY ──
  else if (t.includes('zodiac') || t.includes('astrology') || t.includes('pisces') || t.includes('horoscope')) {
    intro = `Your sign, your style — ${specific}.

This design is for the astrology lovers who check their horoscope before making any major life decisions (and some minor ones too). It's stylish, it's cosmic, and it tells the world exactly what energy you're bringing today. Wear it proudly — your sign already knew you'd love it.

Available as a soft tee for Mercury-in-retrograde casual days or a cozy crewneck sweatshirt for full moon movie nights. The print is vibrant and built to last through every planetary transit this year.

Makes an amazing birthday gift — because what's more personal than their actual zodiac sign on a fire shirt?`;
  }

  // ── POLITICAL / PROTEST ──
  else if (t.includes('anti') || t.includes('protest') || t.includes('democracy') || t.includes('salty') || t.includes('political') || t.includes('ice') || t.includes('trump')) {
    intro = `Say it with your shirt — ${specific}.

Some things need to be said, and sometimes the best way to say them is by wearing them. This design is bold, unapologetic, and made for the people who believe that fashion can be a form of protest. Wear it to the rally, the march, the coffee shop, or just the grocery store — your voice matters everywhere.

Available as a lightweight tee for warmer protests or a crewneck sweatshirt for chilly marches. Both styles are comfortable enough for a full day of standing up for what you believe in.

A great gift for the activist in your life — or for yourself, because self-expression shouldn't wait.`;
  }

  // ── USA / PATRIOTIC ──
  else if (t.includes('usa') || t.includes('patriotic') || t.includes('america') || t.includes('eagle') || t.includes('anniversary') || t.includes('independence') || t.includes('250th') || t.includes('1776')) {
    intro = `American pride, actually stylish — ${specific}.

This design celebrates the red, white, and blue without looking like a Fourth of July clearance rack. It's patriotic with taste — the kind of piece you wear to the cookout, the fireworks show, or just a regular Tuesday when you're feeling proud of where you come from.

Available as a breathable tee for hot summer holidays or a crewneck sweatshirt for those chilly Memorial Day mornings. The DTF print is sharp, vibrant, and holds up through every barbecue season.

Whether it's the 4th of July, Memorial Day, or the 250th anniversary — this shirt shows up.`;
  }

  // ── GAMING / STARDEW ──
  else if (t.includes('stardew') || t.includes('gamer') || t.includes('gaming') || t.includes('pixel')) {
    intro = `Cozy gamer energy, wearable edition — ${specific}.

This design is for the gamers who'd rather tend their virtual farm than deal with the real world — and honestly, we respect it. Whether you're grinding through another Stardew season, exploring a new indie title, or just vibing — this piece matches your energy perfectly.

Available as a soft tee for gaming marathons or a crewneck sweatshirt for those cozy couch sessions when the AC is on and the controller is in hand. Comfortable, well-fitting, and designed by someone who actually gets the reference.

Perfect gift for the gamer in your life — they'll finally have something to wear that isn't the same hoodie from 2019.`;
  }

  // ── NURSE / MEDICAL ──
  else if (t.includes('nurse') || t.includes('nursing') || /\brn\b/.test(t) || t.includes('medical') || t.includes('x-ray') || t.includes('radiol') || /\btech\b/.test(t)) {
    intro = `For the healthcare hero who deserves more than just pizza parties — ${specific}.

This design gets it. The long shifts, the impossible patients, the "just one more chart" that turns into twelve — this shirt is a love letter to everyone in healthcare who shows up every single day. It's funny, it's real, and it's comfortable enough to throw on after a 12-hour shift.

Available as a lightweight tee for off-duty days or a crewneck sweatshirt for those freezing hospital break rooms. Both styles are soft, durable, and printed with a design that won't fade — kind of like your dedication to your patients.

Makes an incredible gift for Nurses Week, graduation, birthdays, or just because your favorite nurse deserves something nice that isn't a "Heroes Work Here" sign.`;
  }

  // ── STAR WARS ──
  else if (t.includes('star wars')) {
    intro = `The Force is strong with this one — ${specific}.

This design is for the Star Wars fans who've watched the originals more times than they can count and have opinions about the prequels that they will share unprompted. It's well-designed, cleverly referential, and the kind of piece that makes fellow fans give you the nod of respect.

Available as a breathable tee for Disneyland's Galaxy's Edge adventures or a cozy crewneck sweatshirt for movie marathon nights. The print is crisp, vibrant, and holds up through hyperspace jumps and regular washing machine cycles alike.

A perfect gift for the Star Wars fan who already has everything — because they definitely don't have this.`;
  }

  // ── WESTERN / COWGIRL ──
  else if (t.includes('western') || t.includes('howdy') || t.includes('cowgirl') || t.includes('cowboy') || t.includes('texas') || t.includes('country')) {
    intro = `Yeehaw, but make it fashion — ${specific}.

This design brings western vibes with a modern twist. Whether you're actually from Texas or just love the aesthetic, this piece has that effortlessly cool ranch-to-brunch energy. Pair it with boots for the full effect or sneakers for a casual day — either way, it works.

Available as a lightweight tee for hot country days or a crewneck sweatshirt for those cool ranch mornings. The print is high-quality DTF — vibrant colors that hold up through every rodeo, concert, and Sunday drive.

Perfect for country music fans, rodeo lovers, state pride events, or anyone who lives that western lifestyle. Makes an amazing gift for the Texan in your life — or for yourself, because you don't need an excuse to rep your roots.`;
  }

  // ── COTTAGECORE / FLORAL / BOHO ──
  else if (t.includes('cottagecore') || t.includes('floral') || t.includes('boho') || t.includes('dragonfly') || t.includes('wildflower') || t.includes('celestial') || t.includes('mushroom')) {
    intro = `Soft, dreamy, and perfectly cottagecore — ${specific}.

This design captures that whimsical, nature-inspired aesthetic that makes you want to bake bread, pick wildflowers, and disappear into the countryside. It's romantic without being over-the-top and trendy without trying too hard.

Available as a breathable tee for garden days or a cozy crewneck sweatshirt for those misty morning walks. Both styles are soft, comfortable, and printed with a design that feels like it belongs in a vintage botanical illustration.

Perfect for the friend who has too many plants and not enough cottagecore merch (impossible, but still).`;
  }

  // ── SPACE / SCI-FI / UFO ──
  else if (t.includes('alien') || t.includes('ufo') || t.includes('space') || t.includes('beam') || t.includes('sci-fi') || t.includes('vecna') || t.includes('stranger')) {
    intro = `Out of this world — literally — ${specific}.

This design is for anyone who's looked up at the sky and thought "yeah, take me." Whether you're into sci-fi, conspiracy theories, or just have a sense of humor about the state of things, this shirt gets it. It's weird, it's funny, and it's the kind of piece that makes people do a double-take.

Available as a lightweight tee for casual days or a crewneck sweatshirt for those cozy movie marathon nights. The print is high-quality and vibrant — because even your shirt should be a little out there.`;
  }

  // ── ANIMAL (non-cat) ──
  else if (t.includes('raccoon') || t.includes('penguin') || t.includes('goose') || t.includes('frog') || t.includes('monkey') || t.includes('bear') || t.includes('owl')) {
    intro = `Chaotic animal energy, now in wearable form — ${specific}.

This design captures everything lovable about nature's most unhinged creatures. Whether you're an animal lover, a meme appreciator, or someone who just vibes with chaotic energy — this shirt is your spirit animal in fabric form.

Choose between a lightweight tee for everyday adventures or a crewneck sweatshirt for cozy days when you'd rather be watching nature documentaries. Both styles are soft, comfortable, and printed with a design that's guaranteed to make people smile.

A perfect gift for the animal lover who has too many cute mugs and not enough cute shirts.`;
  }

  // ── GENERAL FALLBACK ──
  else {
    intro = `Your new favorite graphic tee and sweatshirt — ${specific}.

This design stands out from the generic stuff you see everywhere else. It's well-thought-out, the print quality is sharp, and it's comfortable enough to wear on repeat without anyone judging you (and if they do, they're just jealous). Whether you're buying it for yourself or as a gift, this piece delivers.

Available as a soft, breathable tee for everyday wear or a cozy crewneck sweatshirt for those days when comfort is non-negotiable. Both styles feature high-quality DTF printing — no cracking, no peeling, no fading. Just a great shirt that looks as good on wash day #50 as it did on day one.

The kind of piece that gets compliments and makes people ask "where'd you get that?"`;
  }

  // ── CLOSING CTA ──
  const closingOptions = [
    `Add it to your favorites so you don't lose it — and check out the rest of our shop for more designs you'll love.`,
    `Save it to your favorites and come back when you're ready. We'll be here.`,
    `Grab yours before it's gone — and don't forget to check the rest of the shop for more.`,
    `Add to cart now or save it for later — either way, your wardrobe will thank you.`,
  ];
  const closing = closingOptions[Math.abs(hashCode(title)) % closingOptions.length];

  return intro + AVAILABLE_STYLES + SIZING + COLORS + HOW_TO_ORDER + SHIPPING + '\n\n' + closing;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
// ─────────────────────────────────────────────
// ALT TEXT
// ─────────────────────────────────────────────

function generateAltTexts(title, tags) {
  const full = (title || '').trim();
  const mainProduct = full.split(',')[0].trim();
  const tagList = (tags || []).filter(t => t && t.length > 0);

  const titleParts = full.split(',').map(s => s.trim()).filter(s => s.length > 0);
  const subtitle = titleParts.length > 1 ? titleParts[1] : '';

  const usedTags = new Set();
  function pickTag() {
    for (const t of tagList) {
      if (!usedTags.has(t)) { usedTags.add(t); return t; }
    }
    return '';
  }

  const alts = [
    full,
    [mainProduct, pickTag()].filter(Boolean).join(' - '),
    [pickTag(), mainProduct].filter(Boolean).join(', '),
    [mainProduct, pickTag(), pickTag()].filter(Boolean).join(', '),
    [pickTag(), pickTag()].filter(Boolean).join(', '),
    [mainProduct, pickTag()].filter(Boolean).join(', '),
    [pickTag(), mainProduct].filter(Boolean).join(' - '),
    [pickTag(), pickTag(), pickTag()].filter(Boolean).join(', '),
    [mainProduct, pickTag()].filter(Boolean).join(' - '),
    [pickTag(), pickTag()].filter(Boolean).join(', '),
  ];

  return alts.slice(0, 10).map(alt => alt.trim().substring(0, 250));
}

// ─────────────────────────────────────────────
// TAG OPTİMİZASYONU
// ─────────────────────────────────────────────

const TAG_POOLS = {
  disney: [
    'disney vacation tee', 'disney trip shirt', 'disney family gift',
    'magic kingdom tee', 'disney park outfit', 'disney world gift',
    'disney fan apparel', 'disney adult shirt', 'disneyland trip tee',
    'disney matching tee', 'disney group tee', 'family vacation tee'
  ],
  easter: [
    'easter gift idea', 'easter basket stuffer', 'spring graphic tee',
    'happy easter outfit', 'easter sunday shirt', 'spring holiday gift',
    'easter family shirt', 'easter egg hunt tee', 'april holiday shirt',
    'spring celebration tee', 'easter party outfit', 'easter apparel gift'
  ],
  stpatricks: [
    'st paddys day tee', 'irish pride gift', 'lucky charm shirt',
    'green outfit gift', 'parade day shirt', 'bar crawl outfit',
    'irish heritage tee', 'celtic pride shirt', 'shamrock gift idea',
    'march holiday shirt', 'drinking holiday tee', 'irish apparel gift'
  ],
  hockey: [
    'hockey romance gift', 'booktok merch tee', 'sports romance shirt',
    'fiction fan apparel', 'hockey fan gift idea', 'book lover shirt',
    'romantasy merch tee', 'hockey novel fan tee', 'fictional team shirt',
    'romance reader gift', 'spicy book merch', 'booktok fan outfit'
  ],
  mom: [
    'gift for new mom', 'mothers day present', 'mom birthday gift',
    'cool mom apparel', 'mom life shirt', 'mama bear gift tee',
    'best mom gift idea', 'mom graphic tee', 'pregnancy reveal shirt',
    'mom to be gift', 'mommy and me shirt', 'super mom gift tee'
  ],
  teacher: [
    'teacher gift idea', 'educator gift tee', 'school staff gift',
    'back to school tee', 'teacher bday tee', 'end of year gift',
    'classroom outfit', 'preschool teacher', 'kindergarten tee',
    'teaching life tee', 'teacher self care', 'school year shirt'
  ],
  cat: [
    'cat lover present', 'cat owner gift tee', 'funny feline shirt',
    'kitten graphic tee', 'cat parent apparel', 'cat rescue supporter',
    'crazy cat person tee', 'cat humor shirt', 'meow graphic tee',
    'feline fan gift', 'cat themed apparel', 'pet lover shirt'
  ],
  custom: [
    'personalized apparel', 'custom name shirt', 'made to order tee',
    'unique gift idea', 'monogram shirt gift', 'customized clothing',
    'bespoke shirt gift', 'personal name tee', 'custom print gift',
    'one of a kind shirt', 'initials shirt gift', 'name gift apparel'
  ],
  vintage: [
    'retro graphic tee', 'vintage style gift', 'throwback shirt idea',
    'nostalgic apparel', '90s inspired tee', 'classic design shirt',
    'retro aesthetic tee', 'old school gift tee', 'distressed look shirt',
    'vintage fan gift', 'retro fashion tee', 'vintage lover apparel'
  ],
  christian: [
    'faith based gift', 'christian apparel tee', 'bible verse shirt',
    'church outfit gift', 'religious gift idea', 'easter sunday faith',
    'god is good shirt', 'worship outfit tee', 'christian mom gift',
    'prayer warrior tee', 'scripture graphic tee', 'faith walk shirt'
  ],
  nurse: [
    'nurse appreciation gift', 'rn graduation gift', 'healthcare worker tee',
    'medical professional gift', 'nursing school shirt', 'hospital staff gift',
    'scrub life tee', 'nurse life apparel', 'frontline hero shirt',
    'nurse birthday gift', 'medical field outfit', 'caregiver gift tee'
  ],
  autism: [
    'neurodiversity gift', 'autism awareness tee', 'special needs tee',
    'autism mom gift', 'inclusion tee gift', 'puzzle piece shirt',
    'sensory friendly tee', 'different not less', 'autism dad shirt',
    'neurodivergent pride', 'acceptance gift tee', 'spectrum aware tee'
  ],
  usa: [
    'fourth of july gift', 'patriot day shirt', 'american pride tee',
    'usa fan apparel', 'independence day tee', 'flag graphic shirt',
    'memorial day outfit', 'military support tee', 'red white blue shirt',
    'freedom graphic tee', 'america lover gift', 'patriotic outfit idea'
  ],
  funny: [
    'humor graphic tee', 'funny gift idea', 'sarcasm shirt gift',
    'witty apparel tee', 'joke shirt present', 'novelty gift shirt',
    'office humor gift', 'gag gift tee idea', 'comedy shirt present',
    'ironic tee gift', 'pun shirt apparel', 'laugh out loud tee'
  ],
  gaming: [
    'gamer gift idea', 'gaming apparel tee', 'video game shirt gift',
    'geek chic outfit', 'nerd culture tee', 'game fan apparel',
    'console gamer shirt', 'cozy gamer outfit', 'game night shirt',
    'pixel art tee gift', 'rpg fan apparel', 'game lover present'
  ],
  kpop: [
    'kpop fan shirt gift', 'concert merch tee', 'kpop graphic tee',
    'army fan apparel', 'korean music shirt', 'concert outfit idea',
    'kpop lover gift', 'fan merch apparel', 'music tour shirt',
    'concert fan tee', 'kpop group merch', 'idol fan gift tee'
  ],
  sportshockey: [
    'ice hockey fan tee', 'hockey player gift', 'game day apparel',
    'hockey season shirt', 'hockey mom gift tee', 'hockey dad apparel',
    'winter sports shirt', 'hockey fan apparel', 'rink life tee gift',
    'hockey lover gift', 'sports graphic shirt', 'hockey coach gift'
  ],
  pirates: [
    'pirate life shirt', 'adventure fan tee', 'nautical theme gift',
    'disney ride merch', 'theme park souvenir', 'pirate graphic tee',
    'swashbuckler shirt', 'disney park outfit', 'retro pirate tee',
    'adventure graphic tee', 'pirate fan apparel', 'theme park gift'
  ],
  general: [
    'wooden baby puzzle', 'montessori puzzle', 'baby shower gift',
    'first birthday gift', 'new baby gift', 'personalized baby toy',
    'sensory toddler toy', 'fine motor toy', 'educational baby toy',
    'handmade wood toy', 'gift for niece', 'gift for nephew',
    'baby keepsake gift', 'nursery decor gift', 'toddler wood puzzle',
    'unique baby gift', 'name puzzle gift', 'animal name puzzle',
  ]
};

function getTitleWords(title) {
  return (title || '')
    .toLowerCase()
    .split(/[\s,\-|\/]+/)
    .filter(w => w.length > 3);
}

function tagOverlapsTitle(tag, titleWords) {
  const tagWords = tag.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const matches = tagWords.filter(w => titleWords.includes(w));
  return matches.length >= 2;
}

function getCategory(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('disney') || t.includes('mickey') || t.includes('minnie') || t.includes('epcot') || t.includes('disneyland') || t.includes('mcqueen') && t.includes('pixar')) return 'disney';
  if (t.includes('easter') || (t.includes('bunny') && !t.includes('hockey')) || t.includes('peeps')) return 'easter';
  if (t.includes('patrick') || t.includes('irish') || t.includes('shamrock') || t.includes('paddy') || t.includes('leprechaun')) return 'stpatricks';
  if (t.includes('bts') || t.includes('kpop') || t.includes('k-pop') || t.includes('army fan') || t.includes('blackpink') || t.includes('stray kids')) return 'kpop';
  if (t.includes('pirate') || t.includes('caribbean') || t.includes('sparrow')) return 'pirates';
  if (t.includes('rivalry') || t.includes('hollander') || t.includes('rozanov') || t.includes('hollanov')) return 'hockey';
  if (t.includes('hockey') || t.includes('ice hockey') || t.includes('penalty box') || t.includes('puck')) return 'sportshockey';
  if (t.includes('mama') || (t.includes('mom') && !t.includes('common'))) return 'mom';
  if (t.includes('autism') || t.includes('neurodiv') || t.includes('inclusion') || t.includes('sped teacher')) return 'autism';
  if (t.includes('teacher') || t.includes('tiny humans')) return 'teacher';
  if (t.includes('cat') || t.includes('kitten')) return 'cat';
  if (t.includes('custom') || t.includes('personalized') || t.includes('personalize')) return 'custom';
  if (t.includes('vintage') || t.includes('retro')) return 'vintage';
  if (t.includes('christian') || t.includes('faith') || t.includes('risen') || t.includes('bible') || t.includes('pray') || t.includes('jesus') || t.includes('cross')) return 'christian';
  if (t.includes('nurse') || t.includes('nursing') || t.includes('medical') || t.includes('x-ray')) return 'nurse';
  if (t.includes('usa') || t.includes('patriotic') || t.includes('america') || t.includes('eagle')) return 'usa';
  if (t.includes('funny') || t.includes('meme') || t.includes('sarcastic') || t.includes('humor')) return 'funny';
  if (t.includes('gamer') || t.includes('gaming') || t.includes('stardew') || t.includes('pixel')) return 'gaming';
  return 'general';
}

function optimizeTags(listing) {
  const title = listing.title || '';
  const titleWords = getTitleWords(title);
  const category = getCategory(title);
  const pool = [...(TAG_POOLS[category] || []), ...TAG_POOLS.general];

  // Çöp tag'leri filtrele (sayılar, çok kısa, "query" gibi)
  const JUNK = ['query', 'search', 'undefined', 'null', 'none', 'n/a'];
  let cleanTags = (listing.tags || []).filter(tag => {
    if (!tag || tag.length < 3) return false;
    if (/^\d+$/.test(tag.trim())) return false;
    if (JUNK.includes(tag.toLowerCase().trim())) return false;
    return true;
  });

  const used = new Set();
  const result = cleanTags.map(tag => {
    used.add(tag);
    if (!tagOverlapsTitle(tag, titleWords)) return tag;

    for (const candidate of pool) {
      const c = candidate.substring(0, 20).trim();
      if (!tagOverlapsTitle(c, titleWords) && !used.has(c)) {
        used.add(c);
        return c;
      }
    }
    return tag;
  });

  // 13 tag'e tamamla
  for (const candidate of pool) {
    if (result.length >= 13) break;
    const c = candidate.substring(0, 20).trim();
    if (!used.has(c) && !tagOverlapsTitle(c, titleWords)) {
      used.add(c);
      result.push(c);
    }
  }

  return applyEtsy2026Tags(result, { title });
}

// HARD RULE: every mode must return at least 13 tags. Use this helper to top
// up tag arrays that came back short from AI / scrapers. Picks generic but
// shirt-relevant intent/audience phrases that fit almost any design.
const FALLBACK_TAGS = [
  'wooden baby puzzle', 'montessori puzzle', 'baby shower gift',
  'first birthday gift', 'new baby gift', 'personalized baby toy',
  'nursery decor gift', 'sensory toddler toy', 'fine motor toy',
  'educational baby toy', 'handmade wood toy', 'baby keepsake gift',
  'gift for niece', 'gift for nephew', '1st birthday boy',
  '1st birthday girl', 'toddler wood puzzle', 'animal name puzzle',
  'name puzzle gift', 'baby room decor', 'unique baby gift',
  'handmade nursery toy', 'gift for godchild', 'newborn gift idea',
];

function padTagsTo13(tags) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const t = String(raw || '').toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    if (!t || t.length < 3 || t.length > 20) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  (tags || []).forEach(push);
  if (out.length >= 13) return out.slice(0, 13);
  for (const f of FALLBACK_TAGS) {
    if (out.length >= 13) break;
    push(f);
  }
  return out.slice(0, 13);
}

// Baby puzzle build: Gildan apparel template removed. Gemini already writes the
// full multi-paragraph baby-puzzle description, so we only append a soft closing
// line if the intro didn't include one.
// Locked user-supplied description template — applied to every listing regardless
// of how it was generated. See memory/project_listing_template.md.
// The AI-generated intro is dropped; we always emit the same canonical body with
// the theme noun pulled from the title (best-effort) or a safe generic fallback.
const LOCKED_DESCRIPTION_TEMPLATE = `Personalized wooden baby name puzzle with colorful {theme-design} – a fun, educational toy that helps toddlers learn while playing.
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

function extractThemeFromTitle(title) {
  if (!title) return 'baby puzzle';
  // Strip the boilerplate "Personalized ... Name Puzzle, Wooden Baby ... Gift" and keep the theme noun.
  const m = title.match(/personalized\s+(.+?)\s+name\s+puzzle/i);
  if (m && m[1]) return m[1].toLowerCase().trim();
  // Fallback: take 1-3 words before "Puzzle"
  const m2 = title.match(/(\w+(?:\s+\w+){0,2})\s+puzzle/i);
  if (m2 && m2[1]) return m2[1].toLowerCase().trim();
  return 'baby puzzle';
}

function appendStyleTemplate(_intro, title) {
  const theme = extractThemeFromTitle(title);
  return LOCKED_DESCRIPTION_TEMPLATE
    .replace('{theme-design}', `${theme} design`)
    .replace('{theme-themed}', `${theme}-themed`);
}

module.exports = { generateDescription, appendStyleTemplate, padTagsTo13, optimizeTags, generateAltTexts, getCategory };
