# Etsy Product Creator

Standalone workflow for Etsy product mockups and listings. It still includes the baby puzzle draft generator, but the main flow can also handle other children's products such as playground equipment, kids furniture, and wooden toys.

## Run

```bash
cp .env.example .env
npm install
PORT=3001 npm start
```

Open http://localhost:3001/baby-puzzle.

## What It Does

- Generates baby puzzle draft alternatives from the theme catalog.
- Creates AI lifestyle mockups for the selected product context.
- Builds Etsy-ready title, description, tags, and upload flow.
- Exports supplier files for selected puzzle drafts.
- Adds operation screens for stats, pending jobs, cleanup, tag testing, and script runs.
- Includes a Rexven-like supply panel for product catalog, fulfillment planning, and Etsy profit calculations.

## Etsy API

Set these in `.env` or the settings modal:

```bash
ETSY_API_KEY=keystring:shared_secret
ETSY_ACCESS_TOKEN=oauth_access_token
ETSY_SHOP_ID=your_shop_id
ETSY_SHOP_NAME=your_shop_name
```

The keystring and shared secret alone are not enough for private shop actions. Etsy Open API v3 also requires an OAuth access token with the relevant scopes.

Leather tooling is intentionally split into the separate `~/leather` project.
