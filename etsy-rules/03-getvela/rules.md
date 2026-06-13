---
last_verified: 2026-04-27
sources_file: ./sources.md
---

# Getvela (Vela) — Operating Rules

## 1. TL;DR

Vela (marketed at getvela.com) is a web-based SaaS listing management platform for Etsy, Shopify, eBay, and Faire. Its core value is bulk editing hundreds of listings at once — titles, tags, prices, descriptions, shipping profiles — plus AI-assisted optimization and photo tools, all from a single dashboard without installing any browser extension.

Note on naming: The product is called "Vela." The domain is getvela.com (and getvela.ai for the help center). There is no separate product called "Getvela" — it is the same product. An older incarnation existed before the current AI-era relaunch; the current version (2024-present) is substantially rebuilt with AI features.

---

## 2. Pricing (verified 2026-04-27)

Pricing scales with total listing count (active + inactive + expired all count).

| Listings | Lite/mo | Plus/mo |
|----------|---------|---------|
| 0-250    | ~$10    | — |
| 0-500    | $29.95  | $39.95 |
| 501-1K   | $34.95  | $44.95 |
| 1K-2.5K  | $39.95  | $49.95 |
| 2.5K-5K  | $44.95  | $54.95 |
| 5K-7.5K  | $49.95  | — |
| 7.5K-10K | $54.95  | — |
| 10K+     | contact for quote | — |

- Billing: monthly only, no annual option. Cancel anytime.
- Multi-shop discount: 20% off all additional shops connected to one account.
- Free trial: 7 days, all features, no credit card required.
- Starting price note: one source lists $10/month for up to 250 listings; the main pricing page shows $29.95 for 0-500. The $10 tier may be a legacy or introductory tier — UNVERIFIED whether it still exists.

---

## 3. Capabilities Matrix

### Lite vs Plus

| Feature | Lite | Plus |
|---------|------|------|
| Listing creation | Yes | Yes |
| Individual listing edit | Yes | Yes |
| Bulk edit (title, tags, price, description, shipping, variations) | Yes | Yes |
| Listing scoring (quality score) | Yes | Yes |
| CSV import / export | Yes | Yes |
| Copy listings across shops/channels | Yes | Yes |
| Merge listings | Yes | Yes |
| Schedule publish | Yes | Yes |
| Multi-shop management | Yes | Yes |
| Profiles (saved templates) | 5 max | Unlimited |
| AI bulk optimization | No | Yes |
| AI photo tools (background removal, crop/expand, alt text) | No | Yes |
| Mockup generation | No | Yes (in progress) |
| Photo unification | No | Yes |
| POD shop support | Yes | Yes |
| VA/team access | Yes (UNVERIFIED if limited on Lite) | Yes |

### Bulk-editable fields (verified 2026-04-27)
- Title
- Description
- Tags
- Price (set value or +/- adjustment)
- SKU
- Processing profiles
- Return policy
- Categories and attributes
- Variation prices
- Photos / alt text — listed as "coming soon" as of research date

### Bulk edit limits
- Profiles can be applied to max 500 listings at a time.
- No stated hard cap on general bulk edits.
- Important bug: all edits made during a session (checked AND unchecked listings) are published on sync — not just the checked ones. Always review before syncing.

### CSV export fields
Titles, descriptions, prices, tags, details, SKUs, inventory, variations, photo/video URLs. Optional Etsy fields are excluded (cannot be re-imported via CSV).

---

## 4. Etsy Authentication Method

Vela uses Etsy's official API with OAuth-style authorization redirect. The user flow:
1. Start account setup at getvela.com
2. Click "Connect shop" — redirected to Etsy's login/permissions page
3. Grant Vela permission; Etsy issues an access token
4. Vela imports listings automatically after authorization

