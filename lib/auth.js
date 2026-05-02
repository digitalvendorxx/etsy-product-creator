const jwt = require('jsonwebtoken');
const { createUser, authenticateUser, getUserById, saveEtsyCookies, savePinterestCookies } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'etsy-creator-secret-' + require('crypto').randomBytes(16).toString('hex');

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

// Auth middleware - attaches req.user if valid token
function authMiddleware(req, res, next) {
  // Skip auth for login/signup/static
  const publicPaths = ['/api/auth/login', '/api/auth/signup', '/login.html'];
  if (publicPaths.some(p => req.path === p) || req.path.match(/\.(css|js|ico|png|jpg|svg|woff2?)$/)) {
    return next();
  }

  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token) {
    // For API calls return 401, for pages redirect to login
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Giris yapmaniz gerekiyor' });
    return res.redirect('/login.html');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.id);
    if (!user) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Kullanici bulunamadi' });
      return res.redirect('/login.html');
    }
    req.user = user;
    next();
  } catch (err) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Oturum suresi doldu' });
    return res.redirect('/login.html');
  }
}

function setupAuthRoutes(app) {
  console.log('[AUTH] Registering auth routes...');
  app.post('/api/auth/signup', (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email ve sifre gerekli' });
      if (password.length < 6) return res.status(400).json({ error: 'Sifre en az 6 karakter olmali' });
      const user = createUser(email, password, name);
      const token = generateToken(user);
      res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email ve sifre gerekli' });
    const user = authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: 'Email veya sifre hatali' });
    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giris yapmaniz gerekiyor' });
    res.json({
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      hasEtsy: !!req.user.etsy_cookies,
      hasPinterest: !!req.user.pinterest_cookies,
    });
  });

  // Save Etsy cookies
  app.post('/api/auth/etsy-cookies', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giris gerekli' });
    const { cookies } = req.body;
    if (!cookies) return res.status(400).json({ error: 'Cookie verisi gerekli' });
    saveEtsyCookies(req.user.id, cookies);
    res.json({ ok: true });
  });

  // Save Pinterest cookies
  app.post('/api/auth/pinterest-cookies', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giris gerekli' });
    const { cookies } = req.body;
    if (!cookies) return res.status(400).json({ error: 'Cookie verisi gerekli' });
    savePinterestCookies(req.user.id, cookies);
    res.json({ ok: true });
  });
}

module.exports = { authMiddleware, setupAuthRoutes, JWT_SECRET };
