'use strict';
// POST /api/db  { op: select|get|upsert|delete, table, id?, data? }
// The only path from the browser to the database. Requires a signed-in session.
const c = require('./_lib/core');

const PAGE = 1000;

function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 200; }
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

module.exports = c.handle(async function (req, res) {
  if (req.method !== 'POST') return c.send(res, 405, { error: 'Method not allowed' });
  var ctx = await c.requireSession(req, res);
  if (!ctx) return;

  var b = isPlainObject(req.body) ? req.body : {};
  if (b.op === 'defaults') return c.send(res, 200, { business: require('./_lib/default-business.json') });
  if (c.TABLES.indexOf(b.table) === -1) return c.send(res, 400, { error: 'Unknown table' });
  var table = b.table;

  if (b.op === 'select') {
    var rows = [];
    for (var offset = 0; ; offset += PAGE) {
      var page = await c.sb('GET', table + '?select=id,data&order=id.asc&limit=' + PAGE + '&offset=' + offset);
      rows = rows.concat(page || []);
      if (!page || page.length < PAGE) break;
    }
    return c.send(res, 200, { rows: rows });
  }

  if (!validId(b.id)) return c.send(res, 400, { error: 'Invalid id' });

  if (b.op === 'get') {
    var got = await c.sb('GET', table + '?select=id,data&id=eq.' + encodeURIComponent(b.id) + '&limit=1');
    return c.send(res, 200, { row: (got && got[0]) || null });
  }
  if (b.op === 'upsert') {
    if (!isPlainObject(b.data)) return c.send(res, 400, { error: 'Invalid data' });
    await c.sb('POST', table + '?on_conflict=id', {
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { id: b.id, data: b.data }
    });
    return c.send(res, 200, { ok: true });
  }
  if (b.op === 'delete') {
    await c.sb('DELETE', table + '?id=eq.' + encodeURIComponent(b.id));
    return c.send(res, 200, { ok: true });
  }
  return c.send(res, 400, { error: 'Unknown operation' });
});
