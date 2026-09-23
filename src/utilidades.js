import { supabase } from './supabaseClient';

export const safeString = (val) => (val === null || val === undefined) ? '' : String(val);

export const safeNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  const parsed = Number(val);
  return isNaN(parsed) ? 0 : parsed;
};

export const calcularCerca = (esfera, adicion) => {
  if (!esfera && !adicion) return '';
  const val = safeNum(esfera) + safeNum(adicion);
  return (val > 0 ? '+' : '') + val.toFixed(2);
};

export const comprimirImagen = (archivo) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(archivo);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 500; const MAX_HEIGHT = 500;
        let width = img.width; let height = img.height;
        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          resolve(new File([blob], archivo.name, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.7); 
      };
    };
  });
};

export const calcularEdad = (fechaNacimiento) => {
  try {
    if (!fechaNacimiento) return '';
    const hoyDate = new Date();
    const cumpleanos = new Date(fechaNacimiento);
    if (isNaN(cumpleanos.getTime())) return '';
    let edad = hoyDate.getFullYear() - cumpleanos.getFullYear();
    const m = hoyDate.getMonth() - cumpleanos.getMonth();
    if (m < 0 || (m === 0 && hoyDate.getDate() < cumpleanos.getDate())) { edad--; }
    return edad;
  } catch(e) { return ''; }
};

export const calcularTiempoTranscurrido = (fecha) => {
  try {
    if (!fecha) return '';
    const partesFecha = fecha.split('-');
    if (partesFecha.length !== 3) return '';
    const inicio = new Date(partesFecha[0], partesFecha[1] - 1, partesFecha[2]);
    const hoyTemp = new Date();
    const fin = new Date(hoyTemp.getFullYear(), hoyTemp.getMonth(), hoyTemp.getDate());
    if (inicio.getTime() === fin.getTime()) return 'Hoy';
    if (inicio > fin) return '0 días';
    let anios = fin.getFullYear() - inicio.getFullYear();
    let meses = fin.getMonth() - inicio.getMonth();
    let dias = fin.getDate() - inicio.getDate();
    if (dias < 0) { meses--; dias += new Date(fin.getFullYear(), fin.getMonth(), 0).getDate(); }
    if (meses < 0) { anios--; meses += 12; }
    let partes = [];
    if (anios > 0) partes.push(`${anios} año${anios > 1 ? 's' : ''}`);
    if (meses > 0) partes.push(`${meses} mes${meses > 1 ? 'es' : ''}`);
    if (dias > 0) partes.push(`${dias} día${dias > 1 ? 's' : ''}`);
    return partes.length === 0 ? 'Hoy' : 'hace ' + partes.join(', ');
  } catch(e) { return ''; }
};

export const generarDiagnosticos = (item) => {
  try {
    let diag = [];
    const esfOd = safeNum(item?.esfera_od); const cilOd = safeNum(item?.cilindro_od); const addOd = safeNum(item?.adicion_od);
    const esfOi = safeNum(item?.esfera_oi); const cilOi = safeNum(item?.cilindro_oi); const addOi = safeNum(item?.adicion_oi);
    if (esfOd < 0 || esfOi < 0) diag.push("Miopía (H52.1)");
    if (esfOd > 0 || esfOi > 0) diag.push("Hipermetropía (H52.0)");
    if (cilOd !== 0 || cilOi !== 0) diag.push("Astigmatismo (H52.2)");
    if (addOd > 0 || addOi > 0) diag.push("Presbicia (H52.4)");
    return [...new Set(diag)];
  } catch(e) { return []; }
};

export const descargarCSV = (datos, nombreArchivo) => {
  if (!datos || datos.length === 0) return alert("No hay datos para exportar.");
  const cabeceras = Object.keys(datos[0]);
  const filas = datos.map(fila => {
    return cabeceras.map(cab => {
      let valor = fila[cab] === null || fila[cab] === undefined ? '' : String(fila[cab]);
      valor = valor.replace(/"/g, '""'); 
      return `"${valor}"`;
    }).join(';');
  });
  const contenido = [cabeceras.join(';'), ...filas].join('\n');
  const blob = new Blob(['\uFEFF' + contenido], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${nombreArchivo}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const buscarPacientesEnSupabase = async (textoBusqueda) => {
  try {
    if (!textoBusqueda || textoBusqueda.trim().length < 2) return [];
    const query = textoBusqueda.trim().toUpperCase();
    const esNumero = /^\d+$/.test(query);
    const filtro = esNumero 
      ? `cedula.ilike.${query}%,nombre.ilike.%${query}%` 
      : `nombre.ilike.%${query}%,cedula.ilike.${query}%`;

    const { data, error } = await supabase
      .from('vista_pacientes')
      .select('*')
      .or(filtro)
      .order('fecha', { ascending: false })
      .limit(20); 

    if (error) throw error;
    
    // Aquí burlamos el caché para traer Alias y Comprobantes en las búsquedas
    let resultados = data || [];
    const idsPedidos = resultados.map(d => d.pedido_id).filter(id => id);
    const idsPacientes = resultados.map(d => d.paciente_id).filter(id => id);
    
    let comprobantes = [];
    let perfiles = [];

    if (idsPedidos.length > 0) {
       const { data: c } = await supabase.from('pedidos_ventas').select('id, comprobante_url').in('id', idsPedidos);
       comprobantes = c || [];
    }
    if (idsPacientes.length > 0) {
       const { data: p } = await supabase.from('pacientes_perfil').select('id, alias').in('id', idsPacientes);
       perfiles = p || [];
    }
    
    if (idsPedidos.length > 0 || idsPacientes.length > 0) {
       resultados = resultados.map(item => {
          const comp = comprobantes?.find(c => c.id === item.pedido_id);
          const perf = perfiles?.find(p => p.id === item.paciente_id);
          return { 
              ...item, 
              comprobante_url: comp && comp.comprobante_url ? comp.comprobante_url : item.comprobante_url,
              alias: perf && perf.alias ? perf.alias : item.alias
          };
       });
    }
    
    return resultados;
  } catch (err) {
    console.error("Error buscando en Supabase:", err);
    return [];
  }
};