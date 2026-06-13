const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT,
    plan TEXT DEFAULT 'free',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    etsy_cookies TEXT,
    pinterest_cookies TEXT
  );
`);

// Add plan column if missing (migration for existing DBs)
try { db.exec(`ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'`); } catch {}

// Usage tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    designs INTEGER DEFAULT 0,
    mockups INTEGER DEFAULT 0,
    uploads INTEGER DEFAULT 0,
    pins INTEGER DEFAULT 0,
    UNIQUE(user_id, date)
  );
`);

// Plan limits
const PLAN_LIMITS = {
  free:  { designs: 3,  mockups: 5,   uploads: 0,  pins: 0,  label: 'Ucretsiz' },
  basic: { designs: 25, mockups: 50,  uploads: 25, pins: 25, label: 'Basic' },
  pro:   { designs: -1, mockups: -1,  uploads: -1, pins: -1, label: 'Pro' }, // -1 = unlimited
};

function createUser(email, password, name) {
  const hash = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare('INSERT INTO users (email, password, name, plan) VALUES (?, ?, ?, ?)');
    const result = stmt.run(email.toLowerCase().trim(), hash, name || '', 'free');
    return { id: result.lastInsertRowid, email: email.toLowerCase().trim(), plan: 'free' };
  } catch (err) {
    if (err.message.includes('UNIQUE')) throw new Error('Bu email zaten kayitli');
    throw err;
  }
}

function authenticateUser(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password)) return null;
  return { id: user.id, email: user.email, name: user.name, plan: user.plan || 'free' };
}

function getUserById(id) {
  return db.prepare('SELECT id, email, name, plan, etsy_cookies, pinterest_cookies FROM users WHERE id = ?').get(id);
}

function saveEtsyCookies(userId, cookies) {
  db.prepare('UPDATE users SET etsy_cookies = ? WHERE id = ?').run(cookies, userId);
}

function savePinterestCookies(userId, cookies) {
  db.prepare('UPDATE users SET pinterest_cookies = ? WHERE id = ?').run(cookies, userId);
}

function getUserUsageToday(userId) {
  const today = new Date().toISOString().split('T')[0];
  let row = db.prepare('SELECT * FROM usage WHERE user_id = ? AND date = ?').get(userId, today);
  if (!row) {
    db.prepare('INSERT INTO usage (user_id, date) VALUES (?, ?)').run(userId, today);
    row = { designs: 0, mockups: 0, uploads: 0, pins: 0 };
  }
  return { designs: row.designs, mockups: row.mockups, uploads: row.uploads, pins: row.pins };
}

function incrementUsage(userId, field) {
  const today = new Date().toISOString().split('T')[0];
  db.prepare('INSERT OR IGNORE INTO usage (user_id, date) VALUES (?, ?)').run(userId, today);
  db.prepare(`UPDATE usage SET ${field} = ${field} + 1 WHERE user_id = ? AND date = ?`).run(userId, today);
}

function checkUsageLimit(userId, field) {
  const user = getUserById(userId);
  const plan = PLAN_LIMITS[user?.plan || 'free'];
  if (plan[field] === -1) return { allowed: true, remaining: -1 };
  const usage = getUserUsageToday(userId);
  const remaining = plan[field] - (usage[field] || 0);
  return { allowed: remaining > 0, remaining };
}

function setUserPlan(userId, plan) {
  if (!PLAN_LIMITS[plan]) throw new Error('Gecersiz plan: ' + plan);
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
}

module.exports = {
  db, createUser, authenticateUser, getUserById,
  saveEtsyCookies, savePinterestCookies,
  getUserUsageToday, incrementUsage, checkUsageLimit, setUserPlan,
  PLAN_LIMITS,
};
