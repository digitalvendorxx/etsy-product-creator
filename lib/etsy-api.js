const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const ETSY_API_BASE = process.env.ETSY_API_BASE || 'https://api.etsy.com/v3/application';

const ENV_KEYS = new Set([
  'ETSY_API_KEY',
  'ETSY_ACCESS_TOKEN',
  'ETSY_REFRESH_TOKEN',
  'ETSY_USER_ID',
  'ETSY_SHOP_ID',
  'ETSY_SHOP_NAME',
  'ETSY_REDIRECT_URI',
  'ETSY_SCOPES',
  'ETSY_OAUTH_STATE',
  'ETSY_OAUTH_VERIFIER',
  'ETSY_TOKEN_EXPIRES_AT',
]);

function cleanEnvValue(value) {
  return String(value || '').replace(/[\r\n]/g, '').trim();
}

function mask(value) {
  const s = cleanEnvValue(value);
  if (!s) return '';
  if (s.length <= 8) return '***configured***';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function getEtsyApiConfig() {
  return {
    apiKey: cleanEnvValue(process.env.ETSY_API_KEY),
    accessToken: cleanEnvValue(process.env.ETSY_ACCESS_TOKEN),
    refreshToken: cleanEnvValue(process.env.ETSY_REFRESH_TOKEN),
    userId: cleanEnvValue(process.env.ETSY_USER_ID),
    shopId: cleanEnvValue(process.env.ETSY_SHOP_ID),
    shopName: cleanEnvValue(process.env.ETSY_SHOP_NAME),
    redirectUri: cleanEnvValue(process.env.ETSY_REDIRECT_URI),
    scopes: cleanEnvValue(process.env.ETSY_SCOPES) || 'shops_r listings_r listings_w transactions_r transactions_w',
    tokenExpiresAt: cleanEnvValue(process.env.ETSY_TOKEN_EXPIRES_AT),
    baseUrl: ETSY_API_BASE,
  };
}

function getKeystring(apiKey = getEtsyApiConfig().apiKey) {
  return cleanEnvValue(apiKey).split(':')[0] || '';
}

function getPublicEtsyApiStatus() {
  const cfg = getEtsyApiConfig();
  return {
    apiKey: mask(cfg.apiKey),
    accessToken: mask(cfg.accessToken),
    refreshToken: mask(cfg.refreshToken),
    userId: cfg.userId ? mask(cfg.userId) : '',
    shopId: cfg.shopId || '',
    shopName: cfg.shopName || '',
    redirectUri: cfg.redirectUri || '',
    scopes: cfg.scopes || '',
    tokenExpiresAt: cfg.tokenExpiresAt || '',
    configured: !!(cfg.apiKey && cfg.accessToken && cfg.shopId),
    oauthReady: !!(cfg.apiKey && cfg.redirectUri),
    commercialReady: !!(cfg.apiKey && cfg.redirectUri && cfg.accessToken && cfg.shopId),
  };
}

function etsyHeaders({ oauth = true, contentType } = {}) {
  const cfg = getEtsyApiConfig();
  if (!cfg.apiKey) throw new Error('ETSY_API_KEY eksik. .env icine keystring:shared_secret olarak ekleyin.');
  if (oauth && !cfg.accessToken) throw new Error('ETSY_ACCESS_TOKEN eksik. OAuth token gerekli.');

  const headers = {
    'x-api-key': cfg.apiKey,
  };
  if (oauth) headers.Authorization = `Bearer ${cfg.accessToken}`;
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

async function etsyRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : ETSY_API_BASE + endpoint;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...etsyHeaders({ oauth: options.oauth !== false, contentType: options.contentType }),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = { raw: text }; }
  }
  if (!response.ok) {
    const msg = body?.error || body?.message || body?.raw || `Etsy API HTTP ${response.status}`;
    throw new Error(msg);
  }
  return body || {};
}

function normalizeSections(body) {
  const raw = Array.isArray(body)
    ? body
    : (Array.isArray(body.results) ? body.results : (Array.isArray(body.data?.results) ? body.data.results : []));
  return raw.map(s => ({
    id: String(s.shop_section_id || s.section_id || s.id || ''),
    title: s.title || s.name || '',
  })).filter(s => s.id && s.title);
}

async function listShopSections() {
  const cfg = getEtsyApiConfig();
  if (!cfg.shopId) throw new Error('ETSY_SHOP_ID eksik.');
  const body = await etsyRequest(`/shops/${encodeURIComponent(cfg.shopId)}/sections`, { method: 'GET' });
  return normalizeSections(body);
}

function normalizeResults(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.data?.results)) return body.data.results;
  return [];
}

