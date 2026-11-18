// ---------------------------------------------------------------------------
// VERIFICADOR DE RESPALDOS DE SUPABASE
// ---------------------------------------------------------------------------
// Un `pg_dump` que se corta a la mitad (red, timeout, credencial vencida) deja
// un archivo .sql que "parece" un respaldo: pesa, tiene CREATE TABLE y hasta
// datos. Restaurarlo meses despues es cuando se descubre que faltaba la mitad.
//
// Este modulo lee el volcado en texto plano y comprueba lo minimo que debe
// estar para que la app pueda volver a funcionar:
//   - las tablas y funciones criticas,
//   - que las tablas traigan datos (no solo el esquema),
//   - que el volcado haya terminado (marca final de pg_dump),
//   - que no haya errores mezclados en la salida,
//   - coherencia basica (no puede haber consultas sin pacientes).
//
// Se ejecuta antes de publicar el respaldo en la rama de respaldos. No
// reemplaza al simulacro de restauracion: lo complementa.
// ---------------------------------------------------------------------------

export const TABLAS_CRITICAS = [
  'pacientes_perfil',
  'consultas_clinicas',
  'pedidos_ventas',
  'pedido_items',
  'pagos',
  'inventario',
  'lista_precios',
  'inventario_movimientos',
  'operaciones_aplicadas',
  'consultas_clinicas_revisiones'
];

export const FUNCIONES_CRITICAS = [
  'aplicar_operaciones',
  'guardar_consulta_clinica',
  'guardar_consulta_clinica_v2',
  'crear_venta',
  'registrar_pago',
  'anular_venta',
  'mi_rol',
  'contar_registros_paciente',
  'eliminar_paciente_definitivo'
];

const LIMITE_AVISO_BYTES = 50 * 1024 * 1024; // GitHub rechaza archivos > 100 MB
const MINIMO_TABLAS_CON_RLS = 7;

const sinComentarios = sql => sql
  .split('\n')
  .filter(linea => !linea.startsWith('--'))
  .join('\n');

const buscarNombres = (sql, expresion) => {
  const nombres = new Set();
  for (const coincidencia of sql.matchAll(expresion)) {
    nombres.add(coincidencia[1].toLowerCase());
  }
  return nombres;
};

const CABECERA_COPY = /^COPY\s+(?:public\.)?"?([a-z0-9_]+)"?.*FROM stdin;\s*$/i;

/** Analiza los bloques COPY: filas por tabla y bloques sin terminador. */
const analizarCopias = sql => {
  const lineas = sql.split('\n');
  const filas = new Map();
  const sinTerminar = [];

  for (let indice = 0; indice < lineas.length; indice += 1) {
    const cabecera = CABECERA_COPY.exec(lineas[indice]);
    if (!cabecera) continue;

    const tabla = cabecera[1].toLowerCase();
    let contador = 0;
    let cerrado = false;
    let siguiente = -1;

    for (let j = indice + 1; j < lineas.length; j += 1) {
      if (lineas[j] === '\\.') {
        cerrado = true;
        indice = j;
        break;
      }
      // Si aparece otra cabecera COPY antes del terminador, este bloque se
      // corto: no se puede dejar que se coma las tablas siguientes.
      if (CABECERA_COPY.test(lineas[j])) {
        siguiente = j;
        break;
      }
      if (lineas[j].length > 0) contador += 1;
    }

    if (!cerrado) sinTerminar.push(tabla);
    filas.set(tabla, (filas.get(tabla) || 0) + contador);

    if (siguiente !== -1) indice = siguiente - 1;
  }

  return { filas, sinTerminar };
};

/** Cuenta las filas de cada bloque COPY ... FROM stdin; de un volcado plano. */
export const contarFilasPorTabla = sql => analizarCopias(sql).filas;

/**
 * Verifica un volcado en texto plano.
 * @param {string} sql contenido del .sql
 * @param {{ tamano?: number }} opciones
 * @returns {{ ok: boolean, errores: string[], avisos: string[], completo: boolean,
 *             tablas: string[], funciones: string[], tablasConRls: string[],
 *             filas: Record<string, number>, politicas: number, tamano: number }}
 */
