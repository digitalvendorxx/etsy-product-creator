---
last_verified: 2026-04-27
sources_file: ./sources.md
---

# 08 -- Aysham Daily / Weekly / Monthly Control Rhythm

---

## 1. TL;DR

| Cadence | Time | Core purpose |
|---|---|---|
| Daily | 10-15 min | Stay on top of messages, orders, and overnight stats |
| Weekly | 60-90 min | Performance review, SEO refresh, ads check, competitor scan |
| Monthly | 3-4 hr | P&L, listing audit, holiday prep, pricing, goals |

Etsy rewards consistent daily activity. Even 10 minutes of genuine engagement (replies, renewals, small edits) signals to the algorithm that the shop is active. Batch the heavier work into one weekly session rather than letting it bleed into every day.

---

## 2. Daily Checklist (10-15 min)

Run every morning, 7 days a week.

### Messages (3 min)
- [ ] Reply to all open buyer inquiries -- target under 24h, ideal under 4h
- [ ] Check for any cancellation or refund requests; action within 48h (Etsy Purchase Protection rule as of May 7, 2026)
- [ ] Scan for any negative or neutral review alerts

### Orders (2 min)
- [ ] Confirm all Printify/Printonami orders dispatched; no stuck orders
- [ ] Flag any "in production" orders older than 3 business days for follow-up with supplier

### Stats glance (5 min)
Open Etsy Stats > Today and Yesterday. These are the only numbers to scan daily:

| Metric | Action trigger |
|---|---|
| Views | Drop >40% vs same weekday last week -- check for a delisted/deactivated listing |
| Visits | Drop >40% vs same weekday last week -- same action |
| Orders | 0 for 3+ consecutive days -- run weekly checklist early; check listing status |
| Conversion rate | Below 1% for a week -- flag top-traffic listings for optimization |
| Messages | Any unread > 12h old -- reply immediately |

### Quick action (2 min)
- [ ] Renew 1-2 listings that are about to expire (Etsy auto-renews at $0.20 but manual renewal on a slow listing signals activity)
- [ ] If a listing got a sale overnight, pin it / share it to social (takes 30 sec)

---

## 3. Weekly Checklist (60-90 min)

Run once per week -- Sunday evening or Monday morning works best (resets the week).

### Listing performance review (20 min)
- [ ] Open Etsy Stats > Listings > Sort by views (last 30 days)
- [ ] Identify top 5 listings by views -- are they converting? If views are high but conversion < 1%, fix images or price
- [ ] Identify bottom 5 listings by views -- no views in 30 days = candidate for tag/title refresh or archive
- [ ] Archive any listing with 0 sales and 0 views for 60+ consecutive days (Dylan Jahraus rule: kill 2-month-old dead listings)

### SEO refresh (15 min)
- [ ] Pick 3-5 underperforming listings
- [ ] Run each through eHunt (`node lib/scrape-tags-etsyhunt.js` or ask Claude to run an eHunt tag research session)
- [ ] Update titles and tags per `../07-ehunt/rules.md` -- low competition, high weekly sales, no keyword repetition (>30-40% same lead word)

### Ads review (10 min) -- only if ads are running
- [ ] Open Etsy Ads dashboard
- [ ] Check spend vs revenue this week -- compute ROAS (revenue / spend); minimum profitable ROAS for POD apparel ~4x (see `../04-etsy-ads/rules.md`)
- [ ] Pause any listing with >$3 spend and 0 clicks in 7 days
- [ ] Pause any listing with >$5 spend and 0 sales in 14 days
- [ ] Do NOT increase daily budget mid-week; wait for a full 7-day cycle

### Competitor scan (10 min)
- [ ] Search 2-3 of your main keywords on Etsy
- [ ] Note top 3 competitor listings: price, image style, new designs introduced this week
- [ ] If a competitor dropped price on a near-identical item, decide: match, differentiate, or ignore

### Supplier / fulfillment check (5 min)
- [ ] Log into Printify/Printonami -- any production delays flagged?
- [ ] Check for any new product additions (new blanks, mockup updates) that could be used for new listings

