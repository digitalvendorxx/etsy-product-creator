# Sources -- 08 Daily Control

last_verified: 2026-04-27

---

## Primary sources used

### Dylan Jahraus
- **"My Etsy Productivity Routine Explained (Just Copy Me)"** -- dylanjahraus.com/my-etsy-productivity-routine-explained-just-copy-me/
  - Daily breakdown by day of week; 3 listings/week target; kill 2-month-old dead listings rule; top-10/bottom-10 weekly review; Pinterest 80-100 pins/week target
- **"Episode 183: My Exact Weekly Strategy for $10,000/m on Etsy"** -- dylanjahraus.com/episode-183-my-exact-weekly-strategy-for-10000-m-on-etsy/
  - Day-by-day time allocations; ROAS and conversion tracking; A/B thumbnail testing; mobile optimization audit on Tuesdays; "kill listings with 0 sales after 2 months" rule

### Insight Agent (insightagent.app)
- **"Etsy To-Do List: Weekly & Monthly Checklist"** -- insightagent.app/guides/etsy-to-do-list
  - Structured daily/weekly/monthly checklist; 24h message response threshold; "archive listings unsold 4+ months" threshold; 4-6 week advance supply ordering rule

### CraftyPayout
- **"Successful Etsy Seller: The 7 Daily Habits That Drive Results"** -- craftypayout.com/7-daily-habits-successful-etsy-seller/
  - Morning market intelligence (15 min); financial tracking 10 min/day; total daily routine ~110 min benchmark

### Etsy Seller Handbook
- **"Five Shop Stats You Should Be Tracking"** -- etsy.com/seller-handbook/article/22398388701 (fetch returned 403; information drawn from cached knowledge and search snippet)
  - Views, visits, orders, conversion rate, revenue as the five core Etsy stats

### Existing Aysham automation (etsy-product-creator/)
- `create.js` -- full pipeline: design -> mockup -> tags -> upload
- `lib/scrape-tags-etsyhunt.js` -- eHunt tag scraping
- `fix-tags-v3.js`, `fix-tags-v2.js`, `fix-tags.js` -- bulk tag fixes
- `regen-mockups.js`, `fix-mockups.js` -- mockup regeneration
- `upload-banners-v3.js` -- banner upload
- `pin-all.js`, `lib/pin-to-pinterest.js` -- Pinterest pinning
- `audit-shop.js`, `audit-shop2.js` -- shop auditing
- `check-alt-texts.js`, `fill-alt-texts.js` -- alt text management
- `diag-listing.js` -- listing diagnostics
- `check-sections.js`, `reorganize-sections.js` -- section management
- `server.js` -- Express server (base for future dashboard)
- `banner-calendar.json` -- scheduled banner events
- `package.json` scripts: `start`, `create`, `browser`, `dev`

### Cross-referenced etsy-rules files
- `../04-etsy-ads/rules.md` -- ROAS formula (break-even ~3.33x for 30% margin POD; target 4x+)
- `../05-profit-loss/rules.md` -- monthly P&L template
- `../06-us-holidays/rules.md` -- US holiday calendar and lead times
- `../07-ehunt/rules.md` -- tag research rules (low competition, high weekly sales, longtail)

### Memory files referenced
- `feedback_sublimation_opacity.md` -- 80% opacity on mockups
- `feedback_etsy_description_model.md` -- description template
- `feedback_ehunt_tags_titles.md` -- eHunt tag research rules
- `feedback_avoid_keyword_repetition.md` -- no >30-40% same lead word
- `project_etsy_purchase_protection.md` -- 48h reply rule, May 7 2026

---

## Notes on source reliability

- Dylan Jahraus figures ($10K/month strategy, $1.8M lifetime) are from a high-volume seller with digital + physical products; time allocations may be higher than Aysham needs at current shop size. The structure (daily cadence, top/bottom listing reviews, kill thresholds) is sound regardless of scale.
- CraftyPayout "340% higher conversion rates" and "150% revenue increase" statistics are not independently verified. Treated as directional only.
- Etsy Seller Handbook content (stats article) was blocked at fetch time; content synthesized from training knowledge and search snippets.
- All automation commands verified against actual files in `/Users/Lenovo/etsy-product-creator/` on 2026-04-27.
