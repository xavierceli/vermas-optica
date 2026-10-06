const fs = require('fs');
const ruta = process.env.TEMP + '\\informe_zip\\word\\document.xml';
let xml = fs.readFileSync(ruta, 'utf8');

// 1. Marcar saltos de parrafo y celdas ANTES de quitar etiquetas
xml = xml.replace(/<w:tab[^>]*\/>/g, '  ');
xml = xml.replace(/<w:br[^>]*\/>/g, '\n');
xml = xml.replace(/<\/w:p>/g, '\n@@P@@');
xml = xml.replace(/<\/w:tc>/g, ' | ');

// 2. Estilo del parrafo -> marcador para saber que es titulo o normal
xml = xml.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (m, pr) => {
  let pre = '';
  const estilo = pr.match(/<w:pStyle w:val="([^"]+)"/);
  if (estilo) {
    const e = estilo[1];
    if (/Heading|Ttulo|Encabezado/i.test(e)) {
      const n = (e.match(/(\d)/) || [])[1] || '0';
      pre = '\n' + '#'.repeat(Number(n)) + ' ';
    } else if (/Title|Titulo/i.test(e)) pre = '\n# ';
  }
  return '@@P@@' + pre;
});

// 3. Quitar todas las etiquetas que quedan
xml = xml.replace(/<[^>]+>/g, '');

// 4. Limpiar entidades
const entidades = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
for (const [k, v] of Object.entries(entidades)) xml = xml.split(k).join(v);

// 5. Armar lineas
let lineas = xml.split('@@P@@')
  .map(l => l.replace(/\s+/g, ' ').trim())
  .filter(l => l.length > 0);

let salida = '';
let enTabla = false;
for (const l of lineas) {
  if (l.startsWith('#')) { enTabla = false; salida += l + '\n\n'; continue; }
  if (l.includes('|')) { salida += (enTabla ? '' : '\n') + l + '\n'; enTabla = true; continue; }
  if (enTabla) { salida += '\n'; enTabla = false; }
  salida += l + '\n';
}

fs.writeFileSync('informe.txt', salida, 'utf8');
console.log('lineas: ' + lineas.length + ' | caracteres: ' + salida.length);
console.log('--- primeras 60 lineas ---');
console.log(salida.split('\n').slice(0, 60).join('\n'));