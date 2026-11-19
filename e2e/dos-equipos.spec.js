// ---------------------------------------------------------------------------
// PRUEBAS E2E DE DOS EQUIPOS (dos contextos de navegador, un solo servidor)
// ---------------------------------------------------------------------------
// El objetivo no es "que la pantalla se vea bonita", sino las garantias que
// cuestan dinero o datos:
//   1. Sin internet se puede trabajar y lo guardado sube al reconectar.
//   2. Dos equipos que editan la misma consulta NO se pisan: el segundo recibe
//      un conflicto y conserva su trabajo local.
//   3. Dos equipos que venden el mismo producto NO venden stock inexistente.
//   4. Lo que guarda un equipo llega al otro al sincronizar.
//
// El servidor es falso (src/pruebas/servidorFalso.js) pero implementa las
// mismas reglas: version 40001 y stock 23514. La app es la de verdad.
// ---------------------------------------------------------------------------
import { test, expect } from '@playwright/test';
import { crearServidorFalso } from '../src/pruebas/servidorFalso.js';
import {
  abrirEquipo,
  guardarConsulta,
  guardarVenta,
  sincronizar,
  leerOutbox,
  leerConsulta,
  leerConflictos,
  leerInventario,
  leerVenta,
  pacienteDemo,
  consultaClinica,
  CONSULTA
} from './apoyo.js';

const NUEVA_CONSULTA = 'aaaaaaaa-0000-4000-8000-000000000001';

test('un equipo sin internet guarda la consulta y la sube al reconectar', async ({ browser }) => {
  const servidor = crearServidorFalso();
  const { context, page } = await abrirEquipo(browser, servidor);

  try {
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

    await guardarConsulta(page, {
      patient: pacienteDemo(),
      consultation: consultaClinica({
        id: NUEVA_CONSULTA,
        fecha: '2026-02-01',
        k1_d_od: '45'
      })
    });

    const pendientes = await leerOutbox(page);
    const operacion = pendientes.find(fila => fila.type === 'GUARDAR_CONSULTA');
    expect(operacion, 'la consulta debe quedar en la cola local').toBeTruthy();
    expect(operacion.status).toBe('pending');

    const local = await leerConsulta(page, NUEVA_CONSULTA);
    expect(local.k1_d_od).toBe('45');
    expect(servidor.estado.consultas.has(NUEVA_CONSULTA)).toBe(false);

    await context.setOffline(false);
    await sincronizar(page, true);

    await expect.poll(() => servidor.estado.consultas.has(NUEVA_CONSULTA), { timeout: 20000 }).toBe(true);
    expect(servidor.estado.consultas.get(NUEVA_CONSULTA).k1_d_od).toBe('45');

    await expect.poll(async () => (await leerConsulta(page, NUEVA_CONSULTA))?.syncStatus, { timeout: 20000 })
      .toBe('synced');

    const restantes = await leerOutbox(page);
    expect(restantes.some(fila => fila.type === 'GUARDAR_CONSULTA')).toBe(false);
  } finally {
    await context.close();
  }
});

test('dos equipos que editan la misma consulta: el segundo recibe conflicto y no pierde su trabajo', async ({ browser }) => {
  const servidor = crearServidorFalso();
  const equipoA = await abrirEquipo(browser, servidor);
  const equipoB = await abrirEquipo(browser, servidor);

  try {
    expect((await leerConsulta(equipoA.page, CONSULTA))?.syncVersion).toBe(1);
    expect((await leerConsulta(equipoB.page, CONSULTA))?.syncVersion).toBe(1);

    // A edita y sube: el servidor queda en version 2.
    await guardarConsulta(equipoA.page, {
      patient: pacienteDemo(),
      consultation: consultaClinica({ k1_d_od: '43' })
    });
    await sincronizar(equipoA.page, false);

    expect(servidor.estado.consultas.get(CONSULTA).k1_d_od).toBe('43');
    expect(servidor.estado.consultas.get(CONSULTA).sync_version).toBe(2);

    // B edita sin haber visto el cambio: trabaja sobre la version 1.
    await guardarConsulta(equipoB.page, {
      patient: pacienteDemo(),
      consultation: consultaClinica({ k1_d_od: '99' })
    });
    await sincronizar(equipoB.page, false);

    const outbox = await leerOutbox(equipoB.page);
    const conflicto = outbox.find(fila => fila.type === 'GUARDAR_CONSULTA');
    expect(conflicto, 'la operacion debe quedar registrada').toBeTruthy();
    expect(conflicto.status).toBe('conflict');
    expect(conflicto.lastError).toMatch(/modificad[ao] en otro dispositivo/i);

    // El servidor conserva la edicion de A.
    expect(servidor.estado.consultas.get(CONSULTA).k1_d_od).toBe('43');
    expect(servidor.estado.consultas.get(CONSULTA).sync_version).toBe(2);

    // B conserva su edicion en el dispositivo: nada se pierde.
    const localB = await leerConsulta(equipoB.page, CONSULTA);
    expect(localB.k1_d_od).toBe('99');

    // El conflicto queda registrado con su tipo y el equipo que lo sufrio, que
    // es lo que alimenta el resumen del panel.
    const registrados = await leerConflictos(equipoB.page);
    const evento = registrados.find(fila => fila.operacionId === conflicto.id);
    expect(evento?.categoria).toBe('version_clinica');
    expect(evento?.equipoId).toBeTruthy();
    expect(evento?.equipo).toBeTruthy();
  } finally {
    await equipoA.context.close();
    await equipoB.context.close();
  }
});

