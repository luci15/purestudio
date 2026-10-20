'use strict';
// /api/auth?action=session|login|logout|forgot|reset|change
// Credentials live in Supabase Auth (the super admin + a few staff the super admin creates; sign-ups disabled).
// This function sits in front of it to add the rate limit / IP + device blocklist, and issues the app's own session
// cookie. Supabase tokens never reach the browser.
const c = require('./_lib/core');

function siteOrigin(req) {
  var fixed = c.env('SITE_URL').replace(/\/+$/, '');
  if (fixed) return fixed;
  var h = req.headers || {};
  var proto = String(h['x-forwarded-proto'] || 'https').split(',')[0];
  return proto + '://' + String(h['x-forwarded-host'] || h.host || '').split(',')[0];
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < c.MIN_PASSWORD) return 'Use at least ' + c.MIN_PASSWORD + ' characters.';
  if (pw.length > 200) return 'Password is too long.';
  return '';
}
function gotrueMessage(r, fallback) {
  var d = r.data || {};
  return String(d.msg || d.message || d.error_description || fallback).slice(0, 200);
}

module.exports = c.handle(async function (req, res) {
  var action = (req.query && req.query.action) || '';
  var body = req.body && typeof req.body === 'object' ? req.body : {};

  if (action === 'session' && req.method === 'GET') {
    if (!c.authConfigured()) return c.send(res, 200, { configured: false, authenticated: false });
    var sess = c.verifySession(c.parseCookies(req)[c.SESSION_COOKIE]);
    var deviceId = c.getDeviceId(req);
    var member = deviceId ? await c.sessionValid(sess, deviceId) : null;
    if (member && await c.findBlock(c.getIp(req), deviceId)) member = null;
    if (!member && sess) c.clearSessionCookie(req, res);
    return c.send(res, 200, { configured: true, authenticated: !!member, email: member ? member.email : null, role: member ? member.role : null });
  }

  if (action === 'logout' && req.method === 'POST') {
    c.clearSessionCookie(req, res);
    return c.send(res, 200, { ok: true });
  }

  if (req.method !== 'POST' || ['login', 'forgot', 'reset', 'change'].indexOf(action) === -1) {
    return c.send(res, 405, { error: 'Method not allowed' });
  }
  if (!c.authConfigured()) return c.send(res, 503, { error: 'Server login is not configured', configured: false });

  var did = c.getDeviceId(req);
  if (!did) return action === 'change' ? c.send(res, 401, { error: 'Not signed in' }) : c.send(res, 400, { error: 'Missing device id' });
  var ip = c.getIp(req);
  var ua = c.getUserAgent(req);

  // ----- login -----
  if (action === 'login') {
    var burst = c.rateLimit('login:' + ip, 20, 60 * 1000);
    if (burst) return c.send(res, 429, { error: 'Too many requests', retryAfter: burst }, { 'Retry-After': String(burst) });
    if (await c.findBlock(ip, did)) return c.send(res, 403, { error: 'Access denied' });

    var lockState = await c.checkLock(ip, did);
    if (lockState.lock) {
      return c.send(res, 429, { error: 'Too many failed attempts', retryAfter: lockState.lock }, { 'Retry-After': String(lockState.lock) });
    }
    var email = String(body.email || '').slice(0, 200).trim().toLowerCase();
    var password = String(body.password || '').slice(0, 200);
    var v = await c.verifyUserPassword(email, password);
    if (v.ok) {
      await c.logAttempt(ip, did, ua, email, true);
      c.setSessionCookie(req, res, v.member.email, did);
      return c.send(res, 200, { ok: true, role: v.member.role });
    }
    var f = await c.recordFailure(ip, did, ua, email, lockState);
    return c.send(res, 401, { error: 'Invalid email or password', attemptsLeft: f.attemptsLeft, retryAfter: f.retryAfter },
      f.retryAfter ? { 'Retry-After': String(f.retryAfter) } : {});
  }

  // ----- forgot password: always the same answer, so it can't be used to discover which emails have accounts -----
  if (action === 'forgot') {
    var wait = c.rateLimit('forgot:' + ip, 3, 10 * 60 * 1000);
    if (wait) return c.send(res, 429, { error: 'Too many requests. Try again later.', retryAfter: wait }, { 'Retry-After': String(wait) });
    if (await c.findBlock(ip, did)) return c.send(res, 403, { error: 'Access denied' });
    var fe = String(body.email || '').slice(0, 200).trim().toLowerCase();
    if (fe && await c.getMember(fe)) {
      try {
        await c.gotrue('POST', 'recover?redirect_to=' + encodeURIComponent(siteOrigin(req) + '/'), { body: { email: fe } });
      } catch (e) { console.error('[api] recover failed: ' + e.message); }
    }
    return c.send(res, 200, { ok: true });
  }

  // ----- reset password (from the emailed link: the page passes the recovery token) -----
  if (action === 'reset') {
    var rw = c.rateLimit('reset:' + ip, 10, 10 * 60 * 1000);
    if (rw) return c.send(res, 429, { error: 'Too many requests. Try again later.', retryAfter: rw }, { 'Retry-After': String(rw) });
    if (await c.findBlock(ip, did)) return c.send(res, 403, { error: 'Access denied' });
    var token = String(body.token || '').slice(0, 4000);
    var problem = passwordProblem(body.password);
    if (problem) return c.send(res, 400, { error: problem });
    var invalid = 'Reset link is invalid or expired. Request a new one.';
    if (!token) return c.send(res, 400, { error: invalid });
    var who = await c.gotrue('GET', 'user', { token: token });
    var whoEmail = String((who.data && who.data.email) || '').toLowerCase();
    if (who.status !== 200 || !(await c.getMember(whoEmail))) return c.send(res, 400, { error: invalid });
    var upd = await c.gotrue('PUT', 'user', { token: token, body: { password: body.password } });
    if (upd.status !== 200) return c.send(res, 400, { error: gotrueMessage(upd, 'Could not set that password.') });
    await c.setValidAfter(whoEmail, Date.now());   // that user's other sessions end
    c.clearSessionCookie(req, res);
    return c.send(res, 200, { ok: true });
  }

  // ----- change password (signed in; must prove the current password) -----
  if (action === 'change') {
    var ctx = await c.requireSession(req, res);
    if (!ctx) return;
    var me = ctx.member.email;
    var chProblem = passwordProblem(body.password);
    if (chProblem) return c.send(res, 400, { error: chProblem });
    var cl = await c.checkLock(ip, did);
    if (cl.lock) return c.send(res, 429, { error: 'Too many failed attempts', retryAfter: cl.lock }, { 'Retry-After': String(cl.lock) });
    var cv = await c.verifyUserPassword(me, String(body.current || '').slice(0, 200));
    if (!cv.ok) {
      var cf = await c.recordFailure(ip, did, ua, 'change-password', cl);
      return c.send(res, 401, { error: 'Current password is wrong', attemptsLeft: cf.attemptsLeft, retryAfter: cf.retryAfter },
        cf.retryAfter ? { 'Retry-After': String(cf.retryAfter) } : {});
    }
    var set = await c.gotrue('PUT', 'admin/users/' + encodeURIComponent(cv.user.id), { admin: true, body: { password: body.password } });
    if (set.status !== 200) return c.send(res, 400, { error: gotrueMessage(set, 'Could not set that password.') });
    await c.setValidAfter(me, Date.now());           // this user's other sessions end...
    c.setSessionCookie(req, res, me, did);            // ...this one continues with a fresh cookie
    return c.send(res, 200, { ok: true });
  }
});