Key facts:
- No browser extension required. Web-only app.
- Vela is listed on etsyapps.com (Etsy's recommended app directory) — recognized third-party integration, not a scraper.
- Disclaimer on at least one Vela page: "uses the Etsy API but is not endorsed or certified by Etsy, Inc."
- Vela's team has documented active collaboration with Etsy's engineering team (e.g., working on Global Pricing API compatibility).
- Each Etsy shop can only be connected to one Vela account.
- No webhook support confirmed (UNVERIFIED).
- No developer/public API offered by Vela itself (UNVERIFIED).

---

## 5. Setup Steps

1. Go to getvela.com -> "Get Started" -> create account (name, email, password).
2. During onboarding, connect Etsy shop via OAuth redirect. Grant permissions.
3. Wait for listings to sync (automatic after connection).
4. Optionally connect additional shops (20% discount applies).
5. Optionally invite VA/team members — they can edit listings without accessing your actual Etsy credentials.
6. For POD shops: see Vela's dedicated POD help article for workflow differences.

---

## 6. Best Practices for Aysham

- Use bulk edit for tag refreshes when updating SEO across all listings — change tags on hundreds of listings in one session instead of one by one.
- Use Profiles to save standard shipping, return policy, and description templates. Lite allows 5 profiles; if more are needed, upgrade to Plus.
- Always preview/review in Vela before clicking Sync — the "checked and unchecked all sync" bug can overwrite listings you didn't intend to touch.
- Use the Schedule feature to queue a bulk price update (e.g., holiday sale) for a specific date/time rather than doing it live.
- Grant VA access through Vela rather than sharing your Etsy login — this is the safest workflow for delegating listing work.
- Use CSV export as a periodic backup of all listing data.
- Count your listings carefully before choosing a tier — deactivated and expired listings count toward the listing cap.
- For photo-heavy updates (background removal, crop), upgrade to Plus or use dedicated tools and upload via CSV/Studio.

---

## 7. Limitations & Risks

### Functional limitations
- No built-in keyword research or SEO analytics — must pair with eHunt, Alura, or Marmalead for tag research.
- No auto-sync: listings refresh only on login or manual sync. If an Etsy listing changes outside Vela, Vela won't reflect it until next sync.
- Bulk edit sync-all bug: all edits in a session publish on sync, not just checked listings. This has caused reported cases of unintended price changes.
- Photo bulk edit (alt text, etc.) was still "coming soon" as of research date.
- No marketing automation (Pinterest, Instagram) — these features were discontinued.
- No Etsy analytics or revenue dashboard.
- Global/Domestic Pricing listings have API restrictions from Etsy's side; Vela cannot edit these until Etsy resolves it.
- Profile cap of 5 on Lite is restrictive for shops with many product categories.

### Billing risks (user-reported)
- Multiple Trustpilot and Reddit complaints: cancellation requests are ignored and charges continue. Always cancel through the account dashboard AND monitor your card statement for at least one billing cycle after cancelling.
- Trustpilot rating: 2.6/5 ("Poor") — majority of negative reviews cite billing disputes and unresponsive support.

### Etsy ToS risk
- LOW: Vela uses Etsy's official API and is listed on Etsy's app directory. No documented cases of Etsy account suspensions caused by Vela usage.
- The 7-hours-of-lost-work / sync-not-publishing bug is a Vela platform bug, not an Etsy ban scenario.
- Do not share your Etsy account credentials with Vela support or anyone; the OAuth flow never requires your Etsy password directly.

---

## 8. vs. Alternatives

| Tool | Best for | Pricing | Key differentiator |
|------|----------|---------|-------------------|
| Vela (Lite) | Single/multi-shop bulk edits | $30-55/mo | Mature, cross-platform, VA access |
| Vela (Plus) | AI optimization + photo tools | $40-55/mo | AI mockup gen, background removal |
| Alura | SEO research + listing analytics | ~$19-29/mo | Etsy analytics, keyword tracking built in |
| eHunt | Tag/keyword research only | Free / freemium | Best for tag discovery, no listing editor |
| Listadum | Simple single-shop management | Free tier + $15/mo | Unlimited listings on paid, no bulk photos |
| Marmalead | SEO scoring | ~$19/mo | Best Etsy SEO analytics, no bulk editing |
| Etsy native | Simple individual edits | Free | Most reliable for complex listing types |

### When NOT to use Vela
- When editing 1-5 listings occasionally — native Etsy is faster.
- When your shop relies heavily on Global Pricing (API restriction applies).
- When you need SEO keyword research — Vela has no research tools.
- When you are on a tight budget and have <200 listings — free alternatives (Listadum free tier) cover basic needs.

### Killer features (3 things Vela does best)
1. Bulk tag replacement across hundreds of listings in one session — the fastest way to refresh SEO tags store-wide.
2. Multi-shop management from one dashboard with a VA-safe access model.
3. Cross-channel copy — duplicate an Etsy listing to Shopify/eBay in one click while mapping fields automatically.
