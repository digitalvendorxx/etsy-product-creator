---
last_verified: 2026-04-27
sources_file: ./sources.md
---

# 07 - EHunt + Etsy SEO Tool Rules

## TL;DR - Winner per use case

| Use case | Best tool | Runner-up |
|---|---|---|
| Tag research | EHunt | eRank |
| Title optimization | eRank | EHunt |
| Competitor shop analysis | EHunt | Koalanda |
| Trend spotting | eRank | Marmalead |
| Free tier | eRank | EHunt |
| Best value paid | Koalanda ($5.99/mo annual) | eRank Basic ($5.99/mo) |

---

## EHunt deep dive

**Domain:** ehunt.ai (etsyhunt.com redirects to ehunt.ai since rebranding)

**Etsy connection method:** Chrome extension (primary). The extension overlays data directly on Etsy search/product/shop pages. No OAuth shop connection is required to use keyword/product research. OAuth shop connection is available for listing management features (title/description generation, listing optimizer, review invites).

**Database size (as of April 2026):**
- 71M product listings
- 14M tags
- 3.4M shops
- 2.3M ad listings

**Core features:**
- Keyword Tool - search volume, competition score, weekly sales estimate, favorites, views; longtail suggestions
- Product Research - filter by sales, favorites, reviews, price range; Top 100 items by category
- Shop Analyzer - top seller breakdown, estimated shop sales, listing count, rating
- Niche Finder - underdeveloped or trending categories
- Ad Analysis - competitor ad strategies
- Competitor Tracker - real-time monitoring once you pin a shop/product
- Chrome Extension - overlays product/shop stats while browsing Etsy; batch analysis across multiple listings
- Listing optimization suite (paid): title/description AI gen, mockup creation, review invitations
- Languages: English, Simplified Chinese, Turkish, German, French, Spanish, Italian, Portuguese (8 total)

**Pricing (verified Apr 2026 via chrismjackson.com comparison; exact tier names from goldcityventures review):**

| Plan | Monthly | Notes |
|---|---|---|
| Free | $0 | ~10 keyword searches/day, partial charts, basic product research |
| Basic | ~$3.99-$7.99/mo | Expanded search limits, full charts |
| Pro/Premium | ~$15.99-$19.99/mo | Full features, listing optimizer, AI tools |

UNVERIFIED: Exact tier prices were not retrievable from ehunt.ai/pricing (page loads dynamically). Range above is sourced from two independent reviews; confirm at ehunt.ai/pricing before quoting.

**Sales estimate methodology:**
EHunt's FAQ states: "Although Etsy does not directly disclose sales data, EHunt uses a complex algorithm that includes various indicators. Our algorithm maintains an average accuracy of about 80%."
- Algorithm inputs: reviews, favorites, listing updates, shop activity
- Data updated weekly
- Historical tracking: 3 months back for monitored products
- **Accuracy caveat: "80% accuracy" is a self-reported claim. Independent reviewers describe estimates as "directionally accurate (within 20-30%) but not exact." Use for competitive benchmarking only, not precise forecasting.**

---

## Competitor matrix

