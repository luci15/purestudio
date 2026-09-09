/**
 * Pure Studio - Supabase Database & Realtime Sync Adapter
 * High-reliability adapter with offline fallback & URL sanitization
 */
(function() {
  var activeClient = null;
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

  function cleanUrl(rawUrl) {
    if (!rawUrl) return '';
    var url = rawUrl.trim();
    // Strip trailing slashes
    url = url.replace(/\/+$/, '');
    // Strip /rest/v1 if the user copied the REST endpoint instead of base URL
    url = url.replace(/\/rest\/v1\/?$/i, '');
    return url;
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

  function getCredentials() {
    var cfg = window.SUPABASE_CONFIG || {};
    var url = (cfg.url && cfg.url.indexOf('your-project-id') === -1)
      ? cfg.url
      : (localStorage.getItem('purestudio_sb_url') || '');
    var key = (cfg.anonKey && cfg.anonKey.indexOf('your-anon-key') === -1)
      ? cfg.anonKey
      : (localStorage.getItem('purestudio_sb_key') || '');
    return { url: cleanUrl(url), key: (key || '').trim() };
  }

  function updateSyncBadge(status) {
    var badge = document.getElementById('syncBadge');
    if (!badge) return;
    if (status === 'cloud') {
      badge.innerHTML = '🟢 Supabase Cloud';
      badge.style.color = 'var(--good)';
      badge.style.background = 'var(--good-tint)';
      badge.title = 'Connected to Supabase cloud database.';
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

  function createSupabaseDb(url, anonKey) {
    if (!window.supabase || !window.supabase.createClient) {
      console.warn('Supabase JS library not loaded yet.');
      return null;
    }

    var client = window.supabase.createClient(cleanUrl(url), anonKey);
    activeClient = client;

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
                  console.warn('Supabase query note (' + colName + '):', res.error.message);
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
                  saveLocalDocs(colName, cloudDocs);
                  notifyLocal(colName);
                  updateSyncBadge('cloud');
                  flushPending(client, colName);
                }
              }).catch(function(err) {
                console.warn('Supabase fetch exception:', err);
                if (onError) onError(err);
              });
            }
            fetchAll();

            // 3. Realtime subscription
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

            function fetchDoc() {
              client.from(colName).select('*').eq('id', docId).maybeSingle().then(function(res) {
                if (res.data) {
                  var row = res.data;
                  var raw = (row.data && typeof row.data === 'object') ? row.data : row;
                  var pw = getPending('write', listenerKey);
                  var pd = getPending('delete', listenerKey);
                  if (pd[docId]) return;
                  var finalData = pw[docId] ? pw[docId] : raw;
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

  async function fetchVercelConfig() {
    try {
      var res = await fetch('/api/config');
      if (res.ok) {
        var data = await res.json();
        if (data && data.url && data.anonKey) {
          return { url: cleanUrl(data.url), key: (data.anonKey || '').trim() };
        }
      }
    } catch(e) {}
    return null;
  }

  // Global helper to initialize or get DB
  window.getPureStudioDb = async function() {
    var creds = getCredentials();
    if (!creds.url || !creds.key) {
      var vercelCreds = await fetchVercelConfig();
      if (vercelCreds) creds = vercelCreds;
    }
    if (creds.url && creds.key) {
      try {
        var db = createSupabaseDb(creds.url, creds.key);
        if (db) {
          console.log('%c[Pure Studio] Connected to Supabase: ' + creds.url, 'color:#2F7D4F;font-weight:bold;');
          updateSyncBadge('cloud');
          return db;
        }
      } catch (err) {
        console.error('Supabase connection error:', err);
      }
    }
    updateSyncBadge('local');
    return null;
  };

  // Clean any bad URL that might have been saved in localStorage earlier
  try {
    var savedUrl = localStorage.getItem('purestudio_sb_url');
    if (savedUrl) {
      var fixedUrl = cleanUrl(savedUrl);
      if (fixedUrl !== savedUrl) {
        localStorage.setItem('purestudio_sb_url', fixedUrl);
      }
    }
  } catch(e) {}

  // Update initial badge
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      var creds = getCredentials();
      updateSyncBadge((creds.url && creds.key) ? 'cloud' : 'local');
    });
  } else {
    var creds = getCredentials();
    updateSyncBadge((creds.url && creds.key) ? 'cloud' : 'local');
  }
})();
