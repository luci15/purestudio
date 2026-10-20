'use strict';
// Shared server helpers for the Pure Studio API (sessions, rate limits, blocklist, Supabase REST + Auth).
// Files under api/_lib are not exposed as routes by Vercel.
const crypto = require('crypto');

const TABLES = ['clients', 'invoices', 'settings', 'cash_entries', 'expenses'];
const SESSION_COOKIE = 'ps_session';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;                       // failed logins per IP / per device per window
const AUTO_BLOCK_FAILS = 20;               // failed logins in 24h -> auto-block
const AUTO_BLOCK_MS = 24 * 60 * 60 * 1000;
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MIN_PASSWORD = 12;

function env(name) { return (process.env[name] || '').trim(); }
// OWNER_EMAIL may list several super admins, separated by commas: owner1@x.com, owner2@x.com
function ownerEmails() { return env('OWNER_EMAIL').split(/[,;\s]+/).map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean); }
function isOwnerEmail(email) { return ownerEmails().indexOf(String(email || '').trim().toLowerCase()) !== -1; }
// Total accounts allowed, counting every super admin (OWNER_EMAIL) plus staff.
function maxUsers() { return Math.min(Math.max(parseInt(env('MAX_USERS'), 10) || 3, 1), 10); }
var EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function authConfigured() {
  return !!(ownerEmails().length && env('SESSION_SECRET').length >= 32 &&
    env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY') && env('SUPABASE_ANON_KEY'));
}

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

// ---------- sessions (HMAC-signed, HttpOnly cookie) ----------
function sessionHours() { return Math.min(Math.max(parseInt(env('SESSION_HOURS'), 10) || 24, 1), 24 * 30); }
function hmac(body) { return crypto.createHmac('sha256', env('SESSION_SECRET')).update(body).digest('base64url'); }
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
function setSessionCookie(req, res, email, deviceId) {
  var ms = sessionHours() * 3600 * 1000;
  var token = signSession({ u: email, d: deviceId, iat: Date.now(), exp: Date.now() + ms });
  res.setHeader('Set-Cookie', cookieString(req, token, Math.floor(ms / 1000)));
}
function clearSessionCookie(req, res) { res.setHeader('Set-Cookie', cookieString(req, '', 0)); }
function safeEqualStr(a, b) {
  var ha = crypto.createHash('sha256').update(String(a)).digest();
  var hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

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
    var err = new Error('Database error');
    err.status = 502;
    throw err;
  }
  return data;
}

