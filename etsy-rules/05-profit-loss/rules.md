---
last_verified: 2026-04-27
sources_file: ./sources.md
shop_jurisdiction: US (registered in United States — NOT Turkey)
---

> **2026-04-27 correction:** Aysham's Etsy shop is registered in the **United States** (LLC or sole prop). Earlier draft assumed Turkey-seller rules. The corrections below remove Regulatory Operating Fee (2.27%), VAT on Etsy fees, and USD↔TRY FX assumptions — none of these apply to a US-registered shop. Aysham herself operates from Turkey, but the shop, payouts, and tax obligations are US-based USD.

# 05 — Etsy Profit & Loss: Operating Rules

## 1. TL;DR

- Etsy fees stack to roughly **10-12% of sale price** for a US-registered shop on a domestic US order (no Offsite Ads). Add Offsite Ads and it reaches 22-25%.
- **No Regulatory Operating Fee** for US shops (this fee applies only to Turkey, UK, France, Italy, Vietnam, Canada, Spain, India sellers).
- **No VAT/GST on Etsy service fees** for US sellers (UK adds 20%, AU adds 10%; US is exempt).
- Revenue and payouts are USD-USD — no currency conversion fee.
- For a $30 t-shirt sold via Printonami POD, realistic net margin is $5-9 (17-30%) before Offsite Ads, and can flip negative at $30 if Offsite Ads fire.
- Track gross revenue, not Etsy deposits. Deposits are already net of fees.
- Printonami supplier cost is UNVERIFIED online — pull directly from your Drive pricing sheet before building formulas.
- Use DIY Sheets (Google Sheets) until monthly orders exceed ~50. Upgrade to Paper + Spark ($97 one-time) at 50+ orders/month, or Craftybase Studio ($49/mo) if you need automated daily imports.

---

## 2. Full Etsy Cost Stack Per Sale

All fees from Faz 1 (`01-how-etsy-works/rules.md` section 2). Do not duplicate the fee table here — use those numbers directly.

### Aysham-specific stack (US-registered shop, US buyer, Etsy Payments, USD listing, USD payout)

| # | Cost line | Basis | Rate / amount | Notes |
|---|---|---|---|---|
| 1 | Listing fee | Per listing (amortized) | $0.20 / units sold in that renewal | Renews per qty sold; at 1 unit = $0.20 |
| 2 | Transaction fee | Item price + shipping set | 6.5% | On the price the buyer pays |
| 3 | Payment processing (US buyer) | Order total | 3% + $0.25 | Via Etsy Payments |
| 4 | Regulatory Operating Fee | N/A | **0% (US shops are exempt)** | Applies only to TR/UK/FR/IT/VN/CA/ES/IN sellers |
| 5 | Currency conversion | Only if buyer pays in non-USD | 2.5% | If shop lists in USD and buyer is US, usually no conversion |
| 6 | Offsite Ads (if fired) | Sale price | 15% (under $10k/yr) or 12% (over $10k/yr) | 30-day attribution window; can opt out if under $10k |
| 7 | Supplier cost (Printonami) | Per order fulfilled | UNVERIFIED — see Drive pricing sheet | POD: charged per item, no inventory |
| 8 | Shipping label | Per shipment | $0 (Printonami ships direct-to-buyer) | Verify: does Printonami ship to buyer, or do you re-ship? |
| 9 | Packaging | Per shipment | $0-1 (POD: usually included by supplier) | If you add branded inserts, add $0.10-0.50/unit |
| 10 | Etsy Plus (if enrolled) | Monthly subscription | $10/mo amortized per order | $10 / orders that month |

**Items 7-10 require Aysham to input actual values.** Items 1-6 are fixed by Etsy policy.

---

## 3. Per-Sale Margin Formula

### Variables (define once per listing)

```
PRICE       = listing price (item only, no shipping)
SHIP_SET    = shipping price you charge buyer ($0 if free shipping)
SALE        = PRICE + SHIP_SET          // what buyer pays, minus tax
SUPPLIER    = Printonami fulfillment cost per unit (UNVERIFIED)
SHIP_COST   = carrier cost if you ship; $0 if Printonami ships direct
PACK        = packaging + inserts per unit
```

