'use strict';
// /api/auth?action=session|setup|login|logout
// One site password. The very first visit sets it (guarded by a SETUP_CODE only you know); after that it is
// permanent. Every wrong attempt, for the setup code or the password, counts toward the IP/device lockout.
const c = require('./_lib/core');

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < c.MIN_PASSWORD) return 'Use at least ' + c.MIN_PASSWORD + ' characters.';
  if (pw.length > 200) return 'Password is too long.';
  return '';
}

module.exports = c.handle(async function (req, res) {
  var action = (req.query && req.query.action) || '';
  var body = req.body && typeof req.body === 'object' ? req.body : {};

  if (action === 'session' && req.method === 'GET') {
    if (!c.authConfigured()) return c.send(res, 200, { configured: false, authenticated: false, passwordSet: false });
    var pw = await c.getPasswordHash();
    var sess = c.verifySession(c.parseCookies(req)[c.SESSION_COOKIE]);
    var deviceId = c.getDeviceId(req);
    var ok = !!(pw && sess && deviceId && sess.d === deviceId && sess.h === c.hashId(pw));
    if (ok && await c.findBlock(c.getIp(req), deviceId)) ok = false;
    if (!ok && sess) c.clearSessionCookie(req, res);
    return c.send(res, 200, { configured: true, passwordSet: !!pw, setupCodeSet: !!c.env('SETUP_CODE'), authenticated: ok });
  }

  if (action === 'logout' && req.method === 'POST') {
    c.clearSessionCookie(req, res);
    return c.send(res, 200, { ok: true });
  }

  if (req.method !== 'POST' || (action !== 'login' && action !== 'setup')) {
    return c.send(res, 405, { error: 'Method not allowed' });
  }
  if (!c.authConfigured()) return c.send(res, 503, { error: 'Server login is not configured', configured: false });

  var did = c.getDeviceId(req);
  if (!did) return c.send(res, 400, { error: 'Missing device id' });
  var ip = c.getIp(req);
  var ua = c.getUserAgent(req);

  var burst = c.rateLimit(action + ':' + ip, 20, 60 * 1000);
  if (burst) return c.send(res, 429, { error: 'Too many requests', retryAfter: burst }, { 'Retry-After': String(burst) });
  if (await c.findBlock(ip, did)) return c.send(res, 403, { error: 'Access denied' });

  var stored = await c.getPasswordHash(action === 'setup'); // setup always checks the database, never a cached answer

  // ----- first-time setup -----
  if (action === 'setup') {
    if (stored) return c.send(res, 409, { error: 'The password is already set.', passwordSet: true });
    var expectedCode = c.env('SETUP_CODE');
    if (!expectedCode) {
      return c.send(res, 503, { error: 'First-time setup needs a SETUP_CODE. Add it in Vercel (Settings > Environment Variables), redeploy, then try again.', needsSetupCode: true });
    }
    var sl = await c.checkLock(ip, did);
    if (sl.lock) return c.send(res, 429, { error: 'Too many failed attempts', retryAfter: sl.lock }, { 'Retry-After': String(sl.lock) });
    if (!c.safeEqualStr(String(body.code || '').slice(0, 200), expectedCode)) {
      var sf = await c.recordFailure(ip, did, ua, 'setup', sl);
      return c.send(res, 401, { error: 'Wrong setup code', attemptsLeft: sf.attemptsLeft, retryAfter: sf.retryAfter },
        sf.retryAfter ? { 'Retry-After': String(sf.retryAfter) } : {});
    }
    var problem = passwordProblem(body.password);
    if (problem) return c.send(res, 400, { error: problem });
    var hash = c.hashPassword(body.password);
    if (!(await c.storePasswordOnce(hash))) return c.send(res, 409, { error: 'The password is already set.', passwordSet: true });
    await c.logAttempt(ip, did, ua, 'setup', true);
    c.setSessionCookie(req, res, did, hash);
    return c.send(res, 200, { ok: true });
  }

  // ----- login -----
  if (!stored) return c.send(res, 409, { error: 'No password has been set yet.', passwordSet: false });
  var lockState = await c.checkLock(ip, did);
  if (lockState.lock) {
    return c.send(res, 429, { error: 'Too many failed attempts', retryAfter: lockState.lock }, { 'Retry-After': String(lockState.lock) });
  }
  if (c.verifyPassword(String(body.password || '').slice(0, 200), stored)) {
    await c.logAttempt(ip, did, ua, 'login', true);
    c.setSessionCookie(req, res, did, stored);
    return c.send(res, 200, { ok: true });
  }
  var f = await c.recordFailure(ip, did, ua, 'login', lockState);
  return c.send(res, 401, { error: 'Wrong password', attemptsLeft: f.attemptsLeft, retryAfter: f.retryAfter },
    f.retryAfter ? { 'Retry-After': String(f.retryAfter) } : {});
});