// ---------- Supabase Auth (GoTrue) — used only server-side; its tokens never reach the browser ----------
// Returns { status, data }. 4xx are returned for the caller to interpret; network/5xx/429 throw 503.
async function gotrue(method, path, opts) {
  opts = opts || {};
  var anon = env('SUPABASE_ANON_KEY');
  var headers = { apikey: opts.admin ? env('SUPABASE_SERVICE_ROLE_KEY') : anon, 'Content-Type': 'application/json' };
  if (opts.admin) { if (env('SUPABASE_SERVICE_ROLE_KEY').indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY'); }
  else if (opts.token) headers.Authorization = 'Bearer ' + opts.token;      // a user's own access token
  else if (anon.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + anon; // legacy JWT anon key only (new sb_publishable_ keys go in apikey only)
  var res;
  try {
    res = await fetch(baseUrl() + '/auth/v1/' + path, {
      method: method,
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) { throw unavailable(); }
  var text = await res.text();
  var data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
  if (res.status >= 500 || res.status === 429) {
    console.error('[api] gotrue ' + res.status + ' ' + method + ' ' + path.split('?')[0]);
    var e2 = new Error(res.status === 429 ? 'Too many requests to the sign-in service. Try again in a minute.' : 'Sign-in service unavailable (is the Supabase project paused?)');
    e2.status = 503;
    throw e2;
  }
  return { status: res.status, data: data || {} };
}

// ---------- users: the super admin(s) (OWNER_EMAIL) + staff in app_users, MAX_USERS accounts in total ----------
var userCache = { at: 0, rows: [] };
function invalidateUsers() { userCache.at = 0; }
async function loadUsers() {
  if (Date.now() - userCache.at < 15000) return userCache.rows;
  var rows = await sb('GET', 'app_users?select=email,role,active,created_at,created_by&order=created_at.asc&limit=50');
  userCache = { at: Date.now(), rows: rows || [] };
  return userCache.rows;
}
// { email, role: 'owner'|'staff' } for an allowed, active account; null otherwise.
async function getMember(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return null;
  if (isOwnerEmail(email)) return { email: email, role: 'owner' };
  var rows = await loadUsers();
  var row = rows.find(function (r) { return r.email === email && r.active; });
  return row ? { email: email, role: row.role || 'staff' } : null;
}

// Password check via Supabase Auth. Any other outcome (wrong password, not an allowed account, unconfirmed) is a plain "no".
async function verifyUserPassword(email, password) {
  email = String(email || '').trim().toLowerCase();
  var r = await gotrue('POST', 'token?grant_type=password', { body: { email: email, password: String(password || '') } });
  var user = r.data && r.data.user;
  if (r.status === 200 && user && String(user.email || '').toLowerCase() === email) {
    var member = await getMember(email);
    if (member) return { ok: true, user: user, member: member };
  }
  return { ok: false };
}

// Supabase Auth admin helpers (service role)
async function authAdminFind(email) {
  var r = await gotrue('GET', 'admin/users?per_page=200', { admin: true });
  var list = (r.data && r.data.users) || [];
  return list.find(function (u) { return String(u.email || '').toLowerCase() === email; }) || null;
}

// ---------- "sign this user out everywhere" marker (set on password change/reset/disable) ----------
var validAfterCache = {};
async function getValidAfter(email) {
  var c = validAfterCache[email];
  if (c && Date.now() - c.at < 30000) return c.value;
  var rows = await sb('GET', 'auth_state?select=value&key=eq.' + encodeURIComponent('valid_after:' + email) + '&limit=1');
  var v = (rows && rows[0] && parseInt(rows[0].value, 10)) || 0;
  validAfterCache[email] = { at: Date.now(), value: v };
  return v;
}
async function setValidAfter(email, ms) {
  await sb('POST', 'auth_state?on_conflict=key', {
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { key: 'valid_after:' + email, value: String(ms) }
  });
  validAfterCache[email] = { at: Date.now(), value: ms };
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

// ---------- login attempt log / lockout ----------
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
    await addBlock(kind, value, 'Auto: ' + AUTO_BLOCK_FAILS + ' failed logins in 24h', 'auto', new Date(Date.now() + AUTO_BLOCK_MS).toISOString());
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
// True if the cookie is for an allowed, active account, on this device, issued after any sign-out marker.
async function sessionValid(session, deviceId) {
  if (!session || session.d !== deviceId || !session.u) return null;
  var member = await getMember(session.u);
  if (!member) return null;
  if (session.iat < await getValidAfter(member.email)) return null;
  return member;
}
// Returns { ip, deviceId, session, member } or sends the error response and returns null.
// requireSession(req, res, 'owner') additionally restricts to the super admin.
async function requireSession(req, res, only) {
  if (!authConfigured()) { send(res, 503, { error: 'Server login is not configured' }); return null; }
  var session = verifySession(parseCookies(req)[SESSION_COOKIE]);
  if (!session) { send(res, 401, { error: 'Not signed in' }); return null; }   // e.g. someone typing an /api URL in the address bar
  var deviceId = getDeviceId(req);
  if (!deviceId) { send(res, 400, { error: 'Missing device id' }); return null; }
  if (session.d !== deviceId) { send(res, 401, { error: 'Not signed in' }); return null; }
  var ip = getIp(req);
  var wait = rateLimit('api:' + ip, 240, 60 * 1000);
  if (wait) { send(res, 429, { error: 'Too many requests' }, { 'Retry-After': String(wait) }); return null; }
  var member = await sessionValid(session, deviceId);
  if (!member) { clearSessionCookie(req, res); send(res, 401, { error: 'Not signed in' }); return null; }
  var blocked = await findBlock(ip, deviceId);
  if (blocked) { clearSessionCookie(req, res); send(res, 403, { error: 'Access denied' }); return null; }
  if (only === 'owner' && member.role !== 'owner') { send(res, 403, { error: 'Super admin only' }); return null; }
  return { ip: ip, deviceId: deviceId, session: session, member: member };
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
  TABLES, SESSION_COOKIE, LOGIN_WINDOW_MS, MAX_FAILS, AUTO_BLOCK_FAILS, AUTO_BLOCK_MS, DEVICE_RE, MIN_PASSWORD, EMAIL_RE,
  env, ownerEmails, isOwnerEmail, maxUsers, authConfigured, send, handle, getIp, getDeviceId, getUserAgent, normalizeIp,
  parseCookies, verifySession, setSessionCookie, clearSessionCookie, sessionHours, safeEqualStr,
  sb, gotrue, verifyUserPassword, authAdminFind, loadUsers, getMember, invalidateUsers,
  getValidAfter, setValidAfter, sessionValid,
  findBlock, addBlock, invalidateBlocks, loadBlocks, rateLimit,
  recentFailures, logAttempt, checkLock, recordFailure, requireSession
};
