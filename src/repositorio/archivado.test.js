import { reset, patient } from './ayudaPruebas.js';

// ---------------------------------------------------------------------------
// PRUEBAS DEL REPOSITORIO LOCAL: ARCHIVADO DE CONSULTAS
// ---------------------------------------------------------------------------
// Archivar una consulta es ocultarla, no borrarla: el servidor conserva el dato.
// Aqui se comprueba que se archivan TODAS las visitas del paciente y no solo la
// que se estaba viendo, que la accion es idempotente y que una venta anulada no
// deja saldo fantasma en el historial.
// Sale de localRepository.test.js al separar las pruebas por tema. El codigo de
// cada test no se modifico: solo cambio de archivo.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { localDb } from '../localDb.js';
import { guardarConsultaLocal, guardarVentaLocal, registrarPagoLocal, archivarConsultaLocal, archivarConsultaIndividualLocal, obtenerSnapshotLocal } from '../localRepository.js';
import { calcularTotal } from '../reglas.js';
import { resumenConsulta } from '../historial.js';

// ---------------------------------------------------------------------------
// ARCHIVAR UNA CONSULTA (boton "Eliminar" del historial)
// ---------------------------------------------------------------------------

test('archivar una consulta la marca como archivada', async () => {
  await reset();
  const id = '60000000-0000-4000-8000-000000000001';
  await guardarConsultaLocal({
    patient: patient(),
    consultation: { id, fecha: '2026-01-15' }
  });

  const resultado = await archivarConsultaLocal(id);
  assert.equal(resultado.yaArchivada, false);

  const fila = await localDb.consultations.get(id);
  assert.ok(fila.archivedAt, 'debe quedar marcada como archivada');
});

test('archivar una consulta individual conserva las otras visitas y sus ventas', async () => {
  await reset();
  const paciente = patient();
  const idArchivada = '60000000-0000-4000-8000-000000000101';
  const idViva = '60000000-0000-4000-8000-000000000102';
  await guardarConsultaLocal({ patient: paciente, consultation: { id: idArchivada, fecha: '2026-01-15' } });
  await guardarConsultaLocal({ patient: paciente, consultation: { id: idViva, fecha: '2026-02-15' } });
  await guardarVentaLocal({
    patient: paciente, consultationId: idArchivada,
    sale: { id: 'venta-archivo-individual', estado: 'En laboratorio', venta: '50' }
  });

  await archivarConsultaIndividualLocal(idArchivada);

  assert.ok((await localDb.consultations.get(idArchivada)).archivedAt);
  assert.equal((await localDb.consultations.get(idViva)).archivedAt, undefined,
    'la otra visita de la misma persona debe seguir activa');
  assert.ok(await localDb.sales.get('venta-archivo-individual'),
    'la venta vinculada debe conservarse');
  const operacionesConsulta = await localDb.outbox.where('entityId').equals(idArchivada).toArray();
  const guardar = operacionesConsulta.find(row => row.type === 'GUARDAR_CONSULTA');
  const archivar = operacionesConsulta.find(row => row.type === 'ARCHIVAR_CONSULTA');
  assert.ok(archivar, 'el archivo debe llegar al servidor por la cola');
  assert.ok(Date.parse(archivar.createdAt) > Date.parse(guardar.createdAt),
    'si la consulta a├║n no se hab├¡a sincronizado, primero debe guardarse y despu├®s archivarse');
  assert.equal((await obtenerSnapshotLocal()).historial.length, 1,
    'el historial debe seguir mostrando la visita no archivada');
});

test('archivar dos veces NO da error (debe ser idempotente)', async () => {
  // Pulsar "Eliminar" dos veces no puede mostrar un error rojo: para el usuario
  // el objetivo (que la consulta desaparezca) ya se cumplio.
  await reset();
  const id = '60000000-0000-4000-8000-000000000002';
  await guardarConsultaLocal({
    patient: patient(),
    consultation: { id, fecha: '2026-01-15' }
  });

  const primera = await archivarConsultaLocal(id);
  const segunda = await archivarConsultaLocal(id);

  assert.equal(primera.yaArchivada, false, 'la primera vez si archiva');
  assert.equal(segunda.yaArchivada, true, 'la segunda vez avisa que ya estaba');
  assert.match(segunda.motivo, /ya estaba archivada/i);
});