### New listings (10 min minimum)
- [ ] Create or queue at least 1-3 new listings per week (consistent publishing feeds Etsy's freshness signal)
- [ ] Base new designs on this week's top-selling or most-viewed category
- [ ] Use `npm run create` (node create.js) to run the full pipeline: design -> mockup -> tags -> upload

### Stats deep dive (10 min)
- [ ] Etsy Stats > Traffic sources: is search still dominant? Any unusual spike from social/external?
- [ ] Etsy Stats > Search terms: what keywords are buyers using to find you? Add any new relevant terms to listings
- [ ] Week-over-week orders: up, flat, or down? Note reason if known (season, holiday, algorithm shift)

---

## 4. Monthly Checklist (3-4 hr)

Run on the 1st of each month, or last Sunday of the month.

### P&L (60 min)
- [ ] Open `../05-profit-loss/rules.md` for the full calculation template
- [ ] Pull Etsy Finances > Monthly statement (CSV export)
- [ ] Calculate: Revenue - Etsy fees (6.5% transaction + $0.20/listing + payment processing ~3%) - COGS (Printify cost) - Ads spend = Net profit
- [ ] Target net margin for POD apparel: >20%. Below 15% = pricing review required
- [ ] Log result in a running spreadsheet (or ask Claude to compute from the CSV)

### Listing audit (45 min)
- [ ] Full listings export: Etsy Shop Manager > Listings > Export
- [ ] Identify listings by quadrant:
  - High views + high conversion = protect, double down (never change what works)
  - High views + low conversion = fix images, price, or description
  - Low views + high conversion = SEO problem, refresh title/tags
  - Low views + low conversion = archive candidate
- [ ] Archive anything with 0 sales in 90+ days and no views trend
- [ ] Plan 5-10 new listings for next month based on top performers

### Holiday prep (30 min)
- [ ] Open `../06-us-holidays/rules.md` for the full holiday calendar and lead times
- [ ] Identify which US holidays fall in the next 6 weeks
- [ ] Confirm holiday-specific listings exist and are active
- [ ] Check banner calendar (`/Users/Lenovo/etsy-product-creator/banner-calendar.json`) for scheduled banner changes
- [ ] If a seasonal banner is due, design in Canva, get approval, then run `node upload-banners-v3.js`

### Pricing review (30 min)
- [ ] For each listing, recalculate: COGS + Etsy fees + target margin
- [ ] Standard POD apparel pricing floor: COGS x 3.5 (to clear 20% net after all fees)
- [ ] Compare to top 5 competitors on your main keywords -- are you priced competitively or underpriced?
- [ ] Adjust prices on 3-5 listings as needed; never change more than 20% of the catalog at once

### Photo refresh decisions (20 min)
- [ ] Review mockup quality on top 10 listings (open on mobile -- that is where most buyers browse)
- [ ] Flag any listing with an off-angle design, white background visible on dark shirt, or low-resolution mockup
- [ ] Queue flagged listings for mockup regeneration: `node regen-mockups.js` or `node fix-mockups.js`
- [ ] Apply 80% opacity rule for sublimation designs (see memory: sublimation opacity rule)

### Goals for next month (15 min)
- [ ] Set one revenue target (e.g., $X in sales)
- [ ] Set one operational target (e.g., "publish 12 new listings," "run ads test on 3 listings")
- [ ] Write it down -- even a single line in a notes file is sufficient

---

## 5. Claude Commands Map

These are real scripts and prompts that exist today. Do not invent commands that are not listed here.

### Daily tasks

| Task | What to do |
|---|---|
| Reply to messages | Manual in Etsy -- no automation exists for this |
| Check stats | Manual in Etsy Stats dashboard |
| Renew a listing | Manual in Etsy -- or run `node fix-listing.js` if there is a bulk fix needed |

### Weekly tasks

| Task | Command / prompt |
|---|---|
| Scrape tags for a listing | `node lib/scrape-tags-etsyhunt.js` (requires eHunt session) |
| Create a new listing end-to-end | `npm run create` or `node create.js --ref <design-file> --title "..."` |
| Regenerate mockups for a listing | `node regen-mockups.js` |
| Fix tags in bulk | `node fix-tags-v3.js` |
| Audit shop sections | `node audit-shop.js` |
| Check alt texts on listings | `node check-alt-texts.js` |
| Upload a new banner | `node upload-banners-v3.js` |
| Diagnose a specific listing | `node diag-listing.js` |

### Monthly tasks

| Task | Command / prompt |
|---|---|
| P&L calculation | Ask Claude: "Compute my monthly P&L from this Etsy CSV: [paste]" (no dedicated script exists yet) |
| Full mockup refresh on a batch | `node fix-mockups.js` |
| Pin all listings to Pinterest | `node pin-all.js` |
| Check live banners | `node check-live-banners.js` |

### Claude prompts (no script needed)

- Tag research: "Run eHunt tag research for this listing: [title]. Return low-competition, high weekly sales, longtail tags per etsy-rules/07-ehunt/rules.md."
- Description rewrite: "Rewrite this listing description using the model in memory: Etsy T-Shirt Description Model."
- P&L: "Given these Etsy fees and Printify costs, compute my net profit and margin for [month]."
- Holiday prep: "What US holidays are in the next 6 weeks and what listings should I have active? Reference etsy-rules/06-us-holidays/rules.md."

---

## 6. Automation Roadmap

### What is automated today
- Full listing pipeline: design generation (Gemini), mockup composition (Sharp), tag scraping (eHunt via Playwright), upload to Etsy (Playwright) -- `create.js`
- Mockup regeneration and fixes -- `regen-mockups.js`, `fix-mockups.js`
- Banner generation and upload -- `generate-banners.js`, `upload-banners-v3.js`
- Tag bulk-fix -- `fix-tags-v3.js`
- Pinterest pinning -- `pin-all.js`, `lib/pin-to-pinterest.js`
- Shop section management -- `reorganize-sections.js`, `check-sections.js`
- Alt text filling -- `fill-alt-texts.js`
- Shop audit (sections, listing counts) -- `audit-shop.js`

### What to build next (prioritized)

1. **Daily stats pull to terminal** (`daily.js`) -- Fetch yesterday's views/visits/orders/revenue via Etsy API or Playwright scrape and print a formatted summary. Would replace the 5-min manual stats glance. Medium effort, high daily value. (Noted in README.md TODO.)

2. **Listing performance ranker** -- Weekly script that pulls all listing stats (views, favorites, sales, conversion rate) and outputs a sorted table with top-10 / bottom-10 + action recommendations. Would automate the 20-min weekly review. High effort, high weekly value.

3. **Auto-renew slow listings** -- Script that identifies listings with no views in 14 days and renews them. Low effort, consistent daily signal value.

4. **P&L calculator from Etsy CSV** -- Script that reads the monthly Etsy statement CSV and outputs net profit after fees and COGS. Medium effort, replaces manual monthly calculation.

5. **Competitor price monitor** -- Playwright script that scrapes top 3 results for a given keyword weekly and logs prices. Medium effort, automates the 10-min weekly competitor scan.

---

## 7. Visual Dashboard Concept

A single-pane daily dashboard (terminal or simple HTML served by `server.js`) would show:

```
AYSHAM ETSY DASHBOARD  --  2026-04-27

MESSAGES        2 unread (oldest: 8h ago)    [ACTION NEEDED]
ORDERS          3 in production, 0 delayed   [OK]
STATS (today)   Views: 142  Visits: 89  Orders: 2  Rev: $38.40
vs last Monday  Views: +12%  Visits: +8%  Orders: +1

TOP LISTING     "Funny Mom Shirt" -- 41 views today
BOTTOM LISTING  "Dog Dad Tee" -- 0 views (14 days)  [RENEW?]

ADS             Spend: $1.20  Revenue: $19.00  ROAS: 15.8x  [OK]

NEXT HOLIDAY    Mother's Day (May 11) -- 14 days away  [PREP?]
BANNER STATUS   Current: Spring sale  Next: Mother's Day (May 8)
```

What it would need:
- Etsy Stats API or Playwright scrape for views/visits/orders
- Etsy Conversations API for message count
- Printify API for production status
- Etsy Ads dashboard scrape for ROAS
- `banner-calendar.json` for next banner event
- `../06-us-holidays/rules.md` for next holiday countdown

None of this is built today. The `server.js` (Express) already runs and could serve this as an HTML page at `localhost:3000/dashboard` once the data fetching is wired up.
