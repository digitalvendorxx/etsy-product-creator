---
last_verified: 2026-04-27
sources_file: ./sources.md
---

# 04 -- Etsy Ads: Operating Rules

> Cross-reference: Section 11 of `01-how-etsy-works/rules.md` has the basic Etsy Ads vs. Offsite Ads comparison table. This file adds strategy depth, tools, API status, and Aysham-specific recommendations.

---

## 1. TL;DR

- Do NOT start ads before a listing has proven organic traction. Ads amplify what already works; they do not fix broken listings.
- Start with $1/day per proven bestseller. Run 30 days before any evaluation.
- Break-even ROAS = 1 / gross margin. For POD apparel at ~30% margin the break-even is 3.33x -- meaning you need 4x+ ROAS to actually profit.
- Etsy's Open API has zero ads endpoints. Every third-party "ads optimizer" either uses the official API for shop/listing data only, or uses Chrome extension scraping on your dashboard session.
- Offsite Ads: if margins are under 25%, opt out while you still can. Once you hit $10k lifetime the opt-out is gone forever.

---

## 2. Ads Readiness Checklist

Before turning on a single dollar of Etsy Ads, verify all of the following:

| Check | Why it matters |
|---|---|
| Shop is at least 15 days old | Hard technical requirement; Etsy blocks ads before day 15 |
| Listings have SEO complete (all 13 tags, keyword-first title, full attributes) | Etsy Ads placement is built on the same relevance signals as organic search; poor SEO = poor ad placement even when paying |
| At least 3 listings have recorded organic sales (not just views) | Ads amplify conversion rate; a listing that converts organically at even 1-2% will improve with ad spend; one that has never converted organically will likely not convert with paid traffic either |
| Each listing to be advertised has high-quality images (2,000px+, no text overlays, no watermarks, no cluttered backgrounds) | External advertising platforms (Google, Facebook) prohibit promotional text on images; Etsy also flags substandard images for lower placement |
| You have calculated the break-even ROAS for each listing | Without this number you cannot tell if a campaign is profitable even when it appears to be "working" |
| Return policy is set (even "no returns") | Affects organic ranking AND signals listing quality to the ad system |

**Recommended pre-ad minimum:** 10+ active listings, at least 3 with organic sales, shop age 30+ days. The 15-day requirement is the hard floor; 30 days is practical minimum.

---

## 3. Budget Formula

### Starting budget

| Shop stage | Recommended daily budget | Logic |
|---|---|---|
| New / testing | $1/day per advertised listing | Enough data to learn; low waste risk. 5 listings = $5/day cap. |
| Growing (some organic sales) | $3/day per top listing | Boost proven converters; stay within 3-5% of daily revenue |
| Scaling | Up to $5-10/day per top listing | Only after >30 days of data showing ROAS above break-even |

### Revenue-based rule of thumb (community standard, UNVERIFIED by Etsy officially)

Spend roughly 10-20% of your target revenue on ads during growth phase. If your shop makes $500/month organically and you want $700, a $20-40/month ad budget ($0.65-1.35/day) is a reasonable starting point.

### Scaling warning

Etsy uses a machine-learning bidding system. Doubling your daily budget overnight resets the learning curve and frequently causes a temporary efficiency drop. Scale in increments of 25-50% per week maximum.

### Budget cap note

New shops are capped at $25/day maximum by default. Etsy recalculates and may raise this cap over time based on seller history.

---

## 4. Listing Selection

### Which listings to advertise

**Tier 1 -- Advertise first:**
- Listings with existing organic sales (proven converters)
- Price point $20+ (lower-price listings rarely generate enough revenue per click to cover CPC costs profitably)
- High-margin items (digital downloads, designs with 50%+ margin)

**Tier 2 -- Advertise after Tier 1 is profitable:**
- New listings you believe have strong potential, run for 30 days to gather initial data
- Seasonal items during their relevant window (4-6 weeks before peak)

**Never advertise (pause or exclude):**
- Listings with zero organic sales after 90 days and multiple organic impressions
- Any listing where ads spending exceeds 30% of the listing's revenue over the trailing 30 days with no conversion improvement trend
- Listings with policy flags or image quality issues

### 80/20 principle