async function listShopListings({ state = 'active', limit = 50 } = {}) {
  const cfg = getEtsyApiConfig();
  if (!cfg.shopId) throw new Error('ETSY_SHOP_ID eksik.');
  const safeState = ['active', 'draft', 'inactive', 'expired'].includes(state) ? state : 'active';
  const body = await etsyRequest(`/shops/${encodeURIComponent(cfg.shopId)}/listings/${safeState}?limit=${Math.min(Number(limit) || 50, 100)}`, { method: 'GET' });
  return normalizeResults(body);
}

async function listShopReceipts({ limit = 50 } = {}) {
  const cfg = getEtsyApiConfig();
  if (!cfg.shopId) throw new Error('ETSY_SHOP_ID eksik.');
  const body = await etsyRequest(`/shops/${encodeURIComponent(cfg.shopId)}/receipts?limit=${Math.min(Number(limit) || 50, 100)}`, { method: 'GET' });
  return normalizeResults(body);
}

async function listShippingProfiles() {
  const cfg = getEtsyApiConfig();
  if (!cfg.shopId) throw new Error('ETSY_SHOP_ID eksik.');
  const body = await etsyRequest(`/shops/${encodeURIComponent(cfg.shopId)}/shipping-profiles`, { method: 'GET' });
  return normalizeResults(body);
}

async function getShopInfo() {
  const cfg = getEtsyApiConfig();
  if (!cfg.shopId) throw new Error('ETSY_SHOP_ID eksik.');
  return etsyRequest(`/shops/${encodeURIComponent(cfg.shopId)}`, { method: 'GET' });
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createCodeVerifier() {
  return base64Url(crypto.randomBytes(48)).slice(0, 96);
}

function createCodeChallenge(verifier) {
  return base64Url(crypto.createHash('sha256').update(verifier).digest());
}

function createOAuthStart({ redirectUri, scopes } = {}) {
  const cfg = getEtsyApiConfig();
  const clientId = getKeystring(cfg.apiKey);
  const callback = cleanEnvValue(redirectUri || cfg.redirectUri);
  const scopeText = cleanEnvValue(scopes || cfg.scopes);
  if (!clientId) throw new Error('ETSY_API_KEY keystring eksik.');
  if (!callback) throw new Error('ETSY_REDIRECT_URI eksik.');
  const state = base64Url(crypto.randomBytes(24));
  const verifier = createCodeVerifier();
  const challenge = createCodeChallenge(verifier);
  writeEnvValues({
    ETSY_OAUTH_STATE: state,
    ETSY_OAUTH_VERIFIER: verifier,
    ETSY_REDIRECT_URI: callback,
    ETSY_SCOPES: scopeText,
  });
  const url = new URL('https://www.etsy.com/oauth/connect');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', callback);
  url.searchParams.set('scope', scopeText);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.toString(), state, redirectUri: callback, scopes: scopeText };
}

async function exchangeOAuthCode({ code, state }) {
  const cfg = getEtsyApiConfig();
  const expectedState = cleanEnvValue(process.env.ETSY_OAUTH_STATE);
  const verifier = cleanEnvValue(process.env.ETSY_OAUTH_VERIFIER);
  const clientId = getKeystring(cfg.apiKey);
  if (!code) throw new Error('OAuth code eksik.');
  if (!state || !expectedState || state !== expectedState) throw new Error('OAuth state eslesmedi.');
  if (!verifier) throw new Error('OAuth verifier eksik.');
  if (!clientId) throw new Error('ETSY_API_KEY keystring eksik.');
  if (!cfg.redirectUri) throw new Error('ETSY_REDIRECT_URI eksik.');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: cfg.redirectUri,
    code,
    code_verifier: verifier,
  });
  const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error_description || body.error || body.message || `Etsy OAuth HTTP ${response.status}`);
  }
  const userId = String(body.access_token || '').split('.')[0] || '';
  const expiresAt = body.expires_in ? String(Date.now() + Number(body.expires_in) * 1000) : '';
  writeEnvValues({
    ETSY_ACCESS_TOKEN: body.access_token || '',
    ETSY_REFRESH_TOKEN: body.refresh_token || '',
    ETSY_USER_ID: userId,
    ETSY_TOKEN_EXPIRES_AT: expiresAt,
    ETSY_OAUTH_STATE: '',
    ETSY_OAUTH_VERIFIER: '',
  });
  return { accessToken: mask(body.access_token), refreshToken: mask(body.refresh_token), userId: mask(userId), expiresAt };
}