### Fee lines

```
listing_fee      = 0.20
txn_fee          = SALE * 0.065
proc_fee         = SALE * 0.03 + 0.25
reg_fee          = SALE * 0.0227          // use 0.0167 from 2026-06-22
offsite_ads_fee  = SALE * 0.15            // only if Offsite Ads fired; else 0
total_fees       = listing_fee + txn_fee + proc_fee + reg_fee + offsite_ads_fee
```

### Net margin

```
gross_revenue   = SALE
total_costs     = total_fees + SUPPLIER + SHIP_COST + PACK
net_profit      = gross_revenue - total_costs
margin_pct      = net_profit / gross_revenue * 100
```

### Google Sheets formula (single row, no Offsite Ads)

Assumes: A2=item price, B2=shipping charged, C2=supplier cost, D2=ship cost out, E2=packaging

```
=A2+B2
 - 0.20
 - (A2+B2)*0.065
 - (A2+B2)*0.03 - 0.25
 - (A2+B2)*0.0227
 - C2 - D2 - E2
```

Put that in F2 (net profit). In G2 for margin %:

```
=F2/(A2+B2)
```

For the Offsite Ads scenario, add a separate column H2:

```
=F2 - (A2+B2)*0.15
```

---

## 4. Worked Example — 1 Sale, Full Calculation

**Scenario:** Unisex t-shirt, $30 retail + $0 free shipping. US buyer. **US-registered shop**. No Offsite Ads. Supplier cost $7.50 (Printnest Unisex S-XL, customer pays shipping; verified from Drive pricing sheet 2026-04-27). Printonami/Printnest ships direct, no extra label or packaging cost.

| Line | Calculation | Amount |
|---|---|---|
| Gross sale | $30.00 + $0.00 | **$30.00** |
| Listing fee | flat | -$0.20 |
| Transaction fee | $30.00 x 6.5% | -$1.95 |
| Payment processing | $30.00 x 3% + $0.25 | -$1.15 |
| Regulatory Operating Fee | N/A (US shop) | -$0.00 |
| Offsite Ads | not fired this order | $0.00 |
| **Total Etsy fees** | | **-$3.98** |
| Supplier cost (Printonami) | UNVERIFIED placeholder | -$12.00 |
| Shipping label | Printonami ships direct | $0.00 |
| Packaging / inserts | none | $0.00 |
| **Net profit** | | **$14.02** |
| **Margin** | $14.02 / $30.00 | **46.7%** |

**Same sale if Offsite Ads fires:**

| Additional deduction | $30.00 x 15% | -$4.50 |
|---|---|---|
| **Net profit with Offsite Ads** | | **$9.52** |
| **Margin with Offsite Ads** | | **31.7%** |

**At $25 retail (lower end of range), no Offsite Ads:**

| Line | Amount |
|---|---|
| Gross sale | $25.00 |
| Total Etsy fees | -$3.39 (listing $0.20 + txn $1.625 + proc $1.00 + reg $0.57) |
| Supplier $12 | -$12.00 |
| Net profit | **$9.61** |
| Margin | **38.4%** |

**Key insight:** At $25-35, Etsy fees alone are $3.39-$4.47. Offsite Ads add another $3.75-$5.25. The supplier cost ($12 placeholder) is the largest single line. Increasing the retail price from $25 to $35 improves margin by ~10 points because Etsy fees scale but supplier cost stays flat.

---

## 5. Monthly P&L Template Structure

### Income

| Row | Label | Source |
|---|---|---|
| 1 | Gross sales (item + shipping) | Etsy CSV: "Item subtotal" + "Shipping" columns |
| 2 | Less: Etsy fees (listing + txn + proc + reg) | Etsy CSV: "Fees" column; break down manually |
| 3 | Less: Offsite Ads fees | Etsy CSV: "Offsite Ads" column |
| 4 | Less: Returns/refunds | Etsy CSV: negative rows; see section 7 |
| 5 | **Net platform revenue** | Row 1 - 2 - 3 - 4 |

