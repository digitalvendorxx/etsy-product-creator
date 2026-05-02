#!/usr/bin/env node
// Reads holidays.json, prints upcoming events within --days window.
// Used by daily-checklist.js to surface prep-window holidays.
//
// Usage:
//   node holiday-tracker.js [--days N] [--min-fit N] [--json]
const fs = require('fs');
const path = require('path');

const HOLIDAYS_FILE = path.join(__dirname, 'holidays.json');

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { days: 90, minFit: 1, json: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--days') out.days = parseInt(a[++i], 10);
    else if (a[i] === '--min-fit') out.minFit = parseInt(a[++i], 10);
    else if (a[i] === '--json') out.json = true;
    else if (a[i] === '-h' || a[i] === '--help') {
      console.log(`Usage: node holiday-tracker.js [options]
  --days N       Lookahead window in days (default 90)
  --min-fit N    Minimum apparel fit 1-3 (default 1)
  --json         Output JSON instead of text table
  -h, --help`);
      process.exit(0);
    }
  }
  return out;
}

function classify(h) {
  const peakStart = (h.peak_window_weeks_before?.[1] ?? h.prep_weeks) * 7;
  const peakEnd = (h.peak_window_weeks_before?.[0] ?? 1) * 7;
  const prepDays = h.prep_weeks * 7;
  if (h.daysUntil < 0) return 'PAST';
  if (h.daysUntil <= peakEnd) return 'PEAK';
  if (h.daysUntil <= peakStart) return 'IN_PEAK_WINDOW';
  if (h.daysUntil <= prepDays) return 'IN_PREP_WINDOW';
  return 'FUTURE';
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function main() {
  const ARGS = parseArgs();
  const today = new Date(new Date().toISOString().split('T')[0]);
  const holidays = JSON.parse(fs.readFileSync(HOLIDAYS_FILE, 'utf8'));

  const enriched = holidays
    .map(h => ({
      ...h,
      daysUntil: Math.floor((new Date(h.date) - today) / 86400000),
    }))
    .map(h => ({ ...h, status: classify(h) }))
    .filter(h => h.daysUntil >= 0 && h.daysUntil <= ARGS.days)
    .filter(h => h.fit_for_apparel >= ARGS.minFit)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  if (ARGS.json) {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      window_days: ARGS.days,
      min_fit: ARGS.minFit,
      count: enriched.length,
      holidays: enriched,
    }, null, 2));
    return;
  }

  console.log(`Holidays within ${ARGS.days} days (min fit ${ARGS.minFit}):`);
  console.log('');
  console.log(pad('Days', 5) + pad('Date', 12) + pad('Name', 32) + pad('Fit', 4) + pad('Prep', 6) + 'Status');
  console.log('-'.repeat(75));
  for (const h of enriched) {
    console.log(
      pad(h.daysUntil, 5) +
      pad(h.date, 12) +
      pad(h.name, 32) +
      pad('★'.repeat(h.fit_for_apparel), 4) +
      pad(h.prep_weeks + 'w', 6) +
      h.status
    );
  }
  console.log('');
  console.log(`${enriched.length} event${enriched.length === 1 ? '' : 's'}.`);
}

main();