75% of ad spend should concentrate on 25% of listings (your proven bestsellers). Spreading budget evenly across an entire catalog is the most common waste pattern.

---

## 5. Bid Management

### Auto vs. manual bids

Etsy removed manual per-listing bid controls in 2019. The platform now uses full automated bidding. "Manual" bid input (where it still appears) is treated as a target/cap signal, not an exact price. Etsy's contextual bidding system (neural network-based, verified 2026-04-27) adjusts bids in real time based on:
- Time of day and day of week
- Device type (desktop vs. mobile)
- Buyer's browsing history and intent signals
- Listing's expected conversion probability

### Practical bid strategy

Since sellers cannot set true manual bids, the levers you actually control are:
1. Which listings receive budget (inclusion/exclusion)
2. Daily budget per listing or shop-wide cap
3. Image and listing quality (these affect your quality score and thus effective CPC)

High CTR listings get lower CPC over time because Etsy's system bids less for placements where your listing already earns clicks without premium bids. Improving CTR (better main image, first 3 words of title) is the most effective "bid reduction" tactic available.

---

## 6. Performance Evaluation

### Evaluation windows

| Phase | Action |
|---|---|
| Days 1-30 | Do not pause or adjust. Let the algorithm learn. Gathering baseline data. |
| Day 30-60 | First evaluation. Use the metrics below to decide which listings to keep, scale, or cut. |
| Weekly after day 60 | Review top spenders. Reallocate budget from underperformers to overperformers. |

### Metrics thresholds

| Metric | Action trigger |
|---|---|
| ROAS below break-even after 30 days spend | Pause the listing |
| CTR below 1% consistently | Fix the main image or title before continuing to spend |
| ROAS 2x break-even+ consistently | Scale up: increase daily budget by 25-50% |
| Cost per click rising week over week | Reduce budget slightly; check whether category competition has increased |

### ROAS benchmarks by category

| Category | Typical margin | Break-even ROAS | Target ROAS to profit |
|---|---|---|---|
| Digital downloads | 85-95% | 1.05-1.18 | 2.0+ |
| Handmade jewelry | 50-70% | 1.43-2.00 | 3.0+ |
| Vintage items | 40-60% | 1.67-2.50 | 3.5+ |
| Print-on-demand apparel | 25-35% | 2.86-4.00 | 4.5-5.0+ |
| Craft supplies | 35-50% | 2.00-2.86 | 4.0+ |

**Platform average ROAS** (across all categories): ~2.9 (UNVERIFIED by Etsy directly; from third-party aggregators, 2026).

**Warning for POD sellers:** A 4x ROAS with 30% margin yields approximately 20% net profit after Etsy fees + ad spend combined. This is viable but tight. A 3x ROAS with 30% margin means you are spending more on ads than you profit from those sales.

### Break-even ROAS formula

```
Break-even ROAS = 1 / Gross Profit Margin
```

Example: $25 shirt, $15 production + Etsy fees, $10 gross profit = 40% margin -> break-even ROAS = 1 / 0.40 = 2.5. Any ROAS below 2.5 loses money on that listing.

---

## 7. Offsite Ads Decision

> Full cross-reference: `01-how-etsy-works/rules.md` section 11. Summary here with decision logic added.

### Fee structure recap

- Under $10k lifetime sales: enrolled by default, 15% fee per attributed order, **can opt out**
- Over $10k lifetime sales: mandatory forever, 12% fee per attributed order, **cannot opt out**
- Attribution window: 30 days after click
- Fee cap: $100 per transaction
- Fee applies to: item price + shipping + gift wrap (full order value)

### Opt-out decision matrix

| Scenario | Recommendation |
|---|---|
| Margins under 25% | Opt out immediately. At 15% Offsite Ads fee + 6.5% transaction + processing fees, you can lose money on every attributed sale. |
| Margins 25-40%, under $10k sales | Consider opting out. Test: calculate if a $100 sale attributed to Offsite Ads leaves you a profit after all fees stacked. |
| Margins 40%+ | Opt in. Offsite Ads are effectively a performance-based marketing channel; you only pay when a sale happens. |
| Already at or near $10k in lifetime sales | Critical decision point. If you opt out now before hitting $10k and later hit $10k, you will be re-enrolled permanently at the 12% rate. If you opt in and stay in, the rate drops to 12% once you hit $10k. |
| Running your own Google/Meta ads on the same listings | Consider opting out to avoid bidding against yourself and paying Etsy 15% on a conversion you drove yourself (UNVERIFIED that this scenario is common, but the logic is sound). |

