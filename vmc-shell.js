/* Vital Market Café - cáscara instalable (versión 1)
   Abre la aplicación que vive en Apps Script, la guarda en el equipo y permite vender sin internet.
   No contiene datos ni claves del negocio. */
(function () {
  'use strict';
  var EXEC = 'https://script.google.com/macros/s/AKfycbynypTKFPYsD9diIXLoOBxT_11QTKXSBlQAd8qiP-MBVF1XJ0nwV3kU1JNbe5cvuoUO/exec';
  var VERSION_CASCARA = '1.0';

  /* ---------- memoria del equipo (IndexedDB) ---------- */
  var dbP = null;
  function abrirDb() {
    if (dbP) return dbP;
    dbP = new Promise(function (ok, fail) {
      var r = indexedDB.open('vmc', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { fail(r.error); };
    });
    return dbP;
  }
  var kv = {
    get: function (k) {
      return abrirDb().then(function (db) {
        return new Promise(function (ok, fail) {
          var q = db.transaction('kv').objectStore('kv').get(k);
          q.onsuccess = function () { ok(q.result); }; q.onerror = function () { fail(q.error); };
        });
      }).catch(function () { return undefined; });
    },
    set: function (k, v) {
      return abrirDb().then(function (db) {
        return new Promise(function (ok, fail) {
          var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k);
          tx.oncomplete = function () { ok(); }; tx.onerror = function () { fail(tx.error); };
        });
      }).catch(function () {});
    }
  };

  function uuid() {
    if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function leerToken() { try { return localStorage.getItem('vmc_token') || ''; } catch (e) { return ''; } }

  var nuc = VMC_NUCLEO.crearNucleo({
    url: EXEC, kv: kv, fetchFn: function (u, i) { return fetch(u, i); },
    enLinea: function () { return navigator.onLine !== false; },
    ahora: function () { return new Date(); }, uuid: uuid, leerToken: leerToken,
    temporizador: function (f, ms) { return setTimeout(f, ms); }, limpiar: function (t) { clearTimeout(t); },
    alCambiar: function (e) { pintarAviso(e); }
  });

  /* ---------- imita google.script.run para que la pantalla de Apps Script funcione igual ---------- */
  function corredor(ok, fail) {
    var base = {
      withSuccessHandler: function (f) { return corredor(f, fail); },
      withFailureHandler: function (f) { return corredor(ok, f); },
      withUserObject: function () { return corredor(ok, fail); }
    };
    return new Proxy(base, {
      get: function (t, fn) {
        if (fn in t) return t[fn];
        if (typeof fn !== 'string') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          nuc.ejecutar(fn, args).then(function (r) { if (ok) ok(r); }, function (e) {
            if (fail) fail(e); else console.error(e);
          });
        };
      }
    });
  }
  window.google = { script: { run: corredor(null, null), host: { close: function () {}, origin: location.origin } } };

  /* ---------- aviso fijo abajo ---------- */
  var hayNueva = false, ultimoEstado = null, temp = null;
  function el(id) { return document.getElementById(id); }
  function estiloAviso() {
    if (el('vmcEstilo')) return;
    var s = document.createElement('style'); s.id = 'vmcEstilo';
    s.textContent =
      '#vmcAviso{position:fixed;left:50%;transform:translateX(-50%);bottom:74px;z-index:150000;max-width:94vw;padding:9px 14px;border-radius:999px;font:700 13px/1.3 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.45);cursor:pointer;display:none;text-align:center;border:2px solid #2b2118}' +
      '#vmcAviso.of{background:#ffc107;color:#2b2118}#vmcAviso.en{background:#1d5fa8;color:#fff;border-color:#123f73}#vmcAviso.er{background:#b3261e;color:#fff;border-color:#7f1912}#vmcAviso.ok{background:#1b6e3c;color:#fff;border-color:#14532d}' +
      '#vmcPanel{position:fixed;inset:0;z-index:150001;background:rgba(20,10,0,.72);display:flex;align-items:center;justify-content:center;padding:14px}' +
      '#vmcPanel .c{width:100%;max-width:440px;max-height:88vh;overflow:auto;background:#fffdf9;color:#2b2118;border:2px solid #8a7766;border-top:8px solid #ffc107;border-radius:16px;padding:16px;font:14px/1.4 system-ui,sans-serif}' +
      '#vmcPanel h3{margin:0 0 8px;font-size:18px}#vmcPanel .f{padding:8px 0;border-bottom:1px dashed #b9a995}' +
      '#vmcPanel button{padding:10px 14px;border-radius:10px;border:2px solid #4a2f1d;background:#fff;color:#4a2f1d;font-weight:800;margin:6px 6px 0 0;cursor:pointer}' +
      '#vmcPanel button.p{background:#1b6e3c;border-color:#14532d;color:#fff}';
    document.head.appendChild(s);
  }
  function moneda(n) { return '$ ' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function pintarAviso(e) {
    ultimoEstado = e;
    if (!document.body) return;
    estiloAviso();
    var a = el('vmcAviso');
    if (!a) { a = document.createElement('div'); a.id = 'vmcAviso'; a.setAttribute('role', 'status'); a.onclick = abrirPanel; document.body.appendChild(a); }
    var txt = '', cls = '';
    if (hayNueva) { txt = 'Hay una versión nueva. Toca para actualizar.'; cls = 'ok'; a.onclick = function () { location.reload(); }; }
    else {
      a.onclick = abrirPanel;
      if (e.fallidas) { txt = e.fallidas + (e.fallidas === 1 ? ' venta no se pudo registrar' : ' ventas no se pudieron registrar') + '. Toca para verlas.'; cls = 'er'; }
      else if (e.bloqueado && e.pendientes) { txt = 'Hay ' + e.pendientes + ' venta(s) de ' + e.bloqueado + ' sin enviar. Debe entrar ' + e.bloqueado + ' para enviarlas.'; cls = 'er'; }
      else if (e.sesionVencida && e.pendientes) { txt = 'Entra de nuevo para enviar ' + e.pendientes + ' venta(s) guardada(s).'; cls = 'er'; }
      else if (!e.enLinea) { txt = 'Sin conexión · puedes seguir vendiendo' + (e.pendientes ? ' · ' + e.pendientes + ' por enviar' : ''); cls = 'of'; }
      else if (e.enviando) { txt = 'Enviando ventas guardadas…'; cls = 'en'; }
      else if (e.pendientes) { txt = e.pendientes + ' venta(s) por enviar. Toca para ver.'; cls = 'en'; }
      else if (e.aviso) { txt = e.aviso; cls = 'ok'; }
    }
    a.className = cls; a.textContent = txt; a.style.display = txt ? 'block' : 'none';
  }
  function abrirPanel() {
    var e = ultimoEstado || nuc.estadoUI(); if (!e.pendientes && !e.fallidas) return;
    var f = document.createElement('div'); f.id = 'vmcPanel';
    var c = document.createElement('div'); c.className = 'c'; f.appendChild(c);
    function t(tag, txt, cls) { var x = document.createElement(tag); x.textContent = txt; if (cls) x.className = cls; return x; }
    c.appendChild(t('h3', 'Ventas guardadas en este equipo'));
    if (e.pendientes) {
      c.appendChild(t('div', 'Por enviar (' + e.pendientes + '). Se envían solas cuando hay internet y la sesión está abierta.'));
      e.cola.forEach(function (v) {
        c.appendChild(t('div', new Date(v.ts).toLocaleString('es-CO') + ' · ' + v.items.map(function (i) { return i.producto + ' x' + i.cantidad; }).join(', ') + ' · ' + moneda(v.total) + ' · ' + v.medio + ' · ' + (v.usuario || ''), 'f'));
      });
    }
    if (e.fallidas) {
      c.appendChild(t('h3', 'No se pudieron registrar (' + e.fallidas + ')'));
      e.fallos.forEach(function (v) {
        var d = t('div', new Date(v.ts).toLocaleString('es-CO') + ' · ' + v.items.map(function (i) { return i.producto + ' x' + i.cantidad; }).join(', ') + ' · ' + moneda(v.total) + '\nMotivo: ' + v.motivo, 'f');
        d.style.whiteSpace = 'pre-wrap';
        var b1 = t('button', 'Reintentar'); b1.onclick = function () { nuc.reintentarFallida(v.id); f.remove(); };
        var b2 = t('button', 'Descartar (ya la anoté)'); b2.onclick = function () { if (confirm('¿Descartar esta venta? No se registrará en el Sheet.')) { nuc.descartarFallida(v.id); f.remove(); } };
        d.appendChild(document.createElement('br')); d.appendChild(b1); d.appendChild(b2); c.appendChild(d);
      });
    }
    var enviar = t('button', 'Enviar ahora', 'p'); enviar.onclick = function () { nuc.enviarCola(); f.remove(); };
    var cerrar = t('button', 'Cerrar'); cerrar.onclick = function () { f.remove(); };
    c.appendChild(enviar); c.appendChild(cerrar);
    f.addEventListener('click', function (ev) { if (ev.target === f) f.remove(); });
    document.body.appendChild(f);
  }
  /* el documento se reemplaza al cargar la aplicación: se vuelve a poner el aviso */
  setInterval(function () { if (document.body && !el('vmcAviso') && ultimoEstado) pintarAviso(ultimoEstado); }, 1500);
  window.addEventListener('online', function () { nuc.enviarCola(); pintarAviso(nuc.estadoUI()); });
  window.addEventListener('offline', function () { pintarAviso(nuc.estadoUI()); });
  setInterval(function () { var e = nuc.estadoUI(); if (e.pendientes && e.enLinea) nuc.enviarCola(); }, 30000);

  /* ---------- descarga de la aplicación (pantalla + programa) ---------- */
  function pedirApp(ms) {
    var ctl = new AbortController(); var t = setTimeout(function () { ctl.abort(); }, ms);
    return fetch(EXEC + '?m=app', { redirect: 'follow', signal: ctl.signal }).then(function (r) { return r.text(); }).then(function (txt) {
      clearTimeout(t);
      var j = JSON.parse(txt);
      if (!j || !j.ok || !j.html || !j.js) throw new Error('Respuesta incompleta');
      return { html: j.html, js: j.js, v: j.v || '', t: Date.now() };
    }, function (e) { clearTimeout(t); throw e; });
  }
  function mensaje(txt, esError) {
    document.body.innerHTML = '<div style="font:16px/1.5 system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:18px;text-align:center;color:#2b2118">' +
      '<div style="font-size:22px;font-weight:800;margin-bottom:10px">Vital Market Café</div>' + txt +
      (esError ? '<p><button id="vmcRe" style="padding:12px 18px;border-radius:12px;border:2px solid #14532d;background:#1b6e3c;color:#fff;font-weight:800;font-size:15px">Reintentar</button></p>' : '') + '</div>';
    var b = document.getElementById('vmcRe'); if (b) b.onclick = function () { location.reload(); };
  }
  function pintarApp(b) {
    document.open(); document.write(b.html); document.close();
    setTimeout(function () { pintarAviso(nuc.estadoUI()); }, 50);
  }
  function arrancar() {
    return nuc.cargar().then(function () {
      var b = nuc._est.bundle;
      if (b) {
        pintarApp(b);
        if (navigator.onLine !== false) {
          pedirApp(20000).then(function (nuevo) {
            if (nuevo.v !== b.v || nuevo.html !== b.html || nuevo.js !== b.js) {
              return nuc.guardarBundle(nuevo).then(function () {
                hayNueva = true; pintarAviso(nuc.estadoUI());
              });
            }
          }).catch(function () {});
        }
        return;
      }
      if (navigator.onLine === false) { mensaje('<p>Primera vez en este equipo: conéctate a internet para instalar la aplicación.</p>', true); return; }
      mensaje('<p>Descargando la aplicación…</p>');
      return pedirApp(40000).then(function (nuevo) { return nuc.guardarBundle(nuevo).then(function () { pintarApp(nuevo); }); })
        .catch(function () { mensaje('<p>No se pudo descargar la aplicación. Revisa el internet e intenta de nuevo.</p>', true); });
    });
  }

  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(function () {}); }
  if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(function () {}); }
  window.VMC = { version: VERSION_CASCARA, nucleo: nuc };
  arrancar();
})();
