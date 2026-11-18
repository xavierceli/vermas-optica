import { readFileSync, statSync } from 'node:fs';
import { verificarRespaldo, formatearInforme } from '../src/pruebas/verificarRespaldo.js';

// ---------------------------------------------------------------------------
// Uso:
//   node scripts/verificar-respaldo.mjs respaldos/20261004_datos.sql
//
// Codigos de salida:
//   0 = el respaldo pasa las comprobaciones
//   1 = el respaldo NO es fiable (se corto, le faltan tablas/funciones...)
//   2 = no se pudo leer el archivo o faltan argumentos
// ---------------------------------------------------------------------------

const ruta = process.argv[2];

if (!ruta) {
  console.error('Uso: node scripts/verificar-respaldo.mjs <respaldo.sql>');
  process.exit(2);
}

try {
  const tamano = statSync(ruta).size;
  const sql = readFileSync(ruta, 'utf8');
  const resultado = verificarRespaldo(sql, { tamano });
  console.log(formatearInforme(resultado, ruta));
  process.exit(resultado.ok ? 0 : 1);
} catch (error) {
  console.error(`No se pudo leer ${ruta}: ${error.message}`);
  process.exit(2);
}
