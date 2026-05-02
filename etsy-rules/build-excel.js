#!/usr/bin/env node
// Build an Excel workbook of all etsy-rules/{NN-topic}/rules.md files.
// One sheet per topic + an index sheet. Output to etsy-rules/rules-export.xlsx
// and optionally mirror to the Drive folder.
//
// Usage:
//   node etsy-rules/build-excel.js [--no-drive]
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname);
const OUT = path.join(ROOT, 'rules-export.xlsx');
const DRIVE_DIR = path.join(
  os.homedir(),
  'Library/CloudStorage/GoogleDrive-aylinergani@gmail.com',
  "Drive'ım/ETSY/ETSY Rules"
);

const ARGS = process.argv.slice(2);
const SKIP_DRIVE = ARGS.includes('--no-drive');

function listTopicDirs() {
  return fs.readdirSync(ROOT)
    .filter(name => /^\d{2}-/.test(name))
    .filter(name => fs.statSync(path.join(ROOT, name)).isDirectory())
    .sort();
}

function readFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function firstH2(md) {
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) return line.slice(3).trim();
  }
  return '';
}

function sheetNameFromTopic(topic) {
  return topic.replace(/^\d{2}-/, '').slice(0, 28);
}

function addTopicSheet(wb, topic, md) {
  const ws = wb.addWorksheet(sheetNameFromTopic(topic));
  ws.getColumn(1).width = 110;
  let row = 1;
  for (const line of md.split('\n')) {
    const cell = ws.getCell(row, 1);
    cell.value = line;
    if (line.startsWith('# ')) {
      cell.font = { bold: true, size: 16, color: { argb: 'FF1F4E78' } };
    } else if (line.startsWith('## ')) {
      cell.font = { bold: true, size: 13, color: { argb: 'FF305496' } };
    } else if (line.startsWith('### ')) {
      cell.font = { bold: true, size: 11 };
    } else if (line.startsWith('|')) {
      cell.font = { name: 'Menlo', size: 10 };
    } else if (line.startsWith('```') || line.startsWith('    ')) {
      cell.font = { name: 'Menlo', size: 10 };
    }
    row++;
  }
}

function buildIndex(wb, topics) {
  const ws = wb.addWorksheet('Index');
  ws.columns = [
    { header: 'Topic', key: 'topic', width: 30 },
    { header: 'Last verified', key: 'last_verified', width: 14 },
    { header: 'Lines', key: 'lines', width: 8 },
    { header: 'First section', key: 'first_h2', width: 50 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const t of topics) {
    ws.addRow({
      topic: t.topic,
      last_verified: t.fm.last_verified || '',
      lines: t.lines,
      first_h2: t.firstH2,
    });
  }
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'etsy-rules/build-excel.js';
  wb.created = new Date();

  const topicDirs = listTopicDirs();
  const summaries = [];
  for (const topic of topicDirs) {
    const mdPath = path.join(ROOT, topic, 'rules.md');
    if (!fs.existsSync(mdPath)) continue;
    const md = fs.readFileSync(mdPath, 'utf8');
    summaries.push({
      topic,
      fm: readFrontmatter(md),
      lines: md.split('\n').length,
      firstH2: firstH2(md),
    });
  }

  buildIndex(wb, summaries);

  for (const s of summaries) {
    const md = fs.readFileSync(path.join(ROOT, s.topic, 'rules.md'), 'utf8');
    addTopicSheet(wb, s.topic, md);
  }

  await wb.xlsx.writeFile(OUT);
  console.log(`Wrote ${OUT} (${summaries.length} topics)`);

  if (!SKIP_DRIVE && fs.existsSync(DRIVE_DIR)) {
    const dst = path.join(DRIVE_DIR, 'rules-export.xlsx');
    fs.copyFileSync(OUT, dst);
    console.log(`Copied to ${dst}`);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
