/* Pruebas del núcleo sin conexión. Se ejecutan con: node tests/nucleo.test.js */
const assert = require('assert');
const { crearNucleo } = require('../vmc-nucleo.js');

function servidorFalso() {
  const s = { ventas: [], ids: new Set(), stock: { 'Café Americano': 100, 'Barras de cereal': 30 }, sesionOk: true, caido: false, llamadas: [], lento: false };
  s.fetch = async function (url, init) {
    if (s.caido) throw new TypeError('Failed to fetch');
    const { fn, args } = JSON.parse(init.body);
    s.llamadas.push(fn);
    const res = (o) => ({ text: async () => JSON.stringify(o) });
    if (fn === 'api_login') return res({ ok: true, r: { token: 'T1', usuario: 'sandra', nombre: 'Sandra', perfil: 'Vendedor', mediosPendientes: ['Pendiente Daniel'] } });
    if (!s.sesionOk) return res({ ok: false, e: 'Error: SESION_EXPIRADA' });
    if (fn === 'api_productos') return res({ ok: true, r: { productos: Object.keys(s.stock).map(n => ({ nombre: n, disponible: s.stock[n], unidad: 'Unidad' })), redondeo: 50 } });
    if (fn === 'api_venta') {
      const [, items, medio, ef, nota, id, ts] = args;
      if (items.some(i => !(i.producto in s.stock))) return res({ ok: false, e: 'Error: Producto no encontrado: ' + items[0].producto });
      const dup = id && s.ids.has(id);
      if (!dup) { if (id) s.ids.add(id); items.forEach(i => { s.stock[i.producto] -= i.cantidad; s.ventas.push({ id, ts, medio, total: i.total, producto: i.producto }); }); }
      return res({ ok: true, r: { productos: Object.keys(s.stock).map(n => ({ nombre: n, disponible: s.stock[n], unidad: 'Unidad' })), esPendiente: false, duplicada: !!dup } });
    }
    if (fn === 'api_ventasDia') return res({ ok: true, r: { n: s.ventas.length } });
    if (fn === 'api_cierre') return res({ ok: true, r: true });
    return res({ ok: false, e: 'Error: función desconocida' });
  };
  return s;
}

function hacer(s, extra) {
  const kv = {}; let linea = true, n = 0;
  const o = Object.assign({
    url: 'x', fetchFn: (u, i) => s.fetch(u, i), enLinea: () => linea,
    ahora: () => new Date('2026-11-18T14:00:00Z'), uuid: () => 'id-' + (++n), leerToken: () => 'T1',
    kv: { get: async (k) => kv[k], set: async (k, v) => { kv[k] = v; } }
  }, extra || {});
  const nuc = crearNucleo(o);
  return { nuc, kv, poner: (v) => { linea = v; } };
}
const ITEMS = [{ producto: 'Café Americano', cantidad: 1, total: 5000 }];
let hechas = 0;
async function prueba(nombre, fn) { try { await fn(); hechas++; console.log('  ok  ' + nombre); } catch (e) { console.error('FALLÓ ' + nombre + '\n', e); process.exitCode = 1; } }

