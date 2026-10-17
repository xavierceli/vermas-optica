import { supabase } from './supabaseClient';
import { construirFiltroBusqueda } from './busquedaServidor';

export const safeString = (val) => {
  if (val === null || val === undefined) return '';
  try {
    return String(val);
  } catch {
    return '';
  }
};

export const safeNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  try {
    const parsed = Number(val);
    return isNaN(parsed) ? 0 : parsed;
  } catch {
    return 0;
  }
};

export const calcularCerca = (esfera, adicion) => {
  if (!esfera && !adicion) return '';
  const val = safeNum(esfera) + safeNum(adicion);
  return (val > 0 ? '+' : '') + val.toFixed(2);
};

export const comprimirImagen = (archivo) => {
  return new Promise((resolve, reject) => {
    if (!archivo) return reject(new Error("No se proporcionó ningún archivo."));

    const reader = new FileReader();
    reader.readAsDataURL(archivo);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo de imagen."));
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onerror = () => reject(new Error("Formato de imagen no soportado."));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 500; 
          const MAX_HEIGHT = 500;
          let width = img.width; 
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) { 
              height = Math.round(height * (MAX_WIDTH / width)); 
              width = MAX_WIDTH; 
            }
          } else {
            if (height > MAX_HEIGHT) { 
              width = Math.round(width * (MAX_HEIGHT / height)); 
              height = MAX_HEIGHT; 
            }
          }

          canvas.width = width; 
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            canvas.width = 0;
            canvas.height = 0;
            if (!blob) return reject(new Error("No se pudo procesar la compresión de la imagen."));
            resolve(new File([blob], archivo.name, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.7);
        } catch (e) {
          reject(e);
        }
      };
    };
  });
};

// calcularEdad y calcularTiempoTranscurrido viven en fechas.js (modulo puro, sin
// dependencias de red) para poder probarlos con node --test. Aqui se reexportan
// para conservar la API que ya usaban las vistas.
export { calcularEdad, calcularTiempoTranscurrido } from './fechas';

// generarDiagnosticos vive ahora en historial.js (modulo puro, sin dependencias
// de red). Aqui se reexporta para conservar la API que ya usaba impresiones.js y
// no mantener dos copias de la misma logica clinica.
export { generarDiagnosticos } from './historial.js';

export const buscarPacientesEnSupabase = async (textoBusqueda, { incluirArchivados = false } = {}) => {
  try {
    // El filtro lo arma construirFiltroBusqueda: es el unico sitio por donde
    // pasa lo que escribe el usuario. Ver busquedaServidor.js para el por que.
    const filtro = construirFiltroBusqueda(textoBusqueda);
    if (filtro === null) return [];

    const { data, error } = await supabase
      .from('vista_pacientes')
      .select('*')
      .or(filtro)
      .order('fecha', { ascending: false })
      .limit(20); 

    if (error) throw error;
    
    let resultados = (data || []).filter(row => {
      if (incluirArchivados) return true;
      if (row.archived_at || row.archivada) return false;
      return safeString(row.nombre).trim().toUpperCase() !== 'CONSUMIDOR FINAL';
    });

    const idsPedidos = resultados.map(d => d.pedido_id).filter(Boolean);
    const idsPacientes = resultados.map(d => d.paciente_id).filter(Boolean);
    
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
          comprobante_url: comp?.comprobante_url || item.comprobante_url,
          alias: perf?.alias || item.alias
        };
      });
    }
    
    return resultados;
  } catch (err) {
    console.error("Error buscando en Supabase:", err);
    return [];
  }
};
