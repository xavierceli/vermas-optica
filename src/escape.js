// ---------------------------------------------------------------------------
// ESCAPE Y SANITIZACION DE DATOS
// ---------------------------------------------------------------------------
// Capas de protección contra XSS e inyecciones:
//   - esc(): Para interpolar variables dentro de plantillas HTML.
//   - escJs(): Para incrustar literales seguros dentro de bloques <script>.
//   - limpiarHtml(): Saneamiento previo a la persistencia en base de datos.
//   - neutralizarFormula(): Protección contra inyección de fórmulas en CSV/Excel.
// ---------------------------------------------------------------------------

const ENTIDADES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/** Escapa un valor para interpolarlo de forma segura dentro de plantillas HTML. */
export const esc = valor =>
  valor === null || valor === undefined
    ? ''
    : String(valor).replace(/[&<>"']/g, caracter => ENTIDADES[caracter]);

/**
 * Escape seguro para valores incrustados dentro de bloques <script>.
 * Previene el cierre prematuro de etiquetas (</script> breakout).
 */
export const escJs = valor => {
  const json = JSON.stringify(String(valor ?? ''));
  return json
    .replace(/<\/script/gi, '<\\/script')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
};

/**
 * Sanea entradas de texto antes de persistirlas en la base de datos local o remota.
 * Elimina caracteres de marcado potencialmente peligrosos sin corromper el contenido.
 */
export const limpiarHtml = valor =>
  valor === null || valor === undefined
    ? ''
    : String(valor).replace(/[<>'"]/g, '');

/**
 * Neutraliza la inyección de fórmulas en hojas de cálculo (CSV/Excel).
 * Antepone un apóstrofo si el primer carácter puede desencadenar la ejecución de comandos.
 */
export const neutralizarFormula = valor => {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  const textoRecortado = texto.trimStart();
  return /^[=+\-@\t\r%]/.test(textoRecortado) ? `'${texto}` : texto;
};