### COGS

| Row | Label | Source |
|---|---|---|
| 6 | Supplier cost (Printonami invoices) | Printonami order history |
| 7 | Shipping labels (if any) | Carrier receipts |
| 8 | Packaging and inserts | Actual spend / receipt |
| 9 | **Total COGS** | Sum 6-8 |

### Operating Expenses

| Row | Label | Source |
|---|---|---|
| 10 | Etsy Plus subscription | $10/mo if enrolled |
| 11 | Etsy Ads (onsite CPC) | Etsy billing CSV |
| 12 | Tools (Craftybase, Paper+Spark, etc.) | Subscription/receipt |
| 13 | Design tools (Canva, etc.) | Subscription |
| 14 | Photography / mockup costs | Receipt |
| 15 | Other (packaging samples, returns postage) | Receipt |
| 16 | **Total OpEx** | Sum 10-15 |

### Summary

| Row | Label | Formula |
|---|---|---|
| 17 | **Gross profit** | Row 5 - Row 9 |
| 18 | Gross margin % | Row 17 / Row 1 |
| 19 | **Net profit** | Row 17 - Row 16 |
| 20 | Net margin % | Row 19 / Row 1 |

---

## 6. Tool Comparison

| Tool | Cost | Data import | Best for | Verdict for Aysham |
|---|---|---|---|---|
| **DIY Google Sheets** | Free | Manual CSV paste from Etsy | Shops under ~50 orders/mo | Start here. Use the per-sale formula in section 3. |
| **Paper + Spark** | $97 one-time (lifetime updates) | Manual CSV paste; no API | Shops 50-200 orders/mo wanting structured template | Strong option when DIY feels messy. One-time cost is fair. |
| **Craftybase Pro** | $24/mo (manual imports, 25 order lines) | Manual import, 1 integration | Very small shops that need inventory too | Overkill for POD (no inventory to track) at this tier |
| **Craftybase Studio** | $49/mo or $41/mo annual | Daily auto-import from Etsy API | Shops 100+ orders/mo wanting hands-off COGS | Worth it once at ~100 orders/mo; auto COGS saves real time |
| **Craftybase Indie** | $99/mo or $83/mo annual | Daily auto + batch tracking | Multi-product shops needing traceability | Not needed for POD |
| **QuickBooks + A2X** | ~$30-50/mo (QBO) + ~$19-49/mo (A2X) | Auto via A2X connector | Shops with complex multi-channel or tax filing needs | UNVERIFIED exact pricing; overkill for most Etsy-only shops |

**Recommendation:** Start with DIY Sheets. Graduate to Paper + Spark ($97 once) when the CSV-paste feels unsustainable. Consider Craftybase Studio ($41/mo annual) only after crossing ~100 orders/month consistently.

---

## 7. Returns and Refunds Accounting

### What happens on Etsy when a refund is issued

1. Etsy refunds the buyer from your Payment Account balance.
2. Transaction fee (6.5%) is reversed by Etsy — you get it back.
3. Listing fee ($0.20) is NOT refunded.
4. Payment processing fee (3% + $0.25) is NOT refunded.
5. Offsite Ads fee is NOT refunded (you paid for the click that led to the sale).
6. (Regulatory Operating Fee refund N/A for US shop.)

### How to record in your P&L

- **Do not** net refunds against a random expense row.
- Reverse the original sale: reduce gross revenue by the refund amount.
- Keep listing fee and payment processing as a separate sunk cost under "Etsy fees."
- If you also refunded the buyer for return shipping, record that as a separate "returns postage" expense line.
- For POD: Printonami typically does not refund you unless the item was defective/misprinted. Track that separately as a "supplier dispute" line.

### Google Sheets treatment

