/**
 * Pure Studio - Database adapter + sign-in client
 * All cloud reads/writes go through the app's own /api functions (session cookie,
 * server-side rate limiting and IP/device blocklist); the browser never holds a
 * database key. Optimistic local writes + offline retry queue are kept.
 */
(function() {
  var STORAGE_PREFIX = 'purestudio_db_';
  var listeners = {};

  function notifyLocal(colName) {
    if (!listeners[colName]) return;
    var docs = getLocalDocs(colName);
    var snap = { docs: docs.map(wrapDoc) };
    listeners[colName].forEach(function(cb) {
      try { cb(snap); } catch(e) { console.error(e); }
    });
  }

  function reportSyncError(action, colName, err) {
    console.warn('[Pure Studio] Supabase ' + action + ' error on ' + colName + ' (kept locally):', err);
    try {
      window.dispatchEvent(new CustomEvent('purestudio:sync-error', {
        detail: { action: action, collection: colName, message: (err && err.message) ? err.message : String(err) }
      }));
    } catch(e) {}
  }

  // Pending writes/deletes are the source of truth until a Supabase round-trip
  // confirms them. Without this, a slow/failed cloud write could be silently
  // clobbered by the next cloud fetch (postgres_changes realtime, or a page
  // reload's initial fetchAll) — the exact "edit doesn't save" / "delete comes
  // back after refresh" bug. Persisted to localStorage so it survives a reload
  // too, not just the in-memory session.
  function getPending(kind, colName) {
    try {
      var raw = localStorage.getItem('purestudio_pending_' + kind + '_' + colName);
      return raw ? JSON.parse(raw) : {};
    } catch(e) { return {}; }
  }
  function setPending(kind, colName, obj) {
    try { localStorage.setItem('purestudio_pending_' + kind + '_' + colName, JSON.stringify(obj)); } catch(e) {}
  }
  function markPendingWrite(colName, docId, data) {
    var pw = getPending('write', colName);
    pw[docId] = data;
    setPending('write', colName, pw);
    var pd = getPending('delete', colName);
    if (pd[docId]) { delete pd[docId]; setPending('delete', colName, pd); }
  }
  function clearPendingWrite(colName, docId) {
    var pw = getPending('write', colName);
    if (pw[docId] !== undefined) { delete pw[docId]; setPending('write', colName, pw); }
  }
  function markPendingDelete(colName, docId) {
    var pd = getPending('delete', colName);
    pd[docId] = true;
    setPending('delete', colName, pd);
    var pw = getPending('write', colName);
    if (pw[docId] !== undefined) { delete pw[docId]; setPending('write', colName, pw); }
  }
  function clearPendingDelete(colName, docId) {
    var pd = getPending('delete', colName);
    if (pd[docId]) { delete pd[docId]; setPending('delete', colName, pd); }
  }
  // Opportunistic retry: called whenever we successfully reach Supabase for a
  // collection, so a write/delete that failed earlier (offline blip, etc.) gets
  // another attempt without the user having to redo anything.
  function flushPending(client, colName) {
    var pw = getPending('write', colName);
    var pd = getPending('delete', colName);
    Object.keys(pw).forEach(function(id) {
      client.from(colName).upsert({ id: id, data: pw[id] }).then(function(res) {
        if (!res.error) clearPendingWrite(colName, id);
      }).catch(function(){});
    });
    Object.keys(pd).forEach(function(id) {
      client.from(colName).delete().eq('id', id).then(function(res) {
        if (!res.error) clearPendingDelete(colName, id);
      }).catch(function(){});
    });
  }

  function getLocalDocs(colName) {
    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + colName);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveLocalDocs(colName, docs) {
    try {
      localStorage.setItem(STORAGE_PREFIX + colName, JSON.stringify(docs));
    } catch (e) {}
  }

  function updateSyncBadge(status) {
    var badge = document.getElementById('syncBadge');
    if (!badge) return;
    if (status === 'cloud') {
      badge.innerHTML = '🟢 Supabase Cloud';
      badge.style.color = 'var(--good)';
      badge.style.background = 'var(--good-tint)';
      badge.title = 'Connected to Supabase cloud database.';
    } else if (status === 'error') {
      badge.innerHTML = '🔴 Cloud unreachable';
      badge.style.color = 'var(--bad)';
      badge.style.background = 'var(--bad-tint)';
      badge.title = 'Cannot reach the database (is the Supabase project paused?). Showing the last local copy; changes are kept locally and retried.';
    } else {
      badge.innerHTML = '🟡 Local Storage';
      badge.style.color = 'var(--ink-muted)';
      badge.style.background = 'var(--surface-2)';
      badge.title = 'Using local storage.';
    }
  }

  function wrapDoc(d) {
    var rawData = (d && d.data) ? d.data : d;
    return {
      id: d.id,
      data: function() {
        var copy = Object.assign({}, rawData);
        delete copy.id;
        return copy;
      }
    };
  }

  function createGatewayDb() {
    var client = createGatewayClient();

    return {
      collection: function(colName) {
        return {
          onSnapshot: function(onNext, onError) {
            if (!listeners[colName]) listeners[colName] = [];
            listeners[colName].push(onNext);

            // 1. Immediately emit local docs so UI renders instantly with zero latency
            var localDocs = getLocalDocs(colName);
            if (localDocs && localDocs.length > 0) {
              try { onNext({ docs: localDocs.map(wrapDoc) }); } catch(e) {}
            }

            // 2. Fetch fresh cloud data from Supabase and reconcile with anything
            // still pending — a pending write always overrides the cloud value for
            // that id, and a pending delete always excludes it, until confirmed.
            function fetchAll() {
              client.from(colName).select('*').then(function(res) {
                if (res.error) {
                  console.warn('Cloud query note (' + colName + '):', res.error.message);
                  if (res.error.status !== 401 && res.error.status !== 403) updateSyncBadge('error');
                  if (onError) onError(res.error);
                } else if (res.data) {
                  var cloudDocs = res.data.map(function(row) {
                    var docData = (row.data && typeof row.data === 'object') ? row.data : row;
                    return Object.assign({}, docData, { id: row.id });
                  });
                  var pw = getPending('write', colName);
                  var pd = getPending('delete', colName);
                  cloudDocs = cloudDocs
                    .filter(function(d) { return !pd[d.id]; })
                    .map(function(d) { return pw[d.id] ? Object.assign({}, pw[d.id], { id: d.id }) : d; });
                  var cloudIds = {};
                  cloudDocs.forEach(function(d) { cloudIds[d.id] = true; });
                  Object.keys(pw).forEach(function(id) {
                    if (!cloudIds[id] && !pd[id]) cloudDocs.push(Object.assign({}, pw[id], { id: id }));
                  });
                  // Skip no-op polls so the UI isn't re-rendered every 30s for nothing
                  var changed = firstFetch || JSON.stringify(cloudDocs) !== JSON.stringify(getLocalDocs(colName));
                  firstFetch = false;
                  if (changed) {
                    saveLocalDocs(colName, cloudDocs);
                    notifyLocal(colName);
                  }
                  updateSyncBadge('cloud');
                  flushPending(client, colName);
                }
              }).catch(function(err) {
                console.warn('Cloud fetch exception:', err);
                if (onError) onError(err);
              });
            }
            var firstFetch = true;
            fetchAll();

            // 3. Poll for changes made from other devices
            var channel = null;
            try {
              channel = client.channel('public:' + colName)
                .on('postgres_changes', { event: '*', schema: 'public', table: colName }, function() {
                  fetchAll();
                })
                .subscribe();
            } catch(e) {}

            return function unsubscribe() {
              if (channel) {
                try { client.removeChannel(channel); } catch(e) {}
              }
              listeners[colName] = (listeners[colName]||[]).filter(function(cb) { return cb !== onNext; });
            };
          },

          doc: function(docId) {
            var path = colName + '/' + docId;
            return {
              set: function(data) {
                // Save locally first and notify listeners immediately so the UI
                // never appears to "do nothing" while the network call is in flight
                var docs = getLocalDocs(colName);
                var docData = Object.assign({}, data, { id: docId });
                var idx = docs.findIndex(function(d) { return d.id === docId; });
                if (idx >= 0) docs[idx] = docData; else docs.push(docData);
                saveLocalDocs(colName, docs);
                markPendingWrite(colName, docId, docData);
                notifyLocal(colName);

                // Sync to Supabase in the background
                return client.from(colName).upsert({ id: docId, data: data }).then(function(res) {
                  if (res.error) {
                    reportSyncError('save', colName, res.error);
                  } else {
                    clearPendingWrite(colName, docId);
                  }
                  return res;
                }).catch(function(err) {
                  reportSyncError('save', colName, err);
                });
              },

              update: function(data) {
                var docs = getLocalDocs(colName);
                var idx = docs.findIndex(function(d) { return d.id === docId; });
                var merged;
                if (idx >= 0) {
                  merged = Object.assign({}, docs[idx], data, { id: docId });
                  docs[idx] = merged;
                } else {
                  merged = Object.assign({}, data, { id: docId });
                  docs.push(merged);
                }
                saveLocalDocs(colName, docs);
                markPendingWrite(colName, docId, merged);
                notifyLocal(colName);

                // Upsert the full merged record (not just the partial patch) so a
                // field this update didn't touch (e.g. createdAt) isn't wiped from
                // the cloud row — Supabase upsert replaces the whole jsonb column.
                return client.from(colName).upsert({ id: docId, data: merged }).then(function(res) {
                  if (res.error) {
                    reportSyncError('save', colName, res.error);
                  } else {
                    clearPendingWrite(colName, docId);
                  }
                  return res;
                }).catch(function(err) {
                  reportSyncError('save', colName, err);
                });
              },

              delete: function() {
                var docs = getLocalDocs(colName);
                docs = docs.filter(function(d) { return d.id !== docId; });
                saveLocalDocs(colName, docs);
                markPendingDelete(colName, docId);
                notifyLocal(colName);

                return client.from(colName).delete().eq('id', docId).then(function(res) {
                  if (res.error) {
                    reportSyncError('delete', colName, res.error);
                  } else {
                    clearPendingDelete(colName, docId);
                  }
                  return res;
                }).catch(function(err) {
                  reportSyncError('delete', colName, err);
                });
              },

              onSnapshot: function(onNext, onError) {
                function fetchDoc() {
                  client.from(colName).select('*').eq('id', docId).maybeSingle().then(function(res) {
                    if (res.data) {
                      var d = res.data;
                      var raw = (d.data && typeof d.data === 'object') ? d.data : d;
                      onNext({
                        exists: true,
                        id: docId,
                        data: function() { return raw; }
                      });
                    }
                  }).catch(function(err) { if (onError) onError(err); });
                }
                fetchDoc();

                var channel = null;
                try {
                  channel = client.channel('public:' + colName + ':' + docId)
                    .on('postgres_changes', { event: '*', schema: 'public', table: colName, filter: 'id=eq.' + docId }, function() {
                      fetchDoc();
                    })
                    .subscribe();
                } catch(e) {}

                return function unsubscribe() {
                  if (channel) {
                    try { client.removeChannel(channel); } catch(e) {}
                  }
                };
              }
            };
          },

          add: function(data) {
            var docId = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
            var docData = Object.assign({}, data, { id: docId });

            // 1. Immediately save to local docs and notify listeners
            var docs = getLocalDocs(colName);
            docs.push(docData);
            saveLocalDocs(colName, docs);
            markPendingWrite(colName, docId, docData);
            notifyLocal(colName);

            // 2. Sync to Supabase in background
            return client.from(colName).upsert({ id: docId, data: data }).then(function(res) {
              if (res.error) {
                reportSyncError('add', colName, res.error);
              } else {
                clearPendingWrite(colName, docId);
              }
              return { id: docId };
            }).catch(function(err) {
              reportSyncError('add', colName, err);
              return { id: docId };
            });
          }
        };
      },

      doc: function(docPath) {
        var parts = docPath.split('/');
        var colName = parts[0];
        var docId = parts[1];
        var listenerKey = 'doc:' + docPath;
        return {
          set: function(data) {
            var docData = Object.assign({}, data, { id: docId });
            try { localStorage.setItem(STORAGE_PREFIX + docPath, JSON.stringify(docData)); } catch(e) {}
            markPendingWrite(listenerKey, docId, docData);
            notifyLocal(listenerKey);

            return client.from(colName).upsert({ id: docId, data: data }).then(function(res) {
              if (res.error) {
                reportSyncError('save', colName, res.error);
              } else {
                clearPendingWrite(listenerKey, docId);
              }
              return res;
            }).catch(function(err) {
              reportSyncError('save', colName, err);
            });
          },
          update: function(data) {
            var existingRaw = null;
            try { existingRaw = JSON.parse(localStorage.getItem(STORAGE_PREFIX + docPath) || 'null'); } catch(e) {}
            var merged = Object.assign({}, existingRaw, data, { id: docId });
            try { localStorage.setItem(STORAGE_PREFIX + docPath, JSON.stringify(merged)); } catch(e) {}
            markPendingWrite(listenerKey, docId, merged);
            notifyLocal(listenerKey);

            return client.from(colName).upsert({ id: docId, data: merged }).then(function(res) {
              if (res.error) {
                reportSyncError('save', colName, res.error);
              } else {
                clearPendingWrite(listenerKey, docId);
              }
              return res;
            }).catch(function(err) {
              reportSyncError('save', colName, err);
            });
          },
          delete: function() {
            try { localStorage.removeItem(STORAGE_PREFIX + docPath); } catch(e) {}
            markPendingDelete(listenerKey, docId);
            notifyLocal(listenerKey);
            return client.from(colName).delete().eq('id', docId).catch(function(err) {
              reportSyncError('delete', colName, err);
            });
          },
          onSnapshot: function(onNext, onError) {
            if (!listeners[listenerKey]) listeners[listenerKey] = [];
            listeners[listenerKey].push(onNext);

            var cachedRaw = null;
            try { cachedRaw = JSON.parse(localStorage.getItem(STORAGE_PREFIX + docPath) || 'null'); } catch(e) {}
            if (cachedRaw) {
              try { onNext({ exists: true, id: docId, data: function() { return cachedRaw; } }); } catch(e) {}
            }

            var lastDocSig = null;
            function fetchDoc() {
              client.from(colName).select('*').eq('id', docId).maybeSingle().then(function(res) {
                if (res.data) {
                  var row = res.data;
                  var raw = (row.data && typeof row.data === 'object') ? row.data : row;
                  var pw = getPending('write', listenerKey);
                  var pd = getPending('delete', listenerKey);
                  if (pd[docId]) return;
                  var finalData = pw[docId] ? pw[docId] : raw;
                  var sig = JSON.stringify(finalData);
                  if (sig === lastDocSig) return; // unchanged since last emit — skip the re-render
                  lastDocSig = sig;
                  try { localStorage.setItem(STORAGE_PREFIX + docPath, JSON.stringify(Object.assign({}, finalData, { id: docId }))); } catch(e) {}
                  onNext({
                    exists: true,
                    id: docId,
                    data: function() { return finalData; }
                  });
                }
              }).catch(function(err) { if (onError) onError(err); });
            }
            fetchDoc();

            var channel = null;
            try {
              channel = client.channel('public:' + colName + ':' + docId)
                .on('postgres_changes', { event: '*', schema: 'public', table: colName, filter: 'id=eq.' + docId }, function() {
                  fetchDoc();
                })
                .subscribe();
            } catch(e) {}

            return function unsubscribe() {
              if (channel) {
                try { client.removeChannel(channel); } catch(e) {}
              }
              listeners[listenerKey] = (listeners[listenerKey]||[]).filter(function(cb) { return cb !== onNext; });
            };
          }
        };
      }
    };
  }


  // ---------- Sign-in client + device identity ----------
  var POLL_MS = 30000;
  var memoryDeviceId = null;
  var pendingLoginResolve = null;
  var authEventSent = false;

  function randomId() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).slice(2, 10);
      var a = new Uint8Array(24);
      crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    } catch (e) {
      return (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 40);
    }
  }
  // Stable per-browser id sent with every request so the server can rate-limit / block a device.
  function deviceId() {
    try {
      var id = localStorage.getItem('purestudio_device_id');
      if (!id || id.length < 16) { id = randomId(); localStorage.setItem('purestudio_device_id', id); }
      return id;
    } catch (e) {
      if (!memoryDeviceId) memoryDeviceId = randomId();
      return memoryDeviceId;
    }
  }
  function isLocalHost() {
    return location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }

  function apiFetch(path, body, method) {
    return fetch(path, {
      method: method || 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function(r) {
      return r.json().catch(function() { return {}; }).then(function(j) {
        return { status: r.status, ok: r.ok, body: j || {} };
      });
    });
  }

  function requireLogin(message) {
    if (authEventSent) return;
    authEventSent = true;
    window.dispatchEvent(new CustomEvent('purestudio:auth-required', { detail: { configured: true, setup: false, message: message || '' } }));
  }

  function fetchSession() {
    return apiFetch('/api/auth?action=session', undefined, 'GET').then(function(r) {
      if (r.status === 404 && isLocalHost()) return { status: 'noapi' };
      if (!r.ok) return { status: 'error', message: r.body.error || ('Server error (' + r.status + ')') };
      return { status: 'ok', configured: r.body.configured !== false, passwordSet: r.body.passwordSet !== false, authenticated: !!r.body.authenticated };
    }).catch(function() {
      return isLocalHost() ? { status: 'noapi' } : { status: 'error', message: 'Cannot reach the server. Check your connection and reload.' };
    });
  }

  // login and first-time setup share the same ending: resume start-up, or reload if the session had expired mid-use
  function authCall(action, body) {
    return apiFetch('/api/auth?action=' + action, body).then(function(r) {
      if (r.ok) {
        authEventSent = false;
        if (pendingLoginResolve) { var f = pendingLoginResolve; pendingLoginResolve = null; f(); }
        else location.reload();
        return { ok: true };
      }
      return { ok: false, error: r.body.error || 'Something went wrong', retryAfter: r.body.retryAfter || 0, attemptsLeft: r.body.attemptsLeft,
        configured: r.body.configured, passwordSet: r.body.passwordSet, needsSetupCode: !!r.body.needsSetupCode };
    }).catch(function() { return { ok: false, error: 'Cannot reach the server. Check your connection.' }; });
  }

  window.PureStudioAuth = {
    deviceId: deviceId,
    session: fetchSession,
    login: function(password) { return authCall('login', { password: password }); },
    setup: function(code, password) { return authCall('setup', { code: code, password: password }); },
    logout: function() {
      var done = function() {
        try {
          Object.keys(localStorage).forEach(function(k) { if (k.indexOf(STORAGE_PREFIX) === 0) localStorage.removeItem(k); });
        } catch (e) {}
        location.reload();
      };
      return apiFetch('/api/auth?action=logout').then(done, done);
    },
    defaults: function() { return apiFetch('/api/db', { op: 'defaults' }); },
    security: function() { return apiFetch('/api/security', undefined, 'GET'); },
    securityAction: function(body) { return apiFetch('/api/security', body); }
  };

  function waitForLogin(session) {
    return new Promise(function(resolve) {
      pendingLoginResolve = resolve;
      authEventSent = true;
      window.dispatchEvent(new CustomEvent('purestudio:auth-required', {
        detail: { configured: session.configured !== false, setup: session.status === 'ok' && session.passwordSet === false, message: session.status === 'error' ? session.message : '' }
      }));
    });
  }

  // ---------- Gateway client: the small supabase-js-shaped surface the adapter above uses ----------
  function gw(body) {
    return apiFetch('/api/db', body).then(function(r) {
      if (r.status === 401 || r.status === 403) {
        requireLogin(r.status === 403 ? 'Access denied.' : 'Your session ended. Please sign in again.');
      }
      if (!r.ok) return { data: null, error: { message: r.body.error || ('HTTP ' + r.status), status: r.status } };
      return { data: r.body, error: null };
    }).catch(function(e) {
      return { data: null, error: { message: (e && e.message) || 'network error' } };
    });
  }

  function createGatewayClient() {
    return {
      from: function(table) {
        return {
          select: function() {
            var filterId = null;
            function run() {
              if (filterId === null) {
                return gw({ op: 'select', table: table }).then(function(r) { return r.error ? r : { data: r.data.rows, error: null }; });
              }
              return gw({ op: 'get', table: table, id: filterId }).then(function(r) { return r.error ? r : { data: r.data.row, error: null }; });
            }
            var q = {
              eq: function(col, val) { filterId = val; return q; },
              maybeSingle: function() { return q; },
              then: function(a, b) { return run().then(a, b); },
              catch: function(b) { return run().catch(b); }
            };
            return q;
          },
          upsert: function(row) {
            return gw({ op: 'upsert', table: table, id: row.id, data: row.data }).then(function(r) { return { data: null, error: r.error }; });
          },
          delete: function() {
            return {
              eq: function(col, val) {
                return gw({ op: 'delete', table: table, id: val }).then(function(r) { return { data: null, error: r.error }; });
              }
            };
          }
        };
      },
      // No realtime socket: "subscribe" polls so other devices' changes show up within ~30s.
      channel: function() {
        var cbs = [];
        var ch = {
          on: function() { cbs.push(arguments[arguments.length - 1]); return ch; },
          subscribe: function() {
            ch._timer = setInterval(function() {
              if (document.hidden) return;
              cbs.forEach(function(cb) { try { cb(); } catch (e) {} });
            }, POLL_MS);
            return ch;
          }
        };
        return ch;
      },
      removeChannel: function(ch) { if (ch && ch._timer) clearInterval(ch._timer); }
    };
  }

  // Global helper: resolves to a cloud-backed db once signed in, or null for local-only mode
  // (no /api available, e.g. a plain static dev server on localhost).
  window.getPureStudioDb = async function() {
    var s = await fetchSession();
    if (s.status === 'noapi') { updateSyncBadge('local'); return null; }
    if (!(s.status === 'ok' && s.configured && s.authenticated)) await waitForLogin(s);
    updateSyncBadge('cloud');
    console.log('%c[Pure Studio] Signed in - cloud sync active', 'color:#2F7D4F;font-weight:bold;');
    return createGatewayDb();
  };
})();