async function refreshOAuthToken() {
  const cfg = getEtsyApiConfig();
  const clientId = getKeystring(cfg.apiKey);
  if (!clientId) throw new Error('ETSY_API_KEY keystring eksik.');
  if (!cfg.refreshToken) throw new Error('ETSY_REFRESH_TOKEN eksik.');
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: cfg.refreshToken,
  });
  const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error_description || body.error || body.message || `Etsy OAuth HTTP ${response.status}`);
  }
  const userId = String(body.access_token || '').split('.')[0] || cfg.userId;
  const expiresAt = body.expires_in ? String(Date.now() + Number(body.expires_in) * 1000) : '';
  writeEnvValues({
    ETSY_ACCESS_TOKEN: body.access_token || '',
    ETSY_REFRESH_TOKEN: body.refresh_token || cfg.refreshToken,
    ETSY_USER_ID: userId,
    ETSY_TOKEN_EXPIRES_AT: expiresAt,
  });
  return { accessToken: mask(body.access_token), refreshToken: mask(body.refresh_token || cfg.refreshToken), userId: mask(userId), expiresAt };
}

async function getEtsyOperationalSnapshot() {
  const status = getPublicEtsyApiStatus();
  if (!status.configured) {
    return {
      ready: false,
      status,
      message: 'Etsy API icin keystring:shared_secret, OAuth access token ve shop id gerekli.',
      listings: [],
      receipts: [],
      shippingProfiles: [],
      sections: [],
    };
  }
  const [shop, sections, activeListings, draftListings, receipts, shippingProfiles] = await Promise.allSettled([
    getShopInfo(),
    listShopSections(),
    listShopListings({ state: 'active', limit: 50 }),
    listShopListings({ state: 'draft', limit: 50 }),
    listShopReceipts({ limit: 50 }),
    listShippingProfiles(),
  ]);
  const unwrap = (result, fallback) => result.status === 'fulfilled' ? result.value : fallback;
  const errors = [shop, sections, activeListings, draftListings, receipts, shippingProfiles]
    .filter(r => r.status === 'rejected')
    .map(r => r.reason?.message || String(r.reason));
  const active = unwrap(activeListings, []);
  const drafts = unwrap(draftListings, []);
  const recs = unwrap(receipts, []);
  const profiles = unwrap(shippingProfiles, []);
  return {
    ready: errors.length === 0,
    status,
    errors,
    shop: unwrap(shop, null),
    sections: unwrap(sections, []),
    listings: active.slice(0, 20).map(l => ({
      listingId: l.listing_id,
      title: l.title,
      state: l.state,
      quantity: l.quantity,
      price: l.price?.amount ? Number(l.price.amount) / (l.price.divisor || 100) : l.price,
      views: l.views,
      numFavorers: l.num_favorers,
      expiresAt: l.ending_tsz || l.expires_timestamp || null,
    })),
    summary: {
      activeListings: active.length,
      draftListings: drafts.length,
      openReceipts: recs.length,
      shippingProfiles: profiles.length,
      sections: unwrap(sections, []).length,
    },
    receipts: recs.slice(0, 20).map(r => ({
      receiptId: r.receipt_id,
      name: r.name || r.first_line || '',
      status: r.status || r.was_paid ? 'paid' : '',
      isShipped: !!r.was_shipped,
      grandTotal: r.grandtotal || r.grand_total || null,
      createdAt: r.created_timestamp || r.create_timestamp || r.created_tsz || null,
    })),
    shippingProfiles: profiles.slice(0, 20).map(p => ({
      id: p.shipping_profile_id,
      title: p.title,
      originCountryIso: p.origin_country_iso,
    })),
  };
}

function serializeEnvValue(value) {
  const v = cleanEnvValue(value);
  if (!/[#\s"'\\]/.test(v)) return v;
  return JSON.stringify(v);
}

function writeEnvValues(values) {
  const clean = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (!ENV_KEYS.has(key)) continue;
    const v = cleanEnvValue(value);
    const allowBlank = key === 'ETSY_OAUTH_STATE' || key === 'ETSY_OAUTH_VERIFIER';
    if ((!v && !allowBlank) || v === '***configured***') continue;
    clean[key] = v;
    process.env[key] = v;
  }
  if (Object.keys(clean).length === 0) return false;

  let lines = [];
  try { lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/); }
  catch { lines = []; }

  const seen = new Set();
  lines = lines.map(line => {
    const m = line.match(/^([A-Z0-9_]+)\s*=/);
    if (!m || clean[m[1]] === undefined) return line;
    seen.add(m[1]);
    return `${m[1]}=${serializeEnvValue(clean[m[1]])}`;
  });

  for (const [key, value] of Object.entries(clean)) {
    if (!seen.has(key)) lines.push(`${key}=${serializeEnvValue(value)}`);
  }

  fs.writeFileSync(ENV_PATH, lines.join('\n').replace(/\n*$/, '\n'));
  return true;
}

module.exports = {
  createOAuthStart,
  exchangeOAuthCode,
  refreshOAuthToken,
  getEtsyApiConfig,
  getEtsyOperationalSnapshot,
  getKeystring,
  getPublicEtsyApiStatus,
  listShippingProfiles,
  listShopListings,
  listShopReceipts,
  listShopSections,
  writeEnvValues,
};
