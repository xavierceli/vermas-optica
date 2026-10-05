import { reset } from './ayudaPruebas.js';

// ---------------------------------------------------------------------------
// PRUEBAS DEL REPOSITORIO LOCAL: INTEGRACION Y CATALOGOS
// ---------------------------------------------------------------------------
// Reune casos que atraviesan varios modulos: eliminar un paciente y que no
// reaparezca al sincronizar, y el payload del inventario segun su categoria.
// Sale de localRepository.test.js al separar las pruebas por tema. El codigo de
// cada test no se modifico: solo cambio de archivo.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { localDb } from '../localDb.js';
import { guardarConsultaLocal, archivarConsultaLocal, guardarInventarioLocal, obtenerSnapshotLocal } from '../localRepository.js';

// ---------------------------------------------------------------------------
// BUG: el paciente eliminado VOLVIA A APARECER al sincronizar o actualizar
// ---------------------------------------------------------------------------
// Al archivar una consulta solo se marcaba la fila de `consultations`, pero la
// copia de esa consulta en la tabla `cache` (id "remote:<id>") seguia viva, y es
// la que se dibuja en el historial. Resultado: eliminar un paciente y, al
// recargar o actualizar la app, volvia a estar como si nada.

test('eliminar un paciente no lo hace reaparecer al sincronizar', async () => {
  await reset();
  const consultaId = 'a1000000-0000-4000-8000-000000000001';
  const cedula = '1712345678';

  // 1) El servidor tiene al paciente en su cach├® de historial.
  await localDb.cache.put({
    id: `remote:${consultaId}`, kind: 'historial', idConsulta: consultaId,
    cedula, nombre: 'PRUEBA', fecha: '2026-09-28', estado: 'En laboratorio',
    venta: '0', pedido_id: ''
  });
  const antes = await obtenerSnapshotLocal();
  assert.equal(antes.historial.filter(h => h.cedula === cedula).length, 1,
    'el paciente debe estar visible antes de eliminarlo');

  // 2) El optometr├¡a lo elimina.
  await localDb.consultations.put({
    id: consultaId, patientId: 'p1', cedula, nombre: 'PRUEBA',
    fecha: '2026-09-28', syncStatus: 'pending'
  });
  await archivarConsultaLocal(consultaId);

  // 3) Inmediatamente despues ya no debe verse.
  const despues = await obtenerSnapshotLocal();
  assert.equal(despues.historial.filter(h => h.cedula === cedula).length, 0,
    'tras eliminar, el paciente no debe aparecer');

  // 4) Y aunque el servidor lo mande OTRA VEZ (pull), debe seguir sin verse.
  await localDb.cache.put({
    id: `remote:${consultaId}`, kind: 'historial', idConsulta: consultaId,
    cedula, nombre: 'PRUEBA', fecha: '2026-09-28', estado: 'En laboratorio',
    venta: '0', pedido_id: ''
  });
  const trasPull = await obtenerSnapshotLocal();
  assert.equal(trasPull.historial.filter(h => h.cedula === cedula).length, 0,
    'el servidor puede reenviarlo, pero un borrado local manda hasta que el servidor confirme');
});

test('eliminar borra tambien la copia en la cache del servidor', async () => {
  await reset();
  const consultaId = 'a1000000-0000-4000-8000-000000000002';
  await localDb.cache.put({
    id: `remote:${consultaId}`, kind: 'historial', idConsulta: consultaId,
    cedula: '1712345679', nombre: 'OTRO', fecha: '2026-09-28', estado: 'En laboratorio', venta: '0'
  });
  await localDb.consultations.put({
    id: consultaId, patientId: 'p1', cedula: '1712345679', nombre: 'OTRO',
    fecha: '2026-09-28', syncStatus: 'synced'
  });

  await archivarConsultaLocal(consultaId);

  const cache = await localDb.cache.get(`remote:${consultaId}`);
  assert.equal(cache, undefined,
    'la copia de la cache debe borrarse al archivar: era la que hacia resucitar al paciente');
});

test('un paciente NO eliminado sigue apareciendo con normalidad', async () => {
  await reset();
  await guardarConsultaLocal({
    patient: { id: 'a1000000-0000-4000-8000-000000000004', cedula: '1712345680', nombre: 'NORMAL' },
    consultation: { id: 'a1000000-0000-4000-8000-000000000005', fecha: '2026-09-28', estado: 'Ninguno' }
  });
  const snapshot = await obtenerSnapshotLocal();
  assert.equal(snapshot.historial.filter(h => h.cedula === '1712345680').length, 1,
    'el filtro no debe afectar a pacientes que nunca se eliminaron');
});
// ---------------------------------------------------------------------------
// BUG: editar un producto del inventario borraba datos
// ---------------------------------------------------------------------------
// El formulario de Inventario muestra unos campos segun la categoria y oculta
// otros. El cliente mandaba el objeto COMPLETO con los campos vacios en null y
// el servidor hacia UPDATE de todas las columnas con `p_datos ->> 'columna'`, que
// devuelve NULL cuando la clave no existe. Resultado: al editar un armazon se
// perdian sus notas de material; al editar un accesorio, su codigo y medidas.

test('el payload de un armazon NO lleva campos de accesorio', async () => {
  await reset();
  await localDb.inventory.put({
    id: 5, categoria: 'Armazon', codigo: 'MIR-4017', tipo_armazon: 'Completo',
    material: 'TR90', descripcion: 'Negro con dorado', stock: 3, precio: '80',
    syncStatus: 'synced'
  });

  await guardarInventarioLocal({
    id: 5, categoria: 'Armazon', codigo: 'MIR-4017', tipo_armazon: 'Completo',
    material: 'TR90', descripcion: 'Negro con dorado', stock: 5, precio: '80',
    // El formulario de armazon NO tiene estos campos; llegan vacios.
    nombre_accesorio: '', caracteristica: ''
  });

  const ops = await localDb.outbox.toArray();
  const upsert = ops.find(o => o.type === 'UPSERT_INVENTARIO');
  assert.ok(upsert, 'debe encolarse la actualizacion');
  const datos = upsert.payload.p_datos;

  assert.equal(datos.codigo, 'MIR-4017');
  assert.equal(datos.descripcion, 'Negro con dorado');
  // these campos must NOT arrive as null: that is what erased the data
  assert.notEqual(datos.nombre_accesorio, null,
    'un campo de la otra categoria no debe viajar como null: el servidor lo borraria');
  assert.notEqual(datos.caracteristica, null);
});

test('el payload de un accesorio NO lleva campos de armazon', async () => {
  await reset();
  await localDb.inventory.put({ id: 6, categoria: 'Accesorio', nombre_accesorio: 'ESTUCHE', stock: 20, syncStatus: 'synced' });

  await guardarInventarioLocal({
    id: 6, categoria: 'Accesorio', nombre_accesorio: 'ESTUCHE RIGIDO',
    caracteristica: 'Azul', stock: 20, precio: '5',
    codigo: '', tipo_armazon: '', material: ''
  });

  const ops = await localDb.outbox.toArray();
  const datos = ops.find(o => o.type === 'UPSERT_INVENTARIO').payload.p_datos;

  assert.equal(datos.nombre_accesorio, 'ESTUCHE RIGIDO');
  assert.notEqual(datos.codigo, null, 'codigo no debe viajar como null');
  assert.notEqual(datos.material, null, 'material no debe viajar como null');
  assert.notEqual(datos.param_horizontal, null);
});