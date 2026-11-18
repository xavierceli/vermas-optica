import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  verificarRespaldo,
  TABLAS_CRITICAS,
  FUNCIONES_CRITICAS
} from '../src/pruebas/verificarRespaldo.js';
import { compararConteos, formatearComparacion } from '../src/pruebas/restauracion.js';

// ---------------------------------------------------------------------------
// Uso (dentro del simulacro de restauracion):
//   DATABASE_URL=postgresql://... node scripts/comprobar-restauracion.mjs \
//     --respaldo respaldos/20261118_194935_datos.sql
//
// Compara las filas del volcado con las de la base ya restaurada y comprueba
// que esten las funciones y las politicas RLS. Codigos de salida: 0 bien,
// 1 diferencias, 2 error de uso/psql.
// ---------------------------------------------------------------------------

const argumentos = process.argv.slice(2);
const posicion = argumentos.indexOf('--respaldo');
const ruta = posicion >= 0 ? argumentos[posicion + 1] : null;
const url = process.env.DATABASE_URL;

if (!ruta || !url) {
  console.error('Uso: DATABASE_URL=postgresql://... node scripts/comprobar-restauracion.mjs --respaldo <archivo.sql>');
  process.exit(2);
}

let esperado;
try {
  esperado = verificarRespaldo(readFileSync(ruta, 'utf8'));
} catch (error) {
  console.error(`No se pudo leer ${ruta}: ${error.message}`);
  process.exit(2);
}

if (!esperado.ok) {
  console.error('El volcado no pasa la verificacion previa:');
  for (const error of esperado.errores) console.error(`  - ${error}`);
  process.exit(1);
}

const consultar = sql => {
  try {
    return execFileSync(
      'psql',
      [url, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
  } catch (error) {
    const detalle = (error.stderr || error.message || '').toString().trim();
    console.error(`psql fallo: ${detalle}`);
    process.exit(2);
  }
};

try {
  const union = TABLAS_CRITICAS
    .map(tabla => `select '${tabla}', count(*) from public.${tabla}`)
    .join(' union all ');

  const real = Object.fromEntries(
    consultar(union)
      .split('\n')
      .filter(Boolean)
      .map(linea => {
        const [tabla, cantidad] = linea.split('|');
        return [tabla, Number(cantidad)];
      })
  );

  const listaFunciones = FUNCIONES_CRITICAS.map(nombre => `'${nombre}'`).join(',');
  const funciones = Number(consultar(
    `select count(distinct p.proname)
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (${listaFunciones})`
  ));

  const politicas = Number(consultar(
    "select count(*) from pg_policies where schemaname = 'public'"
  ));

  const diferencias = compararConteos(esperado.filas, real);

  if (funciones < FUNCIONES_CRITICAS.length) {
    diferencias.push(`solo ${funciones} de ${FUNCIONES_CRITICAS.length} funciones criticas`);
  }
  if (politicas === 0) {
    diferencias.push('no se restauro ninguna politica RLS');
  }

  console.log(formatearComparacion(esperado.filas, real, diferencias));
  console.log(`Funciones: ${funciones}/${FUNCIONES_CRITICAS.length} | Politicas RLS: ${politicas}`);
  process.exit(diferencias.length === 0 ? 0 : 1);
} catch (error) {
  console.error(`No se pudo comprobar la restauracion: ${error.message}`);
  process.exit(2);
}
