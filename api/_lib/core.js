'use strict';
// Shared server helpers for the Pure Studio API: one site password (set once, then permanent), signed session
// cookies, rate limiting, IP/device blocklist, and the Supabase REST gateway. Files under api/_lib are not routes.
const crypto = require('crypto');

const TABLES = ['clients', 'invoices', 'settings', 'cash_entries', 'expenses'];
const SESSION_COOKIE = 'ps_session';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;                       // failed attempts per IP / per device per window
const AUTO_BLOCK_FAILS = 20;               // failed attempts in 24h -> auto-block
const AUTO_BLOCK_MS = 24 * 60 * 60 * 1000;
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MIN_PASSWORD = 12;

function env(name) { return (process.env[name] || '').trim(); }
function authConfigured() { return !!(env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY')); }

function send(res, status, body, extraHeaders) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.keys(extraHeaders || {}).forEach(function (k) { res.setHeader(k, extraHeaders[k]); });
  return res.status(status).json(body);
}

// ---------- request identity ----------
function expandIPv6(ip) {
  var parts = ip.split('::');
  var head = parts[0] ? parts[0].split(':') : [];
  var tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  var fill = parts.length > 1 ? new Array(Math.max(0, 8 - head.length - tail.length)).fill('0') : [];
  return head.concat(fill, tail).map(function (g) { return (g || '0').toLowerCase().replace(/^0+(?=.)/, ''); });
}
// IPv4 stays as-is; IPv6 collapses to its /64 so rotating within a subnet doesn't dodge limits.
function normalizeIp(raw) {
  var ip = String(raw || '').trim();
  if (ip.indexOf('::ffff:') === 0) ip = ip.slice(7);
  if (!ip) return 'unknown';
  if (ip.indexOf(':') === -1) return ip.slice(0, 45);
  return expandIPv6(ip).slice(0, 4).join(':') + '::/64';
}
function getIp(req) {
  var h = req.headers || {};
  var raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] ||
    (req.socket && req.socket.remoteAddress) || '';
  return normalizeIp(raw);
}
function getDeviceId(req) {
  var d = String((req.headers || {})['x-device-id'] || '');
  return DEVICE_RE.test(d) ? d : '';
}
function getUserAgent(req) { return String((req.headers || {})['user-agent'] || '').slice(0, 200); }

// ---------- password (scrypt) ----------
function hashPassword(password) {
  var N = 16384, r = 8, p = 1;
  var salt = crypto.randomBytes(16);
  var hash = crypto.scryptSync(password, salt, 64, { N: N, r: r, p: p });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}