test('archivar una consulta que solo vive en la cache del servidor SI funciona', async () => {
  // BUG REAL: la consulta se ve en el historial pero no tiene fila propia, solo la
  // copia "remote:<id>" de la cache. Antes se contestaba "no existe en este
  // dispositivo" sin encolar nada, el servidor nunca se enteraba del archivo y el
  // paciente reaparecia en cada sincronizacion: no se podia eliminar nunca.
  await reset();
  const id = '60000000-0000-4000-8000-000000000777';
  await localDb.cache.put({
    id: `remote:${id}`, kind: 'historial', cedula: '0750577042',
    nombre: 'PRUEBA', fecha: '2026-09-28', venta: '79.20', descuento: '10',
    pedido_id: 'vta-1', estado: 'Anulado', abono: '0'
  });

  const resultado = await archivarConsultaLocal(id);
  assert.equal(resultado.yaArchivada, false, 'debe archivar, no rendirse');

  assert.equal(await localDb.cache.get(`remote:${id}`), undefined, 'la copia del historial se borra');
  const encolada = await localDb.outbox.where('type').equals('ARCHIVAR_CONSULTA').toArray();
  assert.equal(encolada.length, 1, 'el servidor tiene que enterarse del archivo');
  assert.equal(encolada[0].entityId, id);
});

test('tras archivar desde la cache, el paciente desaparece del historial', async () => {
  // La cedula queda en la lista de eliminados de este dispositivo, que es lo que
  // filtra el historial y el autocompletado aunque el servidor la mande de vuelta.
  await reset();
  const id = '60000000-0000-4000-8000-000000000778';
  await localDb.cache.put({
    id: `remote:${id}`, kind: 'historial', cedula: '0750577042',
    nombre: 'PRUEBA', fecha: '2026-09-28', venta: '0', descuento: '0'
  });

  assert.equal((await obtenerSnapshotLocal()).historial.length, 1, 'antes de archivar se ve');
  await archivarConsultaLocal(id);
  assert.equal((await obtenerSnapshotLocal()).historial.length, 0, 'despues de archivar no');
});

test('una venta ANULADA no deja saldo pendiente en el historial', async () => {
  // El caso del paciente PRUEBA: venta de 79.20 con dos abonos y luego anulada.
  // Se mostraba "SALDO PENDIENTE: 79.20" por una venta que ya no existe, y eso
  // hacia creer al optometria que el paciente debia.
  await reset();
  const id = '60000000-0000-4000-8000-000000000779';
  await guardarConsultaLocal({
    patient: { id: 'p-1', cedula: '0750577042', nombre: 'PRUEBA' },
    consultation: { id, fecha: '2026-09-28', venta: '79.20', descuento: '10' }
  });
  await guardarVentaLocal({
    patient: { id: 'p-1', cedula: '0750577042', nombre: 'PRUEBA' },
    consultationId: id,
    sale: { id: 'vta-1', fecha: '2026-09-28', estado: 'Anulado', venta: '79.20', descuento: '10', abono: '0' }
  });

  const fila = (await obtenerSnapshotLocal()).historial[0];
  const resumen = resumenConsulta(fila);
  assert.equal(resumen.saldo, 0, 'una venta anulada no genera deuda');
  assert.equal(resumen.tieneDeuda, false);
});

test('una venta normal SI mantiene su saldo pendiente', async () => {
  // El contrapunto: el arreglo no puede tapar una deuda real.
  await reset();
  const id = '60000000-0000-4000-8000-000000000780';
  await guardarConsultaLocal({
    patient: { id: 'p-2', cedula: '1712345678', nombre: 'ANA' },
    consultation: { id, fecha: '2026-09-28', venta: '100', descuento: '0' }
  });
  await guardarVentaLocal({
    patient: { id: 'p-2', cedula: '1712345678', nombre: 'ANA' },
    consultationId: id,
    sale: { id: 'vta-2', fecha: '2026-09-28', estado: 'En laboratorio', venta: '100', descuento: '0' }
  });
  // El abono se registra como cobro, no como campo de la venta.
  await registrarPagoLocal({ saleId: 'vta-2', amount: 40 });

  const fila = (await obtenerSnapshotLocal()).historial[0];
  assert.equal(calcularTotal('100', '0') - Number(fila.abono), 60, 'una venta viva conserva su deuda');
});