### Opt-out logistics

- Path: Shop Manager -> Settings -> Offsite Ads -> turn off
- Effect takes up to 3 business days
- If a buyer clicked an offsite ad before opt-out took effect, you are still charged the fee if they purchase within the 30-day attribution window

---

## 8. Tool Comparison

### Native Etsy tools

| Tool | What it does | Cost | Limitation |
|---|---|---|---|
| Etsy Ads dashboard | View clicks, spend, ROAS per listing; start/pause ads; set daily budget | Free (built-in) | No export; no automation; 30-day default view |
| Etsy Ads performance report | Downloadable CSV of listing-level ad performance | Free (built-in) | Manual download required; no scheduling |

### Third-party tools

| Tool | Ads feature | Data method | Pricing (2026) | Honest assessment |
|---|---|---|---|---|
| **Alura** | Ads optimizer: auto-pauses underperforming listings based on rules you set (e.g., "spent $10 with 0 revenue"), one-click batch optimization, detailed action report | Official Etsy API for shop/listing data; Chrome extension for dashboard session access | Free plan (limited); Growth $9.99/mo annual / $19.99/mo monthly; Pro $29.99/mo annual / $49.99/mo monthly | Most feature-complete ads automation for Etsy sellers. Genuine time-saver for shops with 50+ advertised listings. Worth the Pro tier if ads budget >$200/mo. |
| **eRank** | No dedicated ads management feature; provides keyword and competitor data useful for pre-ad SEO optimization | Etsy API + own crawling | Free; Basic $5.99/mo; Pro $9.99/mo; Expert $29.99/mo | Good for SEO before ads; no ads automation |
| **Marmalead** | No ads management; keyword research and listing grading | Own data + Google Keyword Planner | $19/mo or $15.83/mo annual | 95% accuracy on 30-day keyword forecasts (their claim, UNVERIFIED independently). No ads features. |
| **Sale Samurai** | No dedicated ads management; tag and competitor analysis | Etsy API + own data | $9.99/mo flat | All-in-one SEO; no ads automation |
| **eHunt / EtsyHunt** | No ads management; product research and keyword tools | Etsy API + crawling | Free; Basic $3.99/mo; Premium $19.99/mo | Good for product research; no ads features |
| **EtsyOptimizer** | Claims ad optimization capability; limited documentation available | UNVERIFIED (likely Chrome extension-based scraping) | UNVERIFIED | Cannot confirm claims without direct testing |

**Summary:** Only Alura has a meaningful, documented Etsy Ads optimization feature. The others are SEO/keyword tools useful before you start ads, not during.

**Best free option:** eRank (keyword research to optimize listings before advertising)
**Best paid option:** Alura (ads automation + comprehensive shop management)
**Manual alternative:** Weekly review of Etsy's built-in ads CSV export + spreadsheet tracking. Sufficient for shops with under 30 advertised listings and under $100/month ad spend.

---

## 9. Etsy Open API: Ads Capabilities

**Official answer: Zero ads endpoints exist in the Etsy Open API v3 (verified via GitHub discussion, 2026-04-27).**

What the API does expose (relevant to ads research):
- Shop data: shop stats, listing counts, revenue signals
- Listings: inventory, titles, tags, prices -- useful for SEO optimization before running ads
- Transactions/receipts: order data -- useful for offline ROAS calculation if you build your own tracking
- Ledger entries: gross ad spend can be estimated by summing `prolist` and `offsite_ads_fee` entries in the payment ledger (this is a workaround, not an official feature)

What the API does NOT expose:
- Listing-level ad spend
- Listing-level ad clicks or impressions
- Ad campaign management (start/pause/budget)
- ROAS data at any granularity

