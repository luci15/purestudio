/**
 * Pure Studio - Supabase Database & Realtime Sync Adapter
 * Provides a seamless Firestore-compatible database interface backed by Supabase.
 */
(function() {
  var activeClient = null;

  function getCredentials() {
    var cfg = window.SUPABASE_CONFIG || {};
    var url = (cfg.url && cfg.url.indexOf('your-project-id') === -1) 
      ? cfg.url 
      : (localStorage.getItem('purestudio_sb_url') || '');
    var key = (cfg.anonKey && cfg.anonKey.indexOf('your-anon-key') === -1) 
      ? cfg.anonKey 
      : (localStorage.getItem('purestudio_sb_key') || '');
    return { url: url.trim(), key: key.trim() };
  }

  function updateSyncBadge(isConnected) {
    var badge = document.getElementById('syncBadge');
    if (!badge) return;
    if (isConnected) {
      badge.innerHTML = '🟢 Supabase Cloud';
      badge.style.color = 'var(--good)';
      badge.style.background = 'var(--good-tint)';
      badge.title = 'Connected to Supabase. Data is backed up and synced in real-time.';
    } else {
      badge.innerHTML = '🟡 Local Storage';
      badge.style.color = 'var(--ink-muted)';
      badge.style.background = 'var(--surface-2)';
      badge.title = 'Using local browser storage. Add Supabase credentials in Settings to sync across devices.';
    }
  }

  function wrapDoc(d) {
    var rawData = d.data || d;
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
      console.warn('Supabase SDK not loaded yet.');
      return null;
    }

    var client = window.supabase.createClient(url, anonKey);
    activeClient = client;

    return {
      collection: function(colName) {
        return {
          onSnapshot: function(onNext, onError) {
            function fetchAll() {
              client.from(colName).select('*').then(function(res) {
                if (res.error) {
                  console.error('Supabase fetch error for ' + colName, res.error);
                  if (onError) onError(res.error);
                } else {
                  var docs = (res.data || []).map(wrapDoc);
                  onNext({ docs: docs });
                }
              }).catch(function(err) {
                if (onError) onError(err);
              });
            }
            fetchAll();

            // Realtime postgres_changes listener
            var channel = client.channel('public:' + colName)
              .on('postgres_changes', { event: '*', schema: 'public', table: colName }, function() {
                fetchAll();
              })
              .subscribe();

            return function unsubscribe() {
              try { client.removeChannel(channel); } catch(e) {}
            };
          },
          doc: function(docId) {
            var path = colName + '/' + docId;
            return {
              set: function(data) {
                return client.from(colName).upsert({ id: docId, data: data });
              },
              update: function(data) {
                return client.from(colName).upsert({ id: docId, data: data });
              },
              delete: function() {
                return client.from(colName).delete().eq('id', docId);
              },
              onSnapshot: function(onNext, onError) {
                function fetchDoc() {
                  client.from(colName).select('*').eq('id', docId).maybeSingle().then(function(res) {
                    if (res.error) {
                      if (onError) onError(res.error);
                    } else {
                      var item = res.data;
                      onNext({
                        exists: !!item,
                        id: docId,
                        data: function() { return (item && item.data) ? item.data : {}; }
                      });
                    }
                  }).catch(function(err) { if (onError) onError(err); });
                }
                fetchDoc();

                var channel = client.channel('public:' + colName + ':' + docId)
                  .on('postgres_changes', { event: '*', schema: 'public', table: colName, filter: 'id=eq.' + docId }, function() {
                    fetchDoc();
                  })
                  .subscribe();

                return function unsubscribe() {
                  try { client.removeChannel(channel); } catch(e) {}
                };
              }
            };
          },
          add: function(data) {
            var docId = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
            return client.from(colName).upsert({ id: docId, data: data }).then(function() {
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
            return client.from(colName).upsert({ id: docId, data: data });
          },
          update: function(data) {
            return client.from(colName).upsert({ id: docId, data: data });
          },
          delete: function() {
            return client.from(colName).delete().eq('id', docId);
          },
          onSnapshot: function(onNext, onError) {
            function fetchDoc() {
              client.from(colName).select('*').eq('id', docId).maybeSingle().then(function(res) {
                if (res.error) {
                  if (onError) onError(res.error);
                } else {
                  var item = res.data;
                  onNext({
                    exists: !!item,
                    id: docId,
                    data: function() { return (item && item.data) ? item.data : {}; }
                  });
                }
              }).catch(function(err) { if (onError) onError(err); });
            }
            fetchDoc();

            var channel = client.channel('public:' + colName + ':' + docId)
              .on('postgres_changes', { event: '*', schema: 'public', table: colName, filter: 'id=eq.' + docId }, function() {
                fetchDoc();
              })
              .subscribe();

            return function unsubscribe() {
              try { client.removeChannel(channel); } catch(e) {}
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
          window.SUPABASE_CONFIG = {
            url: data.url,
            anonKey: data.anonKey
          };
          return { url: data.url.trim(), key: data.anonKey.trim() };
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
          updateSyncBadge(true);
          return db;
        }
      } catch (err) {
        console.error('Supabase connection error:', err);
      }
    }
    updateSyncBadge(false);
    return null;
  };

  // UI Settings Form helpers
  window.populateSupabaseSettings = function() {
    var creds = getCredentials();
    var inputUrl = document.getElementById('sSbUrl');
    var inputKey = document.getElementById('sSbKey');
    if (inputUrl) inputUrl.value = creds.url;
    if (inputKey) inputKey.value = creds.key;
  };

  window.saveSupabaseSettings = function() {
    var inputUrl = document.getElementById('sSbUrl');
    var inputKey = document.getElementById('sSbKey');
    if (!inputUrl || !inputKey) return;

    var newUrl = inputUrl.value.trim();
    var newKey = inputKey.value.trim();
    var oldUrl = localStorage.getItem('purestudio_sb_url') || '';
    var oldKey = localStorage.getItem('purestudio_sb_key') || '';

    if (newUrl !== oldUrl || newKey !== oldKey) {
      if (newUrl) localStorage.setItem('purestudio_sb_url', newUrl);
      else localStorage.removeItem('purestudio_sb_url');

      if (newKey) localStorage.setItem('purestudio_sb_key', newKey);
      else localStorage.removeItem('purestudio_sb_key');

      // Reload so database changes take effect immediately
      setTimeout(function() {
        window.location.reload();
      }, 350);
    }
  };

  // Run initial badge update on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      var creds = getCredentials();
      updateSyncBadge(!!(creds.url && creds.key));
    });
  } else {
    var creds = getCredentials();
    updateSyncBadge(!!(creds.url && creds.key));
  }
})();
