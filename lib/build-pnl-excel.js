// Build a properly formatted P&L Excel workbook using exceljs.
// Currency-formatted cells, borders, bold section headers, color-coded sections.
const ExcelJS = require('exceljs');

const COLOR = {
  title:    'FF1F4E78',  // dark blue
  header:   'FF305496',  // medium blue
  revenue:  'FFC6EFCE',  // light green
  discount: 'FFFFEB9C',  // light yellow
  fee:      'FFFFC7CE',  // light red
  cogs:     'FFFCE4D6',  // light orange
  net:      'FFE2EFDA',  // softer green
  warning:  'FFFFD966',  // amber
  estimate: 'FFD9E1F2',  // very light blue
  white:    'FFFFFFFF',
  black:    'FF000000',
  red:      'FFC00000',
  green:    'FF006100',
};

const BORDER = {
  thin: { style: 'thin', color: { argb: 'FF888888' } },
};

const BORDER_ALL = {
  top: BORDER.thin, left: BORDER.thin, bottom: BORDER.thin, right: BORDER.thin,
};

function fillSolid(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function styleRow(row, opts = {}) {
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (opts.font) cell.font = { ...cell.font, ...opts.font };
    if (opts.fill) cell.fill = opts.fill;
    if (opts.border !== false) cell.border = BORDER_ALL;
    if (opts.alignment) cell.alignment = opts.alignment;
    if (opts.numFmt) cell.numFmt = opts.numFmt;
  });
}

function applyCurrency(row, startCol = 2) {
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (colNumber >= startCol) {
      cell.numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
      cell.alignment = { horizontal: 'right' };
    }
  });
}

function applyPercent(row, startCol = 2) {
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (colNumber >= startCol) {
      cell.numFmt = '0.0%';
      cell.alignment = { horizontal: 'right' };
    }
  });
}

function applyInteger(row, startCol = 2) {
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (colNumber >= startCol) {
      cell.numFmt = '#,##0';
      cell.alignment = { horizontal: 'right' };
    }
  });
}