(async () => {
  await prueba('con internet: la venta pasa directo, con clave y hora', async () => {
    const s = servidorFalso(); const { nuc } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']);
    const r = await nuc.ejecutar('api_venta', ['T1', ITEMS, 'Efectivo', 0, '']);
    assert.strictEqual(s.ventas.length, 1); assert.ok(s.ventas[0].id && s.ventas[0].ts);
    assert.strictEqual(r.productos.find(p => p.nombre === 'Café Americano').disponible, 99);
    assert.strictEqual(nuc.estadoUI().pendientes, 0);
  });

  await prueba('sin internet: la venta queda en cola y el stock local baja', async () => {
    const s = servidorFalso(); const { nuc, poner } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']); await nuc.ejecutar('api_productos', ['T1']);
    poner(false);
    const r = await nuc.ejecutar('api_venta', ['T1', ITEMS, 'Efectivo', 0, '']);
    assert.strictEqual(r.sinConexion, true); assert.strictEqual(s.ventas.length, 0);
    assert.strictEqual(nuc.estadoUI().pendientes, 1);
    const p = await nuc.ejecutar('api_productos', ['T1']);
    assert.strictEqual(p.productos.find(x => x.nombre === 'Café Americano').disponible, 99);
  });

  await prueba('al volver el internet se envía sola y no se duplica', async () => {
    const s = servidorFalso(); const { nuc, poner } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']); await nuc.ejecutar('api_productos', ['T1']);
    poner(false);
    await nuc.ejecutar('api_venta', ['T1', ITEMS, 'Efectivo', 0, '']);
    await nuc.ejecutar('api_venta', ['T1', ITEMS, 'Transferencia', 0, '']);
    poner(true); await nuc.enviarCola();
    assert.strictEqual(s.ventas.length, 2); assert.strictEqual(nuc.estadoUI().pendientes, 0);
    assert.strictEqual(s.stock['Café Americano'], 98);
    await nuc.enviarCola(); assert.strictEqual(s.ventas.length, 2);
  });

  await prueba('reintento con la misma clave: el servidor no duplica', async () => {
    const s = servidorFalso(); const { nuc } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']);
    await s.fetch('x', { body: JSON.stringify({ fn: 'api_venta', args: ['T1', ITEMS, 'Efectivo', 0, '', 'igual', 't'] }) });
    await s.fetch('x', { body: JSON.stringify({ fn: 'api_venta', args: ['T1', ITEMS, 'Efectivo', 0, '', 'igual', 't'] }) });
    assert.strictEqual(s.ventas.length, 1);
  });

  await prueba('el servidor cae a mitad de venta: se guarda y se reenvía', async () => {
    const s = servidorFalso(); const { nuc } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']); await nuc.ejecutar('api_productos', ['T1']);
    s.caido = true;
    const r = await nuc.ejecutar('api_venta', ['T1', ITEMS, 'Efectivo', 0, '']);
    assert.strictEqual(r.sinConexion, true); assert.strictEqual(nuc.estadoUI().pendientes, 1);
    s.caido = false; await nuc.enviarCola(); assert.strictEqual(s.ventas.length, 1);
  });

  await prueba('sesión vencida: la cola se conserva y se envía al volver a entrar', async () => {
    const s = servidorFalso(); const { nuc } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']); await nuc.ejecutar('api_productos', ['T1']);
    s.caido = true; await nuc.ejecutar('api_venta', ['T1', ITEMS, 'Efectivo', 0, '']); s.caido = false;
    s.sesionOk = false; await nuc.enviarCola();
    assert.strictEqual(nuc.estadoUI().pendientes, 1); assert.strictEqual(nuc.estadoUI().sesionVencida, true);
    s.sesionOk = true; await nuc.ejecutar('api_login', ['sandra', 'x']); await nuc.enviarCola();
    assert.strictEqual(s.ventas.length, 1); assert.strictEqual(nuc.estadoUI().pendientes, 0);
  });

  await prueba('otro usuario entra: no se envían ventas ajenas', async () => {
    const s = servidorFalso(); const { nuc, kv } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']); await nuc.ejecutar('api_productos', ['T1']);
    s.caido = true; await nuc.ejecutar('api_venta', ['T1', ITEMS, 'Efectivo', 0, '']); s.caido = false;
    nuc._est.usuario = 'mary';
    await nuc.enviarCola();
    assert.strictEqual(s.ventas.length, 0); assert.strictEqual(nuc.estadoUI().bloqueado, 'sandra');
  });

  await prueba('venta rechazada por el servidor pasa a "con error" y no se pierde', async () => {
    const s = servidorFalso(); const { nuc } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']);
    nuc._est.cola.push({ id: 'z', ts: 't', usuario: 'sandra', items: [{ producto: 'No existe', cantidad: 1, total: 1 }], medio: 'Efectivo' });
    await nuc.enviarCola();
    assert.strictEqual(nuc.estadoUI().fallidas, 1); assert.strictEqual(nuc.estadoUI().pendientes, 0);
    assert.ok(/no encontrado/i.test(nuc.estadoUI().fallos[0].motivo));
  });

  await prueba('sin internet: opciones que necesitan red avisan claro y el cierre de caja se bloquea con ventas guardadas', async () => {
    const s = servidorFalso(); const { nuc, poner } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']);
    poner(false);
    await assert.rejects(() => nuc.ejecutar('api_ventasDia', ['T1']), /Sin conexión/);
    await nuc.ejecutar('api_venta', ['T1', ITEMS, 'Efectivo', 0, '']);
    poner(true);
    await assert.rejects(() => nuc.ejecutar('api_cierre', ['T1']), /ventas guardadas sin conexión/);
  });

  await prueba('la cola y el stock sobreviven a cerrar y abrir la app', async () => {
    const s = servidorFalso(); const a = hacer(s); await a.nuc.cargar();
    await a.nuc.ejecutar('api_login', ['sandra', 'x']); await a.nuc.ejecutar('api_productos', ['T1']);
    a.poner(false); await a.nuc.ejecutar('api_venta', ['T1', ITEMS, 'Efectivo', 0, '']);
    const b = crearNucleo({ url: 'x', fetchFn: (u, i) => s.fetch(u, i), enLinea: () => true, ahora: () => new Date(), uuid: () => 'q', leerToken: () => 'T1',
      kv: { get: async (k) => a.kv[k], set: async (k, v) => { a.kv[k] = v; } } });
    await b.cargar(); assert.strictEqual(b.estadoUI().pendientes, 1);
    await b.enviarCola(); assert.strictEqual(s.ventas.length, 1);
  });

  await prueba('la sesión guardada sirve para abrir sin internet', async () => {
    const s = servidorFalso(); const { nuc, poner } = hacer(s); await nuc.cargar();
    await nuc.ejecutar('api_login', ['sandra', 'x']);
    poner(false);
    const info = await nuc.ejecutar('api_sesion', ['T1']); assert.strictEqual(info.usuario, 'sandra');
    await assert.rejects(() => nuc.ejecutar('api_sesion', ['otro']), /Sin conexión/);
  });

  await prueba('solo se permiten funciones api_', async () => {
    const s = servidorFalso(); const { nuc } = hacer(s); await nuc.cargar();
    await assert.rejects(() => nuc.ejecutar('autorizar', []), /no permitida/);
    await assert.rejects(() => nuc.ejecutar('api_x; drop', []), /no permitida/);
  });

  console.log('\n' + hechas + ' pruebas pasaron' + (process.exitCode ? ' (hay fallas)' : ''));
})();
