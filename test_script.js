
(function(){

  function createLocalDb() {
    var STORAGE_PREFIX = 'purestudio_db_';
    var listeners = {};

    function getKey(path) {
      return STORAGE_PREFIX + path;
    }

    function getDocs(colName) {
      try {
        var raw = localStorage.getItem(getKey(colName));
        return raw ? JSON.parse(raw) : [];
      } catch(e) { return []; }
    }

    function saveDocs(colName, docs) {
      try {
        localStorage.setItem(getKey(colName), JSON.stringify(docs));
      } catch(e) { console.error('Storage quota error:', e); }
      notify(colName);
    }

    function getDoc(docPath) {
      try {
        var raw = localStorage.getItem(getKey(docPath));
        if (raw) return JSON.parse(raw);
        var parts = docPath.split('/');
        if (parts.length === 2) {
          var docs = getDocs(parts[0]);
          var match = docs.find(function(d) { return d.id === parts[1]; });
          if (match) return match;
        }
        return null;
      } catch(e) { return null; }
    }

    function saveDoc(docPath, data) {
      try {
        localStorage.setItem(getKey(docPath), JSON.stringify(data));
      } catch(e) { console.error(e); }
      notify(docPath);
    }

    function notify(target) {
      if (listeners[target]) {
        listeners[target].forEach(function(cb) {
          try { cb(createSnapshot(target)); } catch(e) { console.error(e); }
        });
      }
    }

    function createSnapshot(target) {
      if (target.indexOf('/') === -1) {
        var docs = getDocs(target);
        return {
          docs: docs.map(function(d) {
            return {
              id: d.id,
              data: function() {
                var copy = Object.assign({}, d);
                delete copy.id;
                return copy;
              }
            };
          })
        };
      } else {
        var data = getDoc(target);
        return {
          exists: !!data,
          id: target.split('/').pop(),
          data: function() { return data || {}; }
        };
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', function(e) {
        if (e.key && e.key.indexOf(STORAGE_PREFIX) === 0) {
          var target = e.key.slice(STORAGE_PREFIX.length);
          notify(target);
        }
      });
    }

    return {
      collection: function(colName) {
        return {
          onSnapshot: function(onNext, onError) {
            if (!listeners[colName]) listeners[colName] = [];
            listeners[colName].push(onNext);
            setTimeout(function() {
              try { onNext(createSnapshot(colName)); } catch(e) { if(onError) onError(e); }
            }, 0);
            return function unsubscribe() {
              listeners[colName] = listeners[colName].filter(function(cb) { return cb !== onNext; });
            };
          },
          doc: function(docId) {
            var path = colName + '/' + docId;
            return {
              set: function(data) {
                return new Promise(function(resolve) {
                  var docData = Object.assign({}, data, { id: docId });
                  var docs = getDocs(colName);
                  var idx = docs.findIndex(function(d) { return d.id === docId; });
                  if (idx >= 0) docs[idx] = docData; else docs.push(docData);
                  saveDocs(colName, docs);
                  saveDoc(path, data);
                  resolve();
                });
              },
              update: function(data) {
                return new Promise(function(resolve) {
                  var docs = getDocs(colName);
                  var idx = docs.findIndex(function(d) { return d.id === docId; });
                  if (idx >= 0) {
                    var updated = Object.assign({}, docs[idx], data, { id: docId });
                    docs[idx] = updated;
                    saveDocs(colName, docs);
                    saveDoc(path, updated);
                  } else {
                    var existing = getDoc(path) || {};
                    var updated = Object.assign({}, existing, data);
                    saveDoc(path, updated);
                  }
                  resolve();
                });
              },
              delete: function() {
                return new Promise(function(resolve) {
                  var docs = getDocs(colName);
                  docs = docs.filter(function(d) { return d.id !== docId; });
                  saveDocs(colName, docs);
                  try { localStorage.removeItem(getKey(path)); } catch(e) {}
                  notify(path);
                  resolve();
                });
              },
              onSnapshot: function(onNext, onError) {
                if (!listeners[path]) listeners[path] = [];
                listeners[path].push(onNext);
                setTimeout(function() {
                  try { onNext(createSnapshot(path)); } catch(e) { if(onError) onError(e); }
                }, 0);
                return function unsubscribe() {
                  listeners[path] = listeners[path].filter(function(cb) { return cb !== onNext; });
                };
              }
            };
          },
          add: function(data) {
            return new Promise(function(resolve) {
              var docId = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
              var docData = Object.assign({}, data, { id: docId });
              var docs = getDocs(colName);
              docs.push(docData);
              saveDocs(colName, docs);
              resolve({ id: docId });
            });
          }
        };
      },
      doc: function(docPath) {
        var path = docPath;
        var parts = docPath.split('/');
        var colName = parts[0];
        var docId = parts[1];
        return {
          set: function(data) {
            return new Promise(function(resolve) {
              if (docId) {
                var docs = getDocs(colName);
                var docData = Object.assign({}, data, { id: docId });
                var idx = docs.findIndex(function(d) { return d.id === docId; });
                if (idx >= 0) docs[idx] = docData; else docs.push(docData);
                saveDocs(colName, docs);
              }
              saveDoc(path, data);
              resolve();
            });
          },
          update: function(data) {
            return new Promise(function(resolve) {
              var existing = getDoc(path) || {};
              var updated = Object.assign({}, existing, data);
              if (docId) {
                var docs = getDocs(colName);
                var idx = docs.findIndex(function(d) { return d.id === docId; });
                if (idx >= 0) {
                  docs[idx] = Object.assign({}, docs[idx], data, { id: docId });
                  saveDocs(colName, docs);
                }
              }
              saveDoc(path, updated);
              resolve();
            });
          },
          delete: function() {
            return new Promise(function(resolve) {
              if (docId) {
                var docs = getDocs(colName);
                docs = docs.filter(function(d) { return d.id !== docId; });
                saveDocs(colName, docs);
              }
              try { localStorage.removeItem(getKey(path)); } catch(e) {}
              notify(path);
              resolve();
            });
          },
          onSnapshot: function(onNext, onError) {
            if (!listeners[path]) listeners[path] = [];
            listeners[path].push(onNext);
            setTimeout(function() {
              try { onNext(createSnapshot(path)); } catch(e) { if(onError) onError(e); }
            }, 0);
            return function unsubscribe() {
              listeners[path] = listeners[path].filter(function(cb) { return cb !== onNext; });
            };
          }
        };
      }
    };
  }

  var DEFAULT_BUSINESS = {
    name: 'The Pure Studio',
    regdAddress: '601, Dwarka bldg., Sainath Nagar, L.B.S. Marg, Ghatkopar West, Mumbai-400086',
    officeAddress: 'G-41, Ground Floor, Sai Dham Shopping Plaza, Sarvoday Nagar, Mulund West, Mumbai-400080',
    email: 'info.thepurestudio@gmail.com',
    phone: '9930914406',
    website: '',
    gstin: '27ERWPS0075L1ZU',
    jurisdiction: 'Mumbai',
    cgstPct: 9,
    sgstPct: 9,
    bankAccountName: 'THE PURE STUDIO',
    bankAccountNo: '0365073000001224',
    bankName: 'The South Indian Bank Ltd',
    bankBranch: 'Ghatkopar West',
    bankIfsc: 'SIBL0000365',
    upiHandle: 'dhrumil6115-1@okicici',
    terms: 'Payment requested by crossed PAYEES A/C. cheque / NEFT/RTGS only.\nOur responsibility ceases on delivery of the final files.\nInterest of 24% per annum will be charged on Bills remaining unpaid one week after invoice date.'
  };

  var db = null;
  var clients = [];
  var invoices = [];
  var business = Object.assign({}, DEFAULT_BUSINESS);
  var activeTab = 'dashboard';
  var selectedMonth = new Date().toISOString().slice(0,7);
  var editingClientId = null;
  var editingInvoiceId = null;
  var comboSelectedId = null;
  var drawerClientId = null;
  var formItems = [];
  var previewInvoiceId = null;
  var downloadsCap = null;

  var $ = function(id){ return document.getElementById(id); };

  function debounce(fn, wait){
    var t;
    return function(){
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function(){ fn.apply(ctx, args); }, wait);
    };
  }

  function money(n){
    n = Number(n) || 0;
    return '₹' + n.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function fmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso + 'T00:00:00');
    if(isNaN(d)) return iso;
    return d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
  }
  function fmtMonth(ym){
    var d = new Date(ym + '-01T00:00:00');
    return d.toLocaleDateString('en-US', {month:'long', year:'numeric'});
  }
  function clientById(id){
    for(var i=0;i<clients.length;i++) if(clients[i].id === id) return clients[i];
    return null;
  }
  function initials(name){
    var parts = String(name||'?').trim().split(/\s+/).filter(Boolean);
    if(!parts.length) return '?';
    if(parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  }
  function fyLabel(d){
    var y = d.getFullYear(), m = d.getMonth()+1;
    var startY = m >= 4 ? y : y - 1;
    return startY + '-' + String(startY+1).slice(-2);
  }
  function numberToWordsIndian(num){
    num = Math.round(Math.abs(Number(num)||0));
    if(num === 0) return 'Zero';
    var ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    var tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    function twoDigits(n){
      if(n < 20) return ones[n];
      var t = Math.floor(n/10), r = n%10;
      return tens[t] + (r ? '-' + ones[r] : '');
    }
    function threeDigits(n){
      var h = Math.floor(n/100), r = n%100, out = '';
      if(h) out += ones[h] + ' Hundred';
      if(r) out += (out ? ' ' : '') + twoDigits(r);
      return out;
    }
    var crore = Math.floor(num/10000000); num %= 10000000;
    var lakh = Math.floor(num/100000); num %= 100000;
    var thousand = Math.floor(num/1000); num %= 1000;
    var hundred = num;
    var parts = [];
    if(crore) parts.push(threeDigits(crore) + ' Crore');
    if(lakh) parts.push(twoDigits(lakh) + ' Lakh');
    if(thousand) parts.push(twoDigits(thousand) + ' Thousand');
    if(hundred) parts.push(threeDigits(hundred));
    return parts.join(' ');
  }
  function computeTotals(data){
    var items = data.items || [];
    var subtotal = items.reduce(function(s,it){ return s + (Number(it.qty)||0) * (Number(it.unitPrice)||0); }, 0);
    var otherCharges = Number(data.otherCharges)||0;
    var taxableBase = subtotal + otherCharges;
    var cgstPct = data.cgstPct != null ? Number(data.cgstPct) : business.cgstPct;
    var sgstPct = data.sgstPct != null ? Number(data.sgstPct) : business.sgstPct;
    var cgstAmt = taxableBase * cgstPct / 100;
    var sgstAmt = taxableBase * sgstPct / 100;
    var rawTotal = taxableBase + cgstAmt + sgstAmt;
    var total = Math.round(rawTotal);
    var roundOff = total - rawTotal;
    return {subtotal:subtotal, otherCharges:otherCharges, cgstPct:cgstPct, sgstPct:sgstPct, cgstAmt:cgstAmt, sgstAmt:sgstAmt, taxTotal:cgstAmt+sgstAmt, rawTotal:rawTotal, roundOff:roundOff, total:total};
  }
  function invoiceTotal(inv){
    return inv && inv.total != null ? Number(inv.total) : computeTotals(inv || {}).total;
  }

  function switchTab(tab){
    activeTab = tab;
    ['dashboard','clients','invoices'].forEach(function(t){
      $('panel-'+t).hidden = (t !== tab);
    });
    document.querySelectorAll('.nav-btn, .bn-btn').forEach(function(b){
      if(b.getAttribute('data-tab') === tab) b.setAttribute('aria-current','page');
      else b.removeAttribute('aria-current');
    });
    window.scrollTo({top:0, behavior:'auto'});
  }
  document.querySelectorAll('.nav-btn, .bn-btn').forEach(function(b){
    b.addEventListener('click', function(){ switchTab(b.getAttribute('data-tab')); });
  });

  function salesByClient(){
    var map = {};
    invoices.forEach(function(inv){
      if(!inv.clientId) return;
      if(!map[inv.clientId]) map[inv.clientId] = {total:0, count:0, last:null};
      map[inv.clientId].total += invoiceTotal(inv);
      map[inv.clientId].count += 1;
      if(!map[inv.clientId].last || inv.date > map[inv.clientId].last) map[inv.clientId].last = inv.date;
    });
    return map;
  }

  function renderKPIs(){
    var monthInvoices = invoices.filter(function(i){ return (i.date||'').slice(0,7) === selectedMonth; });
    var byClient = {};
    monthInvoices.forEach(function(inv){
      if(!inv.clientId) return;
      byClient[inv.clientId] = (byClient[inv.clientId]||0) + invoiceTotal(inv);
    });
    var topId = null, topAmt = -1;
    Object.keys(byClient).forEach(function(id){ if(byClient[id] > topAmt){ topAmt = byClient[id]; topId = id; } });
    var topClient = topId ? clientById(topId) : null;
    var totalRevenue = monthInvoices.reduce(function(s,i){ return s + invoiceTotal(i); }, 0);

    var kpis = [
      {label:'Revenue — ' + fmtMonth(selectedMonth), value: money(totalRevenue), mono:true},
      {label:'Top client this month', value: topClient ? topClient.name : '—', hint: topClient ? money(topAmt) + ' in sales' : 'No invoices yet'},
      {label:'Invoices this month', value: String(monthInvoices.length)},
      {label:'Total clients', value: String(clients.length)}
    ];
    $('kpiRow').innerHTML = kpis.map(function(k){
      return '<div class="kpi"><div class="label">'+esc(k.label)+'</div><div class="value'+(k.mono?' mono':'')+'">'+esc(k.value)+'</div>'+(k.hint?'<div class="hint">'+esc(k.hint)+'</div>':'')+'</div>';
    }).join('');
  }

  function renderChart(){
    var monthInvoices = invoices.filter(function(i){ return (i.date||'').slice(0,7) === selectedMonth; });
    var byClient = {};
    monthInvoices.forEach(function(inv){
      if(!inv.clientId) return;
      byClient[inv.clientId] = (byClient[inv.clientId]||0) + invoiceTotal(inv);
    });
    var rows = Object.keys(byClient).map(function(id){
      var c = clientById(id);
      return {name: c ? c.name : 'Unknown client', amount: byClient[id]};
    }).sort(function(a,b){ return b.amount - a.amount; });

    $('chartTitle').textContent = 'Revenue by client — ' + fmtMonth(selectedMonth);
    $('chartNote').textContent = rows.length ? rows.length + ' client' + (rows.length===1?'':'s') + ' billed' : '';

    if(!rows.length){
      $('chartBody').innerHTML = '<div class="empty"><span class="big">No invoices in '+esc(fmtMonth(selectedMonth))+'</span>Pick another month, or add an invoice for this one.</div>';
      return;
    }
    var max = rows[0].amount || 1;
    $('chartBody').innerHTML = rows.map(function(r, idx){
      var pct = Math.max(4, Math.round((r.amount / max) * 100));
      return '<div class="bar-row'+(idx===0?' top':'')+'">'+
        '<div class="name">'+esc(r.name)+'</div>'+
        '<div class="track"><div class="fill" style="width:'+pct+'%"></div></div>'+
        '<div class="amount mono">'+money(r.amount)+'</div>'+
      '</div>';
    }).join('');
  }

  function renderSalesTable(){
    var map = salesByClient();
    var q = ($('salesSearch').value || '').toLowerCase();
    var rows = clients.map(function(c){
      var s = map[c.id] || {total:0, count:0, last:null};
      return {client:c, total:s.total, count:s.count, last:s.last};
    }).filter(function(r){ return r.client.name.toLowerCase().indexOf(q) !== -1; })
      .sort(function(a,b){ return b.total - a.total; });

    $('salesEmpty').style.display = clients.length ? 'none' : 'flex';
    $('salesTableBody').innerHTML = rows.map(function(r){
      return '<tr class="row-click" data-client-id="'+r.client.id+'">'+
        '<td class="client-name card-title" data-label="Client">'+
          '<div class="name-cell"><span class="avatar">'+esc(initials(r.client.name))+'</span>'+esc(r.client.name)+'</div>'+
        '</td>'+
        '<td class="num mono" data-label="Invoices">'+r.count+'</td>'+
        '<td class="num mono" data-label="Total sales">'+money(r.total)+'</td>'+
        '<td data-label="Last invoice">'+fmtDate(r.last)+'</td></tr>';
    }).join('') || (clients.length ? '<tr><td colspan="4" style="color:var(--ink-faint);padding:20px 12px;">No matches.</td></tr>' : '');
  }

  function renderClients(){
    var q = ($('clientSearch').value || '').toLowerCase();
    var map = salesByClient();
    var filtered = clients.filter(function(c){ return c.name.toLowerCase().indexOf(q) !== -1; })
      .sort(function(a,b){ return a.name.localeCompare(b.name); });
    $('clientCount').textContent = clients.length + ' client' + (clients.length===1?'':'s');
    $('clientsEmpty').style.display = clients.length ? 'none' : 'flex';
    $('clientsTableBody').innerHTML = filtered.map(function(c){
      var s = map[c.id] || {total:0, count:0};
      return '<tr class="row-click" data-client-id="'+c.id+'">'+
        '<td class="card-title" data-label="Company">'+
          '<div class="name-cell"><span class="avatar">'+esc(initials(c.name))+'</span><span class="client-name">'+esc(c.name)+'</span></div>'+
        '</td>'+
        '<td data-label="Contact"><div>'+esc(c.contact||'—')+'</div><div class="client-sub">'+esc(c.email||'')+(c.phone?(' · '+esc(c.phone)):'')+'</div></td>'+
        '<td class="num mono" data-label="Total sales">'+money(s.total)+'</td>'+
        '<td class="num mono" data-label="Invoices">'+s.count+'</td>'+
        '<td class="card-actions"><div class="row-actions">'+
          '<button class="icon-btn" data-edit-client="'+c.id+'" title="Edit" aria-label="Edit '+esc(c.name)+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>'+
          '<button class="icon-btn" data-del-client="'+c.id+'" title="Delete" aria-label="Delete '+esc(c.name)+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>'+
        '</div></td></tr>';
    }).join('') || '<tr><td colspan="5" style="color:var(--ink-faint);padding:20px 12px;">No matches.</td></tr>';
  }

  function renderInvoices(){
    var q = ($('invoiceSearch').value || '').toLowerCase();
    var status = $('statusFilter').value;
    var rows = invoices.filter(function(inv){
      var matchesQ = !q || (inv.clientName||'').toLowerCase().indexOf(q) !== -1 || (inv.number||'').toLowerCase().indexOf(q) !== -1;
      var matchesStatus = !status || inv.status === status;
      return matchesQ && matchesStatus;
    }).sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });

    $('invoicesEmpty').style.display = invoices.length ? 'none' : 'flex';
    $('invoicesTableBody').innerHTML = rows.map(function(inv){
      return '<tr>'+
        '<td class="mono card-title" data-label="Invoice">'+esc(inv.number||'—')+'</td>'+
        '<td data-label="Client">'+esc(inv.clientName||'Unknown')+'</td>'+
        '<td data-label="Date">'+fmtDate(inv.date)+'</td>'+
        '<td class="num mono" data-label="Amount">'+money(invoiceTotal(inv))+'</td>'+
        '<td data-label="Status"><span class="chip '+esc(inv.status||'pending')+'">'+esc(inv.status||'pending')+'</span></td>'+
        '<td class="card-actions"><div class="row-actions">'+
          '<button class="icon-btn" data-view-invoice="'+inv.id+'" title="Preview / print" aria-label="Preview invoice '+esc(inv.number||'')+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg></button>'+
          '<button class="icon-btn" data-edit-invoice="'+inv.id+'" title="Edit" aria-label="Edit invoice '+esc(inv.number||'')+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>'+
          '<button class="icon-btn" data-del-invoice="'+inv.id+'" title="Delete" aria-label="Delete invoice '+esc(inv.number||'')+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>'+
        '</div></td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--ink-faint);padding:20px 12px;">No matches.</td></tr>';
  }

  function renderDrawer(){
    if(!drawerClientId) return;
    var c = clientById(drawerClientId);
    if(!c){ closeDrawer(); return; }
    var map = salesByClient();
    var s = map[c.id] || {total:0, count:0};
    var avg = s.count ? s.total / s.count : 0;
    var history = invoices.filter(function(i){ return i.clientId === c.id; })
      .sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });

    var contactHtml = '<div class="contact-list">' +
      (c.contact ? '<div>'+esc(c.contact)+'</div>' : '') +
      (c.email ? '<div><a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a></div>' : '') +
      (c.phone ? '<div><a href="tel:'+esc(c.phone)+'">'+esc(c.phone)+'</a></div>' : '') +
      (c.address ? '<div class="client-sub">'+esc(c.address)+'</div>' : '') +
      (c.gstin ? '<div class="client-sub">GSTIN: '+esc(c.gstin)+'</div>' : '') +
      (c.notes ? '<div class="client-sub">'+esc(c.notes)+'</div>' : '') +
      (!c.contact && !c.email && !c.phone && !c.address ? '<div class="client-sub">No contact details yet.</div>' : '') +
    '</div>';

    var historyHtml = history.length ? history.map(function(inv){
      return '<div class="history-row" data-preview-invoice="'+inv.id+'">'+
        '<div><div class="hnum mono">'+esc(inv.number||'—')+'</div><div class="hdate">'+fmtDate(inv.date)+'</div></div>'+
        '<div style="text-align:right;"><div class="mono" style="font-weight:600;">'+money(invoiceTotal(inv))+'</div><span class="chip '+esc(inv.status||'pending')+'">'+esc(inv.status||'pending')+'</span></div>'+
      '</div>';
    }).join('') : '<div class="client-sub" style="padding:6px 0;">No invoices yet for this client.</div>';

    $('drawerPanel').innerHTML =
      '<div class="drawer-head">'+
        '<div class="drawer-id"><span class="avatar lg">'+esc(initials(c.name))+'</span>'+
          '<div><h2>'+esc(c.name)+'</h2><div class="sub">Client since '+fmtDate((c.createdAt||'').slice(0,10))+'</div></div>'+
        '</div>'+
        '<button class="icon-btn" id="drawerClose" aria-label="Close"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'+
      '</div>'+
      '<div class="drawer-body">'+
        '<div class="drawer-stats">'+
          '<div class="kpi"><div class="label">Total sales</div><div class="value mono">'+money(s.total)+'</div></div>'+
          '<div class="kpi"><div class="label">Invoices</div><div class="value mono">'+s.count+'</div></div>'+
          '<div class="kpi"><div class="label">Avg. invoice</div><div class="value mono">'+money(avg)+'</div></div>'+
        '</div>'+
        '<div class="drawer-section"><h3>Contact</h3>'+contactHtml+'</div>'+
        '<div class="actions">'+
          '<button class="btn primary small" id="drawerNewInvoice">+ New invoice</button>'+
          '<button class="btn ghost small" id="drawerEdit">Edit details</button>'+
          '<button class="btn ghost small danger" id="drawerDelete">Delete client</button>'+
        '</div>'+
        '<div class="drawer-section"><h3>Invoice history</h3>'+historyHtml+'</div>'+
      '</div>';

    $('drawerClose').addEventListener('click', closeDrawer);
    $('drawerNewInvoice').addEventListener('click', function(){
      openInvoiceModal(null);
      $('iClient').value = c.name;
      $('iClientId').value = c.id;
      comboSelectedId = c.id;
      updateClientHint();
    });
    $('drawerEdit').addEventListener('click', function(){ openClientModal(c.id); });
    $('drawerDelete').addEventListener('click', function(){ deleteClient(c.id); closeDrawer(); });
    document.querySelectorAll('[data-preview-invoice]').forEach(function(el){
      el.addEventListener('click', function(){ openPreview(el.getAttribute('data-preview-invoice')); });
    });
  }

  function openDrawer(id){
    drawerClientId = id;
    renderDrawer();
    $('clientDrawer').hidden = false;
  }
  function closeDrawer(){ $('clientDrawer').hidden = true; drawerClientId = null; }

  function renderAll(){
    renderKPIs();
    renderChart();
    renderSalesTable();
    renderClients();
    renderInvoices();
    if(drawerClientId && !$('clientDrawer').hidden) renderDrawer();
  }

  $('monthInput').value = selectedMonth;
  $('monthInput').addEventListener('change', function(){
    selectedMonth = this.value || selectedMonth;
    renderKPIs(); renderChart();
  });
  $('salesSearch').addEventListener('input', debounce(renderSalesTable, 120));
  $('clientSearch').addEventListener('input', debounce(renderClients, 120));
  $('invoiceSearch').addEventListener('input', debounce(renderInvoices, 120));
  $('statusFilter').addEventListener('change', renderInvoices);

  document.body.addEventListener('click', function(e){
    var editC = e.target.closest('[data-edit-client]');
    var delC = e.target.closest('[data-del-client]');
    var editI = e.target.closest('[data-edit-invoice]');
    var delI = e.target.closest('[data-del-invoice]');
    var viewI = e.target.closest('[data-view-invoice]');
    var rowC = e.target.closest('[data-client-id]');
    if(editC){ e.stopPropagation(); openClientModal(editC.getAttribute('data-edit-client')); return; }
    if(delC){ e.stopPropagation(); deleteClient(delC.getAttribute('data-del-client')); return; }
    if(editI){ e.stopPropagation(); openInvoiceModal(editI.getAttribute('data-edit-invoice')); return; }
    if(delI){ e.stopPropagation(); deleteInvoice(delI.getAttribute('data-del-invoice')); return; }
    if(viewI){ e.stopPropagation(); openPreview(viewI.getAttribute('data-view-invoice')); return; }
    if(rowC){ openDrawer(rowC.getAttribute('data-client-id')); return; }
  });

  function openClientModal(id){
    editingClientId = id || null;
    var c = id ? clientById(id) : null;
    $('clientModalTitle').textContent = c ? 'Edit client' : 'Add client';
    $('cName').value = c ? c.name : '';
    $('cContact').value = c ? (c.contact||'') : '';
    $('cEmail').value = c ? (c.email||'') : '';
    $('cPhone').value = c ? (c.phone||'') : '';
    $('cAddress').value = c ? (c.address||'') : '';
    $('cGstin').value = c ? (c.gstin||'') : '';
    $('cNotes').value = c ? (c.notes||'') : '';
    $('clientOverlay').hidden = false;
    setTimeout(function(){ $('cName').focus(); }, 0);
  }
  function closeClientModal(){ $('clientOverlay').hidden = true; editingClientId = null; }
  $('btnNewClient').addEventListener('click', function(){ openClientModal(null); });
  $('btnEmptyAddClient').addEventListener('click', function(){ openClientModal(null); });
  $('clientCancel').addEventListener('click', closeClientModal);
  $('clientOverlay').addEventListener('click', function(e){ if(e.target === $('clientOverlay')) closeClientModal(); });

  $('clientForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!db){ db = createLocalDb(); }
    var data = {
      name: $('cName').value.trim(),
      contact: $('cContact').value.trim(),
      email: $('cEmail').value.trim(),
      phone: $('cPhone').value.trim(),
      address: $('cAddress').value.trim(),
      gstin: $('cGstin').value.trim(),
      notes: $('cNotes').value.trim()
    };
    if(!data.name) return;
    var promise;
    if(editingClientId){
      promise = db.collection('clients').doc(editingClientId).update(data);
    } else {
      data.createdAt = new Date().toISOString();
      promise = db.collection('clients').add(data);
    }
    promise.then(function(){ closeClientModal(); renderAll(); }).catch(function(err){ console.error(err); });
  });

  function deleteClient(id){
    if(!db) db = createLocalDb();
    var c = clientById(id);
    var usedIn = invoices.filter(function(i){ return i.clientId === id; }).length;
    var msg = usedIn ? ('Delete '+(c?c.name:'this client')+'? '+usedIn+' invoice(s) will stay on record but keep this company\'s name.') : ('Delete '+(c?c.name:'this client')+'?');
    if(!window.confirm(msg)) return;
    db.collection('clients').doc(id).delete().then(function(){ renderAll(); }).catch(function(err){ console.error(err); });
  }

  function blankItem(){ return {description:'', hsn:'', qty:1, unitPrice:0}; }

  function renderItemsRows(){
    $('itemsBody').innerHTML = formItems.map(function(it, idx){
      var lineTotal = (Number(it.qty)||0) * (Number(it.unitPrice)||0);
      return '<div class="item-row" data-idx="'+idx+'">'+
        '<input type="text" class="it-desc" placeholder="What did you deliver?" value="'+esc(it.description)+'">'+
        '<input type="text" class="it-hsn" placeholder="HSN/SAC" value="'+esc(it.hsn)+'">'+
        '<input type="number" class="it-qty" min="0" step="1" value="'+esc(it.qty)+'">'+
        '<input type="number" class="it-price" min="0" step="0.01" value="'+esc(it.unitPrice)+'">'+
        '<div class="it-total mono">'+money(lineTotal)+'</div>'+
        '<button type="button" class="icon-btn it-remove" aria-label="Remove line"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'+
      '</div>';
    }).join('');
  }
  function readFormValues(){
    return {
      items: formItems,
      otherCharges: parseFloat($('iOther').value) || 0,
      cgstPct: parseFloat($('iCgst').value) || 0,
      sgstPct: parseFloat($('iSgst').value) || 0
    };
  }
  function recalcSummary(){
    var t = computeTotals(readFormValues());
    $('invoiceSummary').innerHTML =
      '<div class="summary-row"><span>Subtotal</span><span class="mono">'+money(t.subtotal)+'</span></div>'+
      '<div class="summary-row"><span>Other charges</span><span class="mono">'+money(t.otherCharges)+'</span></div>'+
      '<div class="summary-row"><span>CGST @ '+t.cgstPct+'%</span><span class="mono">'+money(t.cgstAmt)+'</span></div>'+
      '<div class="summary-row"><span>SGST @ '+t.sgstPct+'%</span><span class="mono">'+money(t.sgstAmt)+'</span></div>'+
      '<div class="summary-row"><span>Round off</span><span class="mono">'+(t.roundOff>=0?'+':'')+t.roundOff.toFixed(2)+'</span></div>'+
      '<div class="summary-row total"><span>Invoice value</span><span class="mono">'+money(t.total)+'</span></div>'+
      '<div class="summary-words">'+esc(numberToWordsIndian(t.total))+'</div>';
  }
  $('itemsBody').addEventListener('input', function(e){
    var row = e.target.closest('.item-row');
    if(!row) return;
    var idx = Number(row.getAttribute('data-idx'));
    if(e.target.classList.contains('it-desc')) formItems[idx].description = e.target.value;
    else if(e.target.classList.contains('it-hsn')) formItems[idx].hsn = e.target.value;
    else if(e.target.classList.contains('it-qty')) formItems[idx].qty = e.target.value;
    else if(e.target.classList.contains('it-price')) formItems[idx].unitPrice = e.target.value;
    var lineTotal = (Number(formItems[idx].qty)||0) * (Number(formItems[idx].unitPrice)||0);
    row.querySelector('.it-total').textContent = money(lineTotal);
    recalcSummary();
  });
  $('itemsBody').addEventListener('click', function(e){
    var btn = e.target.closest('.it-remove');
    if(!btn) return;
    var row = btn.closest('.item-row');
    var idx = Number(row.getAttribute('data-idx'));
    if(formItems.length <= 1) return;
    formItems.splice(idx, 1);
    renderItemsRows();
    recalcSummary();
  });
  $('btnAddItem').addEventListener('click', function(){
    formItems.push(blankItem());
    renderItemsRows();
    var rows = $('itemsBody').querySelectorAll('.item-row');
    var last = rows[rows.length-1];
    if(last) last.querySelector('.it-desc').focus();
    recalcSummary();
  });
  ['iOther','iCgst','iSgst'].forEach(function(id){
    $(id).addEventListener('input', recalcSummary);
  });

  function updateClientHint(){
    var c = clientById($('iClientId').value);
    if(!c){ $('iClientHint').textContent = ''; return; }
    var bits = [];
    if(c.gstin) bits.push('GSTIN ' + c.gstin);
    if(c.address) bits.push(c.address);
    $('iClientHint').textContent = bits.length ? bits.join(' · ') : 'No billing address or GSTIN on file yet — edit the client to add one.';
  }

  function openInvoiceModal(id){
    editingInvoiceId = id || null;
    var inv = id ? invoices.filter(function(i){return i.id===id;})[0] : null;
    $('invoiceModalTitle').textContent = inv ? 'Edit invoice' : 'New invoice';
    if(inv){
      var c = clientById(inv.clientId);
      $('iClient').value = c ? c.name : (inv.clientName||'');
      $('iClientId').value = inv.clientId || '';
      comboSelectedId = inv.clientId || null;
      $('iNumber').value = inv.number || '';
      $('iDate').value = inv.date || '';
      $('iStatus').value = inv.status || 'pending';
      $('iOther').value = inv.otherCharges != null ? inv.otherCharges : 0;
      $('iCgst').value = inv.cgstPct != null ? inv.cgstPct : business.cgstPct;
      $('iSgst').value = inv.sgstPct != null ? inv.sgstPct : business.sgstPct;
      formItems = (inv.items && inv.items.length) ? inv.items.map(function(it){ return Object.assign({}, it); }) : [blankItem()];
    } else {
      $('iClient').value = '';
      $('iClientId').value = '';
      comboSelectedId = null;
      $('iNumber').value = String(invoices.length + 1) + '/' + fyLabel(new Date());
      $('iDate').value = new Date().toISOString().slice(0,10);
      $('iStatus').value = 'pending';
      $('iOther').value = 0;
      $('iCgst').value = business.cgstPct;
      $('iSgst').value = business.sgstPct;
      formItems = [blankItem()];
    }
    renderItemsRows();
    recalcSummary();
    updateClientHint();
    $('invoiceOverlay').hidden = false;
    setTimeout(function(){ $('iClient').focus(); }, 0);
  }
  function closeInvoiceModal(){ $('invoiceOverlay').hidden = true; editingInvoiceId = null; $('iClientList').hidden = true; }
  $('btnNewInvoice').addEventListener('click', function(){ openInvoiceModal(null); });
  $('btnNewInvoiceTop').addEventListener('click', function(){ openInvoiceModal(null); });
  $('invoiceCancel').addEventListener('click', closeInvoiceModal);
  $('invoiceOverlay').addEventListener('click', function(e){ if(e.target === $('invoiceOverlay')) closeInvoiceModal(); });

  var comboInput = $('iClient');
  var comboList = $('iClientList');
  comboInput.addEventListener('input', function(){
    comboSelectedId = null;
    $('iClientId').value = '';
    updateClientHint();
    var q = comboInput.value.trim().toLowerCase();
    var matches = clients.filter(function(c){ return c.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
    var html = matches.map(function(c){
      return '<div class="combo-item" data-id="'+c.id+'">'+esc(c.name)+'</div>';
    }).join('');
    var exact = clients.some(function(c){ return c.name.toLowerCase() === q; });
    if(q && !exact){
      html += '<div class="combo-item create" data-create="1">+ Add "'+esc(comboInput.value.trim())+'" as a new client</div>';
    }
    comboList.innerHTML = html;
    comboList.hidden = !html;
  });
  comboInput.addEventListener('focus', function(){ if(comboList.innerHTML) comboList.hidden = false; });
  document.addEventListener('click', function(e){
    if(!e.target.closest('.combobox')) comboList.hidden = true;
  });
  comboList.addEventListener('click', function(e){
    var item = e.target.closest('.combo-item');
    if(!item) return;
    if(item.getAttribute('data-create')){
      var name = comboInput.value.trim();
      if(!db) db = createLocalDb();
      if(!name) return;
      db.collection('clients').add({name: name, contact:'', email:'', phone:'', address:'', gstin:'', notes:'', createdAt: new Date().toISOString()})
        .then(function(ref){
          comboSelectedId = ref.id;
          $('iClientId').value = ref.id;
          comboInput.value = name;
          comboList.hidden = true;
          updateClientHint();
        });
    } else {
      var id = item.getAttribute('data-id');
      var c = clientById(id);
      comboSelectedId = id;
      $('iClientId').value = id;
      comboInput.value = c ? c.name : '';
      comboList.hidden = true;
      updateClientHint();
    }
  });

  $('invoiceForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!db) db = createLocalDb();
    var clientId = $('iClientId').value || comboSelectedId;
    if(!clientId){
      comboInput.focus();
      return;
    }
    var validItems = formItems.filter(function(it){ return (it.description||'').trim() || (Number(it.qty)||0) * (Number(it.unitPrice)||0) > 0; })
      .map(function(it){ return {description:(it.description||'').trim(), hsn:(it.hsn||'').trim(), qty:Number(it.qty)||0, unitPrice:Number(it.unitPrice)||0}; });
    if(!validItems.length){
      $('itemsBody').querySelector('.it-desc').focus();
      return;
    }
    var c = clientById(clientId);
    var totalsInput = {items: validItems, otherCharges: parseFloat($('iOther').value)||0, cgstPct: parseFloat($('iCgst').value)||0, sgstPct: parseFloat($('iSgst').value)||0};
    var t = computeTotals(totalsInput);
    var data = {
      clientId: clientId,
      clientName: c ? c.name : comboInput.value.trim(),
      number: $('iNumber').value.trim(),
      date: $('iDate').value,
      status: $('iStatus').value,
      items: validItems,
      otherCharges: t.otherCharges,
      cgstPct: t.cgstPct,
      sgstPct: t.sgstPct,
      subtotal: t.subtotal,
      cgstAmt: t.cgstAmt,
      sgstAmt: t.sgstAmt,
      roundOff: t.roundOff,
      total: t.total
    };
    var promise;
    if(editingInvoiceId){
      promise = db.collection('invoices').doc(editingInvoiceId).update(data);
    } else {
      data.createdAt = new Date().toISOString();
      promise = db.collection('invoices').add(data);
    }
    promise.then(function(){ closeInvoiceModal(); renderAll(); }).catch(function(err){ console.error(err); });
  });

  function deleteInvoice(id){
    if(!db) db = createLocalDb();
    if(!window.confirm('Delete this invoice? This can\'t be undone.')) return;
    db.collection('invoices').doc(id).delete().then(function(){ renderAll(); }).catch(function(err){ console.error(err); });
  }

  function openPreview(id){
    var inv = invoices.filter(function(i){ return i.id === id; })[0];
    if(!inv) return;
    previewInvoiceId = id;
    var c = clientById(inv.clientId) || {name: inv.clientName || 'Client'};
    var t = computeTotals(inv);
    var termsLines = (business.terms||'').split('
').filter(Boolean);

    // Build item rows and fill empty rows up to 8 rows minimum for paper grid
    var items = inv.items || [];
    var itemRowsHtml = items.map(function(it){
      var lineTot = (Number(it.qty)||0) * (Number(it.unitPrice)||0);
      return '<tr>' +
        '<td class="col-desc">' + esc(it.description) + '</td>' +
        '<td class="col-hsn">' + esc(it.hsn || '') + '</td>' +
        '<td class="col-qty">' + (Number(it.qty)||0) + '</td>' +
        '<td class="col-price">₹' + (Number(it.unitPrice)||0).toFixed(2) + '</td>' +
        '<td class="col-total">₹' + lineTot.toFixed(2) + '</td>' +
      '</tr>';
    }).join('');

    var emptyRowCount = Math.max(0, 8 - items.length);
    for(var er = 0; er < emptyRowCount; er++){
      itemRowsHtml += '<tr class="empty-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>';
    }

    var totalTax = (Number(t.cgstAmt)||0) + (Number(t.sgstAmt)||0);
    var inWords = numberToWordsIndian(t.total);

    var logoSvg = '<svg class="inv-logo-svg" viewBox="0 0 170 65" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<g fill="#0b1b36">' +
        '<!-- Interlocking 3-loop geometric icon -->' +
        '<path d="M18 10 C18 4.5 22.5 0 28 0 C33.5 0 38 4.5 38 10 C38 14.2 35.2 17.8 31.4 19.2 L36.8 24.6 C37.6 25.4 37.6 26.6 36.8 27.4 L33.4 30.8 C32.6 31.6 31.4 31.6 30.6 30.8 L25.2 25.4 C23.8 29.2 20.2 32 16 32 C10.5 32 6 27.5 6 22 C6 16.5 10.5 12 16 12 C16.7 12 17.3 12.1 18 12.2 L18 10 Z" fill="none" stroke="#0b1b36" stroke-width="4"/>' +
        '<path d="M22 18 C20.5 16.8 18.5 16 16 16 C12.7 16 10 18.7 10 22 C10 25.3 12.7 28 16 28 C19.3 28 22 25.3 22 22 C22 20.8 21.6 19.7 21 18.8" stroke="#0b1b36" stroke-width="3.5" fill="none"/>' +
        '<path d="M28 4 C24.7 4 22 6.7 22 10 C22 13.3 24.7 16 28 16 C31.3 16 34 13.3 34 10 C34 6.7 31.3 4 28 4 Z" stroke="#0b1b36" stroke-width="3.5" fill="none"/>' +
        '<path d="M16 36 C22 36 26 40 26 46 C26 52 22 56 16 56 C10 56 6 52 6 46 C6 40 10 36 16 36 Z" stroke="#0b1b36" stroke-width="3.5" fill="none"/>' +
        '<path d="M26 42 L34 50 C34.8 50.8 34.8 52 34 52.8 L31 55.8 C30.2 56.6 29 56.6 28.2 55.8 L20 48" stroke="#0b1b36" stroke-width="3.5" fill="none"/>' +
        '<!-- Brand typography -->' +
        '<text x="56" y="20" font-family=\'Arial, sans-serif\' font-weight=\'800\' font-size=\'18\' fill=\'#0b1b36\'>The</text>' +
        '<text x="56" y="38" font-family=\'Arial, sans-serif\' font-weight=\'800\' font-size=\'18\' fill=\'#0b1b36\'>Pure</text>' +
        '<text x="56" y="56" font-family=\'Arial, sans-serif\' font-weight=\'800\' font-size=\'18\' fill=\'#0b1b36\'>studio</text>' +
      '</g>' +
    '</svg>';

    var htmlContent =
      '<div class="invoice-sheet-container">' +
        '<div class="exact-invoice-paper" id="invoicePaper">' +
          '<div class="inv-top-jurisdiction">Subject to ' + esc(business.jurisdiction || 'Mumbai') + ' Jurisdiction</div>' +
          '<div class="inv-tax-title-box">Tax Invoice</div>' +

          '<!-- Top Header: Business info & Logo/Invoice meta -->' +
          '<table class="inv-header-grid">' +
            '<tr>' +
              '<td style="width: 60%;">' +
                '<div class="inv-company-title">' + esc(business.name || 'The Pure Studio') + '</div>' +
                '<table class="inv-grid-table" style="margin-bottom:0; border:none;">' +
                  '<tr><td class="lbl" style="width:105px;">Regd. Address</td><td class="val">' + esc(business.regdAddress || '') + '</td></tr>' +
                  '<tr><td class="lbl">Office Address</td><td class="val">' + esc(business.officeAddress || '') + '</td></tr>' +
                  '<tr><td class="lbl">Email ID</td><td class="val">' + esc(business.email || '') + '</td></tr>' +
                  '<tr><td class="lbl">GST IN</td><td class="val font-bold">' + esc(business.gstin || '') + '</td></tr>' +
                  '<tr><td class="lbl">Phone Number</td><td class="val">' + esc(business.phone || '') + '</td></tr>' +
                '</table>' +
              '</td>' +
              '<td style="width: 40%; vertical-align:middle;">' +
                '<div class="inv-logo-box">' + logoSvg + '</div>' +
                '<table class="inv-grid-table" style="margin-bottom:0; border:none;">' +
                  '<tr><td class="lbl" style="width:90px;">Invoice No:</td><td class="val font-bold">' + esc(inv.number || '—') + '</td></tr>' +
                  '<tr><td class="lbl">Date:</td><td class="val">' + esc(inv.date || fmtDate(new Date().toISOString().slice(0,10))) + '</td></tr>' +
                '</table>' +
              '</td>' +
            '</tr>' +
          '</table>' +

          '<!-- BILL TO Section -->' +
          '<div style="border: 1px solid #444; border-bottom: none; padding: 4px 6px; background:#fff; font-weight:800; font-size:10.5px;">BILL TO</div>' +
          '<table class="inv-grid-table">' +
            '<tr><td class="lbl" style="width:115px;">Company Name</td><td class="val font-bold">' + esc(c.name || '') + '</td></tr>' +
            '<tr><td class="lbl">Address</td><td class="val">' + esc(c.address || '') + '</td></tr>' +
            '<tr><td class="lbl">GST IN</td><td class="val font-bold">' + esc(c.gstin || '') + '</td></tr>' +
            '<tr><td class="lbl">Website</td><td class="val">' + esc(c.website || '') + '</td></tr>' +
          '</table>' +

          '<!-- ITEMS TABLE -->' +
          '<table class="inv-items-grid">' +
            '<thead>' +
              '<tr>' +
                '<th class="col-desc">DESCRIPTION</th>' +
                '<th class="col-hsn">HSN CODE</th>' +
                '<th class="col-qty">QTY</th>' +
                '<th class="col-price">UNIT PRICE</th>' +
                '<th class="col-total">TOTAL</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' +
              itemRowsHtml +
            '</tbody>' +
          '</table>' +

          '<!-- TOTALS & IN-WORDS -->' +
          '<table class="inv-totals-grid">' +
            '<tr>' +
              '<td style="width: 60%; vertical-align:middle;">' +
                '<div class="inv-words-wrap">' +
                  '<div class="inv-words-lbl">Invoice Value ( in words )</div>' +
                  '<div class="inv-words-text">' + esc(inWords) + '</div>' +
                '</div>' +
              '</td>' +
              '<td style="width: 40%;">' +
                '<table class="inv-calc-subtable">' +
                  '<tr><td class="lbl-cell">SUBTOTAL</td><td class="val-cell">₹' + (Number(t.subtotal)||0).toFixed(2) + '</td></tr>' +
                  '<tr><td class="lbl-cell">OTHER CHARGES</td><td class="val-cell">₹' + (Number(t.otherCharges)||0).toFixed(2) + '</td></tr>' +
                  '<tr><td class="lbl-cell">CGST@' + t.cgstPct + '%</td><td class="val-cell">₹' + (Number(t.cgstAmt)||0).toFixed(2) + '</td></tr>' +
                  '<tr><td class="lbl-cell">SGST@' + t.sgstPct + '%</td><td class="val-cell">₹' + (Number(t.sgstAmt)||0).toFixed(2) + '</td></tr>' +
                  '<tr><td class="lbl-cell">ROUND OFF</td><td class="val-cell">' + (t.roundOff >= 0 ? '₹' : '-₹') + Math.abs(t.roundOff).toFixed(2) + '</td></tr>' +
                  '<tr><td class="lbl-cell" style="font-weight:800;">TOTAL TAX</td><td class="val-cell font-bold">₹' + totalTax.toFixed(2) + '</td></tr>' +
                  '<tr class="grand-row"><td class="lbl-cell" style="font-size:11.5px; font-weight:800;">Invoice Value</td><td class="val-cell" style="font-size:12px; font-weight:800;">₹' + Number(t.total).toFixed(2) + '</td></tr>' +
                '</table>' +
              '</td>' +
            '</tr>' +
          '</table>' +

          '<!-- PAYMENT DETAILS -->' +
          '<div style="font-weight:800; font-size:11px; margin: 4px 0 3px;">Payment Details</div>' +
          '<table class="inv-payment-grid">' +
            '<tr>' +
              '<td class="lbl-cell">Account Name</td><td class="val-cell font-bold">' + esc(business.bankAccountName || 'THE PURE STUDIO') + '</td>' +
              '<td class="lbl-cell">Branch</td><td class="val-cell">' + esc(business.bankBranch || 'Ghatkopar West') + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td class="lbl-cell">Account No</td><td class="val-cell font-bold">' + esc(business.bankAccountNo || '') + '</td>' +
              '<td class="lbl-cell">Bank</td><td class="val-cell">' + esc(business.bankName || '') + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td class="lbl-cell">IFSC</td><td class="val-cell font-bold">' + esc(business.bankIfsc || '') + '</td>' +
              '<td class="lbl-cell">UPI Handle</td><td class="val-cell">' + esc(business.upiHandle || '') + '</td>' +
            '</tr>' +
          '</table>' +

          '<!-- TERMS & THANK YOU -->' +
          '<table class="inv-bottom-grid">' +
            '<tr>' +
              '<td style="width: 75%;">' +
                '<div style="font-weight:800; font-size:10.5px; margin-bottom:3px;">Terms &amp; Conditions*</div>' +
                '<ul class="inv-terms-list">' +
                  termsLines.map(function(l){ return '<li>' + esc(l) + '</li>'; }).join('') +
                '</ul>' +
              '</td>' +
              '<td style="width: 25%; vertical-align:bottom; text-align:right;">' +
                '<div class="inv-thanks-text">Thank You,</div>' +
              '</td>' +
            '</tr>' +
          '</table>' +
        '</div>' +
      '</div>';

    $('invoiceSheet').innerHTML = htmlContent;
    $('previewOverlay').hidden = false;
  }
  $('previewClose').addEventListener('click', function(){ $('previewOverlay').hidden = true; });
  $('previewPrint').addEventListener('click', function(){ window.print(); });
  $('previewOverlay').addEventListener('click', function(e){ if(e.target === $('previewOverlay')) $('previewOverlay').hidden = true; });

  function moneyPdf(n){
    n = Number(n) || 0;
    return 'Rs. ' + n.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function generateInvoicePdf(inv, c, t){
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({unit:'mm', format:'a4'});
    var pw = doc.internal.pageSize.getWidth();
    var mLeft = 14, mRight = pw - 14, y = 14;

    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(120,110,95);
    doc.text('Subject to ' + (business.jurisdiction||'') + ' Jurisdiction', pw/2, y, {align:'center'});
    y += 4;
    doc.setDrawColor(220,213,198); doc.line(mLeft, y, mRight, y);
    y += 7;
    doc.setFont('times','bold'); doc.setFontSize(15); doc.setTextColor(20,18,15);
    doc.text('TAX INVOICE', pw/2, y, {align:'center'});
    y += 3;
    doc.setDrawColor(20,18,15); doc.setLineWidth(0.6); doc.line(mLeft, y, mRight, y); doc.setLineWidth(0.2);
    y += 8;

    var topY = y;
    doc.setFont('times','bolditalic'); doc.setFontSize(13); doc.setTextColor(18,70,61);
    doc.text(business.name || '', mLeft, y);
    y += 5.5;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(74,68,58);
    var bizLines = [];
    if(business.regdAddress) bizLines.push(doc.splitTextToSize('Regd: ' + business.regdAddress, 108));
    if(business.officeAddress) bizLines.push(doc.splitTextToSize('Office: ' + business.officeAddress, 108));
    if(business.email) bizLines.push([business.email]);
    if(business.gstin) bizLines.push(['GSTIN: ' + business.gstin]);
    if(business.phone) bizLines.push([business.phone]);
    bizLines.forEach(function(lines){ lines.forEach(function(l){ doc.text(l, mLeft, y); y += 4; }); });

    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(20,18,15);
    doc.text('Invoice No: ' + (inv.number || '—'), mRight, topY, {align:'right'});
    doc.text('Date: ' + fmtDate(inv.date), mRight, topY + 5.5, {align:'right'});

    y = Math.max(y, topY + 11) + 4;
    doc.setDrawColor(220,213,198); doc.rect(mLeft, y, mRight-mLeft, 22);
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(120,110,95);
    doc.text('BILL TO', mLeft+4, y+5);
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(20,18,15);
    doc.text(c.name || '', mLeft+4, y+10.5);
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(74,68,58);
    var by = y + 15;
    if(c.address){ var al = doc.splitTextToSize(c.address, mRight-mLeft-8); doc.text(al, mLeft+4, by); by += al.length*3.6; }
    if(c.gstin) doc.text('GSTIN: ' + c.gstin, mLeft+4, by);
    y += 26;

    var body = (inv.items||[]).map(function(it){
      return [it.description||'', it.hsn||'—', String(Number(it.qty)||0), moneyPdf(it.unitPrice), moneyPdf((Number(it.qty)||0)*(Number(it.unitPrice)||0))];
    });
    doc.autoTable({
      startY: y,
      head: [['Description','HSN/SAC','Qty','Unit price','Total']],
      body: body,
      margin: {left: mLeft, right: 14},
      styles: {fontSize: 8.5, textColor: [40,36,30], lineColor: [220,213,198], lineWidth: 0.2},
      headStyles: {fillColor: [242,237,226], textColor: [40,36,30], fontStyle:'bold'},
      columnStyles: {2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right'}}
    });
    y = doc.lastAutoTable.finalY + 8;

    var boxW = 78, boxX = mRight - boxW;
    function totRow(label, val, bold){
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(bold ? 10.5 : 8.5);
      doc.setTextColor.apply(doc, bold ? [20,18,15] : [74,68,58]);
      doc.text(label, boxX, y);
      doc.text(val, mRight, y, {align:'right'});
      y += bold ? 6.5 : 5;
    }
    totRow('Subtotal', moneyPdf(t.subtotal));
    totRow('Other charges', moneyPdf(t.otherCharges));
    totRow('CGST @ ' + t.cgstPct + '%', moneyPdf(t.cgstAmt));
    totRow('SGST @ ' + t.sgstPct + '%', moneyPdf(t.sgstAmt));
    totRow('Round off', (t.roundOff>=0?'+':'') + t.roundOff.toFixed(2));
    doc.setDrawColor(20,18,15); doc.setLineWidth(0.5); doc.line(boxX, y-3, mRight, y-3); doc.setLineWidth(0.2);
    totRow('Invoice value', moneyPdf(t.total), true);

    y += 3;
    doc.setFont('helvetica','italic'); doc.setFontSize(8.5); doc.setTextColor(74,68,58);
    doc.text('Invoice value (in words): ' + numberToWordsIndian(t.total), mLeft, y);
    y += 9;

    doc.setDrawColor(220,213,198); doc.line(mLeft, y, mRight, y);
    y += 6;
    var colW = (mRight-mLeft-8)/2;
    var termsY = y, payY = y;
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(120,110,95);
    doc.text('TERMS & CONDITIONS', mLeft, termsY);
    doc.text('PAYMENT DETAILS', mLeft+colW+8, payY);
    termsY += 5; payY += 5;
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(74,68,58);
    (business.terms||'').split('\n').filter(Boolean).forEach(function(line){
      var wrapped = doc.splitTextToSize('- ' + line, colW);
      doc.text(wrapped, mLeft, termsY);
      termsY += wrapped.length * 4;
    });
    var payLines = [];
    if(business.bankAccountName) payLines.push('Account: ' + business.bankAccountName);
    if(business.bankAccountNo) payLines.push('A/C No: ' + business.bankAccountNo);
    if(business.bankName) payLines.push('Bank: ' + business.bankName + (business.bankBranch ? (' · ' + business.bankBranch) : ''));
    if(business.bankIfsc) payLines.push('IFSC: ' + business.bankIfsc);
    if(business.upiHandle) payLines.push('UPI: ' + business.upiHandle);
    payLines.forEach(function(l){ doc.text(l, mLeft+colW+8, payY); payY += 4.4; });

    y = Math.max(termsY, payY) + 8;
    doc.setFont('times','italic'); doc.setFontSize(10.5); doc.setTextColor(20,18,15);
    doc.text('Thank you.', mRight, y, {align:'right'});

    return doc;
  }
  $('previewDownload').addEventListener('click', function(){
    var inv = invoices.filter(function(i){ return i.id === previewInvoiceId; })[0];
    var filename = 'Invoice-' + String((inv && inv.number) ? inv.number : 'draft').replace(/[\/\]/g,'-') + '.pdf';
    var element = document.getElementById('invoicePaper');
    if(!element) return;

    if(window.html2pdf){
      var opt = {
        margin:       [4, 4, 4, 4],
        filename:     filename,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      window.html2pdf().set(opt).from(element).save();
    } else {
      window.print();
    }
  });

  function fillSettingsForm(){
    $('sName').value = business.name || '';
    $('sRegd').value = business.regdAddress || '';
    $('sOffice').value = business.officeAddress || '';
    $('sEmail').value = business.email || '';
    $('sPhone').value = business.phone || '';
    $('sGstin').value = business.gstin || '';
    $('sJurisdiction').value = business.jurisdiction || '';
    $('sWebsite').value = business.website || '';
    $('sCgst').value = business.cgstPct;
    $('sSgst').value = business.sgstPct;
    $('sBankAccName').value = business.bankAccountName || '';
    $('sBankAccNo').value = business.bankAccountNo || '';
    $('sBankName').value = business.bankName || '';
    $('sBankBranch').value = business.bankBranch || '';
    $('sBankIfsc').value = business.bankIfsc || '';
    $('sUpi').value = business.upiHandle || '';
    $('sTerms').value = business.terms || '';
  }
  function openSettingsModal(){ fillSettingsForm(); $('settingsOverlay').hidden = false; }
  function closeSettingsModal(){ $('settingsOverlay').hidden = true; }
  $('btnSettings').addEventListener('click', openSettingsModal);
  $('btnSettingsMobile').addEventListener('click', openSettingsModal);
  $('settingsCancel').addEventListener('click', closeSettingsModal);
  $('settingsOverlay').addEventListener('click', function(e){ if(e.target === $('settingsOverlay')) closeSettingsModal(); });
  $('settingsForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!db) db = createLocalDb();
    var data = {
      name: $('sName').value.trim(),
      regdAddress: $('sRegd').value.trim(),
      officeAddress: $('sOffice').value.trim(),
      email: $('sEmail').value.trim(),
      phone: $('sPhone').value.trim(),
      gstin: $('sGstin').value.trim(),
      jurisdiction: $('sJurisdiction').value.trim(),
      website: $('sWebsite').value.trim(),
      cgstPct: parseFloat($('sCgst').value) || 0,
      sgstPct: parseFloat($('sSgst').value) || 0,
      bankAccountName: $('sBankAccName').value.trim(),
      bankAccountNo: $('sBankAccNo').value.trim(),
      bankName: $('sBankName').value.trim(),
      bankBranch: $('sBankBranch').value.trim(),
      bankIfsc: $('sBankIfsc').value.trim(),
      upiHandle: $('sUpi').value.trim(),
      terms: $('sTerms').value
    };
    db.collection('settings').doc('business').set(data).then(function(){ closeSettingsModal(); renderAll(); }).catch(function(err){ console.error(err); });
  });

  $('fabAdd').addEventListener('click', function(){ $('actionSheet').hidden = false; });
  $('sheetCancel').addEventListener('click', function(){ $('actionSheet').hidden = true; });
  $('sheetNewInvoice').addEventListener('click', function(){ $('actionSheet').hidden = true; openInvoiceModal(null); });
  $('sheetNewClient').addEventListener('click', function(){ $('actionSheet').hidden = true; openClientModal(null); });
  $('actionSheet').addEventListener('click', function(e){ if(e.target === $('actionSheet')) $('actionSheet').hidden = true; });
  $('clientDrawer').addEventListener('click', function(e){ if(e.target === $('clientDrawer')) closeDrawer(); });

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      closeClientModal(); closeInvoiceModal(); closeDrawer();
      $('actionSheet').hidden = true; $('previewOverlay').hidden = true; closeSettingsModal();
    }
  });

  renderAll();

  async function init(){
    try{
      db = window.claude ? await window.claude.use('db') : null;
    } catch(err){ db = null; }
    try{
      downloadsCap = window.claude ? await window.claude.use('downloads') : null;
    } catch(err){ downloadsCap = null; }
    
    if(!db){
      db = createLocalDb();
    }
    if($('dbBanner')){
      $('dbBanner').className = 'banner';
    }

    db.collection('clients').onSnapshot(function(snap){
      clients = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      renderAll();
    }, function(err){ console.error(err); });
    db.collection('invoices').onSnapshot(function(snap){
      invoices = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      renderAll();
    }, function(err){ console.error(err); });
    db.doc('settings/business').onSnapshot(function(snap){
      business = snap.exists ? Object.assign({}, DEFAULT_BUSINESS, snap.data()) : Object.assign({}, DEFAULT_BUSINESS);
      renderAll();
    }, function(err){ console.error(err); });
  }
  init();
})();