function verifyPassword(password, stored) {
  try {
    var parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    var N = +parts[1], r = +parts[2], p = +parts[3];
    var salt = Buffer.from(parts[4], 'base64');
    var expected = Buffer.from(parts[5], 'base64');
    var got = crypto.scryptSync(String(password), salt, expected.length, { N: N, r: r, p: p, maxmem: 256 * N * r });
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch (e) { return false; }
}
function safeEqualStr(a, b) {
  var ha = crypto.createHash('sha256').update(String(a)).digest();
  var hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
// Identifies the current password: a session is only valid while it carries this id, so re-doing the
// first-time setup (after deleting the stored password) signs out every old session.
function hashId(storedHash) { return crypto.createHash('sha256').update(String(storedHash)).digest('base64url').slice(0, 16); }

// ---------- sessions (HMAC-signed, HttpOnly cookie) ----------
// The signing key is derived from the server-only service-role key, so there is no extra secret to configure
// and rotating that key also signs everyone out.
function sessionKey() { return crypto.createHmac('sha256', env('SUPABASE_SERVICE_ROLE_KEY')).update('purestudio-session-v1').digest(); }
function sessionHours() { return Math.min(Math.max(parseInt(env('SESSION_HOURS'), 10) || 24, 1), 24 * 30); }
function hmac(body) { return crypto.createHmac('sha256', sessionKey()).update(body).digest('base64url'); }
function signSession(payload) {
  var body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + hmac(body);
}
function verifySession(token) {
  if (!token || token.indexOf('.') === -1) return null;
  var idx = token.lastIndexOf('.');
  var body = token.slice(0, idx);
  var a = Buffer.from(token.slice(idx + 1));
  var b = Buffer.from(hmac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    var p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch (e) { return null; }
}
function parseCookies(req) {
  var out = {};
  String((req.headers || {}).cookie || '').split(';').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return out;
}
function isHttps(req) { return String((req.headers || {})['x-forwarded-proto'] || '').split(',')[0] === 'https'; }
function cookieString(req, value, maxAgeSec) {
  return SESSION_COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAgeSec + (isHttps(req) ? '; Secure' : '');
}
function setSessionCookie(req, res, deviceId, pwHash) {
  var ms = sessionHours() * 3600 * 1000;
  var token = signSession({ d: deviceId, h: hashId(pwHash), iat: Date.now(), exp: Date.now() + ms });
  res.setHeader('Set-Cookie', cookieString(req, token, Math.floor(ms / 1000)));
}
function clearSessionCookie(req, res) { res.setHeader('Set-Cookie', cookieString(req, '', 0)); }

// ---------- Supabase REST (service role, server only) ----------
function baseUrl() { return env('SUPABASE_URL').replace(/\/+$/, '').replace(/\/rest\/v1$/i, ''); }
function serviceHeaders() {
  var key = env('SUPABASE_SERVICE_ROLE_KEY');
  var h = { apikey: key, 'Content-Type': 'application/json' };
  if (key.indexOf('eyJ') === 0) h.Authorization = 'Bearer ' + key; // legacy JWT keys only
  return h;
}
function unavailable() {
  var e = new Error('Database unavailable (is the Supabase project paused?)');
  e.status = 503;
  return e;
}
async function sb(method, path, opts) {
  opts = opts || {};
  var headers = Object.assign(serviceHeaders(), opts.headers || {});
  var res;
  try {
    res = await fetch(baseUrl() + '/rest/v1/' + path, {
      method: method,
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) { throw unavailable(); }
  var text = await res.text();
  var data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  if (!res.ok) {
    console.error('[api] supabase ' + res.status + ' ' + method + ' ' + path.split('?')[0] + ': ' + ((data && data.message) || ''));
    if (res.status >= 500) throw unavailable();
    var err = new Error(res.status === 404 ? 'Database tables are missing - run schema.sql in the Supabase SQL editor' : 'Database error');
    err.status = res.status === 404 ? 503 : 502;
    throw err;
  }
  return data;
}

// ---------- the stored password ----------
var pwCache = { at: 0, hash: null };
async function getPasswordHash(fresh) {
  if (!fresh && pwCache.hash && Date.now() - pwCache.at < 30000) return pwCache.hash;
  var rows = await sb('GET', 'auth_state?select=value&key=eq.password_hash&limit=1');
  var h = (rows && rows[0] && rows[0].value) || null;
  pwCache = { at: Date.now(), hash: h };
  return h;
}
// Stores the password only if none exists yet (the first writer wins). Returns true if this call stored it.
async function storePasswordOnce(hash) {
  var rows = await sb('POST', 'auth_state?on_conflict=key', {
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: { key: 'password_hash', value: hash }
  });
  pwCache = { at: 0, hash: null };
  return Array.isArray(rows) && rows.length === 1;
}

// ---------- blocklist (cached briefly per instance) ----------
var blockCache = { at: 0, items: [] };
function invalidateBlocks() { blockCache.at = 0; }
async function loadBlocks() {
  if (Date.now() - blockCache.at < 30000) return blockCache.items;
  var rows = await sb('GET', 'blocked_entities?select=id,kind,value,reason,source,created_at,expires_at&order=created_at.desc&limit=500');
  blockCache = { at: Date.now(), items: rows || [] };
  return blockCache.items;
}
function isActive(b) { return !b.expires_at || new Date(b.expires_at).getTime() > Date.now(); }
async function findBlock(ip, deviceId) {
  var items = await loadBlocks();
  return items.find(function (b) {
    return isActive(b) && ((b.kind === 'ip' && b.value === ip) || (b.kind === 'device' && deviceId && b.value === deviceId));
  }) || null;
}
async function addBlock(kind, value, reason, source, expiresAt) {
  await sb('POST', 'blocked_entities?on_conflict=kind,value', {
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { kind: kind, value: value, reason: String(reason || '').slice(0, 200), source: source, expires_at: expiresAt || null }
  });
  invalidateBlocks();
}

// ---------- in-memory request limiter (best effort, per serverless instance) ----------
var buckets = new Map();
function rateLimit(key, limit, windowMs) {
  var now = Date.now();
  if (buckets.size > 5000) buckets.forEach(function (v, k) { if (now > v.reset) buckets.delete(k); });
  var b = buckets.get(key);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n <= limit ? 0 : Math.max(1, Math.ceil((b.reset - now) / 1000));
}

// ---------- attempt log / lockout ----------
async function recentFailures(column, value, sinceMs, limit) {
  var since = new Date(Date.now() - sinceMs).toISOString();
  return (await sb('GET', 'auth_attempts?select=created_at&' + column + '=eq.' + encodeURIComponent(value) +
    '&success=eq.false&created_at=gte.' + encodeURIComponent(since) + '&order=created_at.desc&limit=' + limit)) || [];
}
// Seconds until the next attempt is allowed, 0 if not locked.
function lockSeconds(failRows) {
  if (failRows.length < MAX_FAILS) return 0;
  var t = new Date(failRows[MAX_FAILS - 1].created_at).getTime() + LOGIN_WINDOW_MS;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}
async function logAttempt(ip, deviceId, ua, label, success) {
  await sb('POST', 'auth_attempts', {
    headers: { Prefer: 'return=minimal' },
    body: { ip: ip, device_id: deviceId || null, user_agent: ua, username: String(label || '').slice(0, 80), success: success }
  });
}
// Current failures for this IP and device, plus whether either is locked.
async function checkLock(ip, deviceId) {
  var fails = await Promise.all([
    recentFailures('ip', ip, LOGIN_WINDOW_MS, MAX_FAILS),
    recentFailures('device_id', deviceId, LOGIN_WINDOW_MS, MAX_FAILS)
  ]);
  return { fails: fails, lock: Math.max(lockSeconds(fails[0]), lockSeconds(fails[1])) };
}
function lockAfterNewFailure(rows) {
  // After the failure just logged, the (MAX-1)th previous failure becomes the MAXth most recent.
  if (rows.length < MAX_FAILS - 1) return 0;
  var t = new Date(rows[MAX_FAILS - 2].created_at).getTime() + LOGIN_WINDOW_MS;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}
async function autoBlock(kind, column, value) {
  if (!value) return;
  var rows = await recentFailures(column, value, AUTO_BLOCK_MS, AUTO_BLOCK_FAILS);
  if (rows.length >= AUTO_BLOCK_FAILS) {
    await addBlock(kind, value, 'Auto: ' + AUTO_BLOCK_FAILS + ' failed attempts in 24h', 'auto', new Date(Date.now() + AUTO_BLOCK_MS).toISOString());
  }
}
// Logs a failed attempt, applies auto-block, returns { attemptsLeft, retryAfter } for the response.
async function recordFailure(ip, deviceId, ua, label, lockState) {
  await logAttempt(ip, deviceId, ua, label, false);
  await Promise.all([autoBlock('ip', 'ip', ip), autoBlock('device', 'device_id', deviceId)]);
  var used = Math.max(lockState.fails[0].length, lockState.fails[1].length) + 1;
  var left = Math.max(0, MAX_FAILS - used);
  var retry = left === 0 ? Math.max(lockAfterNewFailure(lockState.fails[0]), lockAfterNewFailure(lockState.fails[1])) : 0;
  return { attemptsLeft: left, retryAfter: retry };
}

// ---------- session gate for data endpoints ----------
// Returns { ip, deviceId } or sends the error response and returns null.
async function requireSession(req, res) {
  if (!authConfigured()) { send(res, 503, { error: 'Server login is not configured' }); return null; }
  var session = verifySession(parseCookies(req)[SESSION_COOKIE]);
  if (!session) { send(res, 401, { error: 'Not signed in' }); return null; }   // e.g. someone typing an /api URL in the address bar
  var deviceId = getDeviceId(req);
  if (!deviceId) { send(res, 400, { error: 'Missing device id' }); return null; }
  if (session.d !== deviceId) { send(res, 401, { error: 'Not signed in' }); return null; }
  var ip = getIp(req);
  var wait = rateLimit('api:' + ip, 240, 60 * 1000);
  if (wait) { send(res, 429, { error: 'Too many requests' }, { 'Retry-After': String(wait) }); return null; }
  var pw = await getPasswordHash();
  if (!pw || session.h !== hashId(pw)) { clearSessionCookie(req, res); send(res, 401, { error: 'Not signed in' }); return null; }
  var blocked = await findBlock(ip, deviceId);
  if (blocked) { clearSessionCookie(req, res); send(res, 403, { error: 'Access denied' }); return null; }
  return { ip: ip, deviceId: deviceId };
}

// Wraps a handler so unexpected failures return clean JSON instead of leaking internals.
function handle(fn) {
  return async function (req, res) {
    try { await fn(req, res); }
    catch (e) {
      console.error('[api] ' + (e && e.message));
      if (!res.headersSent) send(res, (e && e.status) || 500, { error: (e && e.status) ? e.message : 'Server error' });
    }
  };
}

module.exports = {
  TABLES, SESSION_COOKIE, LOGIN_WINDOW_MS, MAX_FAILS, AUTO_BLOCK_FAILS, AUTO_BLOCK_MS, DEVICE_RE, MIN_PASSWORD,
  env, authConfigured, send, handle, getIp, getDeviceId, getUserAgent, normalizeIp,
  parseCookies, verifySession, setSessionCookie, clearSessionCookie, sessionHours, safeEqualStr,
  hashPassword, verifyPassword, hashId, getPasswordHash, storePasswordOnce,
  sb, findBlock, addBlock, invalidateBlocks, loadBlocks, rateLimit,
  recentFailures, logAttempt, checkLock, recordFailure, requireSession
};
