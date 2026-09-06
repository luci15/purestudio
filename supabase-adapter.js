/**
 * Pure Studio - Supabase Database & Realtime Sync Adapter
 * High-reliability adapter with offline fallback & URL sanitization
 */
(function() {
  var activeClient = null;
  var STORAGE_PREFIX = 'purestudio_db_';

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
            // 1. Immediately emit local docs so UI renders instantly with zero latency
            var localDocs = getLocalDocs(colName);
            if (localDocs && localDocs.length > 0) {
              try { onNext({ docs: localDocs.map(wrapDoc) }); } catch(e) {}
            }

            // 2. Fetch fresh cloud data from Supabase
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
                  // Merge with local storage
                  saveLocalDocs(colName, cloudDocs);
                  onNext({ docs: cloudDocs.map(wrapDoc) });
                  updateSyncBadge('cloud');
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
            };
          },

          doc: function(docId) {
            var path = colName + '/' + docId;
            return {
              set: function(data) {
                // Save locally first so user never loses data
                var docs = getLocalDocs(colName);
                var docData = Object.assign({}, data, { id: docId });
                var idx = docs.findIndex(function(d) { return d.id === docId; });
                if (idx >= 0) docs[idx] = docData; else docs.push(docData);
                saveLocalDocs(colName, docs);

                // Sync to Supabase
                return client.from(colName).upsert({ id: docId, data: data }).then(function(res) {
                  if (res.error) {
                    console.error('Supabase set error:', res.error);
                  }
                  return res;
                }).catch(function(err) {
                  console.warn('Supabase network error (saved locally):', err);
                });
              },

              update: function(data) {
                var docs = getLocalDocs(colName);
                var idx = docs.findIndex(function(d) { return d.id === docId; });
                if (idx >= 0) {
                  docs[idx] = Object.assign({}, docs[idx], data, { id: docId });
                } else {
                  docs.push(Object.assign({}, data, { id: docId }));
                }
                saveLocalDocs(colName, docs);

                return client.from(colName).upsert({ id: docId, data: data }).catch(function(err) {
                  console.warn('Supabase update error (saved locally):', err);
                });
              },

              delete: function() {
                var docs = getLocalDocs(colName);
                docs = docs.filter(function(d) { return d.id !== docId; });
                saveLocalDocs(colName, docs);

                return client.from(colName).delete().eq('id', docId).catch(function(err) {
                  console.warn('Supabase delete error (saved locally):', err);
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

            // 1. Immediately save to local docs
            var docs = getLocalDocs(colName);
            docs.push(docData);
            saveLocalDocs(colName, docs);

            // 2. Sync to Supabase in background
            return client.from(colName).upsert({ id: docId, data: data }).then(function(res) {
              if (res.error) {
                console.warn('Supabase add sync error (saved locally):', res.error.message);
              }
              return { id: docId };
            }).catch(function(err) {
              console.warn('Supabase add network error (saved locally):', err);
              return { id: docId };
            });
          }
        };
      },

      doc: function(docPath) {
        var parts = docPath.split('/');
        var colName = parts[0];
        var docId = parts[1];
        return {
          set: function(data) {
            try {
              localStorage.setItem(STORAGE_PREFIX + docPath, JSON.stringify(data));
            } catch(e) {}

            return client.from(colName).upsert({ id: docId, data: data }).catch(function(err) {
              console.warn('Supabase doc set error:', err);
            });
          },
          update: function(data) {
            return client.from(colName).upsert({ id: docId, data: data }).catch(function(err) {
              console.warn('Supabase doc update error:', err);
            });
          },
          delete: function() {
            return client.from(colName).delete().eq('id', docId).catch(function(err) {});
          },
          onSnapshot: function(onNext, onError) {
            function fetchDoc() {
              client.from(colName).select('*').eq('id', docId).maybeSingle().then(function(res) {
                if (res.data) {
                  var row = res.data;
                  var raw = (row.data && typeof row.data === 'object') ? row.data : row;
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
