/* Vital Market Café - núcleo del modo sin conexión (versión 1)
   Esta pieza NO lleva datos ni código del negocio. Hace tres cosas:
   1) imita google.script.run para que la pantalla de Apps Script funcione igual desde este alojamiento;
   2) guarda las ventas en una cola cuando no hay internet y las envía solas al volver (con clave anti-duplicados);
   3) guarda una copia de lo necesario para poder vender sin conexión.
   Se usa en el navegador (vmc-shell.js) y se prueba en Node (tests/). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.VMC_NUCLEO = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MSG_SIN_INTERNET = 'Sin conexión: esta opción necesita internet. Mientras tanto puedes seguir vendiendo.';

  function errRed(msg) { var e = new Error(msg || 'Sin conexión'); e.red = true; return e; }
  function errSrv(msg) { var e = new Error(String(msg || 'Error del servidor').replace(/^Error:\s*/, '')); e.srv = true; return e; }

  /* o: { url, kv:{get,set}, fetchFn, enLinea(), ahora(), uuid(), leerToken(), alCambiar(), temporizador(fn, ms) } */
  function crearNucleo(o) {
    var est = { cola: [], fallidas: [], usuario: '', info: null, productos: null, imagenes: null, bundle: null,
                enviando: false, bloqueado: '', sesionVencida: false, aviso: '' };

    function avisar() { try { if (o.alCambiar) o.alCambiar(estadoUI()); } catch (e) {} }
    function guardar(k, v) { return Promise.resolve(o.kv.set(k, v)); }

    function cargar() {
      return Promise.all(['cola', 'fallidas', 'usuario', 'info', 'productos', 'imagenes', 'bundle'].map(function (k) {
        return Promise.resolve(o.kv.get(k)).then(function (v) { if (v !== undefined && v !== null) est[k] = v; });
      })).then(function () { avisar(); return est; });
    }

    function estadoUI() {
      return { enLinea: !!o.enLinea(), pendientes: est.cola.length, fallidas: est.fallidas.length, enviando: est.enviando,
               bloqueado: est.bloqueado, sesionVencida: est.sesionVencida, aviso: est.aviso,
               cola: est.cola.map(function (c) { return { id: c.id, ts: c.ts, usuario: c.usuario, medio: c.medio, total: totalItems(c.items), items: c.items }; }),
               fallos: est.fallidas.slice() };
    }
    function totalItems(items) { return (items || []).reduce(function (a, x) { return a + (Number(x.total) || 0); }, 0); }

    /* ---------- llamada al servidor ---------- */
    function post(fn, args, ms) {
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var t = o.temporizador ? o.temporizador(function () { if (ctl) ctl.abort(); }, ms) : null;
      var fin = function () { if (t && o.limpiar) o.limpiar(t); };
      var init = { method: 'POST', body: JSON.stringify({ fn: fn, args: args }), redirect: 'follow' };
      if (ctl) init.signal = ctl.signal;
      var p;
      try { p = Promise.resolve(o.fetchFn(o.url, init)); } catch (e) { fin(); return Promise.reject(errRed()); }
      return p.then(function (r) { return r.text(); }, function () { throw errRed(); })
        .then(function (txt) {
          fin();
          var j; try { j = JSON.parse(txt); } catch (e) { throw errRed('Respuesta no válida del servidor'); }
          if (j && j.ok) return j.r;
          throw errSrv(j && j.e);
        }, function (e) { fin(); throw e.red || e.srv ? e : errRed(); });
    }

    /* ---------- copia de lo necesario sin conexión ---------- */
    function esPendiente(medio) { return !!(est.info && (est.info.mediosPendientes || []).indexOf(medio) >= 0); }

    function descontar(productos, items, signo) {
      if (!productos || !productos.productos) return productos;
      var por = {};
      productos.productos.forEach(function (p) { por[p.nombre] = p; });
      items.forEach(function (it) {
        var p = por[it.producto];
        if (p && typeof p.disponible === 'number') p.disponible = Math.round((p.disponible + signo * Number(it.cantidad)) * 100) / 100;
      });
      return productos;
    }
    function copiar(x) { return JSON.parse(JSON.stringify(x)); }
    /* a lo que llega del servidor se le restan las ventas que todavía no se han enviado */
    function conCola(productos) {
      var r = copiar(productos);
      est.cola.forEach(function (c) { descontar(r, c.items, -1); });
      return r;
    }

    function recordarLectura(fn, r) {
      if (fn === 'api_productos') { est.productos = copiar(r); return guardar('productos', est.productos); }
      if (fn === 'api_imagenes') { est.imagenes = r; return guardar('imagenes', r); }
      if (fn === 'api_login' || fn === 'api_sesion' || fn === 'api_cambiarClave') {
        est.info = r; est.usuario = (r && r.usuario) || est.usuario; est.sesionVencida = false;
        return Promise.all([guardar('info', r), guardar('usuario', est.usuario)]);
      }
      return Promise.resolve();
    }

    function lecturaSinConexion(fn, args) {
      if (fn === 'api_productos' && est.productos) return Promise.resolve(copiar(est.productos));
      if (fn === 'api_imagenes' && est.imagenes) return Promise.resolve(est.imagenes);
      if (fn === 'api_sesion' && est.info && est.info.token === args[0]) return Promise.resolve(est.info);
      if (fn === 'api_logout') return Promise.resolve(true);
      if (fn === 'api_login') return Promise.reject(new Error('Sin conexión: para entrar necesitas internet. Si ya habías entrado, no cierres la sesión.'));
      return Promise.reject(new Error(MSG_SIN_INTERNET));
    }

    /* ---------- ventas: cola con clave única ---------- */
    function encolar(item) {
      est.cola.push(item);
      if (est.productos) descontar(est.productos, item.items, -1);
      return Promise.all([guardar('cola', est.cola), guardar('productos', est.productos)]).then(function () {
        est.aviso = 'Venta guardada sin conexión. Se enviará sola cuando vuelva el internet.';
        avisar();
        return { productos: est.productos ? copiar(est.productos).productos : [], esPendiente: esPendiente(item.medio), sinConexion: true };
      });
    }

    function venta(args) {
      /* args: [token, items, medio, efectivo, nota, extra]  (extra = cliente, puntos y propina de la versión 3.11) */
      var item = { id: o.uuid(), ts: o.ahora().toISOString(), usuario: est.usuario || '', items: args[1], medio: args[2], ef: args[3], nota: args[4], extra: args[5] === undefined ? null : args[5] };
      var completa = [args[0], item.items, item.medio, item.ef, item.nota, item.extra, item.id, item.ts];
      if (!o.enLinea()) return encolar(item);
      return post('api_venta', completa, 40000).then(function (r) {
        if (r && r.productos) { est.productos = { productos: copiar(r.productos), redondeo: est.productos ? est.productos.redondeo : 50 }; guardar('productos', est.productos); }
        if (r && r.productos) r = { productos: conCola(est.productos).productos, esPendiente: r.esPendiente };
        enviarCola();
        return r;
      }, function (e) {
        if (e.red) return encolar(item);   /* sin respuesta: se guarda y se reenvía; la clave única evita duplicados */
        throw e;
      });
    }

    /* envía la cola, de a una, en orden */
    var enCurso = null;
    function enviarCola() {
      if (est.enviando && enCurso) return enCurso;
      if (est.enviando || !est.cola.length || !o.enLinea()) return Promise.resolve();
      est.enviando = true; avisar();
      function siguiente() {
        if (!est.cola.length) return Promise.resolve();
        var c = est.cola[0];
        if (c.usuario && est.usuario && c.usuario !== est.usuario) { est.bloqueado = c.usuario; return Promise.resolve(); }
        est.bloqueado = '';
        var token = o.leerToken();
        if (!token) { est.sesionVencida = true; return Promise.resolve(); }
        return post('api_venta', [token, c.items, c.medio, c.ef, c.nota, c.extra === undefined ? null : c.extra, c.id, c.ts], 60000).then(function () {
          est.cola.shift(); est.aviso = '';
          return guardar('cola', est.cola).then(siguiente);
        }, function (e) {
          if (e.red) return Promise.resolve();
          if (/SESION_EXPIRADA/.test(e.message)) { est.sesionVencida = true; return Promise.resolve(); }
          est.cola.shift();
          est.fallidas.push({ id: c.id, ts: c.ts, usuario: c.usuario, medio: c.medio, ef: c.ef, nota: c.nota, extra: c.extra === undefined ? null : c.extra, total: totalItems(c.items), items: c.items, motivo: e.message });
          return Promise.all([guardar('cola', est.cola), guardar('fallidas', est.fallidas)]).then(siguiente);
        });
      }
      enCurso = siguiente().then(function () {
        est.enviando = false; enCurso = null;
        if (!est.cola.length) { est.sesionVencida = false; est.bloqueado = ''; refrescarProductos(); }
        avisar();
      }, function () { est.enviando = false; enCurso = null; avisar(); });
      return enCurso;
    }

    function refrescarProductos() {
      var token = o.leerToken(); if (!token || !o.enLinea()) return Promise.resolve();
      return post('api_productos', [token], 60000).then(function (r) { return recordarLectura('api_productos', r); }, function () {});
    }

    /* ---------- punto de entrada: lo que antes era google.script.run.<función>(...) ---------- */
    function ejecutar(fn, args) {
      if (fn === 'cargarJs') return est.bundle ? Promise.resolve(est.bundle.js) : Promise.reject(new Error('Falta descargar la aplicación. Conéctate a internet.'));
      if (!/^api_[A-Za-z0-9_]+$/.test(fn)) return Promise.reject(new Error('Función no permitida'));
      if (fn === 'api_venta') return venta(args);
      if (fn === 'api_cierre' && (est.cola.length || est.fallidas.length)) {
        return Promise.reject(new Error('Antes de cerrar la caja hay que enviar las ventas guardadas sin conexión (' + est.cola.length + ' por enviar, ' + est.fallidas.length + ' con error). Revisa el aviso de arriba.'));
      }
      if (!o.enLinea()) return lecturaSinConexion(fn, args);
      return post(fn, args, 120000).then(function (r) {
        return recordarLectura(fn, r).then(function () {
          if (fn === 'api_login' || fn === 'api_sesion' || fn === 'api_cambiarClave') enviarCola();
          if (fn === 'api_productos') return conCola(r);
          return r;
        });
      }, function (e) {
        if (e.red) return lecturaSinConexion(fn, args);
        throw e;
      });
    }

    function descartarFallida(id) {
      est.fallidas = est.fallidas.filter(function (f) { return f.id !== id; });
      return guardar('fallidas', est.fallidas).then(avisar);
    }
    function reintentarFallida(id) {
      var f = est.fallidas.filter(function (x) { return x.id === id; })[0]; if (!f) return Promise.resolve();
      est.fallidas = est.fallidas.filter(function (x) { return x.id !== id; });
      est.cola.push({ id: f.id, ts: f.ts, usuario: f.usuario, items: f.items, medio: f.medio, ef: f.ef, nota: f.nota, extra: f.extra === undefined ? null : f.extra });
      return Promise.all([guardar('cola', est.cola), guardar('fallidas', est.fallidas)]).then(function () { avisar(); return enviarCola(); });
    }
    function guardarBundle(b) { est.bundle = b; return guardar('bundle', b); }

    return { cargar: cargar, ejecutar: ejecutar, enviarCola: enviarCola, estadoUI: estadoUI, guardarBundle: guardarBundle,
             descartarFallida: descartarFallida, reintentarFallida: reintentarFallida, _est: est };
  }

  return { crearNucleo: crearNucleo, MSG_SIN_INTERNET: MSG_SIN_INTERNET };
});
