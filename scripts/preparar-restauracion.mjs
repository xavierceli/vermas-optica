import { readFileSync } from 'node:fs';
import { extraerIdsPerfiles, sqlInsertarUsuarios } from '../src/pruebas/restauracion.js';

// ---------------------------------------------------------------------------
// Uso:
//   node scripts/preparar-restauracion.mjs respaldo.sql > /tmp/usuarios.sql
//
// Imprime el SQL que recrea en auth.users los ids referenciados por
// public.perfiles. Se ejecuta ANTES de restaurar el volcado para que la clave
// foranea de perfiles encuentre sus usuarios.
// ---------------------------------------------------------------------------

const ruta = process.argv[2];

if (!ruta) {
  console.error('Uso: node scripts/preparar-restauracion.mjs <respaldo.sql>');
  process.exit(2);
}

try {
  const sql = readFileSync(ruta, 'utf8');
  const ids = extraerIdsPerfiles(sql);
  process.stdout.write(sqlInsertarUsuarios(ids));
  console.error(`Usuarios a recrear en auth.users: ${ids.length}`);
} catch (error) {
  console.error(`No se pudo leer ${ruta}: ${error.message}`);
  process.exit(2);
}