### eRank
- **Pricing:** Free / $5.99 / $9.99 / $29.99 per month (annual saves ~$25/yr on Pro)
- **Free tier:** 5 keyword lookups/day, 50 active listings, 1 keyword list - genuinely useful
- **Data source:** Etsy official API (confirmed; adapted to Etsy's new API pricing Aug 2025) + cross-marketplace trend data (Amazon, eBay, Google)
- **Connection method:** OAuth (connects your shop directly) + Chrome extension
- **Strengths:** Most comprehensive free tier in the market; bulk rank checking; competitor tracking (5 on Basic, 50 on Pro); seasonality data; regional search analysis; listing audits; active 300,000+ seller community
- **Weaknesses:** Cluttered interface; steep learning curve; search limits even on paid tiers (200 keyword searches/day on Pro); sales estimates are estimates, not actuals
- **Accuracy note:** Keyword data from Etsy API is reliable. Sales/revenue estimates are best-guess. One Reddit user noted ranking data "isn't really accurate on where your products rank."
- **Best for:** All-in-one platform, budget sellers, rank tracking, trend spotting

### Marmalead
- **Pricing:** $19/mo monthly / $16/mo annual / $5/mo lifetime ($300 one-time)
- **Free tier:** None (14-day trial only)
- **Data source:** Claims Etsy API; specifics not disclosed
- **Connection method:** OAuth
- **Strengths:** Predictive keyword forecasting (claims 95% accuracy 3 months ahead - UNVERIFIED independently); "Storm" brainstorm tool; seasonality graphs; beginner-friendly UI; recently added ChatGPT Shopping optimization
- **Weaknesses:** 3x price of eRank Basic; no competitor tracking or product research; reported user discrepancies between Marmalead search volume and Etsy internal stats; considered outdated vs. newer tools
- **Best for:** Seasonal product planning, creative keyword brainstorming, sellers earning $2k+/mo who want trend forecasting

### Sale Samurai
- **Pricing:** $9.99/mo or $99.99/yr (3-day free trial, no free tier)
- **Data source:** Etsy API (self-disclosed); "Real Etsy Search Data"
- **Connection method:** Chrome extension + Etsy API
- **Strengths:** Real Etsy search volume from API (most trustworthy volume data); long-tail keyword focus; CTR metrics; advanced filtering; downloadable results; strong for POD sellers managing bulk listings
- **Weaknesses:** No free tier; weaker product research vs. EHunt; no shop analytics beyond basics
- **Best for:** POD sellers, keyword volume accuracy, low-competition tag finding

### Alura
- **Pricing:** Free / $7.99 / $14.99 / $29.99 per month (up to 50% off annual)
- **Free tier:** 5 daily searches/tool, 10 listings to optimize - very limited
- **Data source:** "Millions of listings" - method not specified (likely scraping + modeling)
- **Connection method:** Chrome extension + OAuth for shop connection
- **Strengths:** 20+ metrics per listing including conversion rates; seasonality graph; Pinterest pinning automation; A/B testing; good for beginners
- **Weaknesses:** Free tier is too limited for real use; no direct Etsy API disclosure; weaker keyword depth vs. eRank
- **Best for:** Beginners wanting an all-in-one dashboard; sellers who want A/B testing

### Koalanda
- **Pricing:** Free (limited) / $11.99/mo / $9.99/mo quarterly / $5.99/mo annually ($71.88/yr)
- **Free tier:** Limited searches, limited features; unlimited marketplace browsing; 5 shops
- **Data source:** Etsy API (disclosed; "not endorsed by Etsy")
- **Connection method:** OAuth (connects up to 5 shops)
- **Strengths:** Best annual price ($5.99/mo) for unlimited searches; listing editor built-in (edit title/tags without leaving Koalanda); claims 89% listing sales accuracy and 90% keyword score accuracy; clean UX; unlimited searches on all paid tiers
- **Weaknesses:** Smaller user community; less known; accuracy claims are self-reported
- **Best for:** Budget-conscious sellers who want unlimited searches; shop management + SEO in one place

### EverBee (not in original brief but referenced widely)
- **Pricing:** Free (20 searches/mo) / $9.99 / $29.99 per month
- **Data source:** Etsy API + Chrome extension
- **Strengths:** 15+ listing metrics; conversion rate data; 195M+ listings; 57M+ keywords
- **Weaknesses:** Free tier nearly unusable (20 searches/month); expensive for full access
- **Best for:** Deep niche research in saturated categories (POD, jewelry, wall art)

---

## Data accuracy - what is actually known

| Tool | Sales estimate accuracy | Source of claim |
|---|---|---|
| EHunt | ~80% (self-claimed) | EHunt FAQ |
| Koalanda | 89% listing sales, 90% keyword score (self-claimed) | Koalanda site |
| EverBee | ~80% (cited in reviews) | Third-party reviews |
| eRank | Not disclosed; "estimates, not actuals" | eRank documentation |
| Marmalead | 95% trend forecast 3mo out (self-claimed, UNVERIFIED) | Marmalead site |
| Sale Samurai | Uses real Etsy search volume (API-sourced) | Self-disclosed |

**Key finding:** ALL tools' weekly sales estimates are modeled, not sourced from Etsy (Etsy does not share actual sales data via API). Models infer sales from review velocity, favorites, and listing age. Independent community consensus: estimates are directionally useful within ~20-30% but can be significantly off for individual listings. Never use a single tool's sales number as a planning figure - use it as a relative rank signal only.

---

## Aysham recommendation

**Primary tool: EHunt** - confirmed appropriate. Reasons:
1. Best free tier for tag research (10+ searches/day with full competition + score + weekly sales data)
2. Chrome extension workflow matches how Aysham uses it (browsing Etsy, checking competitor tags)
3. Largest proprietary product database (71M listings)
4. 8-language support (Turkish included - useful for TheAysham's market)
5. The specific criteria in existing workflow (LOW competition, HIGH score, LONGTAIL, HIGH weekly sales) map exactly to EHunt's keyword filter UI

**Secondary tool: eRank (free tier)**
1. Free and genuinely functional (5 lookups/day is tight but sufficient for spot-checking)
2. Etsy API-sourced keyword data = more reliable search volume than modeled estimates
3. Seasonality data helps plan for peak periods (Valentine's, Mother's Day, etc.)
4. Use eRank to validate EHunt's top tag picks - cross-reference search volume

**Do not add:** Marmalead (expensive, no free tier, no competitive advantage over EHunt for tag research). Sale Samurai only worth it if volume data accuracy becomes critical. Koalanda worth evaluating if annual plan ($5.99/mo) replaces eRank's free tier.

---

## Per-use-case workflows

### Opening a new listing (EHunt primary)

1. Generate a general keyword from the design (e.g. "funny cat sweatshirt")
2. Open EHunt > Keyword Tool > enter general keyword
3. Filter results: Competition = LOW, Score = HIGH
4. Sort by Weekly Sales DESC
5. Pick longtail candidates (2-3 words minimum; 20 chars max per Etsy tag rule)
6. Cross-check: are the tags actually relevant to the design? Remove any mismatch.
7. Select best 13 tags meeting all criteria
8. Spot-check top 2-3 tags in eRank free tier to confirm search volume is not zero
9. Finalize tags list; title comes from visual analysis of mockup (not from tags)

### Refreshing a stale listing (EHunt + eRank)

1. Pull the listing's current tags - note which are performing (use Etsy Stats)
2. In EHunt > Keyword Tool, search each current tag to check current competition + score
3. Identify any tags now showing HIGH competition or LOW score - these are candidates for replacement
4. Search for replacement longtail variants of underperforming tags
5. In eRank (free), check seasonality for the listing's top keywords - confirm you're not refreshing at seasonal peak (wait until off-peak to avoid disrupting momentum)
6. Swap out bottom 3-4 tags; keep top performers unchanged

### Scouting a competitor shop (EHunt Shop Analyzer)

1. EHunt > Shop Analyzer > enter competitor shop name
2. Review: estimated monthly sales, top listings by sales volume, tag patterns in top listings
3. EHunt Chrome Extension: navigate to competitor's top listing on Etsy > extension panel shows their tags in one click
4. Note tag patterns used by top sellers - feed these into Keyword Tool to check if they're worth adopting
5. Do not copy tags directly - use them as seed keywords for your own EHunt search

### Finding a new niche (EHunt Niche Finder + Product Research)

1. EHunt > Product Research > set Category to your product type
2. Filter: HIGH weekly sales, LOW competition rating, price range matching your product
3. Sort by favorites or weekly sales to surface trending items
4. Click into top listings > EHunt extension shows their tags
5. Feed winning tags into Keyword Tool to size the opportunity (check if longtail variants exist with LOW competition)
6. Validate with eRank seasonality: is this niche peaking now or growing?
7. Niche is viable if: longtail tags exist with LOW competition + >X weekly sales + relevant to a design you can produce

---

## Memory file verdict

Existing rule in `feedback_ehunt_tags_titles.md` is **confirmed correct**. EHunt remains the best primary tool for tag research for Aysham's workflow. The criteria already documented (LOW competition, HIGH score, LONGTAIL, HIGH weekly sales, HIGH favorites/views, RELEVANT) are the right filters. One addition recommended: cross-check top 2-3 final tags in eRank free tier to validate search volume from an API-sourced dataset.