test('el historial pasa el id con prefijo remote: y aun asi se archiva', async () => {
  // BUG REAL: las filas que vienen del servidor se dibujan con el id "remote:<id>".
  // El boton eliminar pasaba ese id tal cual y se buscaba "remote:remote:<id>":
  // no habia nada que archivar, no se encolaba nada y el paciente no se borraba
  // NUNCA. El optometria podia pulsar Eliminar mil veces sin que pasara nada.
  await reset();
  const id = '60000000-0000-4000-8000-000000000781';
  await localDb.cache.put({
    id: `remote:${id}`, kind: 'historial', cedula: '0750577042',
    nombre: 'PRUEBA', fecha: '2026-09-28', venta: '0', descuento: '0'
  });

  // ASI LO LLAMA EL HISTORIAL: con el prefijo puesto.
  const resultado = await archivarConsultaLocal(`remote:${id}`);
  assert.equal(resultado.yaArchivada, false, 'debe archivar aunque le lleguen el id con prefijo');
  assert.equal(await localDb.cache.get(`remote:${id}`), undefined, 'la fila desaparece del historial');
  const ops = await localDb.outbox.toArray();
  assert.equal(ops.filter(o => o.type === 'ARCHIVAR_CONSULTA').length, 1, 'y se avisa al servidor');
  assert.equal(ops.find(o => o.type === 'ARCHIVAR_CONSULTA').entityId, id, 'con el id real, sin prefijo');
});

test('EL CASO REAL: la cedula esta en el paciente, no en la consulta', async () => {
  // Asi esta guardado de verdad: la consulta no lleva cedula, el paciente si. Al
  // leer la cedula de la consulta se Guardaba '' en el registro de eliminados, el
  // historial no filtraba nada y el paciente seguia apareciendo: la app decia
  // "ya estaba archivada" mientras no habia quitado nada de la pantalla.
  await reset();
  const idConsulta = '60000000-0000-4000-8000-000000000790';
  const idPaciente = '70000000-0000-4000-8000-000000000790';
  await guardarConsultaLocal({
    patient: { id: idPaciente, cedula: '0750577042', nombre: 'PRUEBA' },
    consultation: { id: idConsulta, fecha: '2026-09-28', cedula: '' }
  });
  await localDb.cache.put({
    id: `remote:${idConsulta}`, kind: 'historial', cedula: '0750577042',
    patientId: idPaciente, nombre: 'PRUEBA', fecha: '2026-09-28', venta: '0', descuento: '0'
  });

  assert.ok((await obtenerSnapshotLocal()).historial.length >= 1, 'antes de archivar se ve');

  await archivarConsultaLocal(`remote:${idConsulta}`);

  assert.equal(
    (await obtenerSnapshotLocal()).historial.length,
    0,
    'despues de archivar el paciente NO debe seguir apareciendo, aunque la copia de la nube siga ahi'
  );
});

test('una consulta archivada desaparece aunque la copia de la nube siga en la cache', async () => {
  await reset();
  const id = '60000000-0000-4000-8000-000000000791';
  await guardarConsultaLocal({
    patient: { id: 'p-9', cedula: '1712345678', nombre: 'ANA' },
    consultation: { id, fecha: '2026-09-28' }
  });
  await localDb.cache.put({
    id: `remote:${id}`, kind: 'historial', cedula: '1712345678',
    patientId: 'p-9', nombre: 'ANA', fecha: '2026-09-28', venta: '0', descuento: '0'
  });
  // Se archiva SOLO la fila local, sin pasar por el boton (como si el pull
  // llegase despues): la vista no debe resucitar la consulta.
  await localDb.consultations.put({ ...(await localDb.consultations.get(id)), archivedAt: '2026-09-28' });

  assert.equal((await obtenerSnapshotLocal()).historial.length, 0);
});

test('archivar una consulta inexistente no lanza error', async () => {
  await reset();
  const resultado = await archivarConsultaLocal('60000000-0000-4000-8000-000000000999');
  assert.equal(resultado.yaArchivada, true);
  assert.match(resultado.motivo, /no existe/i);
});

