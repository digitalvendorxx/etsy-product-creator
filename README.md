# Etsy Product Creator

End-to-end automation pipeline for Etsy listings: AI design generation, mockup composition, EtsyHunt-driven keyword research, NLP-aware title/description writing, and automated Etsy upload over a CDP-attached browser.

## Highlights

- **Four creation modes** in the wizard UI
  - **Single** — one design, multiple mockup templates
  - **Front-Back** — front + back design on the same template (two-pass calibration)
  - **Image-to-Mockup** — upload a product photo, AI generates 7/10/20 lifestyle mockups across 11 scene pools and 10 camera angles, slot-aligned to Etsy's 2025-2026 photo checklist
  - **Bulk** — N independent listings in one run, each with its own mode/design/mockups/tag-source/bg-removal
- **Tag pipeline** (Tag Lab)
  - Gemini extracts seed keywords + theme vocabulary from the composed mockup
  - Seeds expanded via EtsyHunt (iframe scrape)
  - Composite scoring (competition + sales + views + long-tail) + relevance tier (strict-then-loose) + token-set dedupe + diversity cap
  - Title-overlap dedupe so tags complement (not duplicate) the title
  - Tier-3 fallback guarantees 13 slots filled
- **Etsy 2025-2026 NLP rules** baked into Gemini prompts: title under 70 chars with primary keyword in first 30, description 1000+ chars with hook in first 160, 13 long-tail tags with intent diversity (gift/recipient/audience/theme variants), photo composition rules per slot
- **Lifestyle mockup generator** — port of upstream `lifestyle-mockup` with extreme-detail prompts for size-scale, color-variants, gift-packaging, back-side-view, and macro-detail slots
- **CDP-attached browser** for both EtsyHunt scraping (uses your logged-in session) and Etsy upload (replaces template listing's media + tags + title + description)

## Setup

```bash
cp .env.example .env       # add OPENROUTER_API_KEY, GEMINI_API_KEY
cp config.example.json config.json   # set operaPath + your templateListingId
npm install
```

## Run

```bash
npm run dev      # launches Opera/Chromium with --remote-debugging-port + Express on :3001
npm start        # server only (assumes browser is already running)
npm run browser  # just the CDP browser
```

CLI:
```bash
npm run create -- --ref design.png --mockups t1.png,t2.png --competitor https://www.etsy.com/listing/... --sku ABC123
```

## Architecture

```
server.js                       Express + SSE pipeline (entry)
create.js                       Single-SKU CLI wrapper
lib/
  generate-design.js            OpenRouter image gen
  generate-mockup-from-image.js Legacy AI mockup-from-photo
  lifestyle-mockup.js           Slot-aligned multi-mockup generator (scene + angle rotation)
  compose-mockup.js             Sharp-based template composition
  analyze-mockup.js             Gemini title + description + tags (NLP-rule-strict)
  tag-lab-pipeline.js           EtsyHunt + scoring + dedupe + diversity orchestrator
  scrape-tags-etsyhunt.js       EtsyHunt iframe scraper + composite scoreKeyword
  optimize.js                   Gildan boilerplate description blocks
  upload-etsy.js                Playwright via CDP, replaces template listing
  upload-etsy-cookies.js        Headless cookie variant
  pin-to-pinterest.js           Pinterest pin
tag-lab/                        Standalone keyword research UI on :3002
public/
  app.html                      New wizard UI (preferred)
  index.html                    Legacy form UI (served at /legacy)
```

## Tag Lab

Standalone EtsyHunt-driven keyword tool at `:3002`:
```bash
node tag-lab/server.js
```
Drag a design → Gemini extracts seeds + theme vocabulary → EtsyHunt scrape → top 13 by composite score with relevance + diversity gating → Gemini writes the listing title and description.

## Scope

This is a personal automation built around one specific Etsy workflow (POD apparel: shirts + sweatshirts using Gildan 64000 / 18000 templates). The Tag Lab pipeline, lifestyle mockup generator, and tag-lab-pipeline modules are reusable for other niches; the upload/template-copy flow is hardcoded to one template listing structure.

## Credits

- `lib/lifestyle-mockup.js` adapted from [esenbora/etsy-unalta-metal](https://github.com/esenbora/etsy-unalta-metal)
- Composite tag scoring inspired by EtsyHunt's own ranking signals