In your monthly sales log, add a row for the refund with negative values in the Gross Sale, Transaction Fee (refunded), and Reg Fee columns. Leave Listing Fee and Processing Fee positive (you don't get them back).

---

## 8. Currency and FX Risk

### Aysham's setup

- Shop lists in USD.
- Etsy Payments settles in USD to your Etsy Payment Account.
- Payout to a Turkish bank account = Etsy applies 2.5% currency conversion fee (USD -> TRY) OR you receive USD if you have a USD-denominated account.
- Printonami cost: likely in TRY (Turkish supplier), so you effectively pay in TRY. TRY has depreciated significantly (USD/TRY ~44 as of early 2026, versus ~14 in 2021).

### FX risk reality

- Your revenue is USD-denominated (good: protects against TRY inflation).
- Printonami costs are TRY-denominated. As TRY weakens vs USD, your supplier cost in USD terms falls — this is a tailwind. But if TRY strengthens or Printonami raises TRY prices to match inflation, your USD-equivalent COGS rises.
- **Practical rule:** Always record Printonami costs in USD at the exchange rate on the invoice date. Use xe.com or Google Finance for the rate. Keep a "FX rate used" column in your Sheets.

### Minimizing FX drag

1. If you have access to a USD-denominated Etsy payout account (e.g., Payoneer USD account), you avoid the 2.5% Etsy conversion fee. Verify Payoneer supports USD payouts for Turkish sellers.
2. Pay Printonami from your USD balance rather than converting to TRY first if they accept USD.
3. If you convert to TRY: do so in batches (weekly or monthly) rather than per-order, to average out the rate.

### What to track

| Column | Value |
|---|---|
| Invoice date | YYYY-MM-DD |
| Printonami invoice (TRY) | Raw TRY amount |
| USD/TRY rate used | xe.com spot rate on that date |
| Printonami cost (USD) | TRY / rate |
| Etsy payout (USD) | From Etsy Payment Account |
| FX conversion fee (if payout in TRY) | Payout x 0.025 |

---

## 9. Common Accounting Mistakes

1. **Using Etsy deposit as revenue.** Deposits are net of fees. You will understate revenue and hide the fee stack.
2. ~~Forgetting the Regulatory Operating Fee.~~ **N/A for US shop.**
3. **Not tracking the Offsite Ads attribution.** An order that looks profitable on paper may be losing money if Offsite Ads fired. Check the "Order source" in Etsy's CSV.
4. **Recording refunds as expenses.** Refunds reduce revenue; they are not a new cost (except any shipping you pay out of pocket for returns).
5. **Recording Etsy deposits as gross revenue.** See mistake 1.
6. **Ignoring FX rate changes month to month.** A consistent FX rate assumption will make your P&L wrong if TRY moves 5%+ in a month (which it does).
7. **Amortizing the listing fee incorrectly.** The $0.20 fires per unit sold, not per listing published. If one listing sells 10 units, you paid $2.00 in listing fees for that listing that month.
8. **Not separating Etsy Ads (CPC) from Offsite Ads.** They appear in different columns in the billing CSV and have completely different cost structures.

---

## 10. Aysham Workflow Recommendation

### Now (Phase 1 — under 50 orders/month)

1. Download Etsy's CSV monthly: Shop Manager > Finances > Payment Account > Download CSV.
2. Open in Google Sheets. Add columns: Supplier Cost, Ship Out, Packaging, FX Rate, Net Profit.
3. Use the per-sale formula from section 3 to populate Net Profit per row.
4. Sum into the monthly P&L template (section 5).
5. Tag each order: "Offsite Ads: Y/N" from the Order Source column.

### Phase 2 — 50-100 orders/month

- Buy Paper + Spark Etsy Seller Spreadsheet ($97 once). Paste CSV monthly. Use their KPI dashboard to spot trends.

### Phase 3 — 100+ orders/month

- Evaluate Craftybase Studio ($41/mo annual). Auto-imports daily. Calculates COGS automatically. Saves ~2h/month at this volume.
- Printonami costs still entered manually as supplier invoices unless an API connection exists (UNVERIFIED).
