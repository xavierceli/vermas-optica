// ---------------------------------------------------------------------------
// ENTORNO DE PRUEBAS: IndexedDB simulado
// ---------------------------------------------------------------------------
// ESTE IMPORT DEBE IR EL PRIMERO EN CADA ARCHIVO DE PRUEBA, ANTES DE
// `import { localDb } from '../localDb.js'`.
//
// Por que: `localDb.js` construye el objeto Dexie en cuanto se importa
// (`new Dexie('vermas-local')`). Node no tiene IndexedDB, asi que hace falta
// `fake-indexeddb`. En ESM todos los imports se resuelven antes de ejecutar
// ninguna linea, asi que este import debe ser el primero; un
// `await import()` mas abajo llega tarde y Dexie se queda sin base
// ("Cannot read properties of undefined (reading 'deleteDatabase')").
//
// Esto ya pasaba antes del reparto en modulos: cada archivo de pruebas historico
// empezaba con `import 'fake-indexeddb/auto';`. Aqui queda centralizado.
// ---------------------------------------------------------------------------
import 'fake-indexeddb/auto';
import { localDb } from '../localDb.js';

// --- Datos de prueba compartidos --------------------------------------------
// Antes vivian al principio de localRepository.test.js. Al dividir ese archivo en
// varios por tema, se comparten desde aqui para que los datos sean SIEMPRE los
// mismos: si un producto vale 10 en un archivo y 20 en otro, una regresion
// pasaria desapercibida.

export const reset = async () => {
  await localDb.delete();
  await localDb.open();
};

export const product = (stock = 2) => ({
  id: 1, categoria: 'Accesorio', nombre_accesorio: 'Estuche',
  codigo: 'ACC-1', precio: '10', stock, syncStatus: 'synced'
});

export const patient = () => ({
  id: '10000000-0000-4000-8000-000000000001',
  cedula: '17123456789',
  nombre: 'Paciente Prueba'
});

export const sale = (accessory = '1') => ({
  id: '20000000-0000-4000-8000-000000000001',
  pedido_id: '20000000-0000-4000-8000-000000000001',
  patient_id: patient().id,
  consultation_id: '30000000-0000-4000-8000-000000000001',
  fecha: '2026-09-24', venta: '100', descuento: '0', abono: '0',
  estado: 'En laboratorio', accesorio_id: accessory
});