test('dos equipos que venden el mismo producto: el servidor rechaza el stock inexistente', async ({ browser }) => {
  const servidor = crearServidorFalso();
  const equipoA = await abrirEquipo(browser, servidor);
  const equipoB = await abrirEquipo(browser, servidor);

  try {
    expect(servidor.estado.inventario.get(1).stock).toBe(1);
    expect((await leerInventario(equipoA.page, 1))?.stock).toBe(1);
    expect((await leerInventario(equipoB.page, 1))?.stock).toBe(1);

    const venta = id => ({
      id,
      pedido_id: id,
      fecha: '2026-03-01',
      venta: '100',
      descuento: '0',
      abono: '0',
      estado: 'En laboratorio',
      items: [{ inventario_id: 1, cantidad: 1 }]
    });

    // A vende la unica unidad y sube.
    await guardarVenta(equipoA.page, {
      patient: pacienteDemo(),
      consultationId: CONSULTA,
      sale: venta('venta-equipo-a')
    });
    await sincronizar(equipoA.page, false);
    expect(servidor.estado.inventario.get(1).stock).toBe(0);
    expect((await leerInventario(equipoA.page, 1))?.stock).toBe(0);

    // B, que aun cree que hay una unidad, la vende tambien.
    await guardarVenta(equipoB.page, {
      patient: pacienteDemo(),
      consultationId: CONSULTA,
      sale: venta('venta-equipo-b')
    });
    expect((await leerInventario(equipoB.page, 1))?.stock, 'localmente el descuento se aplica; el servidor es quien decide').toBe(0);

    await sincronizar(equipoB.page, false);

    const outbox = await leerOutbox(equipoB.page);
    const conflicto = outbox.find(fila => fila.type === 'CREAR_VENTA');
    expect(conflicto).toBeTruthy();
    expect(conflicto.status).toBe('conflict');
    expect(conflicto.lastError).toMatch(/stock insuficiente/i);

    expect(servidor.estado.inventario.get(1).stock, 'el stock nunca queda negativo').toBe(0);
    expect(servidor.estado.ventas.has('venta-equipo-a')).toBe(true);
    expect(servidor.estado.ventas.has('venta-equipo-b')).toBe(false);

    // La venta y la consulta de B siguen en el dispositivo para que pueda
    // corregirlas cuando le llegue el aviso; no desaparecen.
    expect((await leerVenta(equipoB.page, 'venta-equipo-b'))?.estado).toBe('En laboratorio');
    expect((await leerConsulta(equipoB.page, CONSULTA))?.k1_d_od).toBe('42');

    const registrados = await leerConflictos(equipoB.page);
    const evento = registrados.find(fila => fila.operacionId === conflicto.id);
    expect(evento?.categoria).toBe('stock');
    expect(evento?.equipoId).toBeTruthy();
  } finally {
    await equipoA.context.close();
    await equipoB.context.close();
  }
});

test('lo que guarda un equipo llega al otro al sincronizar', async ({ browser }) => {
  const servidor = crearServidorFalso();
  const equipoA = await abrirEquipo(browser, servidor);
  const equipoB = await abrirEquipo(browser, servidor);

  try {
    await guardarConsulta(equipoA.page, {
      patient: pacienteDemo(),
      consultation: consultaClinica({ k1_d_od: '47' })
    });
    await sincronizar(equipoA.page, false);

    // B no recarga ni edita: solo sincroniza, como el sondeo periodico.
    await sincronizar(equipoB.page, true);

    const localB = await leerConsulta(equipoB.page, CONSULTA);
    expect(localB.k1_d_od).toBe('47');
    expect(localB.syncVersion).toBe(2);
    expect(servidor.estado.consultas.get(CONSULTA).k1_d_od).toBe('47');
  } finally {
    await equipoA.context.close();
    await equipoB.context.close();
  }
});
