# ETSY Rules — Aysham Knowledge Base

This folder is the **single source of truth** for ETSY operations on the Aysham store. Both Claude (via this `.md` tree) and the human user (via mirrored Google Docs in `Drive/ETSY/ETSY Rules/`) read from here.

## Goals

1. Teach the user ETSY operations end-to-end.
2. Automate the Aysham store with Claude as much as possible.
3. Keep content **non-garbage**: only verified, current, actionable info.

## Folder map

| # | Folder | Topic |
|---|--------|-------|
| 1 | `01-how-etsy-works/` | Etsy Sellers Handbook synthesis |
| 2 | `02-listing/` | Listing tracking + writing the most effective listings |
| 3 | `03-getvela/` | Getvela.com — features, Etsy integration, automation |
| 4 | `04-etsy-ads/` | Etsy Ads — best practices, tools, APIs, expert insights |
| 5 | `05-profit-loss/` | Etsy P&L — formulas, tools, methodology |
| 6 | `06-us-holidays/` | US holidays calendar + prep timeline + automation |
| 7 | `07-ehunt/` | EHunt + competitors (eRank, Marmalead, Sale Samurai) |
| 8 | `08-daily-control/` | Daily/weekly/monthly Aysham management rhythm + Claude automation |
| 9 | `09-pinterest-fb-ig/` | Etsy ↔ Pinterest / Facebook / Instagram integration |
| 10 | `10-dtf-business/` | DTF business decision: costs, top shops, tools, go/no-go for Aysham |
| 11 | `11-aysham-snapshot/` | Aysham health snapshot framework: P&L, listings audit, listing health rubric |
| — | `_x-monitoring/` | Daily X (Twitter) digest infrastructure |

## File conventions per topic folder

- `README.md` — research brief (sources, questions to answer, output format). This is what Claude reads to know **what to research**.
- `rules.md` — final synthesized content. This is what Claude reads as **operating knowledge**.
- `sources.md` — list of URLs/handles consulted, with last-checked date.
- `notes/` (optional) — raw research notes, daily snapshots.

## Update cadence

- **Sellers Handbook** (#1): re-check monthly for policy changes.
- **Getvela / EHunt / Ads tools** (#3, #4, #7): re-check quarterly or when user reports change.
- **US holidays** (#6): yearly refresh in Q4.
- **X digest** (`_x-monitoring/`): daily, automated.

## How to use from automation

Reference from `etsy-product-creator/CLAUDE.md`:
```
ETSY operating rules live in ./etsy-rules/. When working on Etsy
tasks, read the relevant rules.md file before acting.
```

Last updated: 2026-04-27
