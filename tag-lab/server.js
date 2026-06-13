const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const multer = require('multer');
const { extractKeywords } = require('./extract-keywords');
const { scrapeRich } = require('./scrape-rich');
const { runTagLabPipeline } = require('../lib/tag-lab-pipeline');

const app = express();
const PORT = parseInt(process.env.TAG_LAB_PORT || '3002', 10);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  if (req.path === '/' || /\.html?$/i.test(req.path)) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0, index: false }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/extract', upload.single('design'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'design required' });
    const mime = req.file.mimetype || 'image/png';
    const apiKey = process.env.OPENROUTER_API_KEY;
    const { keywords, themeWords } = await extractKeywords(req.file.buffer, mime, apiKey);
    res.json({ keywords, themeWords });
  } catch (err) {
    console.error('[extract]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/etsyhunt', async (req, res) => {
  try {
    const { keyword, limit } = req.body || {};
    if (!keyword || !String(keyword).trim()) return res.status(400).json({ error: 'keyword required' });
    const rows = await scrapeRich(String(keyword).trim(), { limit: Math.min(parseInt(limit) || 50, 200) });
    res.json({ keyword, rows });
  } catch (err) {
    console.error('[etsyhunt]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/run', upload.single('design'), async (req, res) => {
  res.set('Content-Type', 'text/event-stream');
  res.set('Cache-Control', 'no-cache');
  res.set('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event, data) => {
    res.write('event: ' + event + '\n');
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  };
  try {
    if (!req.file) { send('error', { message: 'design required' }); return res.end(); }
    const perKwLimit = Math.max(10, Math.min(parseInt(req.body.perKwLimit) || 50, 200));
    const minScore = parseFloat(req.body.minScore);
    const result = await runTagLabPipeline({
      imageBuffer: req.file.buffer,
      mime: req.file.mimetype || 'image/png',
      apiKey: process.env.OPENROUTER_API_KEY,
      perKwLimit,
      targetCount: 13,
      minScore: isNaN(minScore) ? 60 : minScore,
      maxRetries: 10,
      onLog: (message) => send('log', { message }),
      onKeywords: (keywords, retry) => send('keywords', { keywords, retry }),
      onResult: (keyword, count, top, error) => send('result', { keyword, count, top, error }),
      onProgress: (count, avgScore) => send('best-progress', { count, avgScore }),
    });
    send('best', { rows: result.rows });
    if (result.title || result.description) {
      send('listing', { title: result.title, description: result.description });
    }
    send('done', {});
    res.end();
  } catch (err) {
    send('error', { message: err.message });
    res.end();
  }
});

app.listen(PORT, () => console.log('Tag Lab running at http://localhost:' + PORT));