test('archivar una consulta que nunca se sincronizo no encola operacion', async () => {
  // Si nunca llego al servidor, encolar el archivo haria que el servidor lo
  // rechazara para siempre ("La consulta X no existe"), dejando la barra roja.
  await reset();
  const id = '60000000-0000-4000-8000-000000000003';
  await guardarConsultaLocal({
    patient: patient(),
    consultation: { id, fecha: '2026-01-15' }
  });

  await archivarConsultaLocal(id);

  const ops = await localDb.outbox.toArray();
  const archivar = ops.filter(o => o.type === 'ARCHIVAR_CONSULTA');
  assert.equal(archivar.length, 0,
    'una consulta local que nunca se subio no debe generar una operacion de archivo');
});
// ---------------------------------------------------------------------------
// BUG: guardar una clinica sola hacia aparecer una VENTA de $0 en Pedidos
// ---------------------------------------------------------------------------
// La vista del servidor entrega `estado` = 'En laboratorio' por defecto, tomandolo
// de la venta. Una consulta clinica que nunca tuvo venta llegaba igual con ese
// estado inventado y pasaba el filtro de Pedidos, que solo miraba el estado.

test('una consulta clinica sin venta no genera un pedido', async () => {
  await reset();
  const id = '70000000-0000-4000-8000-000000000001';
  await guardarConsultaLocal({
    patient: { id: '70000000-0000-4000-8000-000000000002', cedula: '1712345678', nombre: 'PRUEBA' },
    consultation: { id, fecha: '2026-09-28', estado: 'Ninguno' }
  });

  const snapshot = await obtenerSnapshotLocal();
  const fila = snapshot.historial.find(h => h.id === id);
  assert.ok(fila, 'la consulta debe estar en el historial');

  // Este es el criterio que usan PedidosLista y useGestor.
  const tienePedido = Boolean(String(fila.pedido_id || '').trim())
    || Number(fila.venta || 0) > 0
    || String(fila.codigo_armazon || '').trim() !== ''
    || String(fila.accesorio_id || '').trim() !== '';
  assert.equal(tienePedido, false, 'una consulta sin venta no es un pedido');
});

test('el historial remoto sin pedido no inventa un estado de venta', async () => {
  // Reproduce lo que llega del servidor: estado 'En laboratorio' sin pedido_id.
  await reset();
  await localDb.cache.put({
    id: 'remote:90000000-0000-4000-8000-000000000001',
    kind: 'historial',
    idConsulta: '90000000-0000-4000-8000-000000000001',
    cedula: '1712345678', nombre: 'PRUEBA',
    fecha: '2026-09-27', estado: 'En laboratorio', venta: '0', pedido_id: ''
  });

  const snapshot = await obtenerSnapshotLocal();
  const fila = snapshot.historial.find(h => h.cedula === '1712345678');
  assert.ok(fila, 'debe aparecer en el historial');
  assert.equal(fila.estado, 'Ninguno',
    'sin pedido_id el estado debe ser Ninguno, no el inventado por el servidor');
});

test('una venta real si se mantiene en Pedidos', async () => {
  await reset();
  await localDb.sales.put({
    id: '80000000-0000-4000-8000-000000000001', pedido_id: '80000000-0000-4000-8000-000000000001',
    consultationId: '80000000-0000-4000-8000-000000000002', cedula: '1712345679', nombre: 'REAL',
    fecha: '2026-09-26', venta: '100', descuento: '0', abono: '0', estado: 'En laboratorio'
  });
  await localDb.consultations.put({
    id: '80000000-0000-4000-8000-000000000002', patientId: 'x', cedula: '1712345679',
    nombre: 'REAL', fecha: '2026-09-26', syncStatus: 'synced'
  });

  const snapshot = await obtenerSnapshotLocal();
  const fila = snapshot.historial.find(h => h.cedula === '1712345679');
  const tienePedido = Boolean(String(fila.pedido_id || '').trim()) || Number(fila.venta || 0) > 0;
  assert.equal(tienePedido, true, 'una venta real SI debe aparecer en Pedidos');
});