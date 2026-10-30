'use strict';
// GET  /api/security                      -> recent sign-in attempts + blocklist
// POST /api/security {action:'block', kind:'ip'|'device', value, reason?, hours?}
// POST /api/security {action:'unblock', id}
const c = require('./_lib/core');

module.exports = c.handle(async function (req, res) {
  var ctx = await c.requireSession(req, res);
  if (!ctx) return;

  if (req.method === 'GET') {
    var out = await Promise.all([
      c.sb('GET', 'auth_attempts?select=id,created_at,ip,device_id,user_agent,username,success&order=created_at.desc&limit=40'),
      c.sb('GET', 'blocked_entities?select=id,kind,value,reason,source,created_at,expires_at&order=created_at.desc&limit=200')
    ]);
    return c.send(res, 200, { me: { ip: ctx.ip, deviceId: ctx.deviceId }, attempts: out[0] || [], blocked: out[1] || [] });
  }

  if (req.method !== 'POST') return c.send(res, 405, { error: 'Method not allowed' });
  var b = req.body && typeof req.body === 'object' ? req.body : {};

  if (b.action === 'block') {
    var kind = b.kind;
    var value = String(b.value || '').trim();
    if (kind === 'ip') value = c.normalizeIp(value);
    if ((kind !== 'ip' && kind !== 'device') || !value || value === 'unknown') {
      return c.send(res, 400, { error: 'Enter a valid IP or device id' });
    }
    if (kind === 'device' && !c.DEVICE_RE.test(value)) return c.send(res, 400, { error: 'Invalid device id' });
    if (kind === 'ip' && !/^[0-9a-fA-F:.\/]{3,64}$/.test(value)) return c.send(res, 400, { error: 'Invalid IP' });
    if ((kind === 'ip' && value === ctx.ip) || (kind === 'device' && value === ctx.deviceId)) {
      return c.send(res, 400, { error: 'You cannot block the IP or device you are using right now' });
    }
    var hours = parseFloat(b.hours);
    var expires = hours > 0 ? new Date(Date.now() + Math.min(hours, 24 * 365) * 3600 * 1000).toISOString() : null;
    await c.addBlock(kind, value, b.reason || 'Blocked manually', 'manual', expires);
    return c.send(res, 200, { ok: true });
  }

  if (b.action === 'unblock') {
    var id = parseInt(b.id, 10);
    if (!(id > 0)) return c.send(res, 400, { error: 'Invalid id' });
    await c.sb('DELETE', 'blocked_entities?id=eq.' + id);
    c.invalidateBlocks();
    return c.send(res, 200, { ok: true });
  }

  return c.send(res, 400, { error: 'Unknown action' });
});
