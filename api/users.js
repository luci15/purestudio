'use strict';
// Super-admin only. Staff accounts: the super admin sets their email + initial password; staff can change it later.
// GET  /api/users                                    -> { me, max, users:[{email,role,active,created_at}] }
// POST /api/users {action:'create', email, password}
// POST /api/users {action:'update', email, active}      (disable / re-enable)
// POST /api/users {action:'setpassword', email, password}
// POST /api/users {action:'delete', email}
const c = require('./_lib/core');

function problem(pw) {
  if (typeof pw !== 'string' || pw.length < c.MIN_PASSWORD) return 'Use at least ' + c.MIN_PASSWORD + ' characters.';
  if (pw.length > 200) return 'Password is too long.';
  return '';
}

module.exports = c.handle(async function (req, res) {
  var ctx = await c.requireSession(req, res, 'owner');
  if (!ctx) return;

  if (req.method === 'GET') {
    c.invalidateUsers();
    var rows = await c.loadUsers();
    return c.send(res, 200, { me: ctx.member.email, owners: c.ownerEmails().length, max: c.maxUsers(), users: rows });
  }
  if (req.method !== 'POST') return c.send(res, 405, { error: 'Method not allowed' });

  var b = req.body && typeof req.body === 'object' ? req.body : {};
  var email = String(b.email || '').trim().toLowerCase();
  if (!c.EMAIL_RE.test(email)) return c.send(res, 400, { error: 'Enter a valid email.' });
  if (c.isOwnerEmail(email)) return c.send(res, 400, { error: 'Super admin accounts can only be changed in Supabase (and OWNER_EMAIL in Vercel).' });

  c.invalidateUsers();
  var users = await c.loadUsers();
  var existing = users.find(function (u) { return u.email === email; });

  if (b.action === 'create') {
    var p = problem(b.password);
    if (p) return c.send(res, 400, { error: p });
    if (existing) return c.send(res, 400, { error: 'That user already exists.' });
    if (users.length + c.ownerEmails().length >= c.maxUsers()) {
      return c.send(res, 400, { error: 'User limit reached (' + c.maxUsers() + ' accounts including super admins). Remove someone first, or raise MAX_USERS.' });
    }
    var made = await c.gotrue('POST', 'admin/users', { admin: true, body: { email: email, password: b.password, email_confirm: true } });
    if (made.status >= 300) {
      var m = String((made.data && (made.data.msg || made.data.message)) || '');
      return c.send(res, 400, { error: /already|exists|registered/i.test(m) ? 'That email already has a Supabase account. Delete it in Supabase first.' : (m || 'Could not create the user.') });
    }
    try {
      await c.sb('POST', 'app_users', { headers: { Prefer: 'return=minimal' }, body: { email: email, role: 'staff', active: true, created_by: ctx.member.email } });
    } catch (e) {
      await c.gotrue('DELETE', 'admin/users/' + encodeURIComponent(made.data.id), { admin: true }).catch(function () {});
      throw e;
    }
    c.invalidateUsers();
    return c.send(res, 200, { ok: true });
  }

  if (!existing) return c.send(res, 404, { error: 'No such user.' });

  if (b.action === 'update') {
    var active = !!b.active;
    await c.sb('PATCH', 'app_users?email=eq.' + encodeURIComponent(email), { headers: { Prefer: 'return=minimal' }, body: { active: active } });
    if (!active) await c.setValidAfter(email, Date.now());
    c.invalidateUsers();
    return c.send(res, 200, { ok: true });
  }

  if (b.action === 'setpassword') {
    var p2 = problem(b.password);
    if (p2) return c.send(res, 400, { error: p2 });
    var u = await c.authAdminFind(email);
    if (!u) return c.send(res, 404, { error: 'That user has no Supabase account.' });
    var set = await c.gotrue('PUT', 'admin/users/' + encodeURIComponent(u.id), { admin: true, body: { password: b.password } });
    if (set.status !== 200) return c.send(res, 400, { error: String((set.data && (set.data.msg || set.data.message)) || 'Could not set that password.').slice(0, 200) });
    await c.setValidAfter(email, Date.now());
    return c.send(res, 200, { ok: true });
  }

  if (b.action === 'delete') {
    await c.sb('DELETE', 'app_users?email=eq.' + encodeURIComponent(email));
    await c.setValidAfter(email, Date.now());
    c.invalidateUsers();
    var gone = await c.authAdminFind(email);
    if (gone) await c.gotrue('DELETE', 'admin/users/' + encodeURIComponent(gone.id), { admin: true });
    return c.send(res, 200, { ok: true });
  }

  return c.send(res, 400, { error: 'Unknown action' });
});
