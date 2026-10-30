'use strict';
// Daily Vercel cron: touches the database so the free Supabase project is never paused for
// inactivity, and prunes old login logs / expired blocks. Needs CRON_SECRET set in Vercel.
const c = require('./_lib/core');

module.exports = c.handle(async function (req, res) {
  var secret = c.env('CRON_SECRET');
  if (!secret) return c.send(res, 503, { error: 'CRON_SECRET is not set' });
  var given = String((req.headers || {}).authorization || '').replace(/^Bearer\s+/i, '');
  if (!c.safeEqualStr(given, secret)) return c.send(res, 401, { error: 'Unauthorized' });

  await c.sb('GET', 'settings?select=id&limit=1');
  var now = Date.now();
  await c.sb('DELETE', 'auth_attempts?created_at=lt.' + encodeURIComponent(new Date(now - 30 * 86400000).toISOString()));
  await c.sb('DELETE', 'blocked_entities?expires_at=lt.' + encodeURIComponent(new Date(now).toISOString()));
  return c.send(res, 200, { ok: true });
});
