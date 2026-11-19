// ---------------------------------------------------------------------------
// RESUMEN LEGIBLE DE UNA VERSION CLINICA
// ---------------------------------------------------------------------------
// El snapshot de cada revision es la fila completa de consultas_clinicas.
// Mostrarla como JSON no le sirve al optometra: aqui se extraen solo los datos
// que se leen de un vistazo (refraccion y notas). Modulo puro, sin Supabase ni
// IndexedDB, para probarlo con node --test.
// ---------------------------------------------------------------------------

const texto = valor => (valor === null || valor === undefined ? '' : String(valor).trim());

const refraccion = (fila, ojo) => {
  const partes = [
    ['AV lejos', fila[`avsl_${ojo}`]],
    ['Esf', fila[`esfera_${ojo}`]],
    ['Cil', fila[`cilindro_${ojo}`]],
    ['Eje', fila[`eje_${ojo}`]],
    ['Add', fila[`adicion_${ojo}`]],
    ['DNP', fila[`dnp_${ojo}`]]
  ];
  const presentes = partes.filter(([, valor]) => texto(valor));
  if (presentes.length === 0) return 'Sin datos de refracción';
  return presentes.map(([etiqueta, valor]) => `${etiqueta} ${texto(valor)}`).join(' · ');
};

/**
 * Datos de una version anterior listos para mostrar.
 *
 * @param {object} snapshot Fila de consultas_clinicas guardada en la revision.
 * @returns {{ fecha: string, od: string, oi: string, notas: string }}
 */
export const resumenDeVersion = snapshot => {
  const fila = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return {
    fecha: texto(fila.fecha),
    od: refraccion(fila, 'od'),
    oi: refraccion(fila, 'oi'),
    notas: texto(fila.notas_clinicas)
  };
};