export const verificarRespaldo = (sql, { tamano } = {}) => {
  const errores = [];
  const avisos = [];
  const contenido = String(sql || '');
  const peso = tamano ?? new TextEncoder().encode(contenido).length;
  const limpio = sinComentarios(contenido);

  const tablas = [...buscarNombres(limpio,
    /^CREATE TABLE (?:IF NOT EXISTS )?(?:(?:"?public"?)\s*\.\s*)?"?([a-z0-9_]+)"?/gim)].sort();

  const funciones = [...buscarNombres(limpio,
    /^CREATE (?:OR REPLACE )?FUNCTION\s+(?:(?:"?public"?)\s*\.\s*)?"?([a-z0-9_]+)"?/gim)].sort();

  const tablasConRls = [...buscarNombres(limpio,
    /^ALTER TABLE (?:ONLY )?(?:(?:"?public"?)\s*\.\s*)?"?([a-z0-9_]+)"?\s+ENABLE ROW LEVEL SECURITY/gim)].sort();

  const politicas = (limpio.match(/^CREATE POLICY\s+/gim) || []).length;
  const completo = /PostgreSQL database dump complete/i.test(contenido);

  const { filas: filasMapa, sinTerminar } = analizarCopias(contenido);
  const filas = Object.fromEntries([...filasMapa.entries()].sort(([a], [b]) => a.localeCompare(b)));

  for (const tabla of sinTerminar) {
    errores.push(`el bloque COPY de ${tabla} no termina con \\. (volcado cortado dentro de los datos)`);
  }

  if (!contenido.trim()) {
    errores.push('el archivo esta vacio');
  }

  if (!completo) {
    errores.push('falta la marca final "PostgreSQL database dump complete" (volcado cortado o incompleto)');
  }

  if (/^(?:pg_dump|psql):\s*(?:error|fatal):|^(?:ERROR|FATAL):/im.test(limpio)) {
    errores.push('el archivo contiene lineas de ERROR/FATAL; se mezclo la salida de error con el volcado');
  }

  for (const tabla of TABLAS_CRITICAS) {
    if (!tablas.includes(tabla)) {
      errores.push(`falta la tabla ${tabla}`);
    } else if (!filasMapa.has(tabla)) {
      errores.push(`la tabla ${tabla} no trae bloque COPY (parece solo esquema, sin datos)`);
    }
  }

  for (const funcion of FUNCIONES_CRITICAS) {
    if (!funciones.includes(funcion)) {
      errores.push(`falta la funcion ${funcion}`);
    }
  }

  if (politicas === 0) {
    avisos.push('no hay ninguna CREATE POLICY: revisa que la RLS venga en el volcado');
  }

  if (tablasConRls.length < MINIMO_TABLAS_CON_RLS) {
    avisos.push(`solo ${tablasConRls.length} tablas con RLS (se esperaban al menos ${MINIMO_TABLAS_CON_RLS})`);
  }

  const pacientes = filasMapa.get('pacientes_perfil') || 0;
  const consultas = filasMapa.get('consultas_clinicas') || 0;

  if (pacientes === 0) {
    avisos.push('pacientes_perfil esta vacia: puede ser una instalacion nueva, pero confirmalo antes de confiar en el respaldo');
  }

  if (consultas > 0 && pacientes === 0) {
    errores.push(`hay ${consultas} consultas pero 0 pacientes: los datos estan incompletos`);
  }

  if (peso > LIMITE_AVISO_BYTES) {
    avisos.push(`el archivo pesa ${(peso / 1024 / 1024).toFixed(1)} MB; GitHub rechaza archivos de mas de 100 MB`);
  }

  return {
    ok: errores.length === 0,
    errores,
    avisos,
    completo,
    tablas,
    funciones,
    tablasConRls,
    filas,
    politicas,
    tamano: peso
  };
};

export const formatearInforme = (resultado, ruta = '') => {
  const lineas = [];
  if (ruta) lineas.push(`Respaldo: ${ruta}`);
  lineas.push(`Tamano: ${(resultado.tamano / 1024).toFixed(1)} kB`);
  lineas.push(`Marcador final: ${resultado.completo ? 'si' : 'NO'}`);
  lineas.push(`Tablas: ${resultado.tablas.length} | Funciones: ${resultado.funciones.length} | RLS: ${resultado.tablasConRls.length} | Politicas: ${resultado.politicas}`);

  const resumenFilas = Object.entries(resultado.filas)
    .map(([tabla, cantidad]) => `${tabla}=${cantidad}`)
    .join(', ');
  lineas.push(`Filas: ${resumenFilas || 'ninguna'}`);

  for (const error of resultado.errores) lineas.push(`ERROR: ${error}`);
  for (const aviso of resultado.avisos) lineas.push(`AVISO: ${aviso}`);
  lineas.push(resultado.ok ? 'OK: el respaldo parece restaurable.' : 'FALLO: el respaldo NO es fiable.');

  return lineas.join('\n');
};