async function buildPnlExcel({ total, byMonth, byListing, coverage, enriched, today, args, paths }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aysham P&L automation';
  wb.created = new Date();
  wb.modified = new Date();

  const sortedMonths = byMonth.slice().sort((a, b) => a.month.localeCompare(b.month));

  // ============================================================
  // SHEET 1: P&L Statement
  // ============================================================
  const ws = wb.addWorksheet('P&L Statement', {
    properties: { defaultColWidth: 14 },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }],
  });

  ws.columns = [
    { width: 42 }, // Line item
    ...sortedMonths.map(() => ({ width: 13 })),
    { width: 15 }, // TOTAL
  ];

  const lastCol = sortedMonths.length + 2;

  // Title row
  ws.addRow([`Aysham P&L Statement — All amounts in USD — generated ${today}`]);
  ws.mergeCells(1, 1, 1, lastCol);
  const titleRow = ws.getRow(1);
  titleRow.height = 26;
  titleRow.eachCell(c => {
    c.font = { bold: true, size: 13, color: { argb: COLOR.white } };
    c.fill = fillSolid(COLOR.title);
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Filter / source row
  ws.addRow([`Filter: ${args.year || args.month || 'All available data'}    |    Etsy CSV + Customhub scraper    |    Source-of-truth: Etsy 'Order Net' column`]);
  ws.mergeCells(2, 1, 2, lastCol);
  const subRow = ws.getRow(2);
  subRow.eachCell(c => {
    c.font = { italic: true, size: 10, color: { argb: 'FF555555' } };
    c.alignment = { horizontal: 'center' };
  });

  // Header row
  const headerRow = ws.addRow(['Line Item', ...sortedMonths.map(m => m.month), 'TOTAL']);
  headerRow.height = 22;
  headerRow.eachCell(c => {
    c.font = { bold: true, color: { argb: COLOR.white } };
    c.fill = fillSolid(COLOR.header);
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = BORDER_ALL;
  });

  // Orders count
  const ordersRow = ws.addRow(['Orders (count)', ...sortedMonths.map(m => m.orders), total.orders]);
  styleRow(ordersRow, { font: { bold: true } });
  applyInteger(ordersRow);
  ordersRow.getCell(1).alignment = { horizontal: 'left' };
  ordersRow.getCell(1).font = { bold: true };

  ws.addRow([]);

  // === GROSS REVENUE ===
  const revH = ws.addRow(['GROSS REVENUE']);
  ws.mergeCells(revH.number, 1, revH.number, lastCol);
  revH.eachCell(c => {
    c.font = { bold: true, size: 11 };
    c.fill = fillSolid(COLOR.revenue);
    c.alignment = { horizontal: 'left' };
    c.border = BORDER_ALL;
  });

  const itemRow = ws.addRow(['  Item Sales (USD)', ...sortedMonths.map(m => m.item_revenue), total.item_revenue]);
  styleRow(itemRow); applyCurrency(itemRow); itemRow.getCell(1).alignment = { horizontal: 'left' };

  const shipRow = ws.addRow(['  Shipping Collected (USD)', ...sortedMonths.map(m => m.shipping_revenue), total.shipping_revenue]);
  styleRow(shipRow); applyCurrency(shipRow); shipRow.getCell(1).alignment = { horizontal: 'left' };

  const totalRevRow = ws.addRow(['  Total Gross Revenue (USD)', ...sortedMonths.map(m => m.revenue), total.revenue]);
  totalRevRow.eachCell(c => {
    c.font = { bold: true };
    c.border = BORDER_ALL;
  });
  applyCurrency(totalRevRow);
  totalRevRow.getCell(1).alignment = { horizontal: 'left' };

  ws.addRow([]);

  // === DISCOUNTS ===
  const discH = ws.addRow(['DISCOUNTS GIVEN (informational — already reflected in Item Sales)']);
  ws.mergeCells(discH.number, 1, discH.number, lastCol);
  discH.eachCell(c => {
    c.font = { bold: true, size: 11 };
    c.fill = fillSolid(COLOR.discount);
    c.alignment = { horizontal: 'left' };
    c.border = BORDER_ALL;
  });

  const discRow = ws.addRow(['  Coupon discounts given (USD)', ...sortedMonths.map(m => -m.discount), -total.discount]);
  styleRow(discRow); applyCurrency(discRow); discRow.getCell(1).alignment = { horizontal: 'left' };

  ws.addRow([]);

  // === ETSY FEES ===
  const feeH = ws.addRow(['LESS: ETSY FEES (per Etsy CSV — authoritative)']);
  ws.mergeCells(feeH.number, 1, feeH.number, lastCol);
  feeH.eachCell(c => {
    c.font = { bold: true, size: 11 };
    c.fill = fillSolid(COLOR.fee);
    c.alignment = { horizontal: 'left' };
    c.border = BORDER_ALL;
  });

  const feeRow = ws.addRow(['  Etsy Fees (Order Total - Order Net)', ...sortedMonths.map(m => -m.fees), -total.etsy_fees_actual]);
  styleRow(feeRow); applyCurrency(feeRow); feeRow.getCell(1).alignment = { horizontal: 'left' };

  const feePctRow = ws.addRow(['  Fee % of Revenue', ...sortedMonths.map(m => m.fee_pct / 100), total.fee_pct / 100]);
  styleRow(feePctRow); applyPercent(feePctRow); feePctRow.getCell(1).alignment = { horizontal: 'left' };

  ws.addRow([]);

  // === MARKETING (per Etsy monthly statement) ===
  const mktH = ws.addRow(['LESS: MARKETING (Offsite Ads + on-site Ads + Etsy Plus)']);
  ws.mergeCells(mktH.number, 1, mktH.number, lastCol);
  mktH.eachCell(c => {
    c.font = { bold: true, size: 11 };
    c.fill = fillSolid('FFFFB6B6');
    c.alignment = { horizontal: 'left' };
    c.border = BORDER_ALL;
  });

  const mktRow = ws.addRow(['  Marketing total', ...sortedMonths.map(m => -(m.marketing || 0)), -(total.marketing || 0)]);
  styleRow(mktRow); applyCurrency(mktRow); mktRow.getCell(1).alignment = { horizontal: 'left' };

  const mktPctRow = ws.addRow(['  Marketing % of Revenue', ...sortedMonths.map(m => (m.marketing_pct || 0) / 100), (total.marketing_pct || 0) / 100]);
  styleRow(mktPctRow); applyPercent(mktPctRow); mktPctRow.getCell(1).alignment = { horizontal: 'left' };

  const mktSrcRow = ws.addRow(['  Marketing source', ...sortedMonths.map(m => m.has_statement ? 'verified' : 'estimated 25%'), `${total.months_with_statements || 0} verified, ${total.months_estimated_marketing || 0} estimated`]);
  mktSrcRow.eachCell(c => { c.font = { italic: true, size: 9, color: { argb: 'FF666666' } }; c.border = BORDER_ALL; c.alignment = { horizontal: 'center' }; });
  mktSrcRow.getCell(1).alignment = { horizontal: 'left' };

  ws.addRow([]);

  // === COGS ===
  const cogsH = ws.addRow(['LESS: COGS (Cost of Goods Sold)']);
  ws.mergeCells(cogsH.number, 1, cogsH.number, lastCol);
  cogsH.eachCell(c => {
    c.font = { bold: true, size: 11 };
    c.fill = fillSolid(COLOR.cogs);
    c.alignment = { horizontal: 'left' };
    c.border = BORDER_ALL;
  });

  const cogsRow = ws.addRow(['  COGS (Customhub real + Printnest est.)', ...sortedMonths.map(m => -m.cogs), -total.cogs]);
  styleRow(cogsRow); applyCurrency(cogsRow); cogsRow.getCell(1).alignment = { horizontal: 'left' };

  ws.addRow([]);

  // === NET PROFIT (visible) ===
  const netH = ws.addRow(['= NET PROFIT (visible)']);
  ws.mergeCells(netH.number, 1, netH.number, lastCol);
  netH.eachCell(c => {
    c.font = { bold: true, size: 12, color: { argb: COLOR.green } };
    c.fill = fillSolid(COLOR.net);
    c.alignment = { horizontal: 'left' };
    c.border = BORDER_ALL;
  });

  const netRow = ws.addRow(['  Net Profit (USD)', ...sortedMonths.map(m => m.net), total.net_profit]);
  netRow.eachCell(c => { c.font = { bold: true, size: 12 }; c.border = BORDER_ALL; });
  applyCurrency(netRow);
  netRow.getCell(1).alignment = { horizontal: 'left' };

  const marginRow = ws.addRow(['  Net Margin %', ...sortedMonths.map(m => m.margin / 100), total.margin / 100]);
  marginRow.eachCell(c => { c.font = { bold: true }; c.border = BORDER_ALL; });
  applyPercent(marginRow);
  marginRow.getCell(1).alignment = { horizontal: 'left' };

  ws.addRow([]);

  // === ESTIMATED REAL P&L (with hidden costs) ===
  const realH = ws.addRow(['ESTIMATED REAL P&L (assuming typical hidden costs)']);
  ws.mergeCells(realH.number, 1, realH.number, lastCol);
  realH.eachCell(c => {
    c.font = { bold: true, size: 11, color: { argb: COLOR.black } };
    c.fill = fillSolid(COLOR.warning);
    c.alignment = { horizontal: 'left' };
    c.border = BORDER_ALL;
  });

  // Offsite Ads estimate: 5% of revenue (typical 30-50% attribution × 12% rate)
  const offsiteEst = sortedMonths.map(m => -(m.revenue * 0.05));
  const offsiteEstTotal = -(total.revenue * 0.05);
  const offRow = ws.addRow(['  Offsite Ads (est. 5% of revenue if >$10K/yr)', ...offsiteEst, offsiteEstTotal]);
  styleRow(offRow); applyCurrency(offRow); offRow.getCell(1).alignment = { horizontal: 'left' };

  // Etsy Plus: $10/mo if active
  const plusEst = sortedMonths.map(() => -10);
  const plusEstTotal = -10 * sortedMonths.length;
  const plusRow = ws.addRow(['  Etsy Plus (assume active, $10/mo)', ...plusEst, plusEstTotal]);
  styleRow(plusRow); applyCurrency(plusRow); plusRow.getCell(1).alignment = { horizontal: 'left' };

  // Sweatshirt COGS gap: top sellers are sweatshirts; my estimate is tee price ($6) vs real sweatshirt ~$11
  // Estimate: 30% of orders are sweatshirts at $5 extra cost each
  const sweatGapEst = sortedMonths.map(m => -(m.orders * 0.30 * 5));
  const sweatGapTotal = -(total.orders * 0.30 * 5);
  const sweatRow = ws.addRow(['  Sweatshirt COGS gap (top sellers are sweatshirts; tee est. low)', ...sweatGapEst, sweatGapTotal]);
  styleRow(sweatRow); applyCurrency(sweatRow); sweatRow.getCell(1).alignment = { horizontal: 'left' };

  // Estimated Real Net
  const estRealNet = sortedMonths.map(m => m.net + (offsiteEst[sortedMonths.indexOf(m)]) + (plusEst[sortedMonths.indexOf(m)]) + (sweatGapEst[sortedMonths.indexOf(m)]));
  const estRealTotal = total.net_profit + offsiteEstTotal + plusEstTotal + sweatGapTotal;
  const estNetRow = ws.addRow(['  = Estimated Real Net Profit', ...estRealNet, estRealTotal]);
  estNetRow.eachCell(c => { c.font = { bold: true, color: { argb: COLOR.green } }; c.border = BORDER_ALL; });
  applyCurrency(estNetRow);
  estNetRow.getCell(1).alignment = { horizontal: 'left' };

  // Estimated Real Margin
  const estRealMargins = sortedMonths.map((m, i) => m.revenue > 0 ? estRealNet[i] / m.revenue : 0);
  const estRealMarginTotal = total.revenue > 0 ? estRealTotal / total.revenue : 0;
  const estMarginRow = ws.addRow(['  Estimated Real Margin %', ...estRealMargins, estRealMarginTotal]);
  estMarginRow.eachCell(c => { c.font = { bold: true, color: { argb: COLOR.green } }; c.border = BORDER_ALL; });
  applyPercent(estMarginRow);
  estMarginRow.getCell(1).alignment = { horizontal: 'left' };

  ws.addRow([]);

  // === NOTES ===
  const notesH = ws.addRow(['NOTES']);
  ws.mergeCells(notesH.number, 1, notesH.number, lastCol);
  notesH.eachCell(c => {
    c.font = { bold: true, size: 10 };
    c.fill = fillSolid('FFE7E6E6');
    c.alignment = { horizontal: 'left' };
  });

  const notes = [
    '• US-registered shop: no Regulatory Operating Fee, no VAT on Etsy fees.',
    '• Etsy Fees row uses Etsy\'s own "Order Net" column (Order Total - Order Net = exact fees).',
    `• Real fee % from CSV: ${total.fee_pct.toFixed(1)}% — matches typical US shop with no Offsite Ads in this CSV view.`,
    `• COGS coverage: ${coverage.matched_customhub} from Customhub (real Printonami data), ${coverage.estimated_printnest} estimated from Printnest tee pricing.`,
    '• Estimates above use TEE prices ($6-7.50). Top-selling listings are SWEATSHIRTS which cost $10-12 — major COGS underreporting.',
    '• Offsite Ads: shop >$10K/yr is auto-enrolled at 12% on attributed orders. Need monthly bill statement to subtract exactly.',
    '• "Estimated Real Margin" applies typical sweatshirt + Offsite + Etsy Plus assumptions. Could be ±5pp off until monthly bill is loaded.',
    '• Aysham\'s labor/time and design opportunity cost NOT included.',
  ];
  for (const text of notes) {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, lastCol);
    r.getCell(1).font = { size: 10, color: { argb: 'FF333333' } };
    r.getCell(1).alignment = { horizontal: 'left', wrapText: true };
  }

  // ============================================================
  // SHEET 2: By Month (rich)
  // ============================================================
  const ws2 = wb.addWorksheet('By Month');
  ws2.columns = [
    { header: 'Month', width: 10 },
    { header: 'Orders', width: 8 },
    { header: 'Item Sales', width: 13 },
    { header: 'Shipping', width: 11 },
    { header: 'Total Revenue', width: 14 },
    { header: 'Discount Given', width: 14 },
    { header: 'Etsy Fees', width: 12 },
    { header: 'Fee %', width: 8 },
    { header: 'COGS', width: 11 },
    { header: 'Net Profit', width: 13 },
    { header: 'Margin %', width: 9 },
  ];
  ws2.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: COLOR.white } };
    c.fill = fillSolid(COLOR.header);
    c.alignment = { horizontal: 'center' };
    c.border = BORDER_ALL;
  });

  for (const m of sortedMonths) {
    const r = ws2.addRow([
      m.month, m.orders, m.item_revenue, m.shipping_revenue, m.revenue,
      -m.discount, -m.fees, m.fee_pct / 100, -m.cogs, m.net, m.margin / 100,
    ]);
    r.eachCell(c => { c.border = BORDER_ALL; });
    // Currency cells
    [3, 4, 5, 6, 7, 9, 10].forEach(col => {
      r.getCell(col).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
      r.getCell(col).alignment = { horizontal: 'right' };
    });
    [8, 11].forEach(col => {
      r.getCell(col).numFmt = '0.0%';
      r.getCell(col).alignment = { horizontal: 'right' };
    });
    r.getCell(2).numFmt = '#,##0';
    r.getCell(2).alignment = { horizontal: 'right' };
  }

  // Total row
  const totRow = ws2.addRow([
    'TOTAL', total.orders, total.item_revenue, total.shipping_revenue, total.revenue,
    -total.discount, -total.etsy_fees_actual, total.fee_pct / 100, -total.cogs, total.net_profit, total.margin / 100,
  ]);
  totRow.eachCell(c => {
    c.font = { bold: true };
    c.fill = fillSolid('FFD9D9D9');
    c.border = BORDER_ALL;
  });
  [3, 4, 5, 6, 7, 9, 10].forEach(col => {
    totRow.getCell(col).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
    totRow.getCell(col).alignment = { horizontal: 'right' };
  });
  [8, 11].forEach(col => {
    totRow.getCell(col).numFmt = '0.0%';
    totRow.getCell(col).alignment = { horizontal: 'right' };
  });
  totRow.getCell(2).numFmt = '#,##0';
  totRow.getCell(2).alignment = { horizontal: 'right' };

  ws2.views = [{ state: 'frozen', ySplit: 1 }];

  // ============================================================
  // SHEET 3: By Listing
  // ============================================================
  const ws3 = wb.addWorksheet('By Listing');
  ws3.columns = [
    { header: 'Listing ID', width: 14 },
    { header: 'Name', width: 60 },
    { header: 'Sales', width: 8 },
    { header: 'Units', width: 8 },
    { header: 'Revenue', width: 13 },
  ];
  ws3.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: COLOR.white } };
    c.fill = fillSolid(COLOR.header);
    c.alignment = { horizontal: 'center' };
    c.border = BORDER_ALL;
  });
  const listings = Object.values(byListing).sort((a, b) => b.revenue - a.revenue);
  for (const l of listings) {
    const r = ws3.addRow([l.listing_id, l.name || '', l.sales, l.units, l.revenue]);
    r.eachCell(c => { c.border = BORDER_ALL; });
    r.getCell(5).numFmt = '"$"#,##0.00';
    r.getCell(5).alignment = { horizontal: 'right' };
  }
  ws3.views = [{ state: 'frozen', ySplit: 1 }];
  ws3.autoFilter = { from: 'A1', to: `E${listings.length + 1}` };

  // ============================================================
  // SHEET 4: Per Order
  // ============================================================
  const ws4 = wb.addWorksheet('Per Order');
  ws4.columns = [
    { header: 'Date', width: 12 },
    { header: 'Order ID', width: 12 },
    { header: 'Status', width: 14 },
    { header: 'Buyer', width: 22 },
    { header: 'State', width: 6 },
    { header: 'Country', width: 14 },
    { header: 'Items', width: 7 },
    { header: 'Item Sales', width: 12 },
    { header: 'Shipping', width: 11 },
    { header: 'Discount', width: 11 },
    { header: 'Order Total', width: 12 },
    { header: 'Etsy Fees', width: 11 },
    { header: 'Etsy Net', width: 11 },
    { header: 'COGS', width: 9 },
    { header: 'COGS Source', width: 18 },
    { header: 'Net Profit', width: 12 },
    { header: 'Margin %', width: 9 },
    { header: 'SKUs', width: 40 },
  ];
  ws4.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: COLOR.white } };
    c.fill = fillSolid(COLOR.header);
    c.alignment = { horizontal: 'center' };
    c.border = BORDER_ALL;
  });
  const sortedOrders = enriched.slice().sort((a, b) => b.date.localeCompare(a.date));
  for (const o of sortedOrders) {
    const r = ws4.addRow([
      o.date, o.order_id, o.status, o.buyer, o.ship_state, o.ship_country, o.num_items,
      Math.round((o.order_total - o.shipping_revenue) * 100) / 100,
      o.shipping_revenue, -o.discount, o.order_total,
      -o.etsy_fees_actual, o.final_net, -o.cogs, o.cogs_source,
      o.net_profit, o.margin / 100,
      (o.items || []).map(it => it.sku).filter(Boolean).join(' | '),
    ]);
    r.eachCell(c => { c.border = BORDER_ALL; });
    [8, 9, 10, 11, 12, 13, 14, 16].forEach(col => {
      r.getCell(col).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
      r.getCell(col).alignment = { horizontal: 'right' };
    });
    r.getCell(17).numFmt = '0.0%';
    r.getCell(17).alignment = { horizontal: 'right' };
    // Highlight loss-making orders
    if (o.net_profit < 0) {
      r.eachCell(c => { c.font = { color: { argb: COLOR.red } }; });
    }
  }
  ws4.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  ws4.autoFilter = { from: 'A1', to: `R${sortedOrders.length + 1}` };

  // ============================================================
  // SHEET: Action Items (priority queue based on P&L findings)
  // ============================================================
  const wsAct = wb.addWorksheet('Action Items');
  wsAct.columns = [
    { width: 4 },   // #
    { width: 9 },   // Priority
    { width: 38 },  // Action
    { width: 50 },  // Why / Evidence
    { width: 16 },  // Est. Annual Impact
    { width: 14 },  // Effort
    { width: 12 },  // Status
    { width: 24 },  // Owner / Due
  ];

  const actTitle = wsAct.addRow([`Aysham Action Plan — based on P&L findings ${today}`]);
  wsAct.mergeCells(1, 1, 1, 8);
  actTitle.height = 26;
  actTitle.eachCell(c => {
    c.font = { bold: true, size: 13, color: { argb: COLOR.white } };
    c.fill = fillSolid(COLOR.title);
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  const actHdr = wsAct.addRow(['#', 'Priority', 'Action', 'Why / Evidence from this P&L', 'Est. Annual Impact (USD)', 'Effort', 'Status', 'Owner / Due']);
  actHdr.height = 22;
  actHdr.eachCell(c => {
    c.font = { bold: true, color: { argb: COLOR.white } };
    c.fill = fillSolid(COLOR.header);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = BORDER_ALL;
  });

  const items = [
    { p: 'P0', a: 'Open monthly statement "Expand Categories" to break down Marketing into Offsite Ads / On-site Ads / Etsy Plus', why: 'Marketing is 23.6% of revenue ($3,565/yr at current run-rate). Need the breakdown to know what to cut.', impact: '+$500-1,500', e: 'S', s: 'TODO' },
    { p: 'P0', a: 'Investigate March 2026 marketing spike (35% of revenue)', why: 'Mar 2026 Sales=$558, Marketing=$199. Very high % during low-sales month. Likely on-site Ads campaign running on autopilot.', impact: '+$200-800', e: 'S', s: 'TODO' },
    { p: 'P1', a: 'Cancel Etsy Plus if not actively used', why: '$10/mo × 12 = $120/yr. Plus offers 15 listing credits + $5 Ads credit + custom domain. Confirm value vs cost.', impact: '+$120 (if cancelled)', e: 'S', s: 'TODO' },
    { p: 'P1', a: 'Pause / reduce on-site Etsy Ads campaigns', why: 'On-site Ads are opt-in (unlike Offsite which is mandatory at $10K+). Easy lever to lower marketing %.', impact: '+$300-1,000', e: 'S', s: 'TODO' },
    { p: 'P0', a: 'Add 3 monthly statements for 2025 (Oct/Nov/Dec) to JSON', why: 'Q4 2025 marketing currently estimated at 25%. True number could be different — could shift annual margin ±3pp.', impact: 'Better visibility', e: 'S', s: 'TODO' },
    { p: 'P0', a: 'Diversify away from Huntrix listing concentration', why: 'Huntrix Sweatshirt = $9,411 = 62% of total revenue. Single point of failure. If trend dies or listing gets banned, mağaza çöker.', impact: 'Risk mitigation', e: 'M', s: 'TODO' },
    { p: 'P1', a: 'Add sweatshirt sibling listings to top tee-only sellers', why: 'Backstreet Boys T-Shirt ($1,965) and Bruce Springsteen ($1,787) have NO sweatshirt version. Sweatshirts have higher AOV and margin.', impact: '+$2,000-4,000', e: 'M', s: 'TODO' },
    { p: 'P1', a: 'Add Youth versions to top sweatshirt listings', why: 'Top 2 sweatshirt listings (Huntrix + Backstreet Heart) have no Youth — capturing family/gifting buyers expands market.', impact: '+$500-1,500', e: 'M', s: 'TODO' },
    { p: 'P2', a: 'Raise prices selectively to absorb mandatory Offsite Ads', why: 'Offsite Ads fee 12% on attributed sales is mandatory ($10K+ shop). Cannot opt out. Only lever is to raise price by 4-5% to absorb partially.', impact: '+$300-700', e: 'M', s: 'TODO' },
    { p: 'P1', a: 'Audit Printonami pricing vs Printnest after switch', why: 'Printonami sweatshirt $11 vs Printnest $9.75 — Printonami is +$1.25 more per unit. Consider negotiating or splitting suppliers.', impact: '+$300-800', e: 'L', s: 'TODO' },
    { p: 'P2', a: 'Track ROAS for each Offsite-attributed order', why: 'When Adjusted Net < Order Net in CSV, that order was offsite-attributed. Compare margin of those orders vs organic — identify if Offsite is profitable.', impact: 'Data', e: 'M', s: 'TODO' },
    { p: 'P2', a: 'Cancellation rate review (3 cancelled orders found in Printnest data)', why: 'Cancellations cost time + paid Etsy fees. If trending up, identify root cause (sizing? quality? shipping?)', impact: 'Quality', e: 'S', s: 'TODO' },
    { p: 'P1', a: 'Fix audit-listing-health.js Etsy editor selectors', why: 'Auto-audit scored Huntrix listing 45/100 due to scraper bug (0 word title detected). Fix to enable bulk listing health monitoring.', impact: 'Tooling', e: 'M', s: 'TODO' },
    { p: 'P2', a: 'Run weekly P&L cron on macOS', why: 'plist already prepared. Install with `launchctl load ~/Library/LaunchAgents/<your>.weekly-pnl.plist`. Auto-runs every Sunday 9:15 AM.', impact: 'Automation', e: 'S', s: 'TODO' },
  ];

  let i = 1;
  for (const it of items) {
    const r = wsAct.addRow([i++, it.p, it.a, it.why, it.impact, it.e, it.s, '']);
    r.alignment = { vertical: 'top', wrapText: true };
    r.eachCell(c => { c.border = BORDER_ALL; c.alignment = { vertical: 'top', wrapText: true }; });
    r.height = 50;
    // Color priority
    const pCell = r.getCell(2);
    pCell.alignment = { horizontal: 'center', vertical: 'middle' };
    pCell.font = { bold: true };
    if (it.p === 'P0') pCell.fill = fillSolid('FFFF6B6B'); // red
    else if (it.p === 'P1') pCell.fill = fillSolid('FFFFD966'); // amber
    else pCell.fill = fillSolid('FFA9D08E'); // green
    // Status cell
    r.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(7).font = { bold: true, color: { argb: 'FF888888' } };
  }

  // Legend
  wsAct.addRow([]);
  const legendH = wsAct.addRow(['LEGEND']);
  legendH.getCell(1).font = { bold: true };
  wsAct.addRow(['', 'P0', 'Critical — do this week', '', '', '', '', '']).getCell(2).fill = fillSolid('FFFF6B6B');
  wsAct.addRow(['', 'P1', 'Important — do this month', '', '', '', '', '']).getCell(2).fill = fillSolid('FFFFD966');
  wsAct.addRow(['', 'P2', 'Nice-to-have — do this quarter', '', '', '', '', '']).getCell(2).fill = fillSolid('FFA9D08E');
  wsAct.addRow([]);
  wsAct.addRow(['', '', 'Effort: S = small (1-2 hr), M = medium (1-2 days), L = large (week+)']).getCell(3).font = { italic: true, color: { argb: 'FF666666' } };

  wsAct.views = [{ state: 'frozen', ySplit: 2 }];

  // Save to all paths
  for (const p of paths) {
    await wb.xlsx.writeFile(p);
  }
  return paths;
}

module.exports = { buildPnlExcel };