Community feature requests for ads endpoints have been open since August 2023 (GitHub discussion #1082) with no official Etsy response as of May 2025. Etsy's apparent position is that it retains full control over advertising data and does not want third parties to automate ad management outside of the platform.

**Implication for TheAysham:** Any automation tool claiming to manage Etsy ads must be doing so via a Chrome extension that acts on your browser session (scraping the Etsy Ads dashboard on your behalf, not via API). This is technically against Etsy's ToS in most interpretations, though Alura's product appears to operate at the boundary of what Etsy tolerates.

---

## 10. Expert Stances (X / YouTube)

### English-language experts

**Nancy Badillo (@NancyBadillo13)** -- Etsy coach since 2017, $60k+ in year 2 on Etsy:
- Start with $1-2/day budget
- Do not run ads on new listings in their first month; gather organic data first
- Focus ads on best-sellers with high clicks, likes, and past sales
- Monitor daily; pause consistently underperforming campaigns
- No specific ROAS formula in her public content

**Dylan Jahraus** -- $1.8M+ lifetime Etsy sales; notable position: "How I Make $50,000+/Mo on Etsy With NO ADS." His content de-emphasizes paid ads in favor of organic SEO and product research. His X posts were not fetchable (login wall). X handle needs manual review.

**Starla Moore (@AlphaStarla / Handmade Alphas)** -- eRank manager and Etsy SEO expert. Primary focus is organic SEO and trend-based product strategy; specific ads advice not retrievable from public content. X handle searchable but content behind login wall. X handle needs manual review.

**Cody Berman (Gold City Ventures)** -- Focuses on digital/printable products on Etsy. High organic margin in digital products means break-even ROAS is much lower than for physical products. Specific X ads content not found.

### Turkish experts

**Mesut Berkant Yigit (@mberkantyigit)** -- Active on X; posts cover Etsy shop setup, digital products. Specific ads strategy content not found in public X posts. X handle needs manual review.

**Selimhan Tokgoz, Bahattin Duran** -- X handles not located via search. YouTube content exists but specific ads strategy content not retrieved. Needs manual review on their YouTube channels directly.

**General Turkish community consensus (from becommer.com and kureselis.com):**
- Etsy Offsite Ads is frequently discussed as a pain point for Turkish sellers due to the 15% fee stacking on top of Turkey's 2.27% Regulatory Operating Fee and payment processing
- Common advice: opt out of Offsite Ads if margins are under 30% (Turkish seller context where production costs are often different)

---

## 11. TheAysham-Specific Recommendations

TheAysham is a POD/print shop (t-shirts, apparel, sublimation designs). Applied rules:

**1. Ad readiness check first:**
Before any ad spend, verify: (a) listings have all 13 tags using eHunt-researched longtail keywords, (b) main image is high-quality mockup with no text overlays or watermarks, (c) listing has at least 1 organic sale or 200+ organic impressions with strong CTR (>1%).

**2. Start budget:**
$1/day on each listing with at least 1 organic sale. If 5 listings qualify, total = $5/day. Do not advertise listings that have not yet sold organically.

**3. ROAS target for POD apparel:**
At typical POD t-shirt margins (~30-35%), break-even ROAS is approximately 2.86-3.33x. Target 4.5x+ to actually profit after Etsy's 6.5% transaction fee, payment processing (~3%), and ad cost are all stacked. If a listing cannot sustain 4.5x ROAS after 60 days, pause it and redirect budget.

**4. Offsite Ads decision:**
If TheAysham is under $10k lifetime sales: opt out if margin per shirt after all Etsy fees is under $7 (for a $25 shirt). The 15% Offsite Ads fee on a $25 shirt = $3.75 fee, which on top of ~$5 in other Etsy fees leaves minimal or no profit at typical POD production costs. Run the math per specific product before deciding.

**5. Evaluation cadence:**
- Days 1-30: no changes, collect data
- Day 30: export CSV, calculate ROAS per listing
- Day 60: first serious cull -- pause everything below 3x ROAS; scale listings above 5x ROAS by +$1/day
- Weekly after day 60: 15-minute review of top 5 ad spenders

**6. Tools:**
Use eHunt (free) for keyword research before advertising. If monthly ad spend exceeds $100, consider Alura Growth plan ($9.99/mo annual) for its one-click ads optimizer. Manual weekly CSV review is sufficient below $100/month.

**7. Do not advertise during:**
First week of a new listing (let Etsy gather organic data). Active discounts/sales campaigns (conversion rate will look inflated; hard to read true ad performance).
