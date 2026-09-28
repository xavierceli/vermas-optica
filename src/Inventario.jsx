import { useState, useEffect } from 'react';
import { safeString, safeNum } from './utilidades';
import { resolverUrlImagenInventario } from './imagenesInventario';
import { imprimirEtiqueta } from './impresiones';

export default function Inventario({
  inventario, nuevoItemInv, editandoInvId, cargandoImagen,
  manejarCambioInv, setImagenSeleccionada, guardarItemInventario,
  cancelarEdicionInventario, cargarParaEditarInventario, eliminarItemInventario
}) {
  const [busqueda, setBusqueda] = useState('');
  const [imagenAmpliada, setImagenAmpliada] = useState(null);
  // URLs firmadas: el bucket es privado, asi que la ruta guardada NO se puede
  // usar tal cual en un <img>. Se firma en el dispositivo y se cachea 1 hora.
  const [urlsImagenes, setUrlsImagenes] = useState({});
  // Si una imagen firmada aun asi no carga (archivo que ya no esta en el bucket,
  // red que se cae a mitad...), se marca como fallida: antes se dejaba el <img>
  // con una URL muerta y el navegador pintaba su texto alternativo "Foto de ...".
  const [imagenesFallidas, setImagenesFallidas] = useState({});

  useEffect(() => {
    const conFoto = (inventario || []).filter(item => item && item.imagen_url);
    if (conFoto.length === 0) return;
    let vigente = true;
    void Promise.all(conFoto.map(async item => {
      if (urlsImagenes[item.id]) return null;
      const url = await resolverUrlImagenInventario(item.imagen_url);
      return url ? [item.id, url] : null;
    })).then(resultados => {
      if (!vigente) return;
      const nuevos = {};
      for (const par of resultados) if (par) nuevos[par[0]] = par[1];
      if (Object.keys(nuevos).length > 0) setUrlsImagenes(prev => ({ ...prev, ...nuevos }));
    });
    return () => { vigente = false; };
  }, [inventario, urlsImagenes]);

  // El <img> NUNCA debe usar el valor crudo de imagen_url: con el bucket privado
  // una URL publica antigua responde 400, y una ruta suelta ni siquiera es una
  // URL. Solo se muestra la URL firmada que se resolvio arriba.
  const fotoDe = item => {
    if (!item || !item.imagen_url || imagenesFallidas[item.id]) return null;
    return urlsImagenes[item.id] || null;
  };

  const itemsFiltrados = (inventario || []).filter(item => {
    if (!item) return false;
    const term = busqueda.toLowerCase();
    return safeString(item.codigo).toLowerCase().includes(term) ||
           safeString(item.tipo_armazon).toLowerCase().includes(term) ||
           safeString(item.nombre_accesorio).toLowerCase().includes(term) ||
           safeString(item.descripcion).toLowerCase().includes(term);
  });

  // --- NUEVO: CÁLCULOS ESTADÍSTICOS DEL INVENTARIO ---
  const modelosArmazones = (inventario || []).filter(i => safeString(i.categoria) === 'Armazon');
  const totalModelosArmazones = modelosArmazones.length;
  const stockArmazones = modelosArmazones.reduce((acc, curr) => acc + safeNum(curr.stock), 0);

  const modelosAccesorios = (inventario || []).filter(i => safeString(i.categoria) === 'Accesorio');
  const totalModelosAccesorios = modelosAccesorios.length;
  const stockAccesorios = modelosAccesorios.reduce((acc, curr) => acc + safeNum(curr.stock), 0);

  const totalStockGeneral = stockArmazones + stockAccesorios;

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-t-4 border-purple-600 relative">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">👓 Gestión de Inventario</h2>
      </div>

      {/* --- NUEVO: TARJETAS DE RESUMEN DE STOCK --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-purple-50 p-4 rounded-xl border border-purple-200 flex flex-col justify-center items-center shadow-sm">
          <span className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-1">📦 Total Unidades en Stock</span>
          <span className="text-4xl font-black text-purple-900">{totalStockGeneral}</span>
        </div>
        
        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex flex-col justify-center items-center shadow-sm">
          <span className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">👓 Armazones</span>
          <span className="text-2xl font-black text-blue-900">{stockArmazones} <span className="text-sm font-bold text-blue-600">unid.</span></span>
          <span className="text-xs text-blue-500 font-medium mt-1">Repartidos en {totalModelosArmazones} modelos</span>
        </div>
        
        <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 flex flex-col justify-center items-center shadow-sm">
          <span className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">👜 Accesorios / Varios</span>
          <span className="text-2xl font-black text-amber-900">{stockAccesorios} <span className="text-sm font-bold text-amber-600">unid.</span></span>
          <span className="text-xs text-amber-500 font-medium mt-1">Repartidos en {totalModelosAccesorios} tipos</span>
        </div>
      </div>

      {/* FORMULARIO DE INGRESO */}
      <div className="bg-purple-50 p-6 rounded-xl border border-purple-100 mb-8">
        <h3 className="font-bold text-purple-800 mb-4">{editandoInvId ? '✏️ Editando Producto' : '➕ Ingresar Nuevo Producto'}</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Categoría</label>
            <select name="categoria" aria-label="Categoria del producto" value={safeString(nuevoItemInv.categoria)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm font-bold text-purple-800">
              <option value="Armazon">Armazón</option>
              <option value="Accesorio">Accesorio / Varios</option>
            </select>
          </div>
          
          {nuevoItemInv.categoria === 'Armazon' ? (
            <>
              <div><label className="block text-xs font-bold text-gray-700 mb-1">Código / Referencia</label><input name="codigo" aria-label="Codigo del producto" value={safeString(nuevoItemInv.codigo)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm uppercase font-bold" placeholder="Ej: MIRAFLEX 4017" /></div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Tipo de Armazón</label>
                <select name="tipo_armazon" aria-label="Tipo de armazon" value={safeString(nuevoItemInv.tipo_armazon)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm">
                  <option value="">Seleccionar...</option><option value="Completo">Completo</option><option value="Semi al Aire">Semi al Aire</option><option value="Al Aire">Al Aire</option>
                </select>
              </div>
              <div><label className="block text-xs font-bold text-gray-700 mb-1">Material</label><input name="material" aria-label="Material del armazon" value={safeString(nuevoItemInv.material)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm" placeholder="Ej: TR90, Acetato..." /></div>
              
              <div className="md:col-span-2 bg-white p-3 rounded border flex flex-col mt-2">
                <span className="text-xs font-bold text-gray-500 mb-2">Parámetros y Medidas (mm):</span>
                <div className="flex flex-wrap gap-2">
                  <input name="param_horizontal" aria-label="Parametro horizontal" value={safeString(nuevoItemInv.param_horizontal)} onChange={manejarCambioInv} className="flex-1 min-w-[50px] p-1.5 border rounded text-xs text-center" placeholder="Horiz." title="Lente Horizontal"/>
                  <input name="param_puente" aria-label="Puente" value={safeString(nuevoItemInv.param_puente)} onChange={manejarCambioInv} className="flex-1 min-w-[50px] p-1.5 border rounded text-xs text-center" placeholder="Puente" title="Puente"/>
                  <input name="param_vertical" aria-label="Parametro vertical" value={safeString(nuevoItemInv.param_vertical)} onChange={manejarCambioInv} className="flex-1 min-w-[50px] p-1.5 border rounded text-xs text-center" placeholder="Verti." title="Lente Vertical"/>
                  <input name="param_diagonal" aria-label="Diametro diagonal" value={safeString(nuevoItemInv.param_diagonal)} onChange={manejarCambioInv} className="flex-1 min-w-[50px] p-1.5 border rounded text-xs text-center" placeholder="D.May" title="Diámetro Mayor"/>
                  <input name="param_frontal" aria-label="Frente" value={safeString(nuevoItemInv.param_frontal)} onChange={manejarCambioInv} className="flex-1 min-w-[60px] p-1.5 border rounded text-xs text-center bg-blue-50 focus:bg-blue-100" placeholder="Frente" title="Ancho Total Frontal"/>
                  <input name="param_varillas" aria-label="Varillas" value={safeString(nuevoItemInv.param_varillas)} onChange={manejarCambioInv} className="flex-1 min-w-[60px] p-1.5 border rounded text-xs text-center bg-blue-50 focus:bg-blue-100" placeholder="Varillas" title="Largo de Varillas (Patitas)"/>
                </div>
              </div>
              
              <div className="md:col-span-2 mt-2">
                <label className="block text-xs font-bold text-gray-700 mb-1">Descripción / Detalles</label>
                <input name="descripcion" aria-label="Descripcion del armazon" value={safeString(nuevoItemInv.descripcion)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm bg-white h-[42px]" placeholder="Ej: Negro con dorado, plaquetas silicona..." />
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2"><label className="block text-xs font-bold text-gray-700 mb-1">Nombre del Accesorio</label><input name="nombre_accesorio" aria-label="Nombre del accesorio" value={safeString(nuevoItemInv.nombre_accesorio)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm font-bold uppercase" placeholder="Ej: Estuche Rígido, Gotas..." /></div>
              <div><label className="block text-xs font-bold text-gray-700 mb-1">Característica</label><input name="caracteristica" aria-label="Caracteristica del accesorio" value={safeString(nuevoItemInv.caracteristica)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm" placeholder="Ej: Color azul, 15ml..." /></div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 border-t border-purple-200 pt-4 mt-2">
          <div><label className="block text-xs font-bold text-gray-700 mb-1">Costo Compra ($)</label><input type="number" name="costo_compra" aria-label="Costo de compra" value={safeString(nuevoItemInv.costo_compra)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm text-red-600 font-bold" /></div>
          <div><label className="block text-xs font-bold text-gray-700 mb-1">PVP Sugerido ($)</label><input type="number" name="precio" aria-label="Precio de venta" value={safeString(nuevoItemInv.precio)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm text-green-600 font-bold" /></div>
          <div><label className="block text-xs font-bold text-gray-700 mb-1">Unidades en Stock</label><input type="number" name="stock" aria-label="Cantidad en stock" value={safeString(nuevoItemInv.stock)} onChange={manejarCambioInv} className="w-full p-2 border rounded outline-none text-sm font-bold" /></div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Fotografía (Opcional)</label>
            <input type="file" accept="image/*" aria-label="Seleccionar foto del producto" onChange={(e) => setImagenSeleccionada(e.target.files[0])} className="w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-purple-100 file:text-purple-700 hover:file:bg-purple-200" />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          {editandoInvId && <button onClick={cancelarEdicionInventario} className="px-4 py-2 bg-gray-400 text-white rounded font-bold">Cancelar</button>}
          <button onClick={guardarItemInventario} disabled={cargandoImagen} className={`px-8 py-2 rounded font-bold text-white shadow-md ${cargandoImagen ? 'bg-gray-400' : 'bg-purple-600 hover:bg-purple-700'}`}>
            {cargandoImagen ? 'Subiendo Imagen...' : 'Guardar Producto'}
          </button>
        </div>
      </div>

      <input type="text" aria-label="Buscar producto por codigo, tipo, detalle o nombre" placeholder="🔍 Buscar por código, tipo, detalle o nombre..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="w-full p-3 mb-4 border rounded-lg outline-none focus:ring-2 focus:ring-purple-500 shadow-sm" />
      
      <div className="overflow-x-auto border rounded-lg shadow-sm">
        <table className="w-full text-left text-sm bg-white">
          <thead className="bg-purple-50 text-purple-900 border-b">
            <tr>
              <th className="p-3">Img</th>
              <th className="p-3">Categoría</th>
              <th className="p-3">Detalle / Modelo</th>
              <th className="p-3 text-center">Stock</th>
              <th className="p-3">PVP</th>
              <th className="p-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {itemsFiltrados.map(item => (
              <tr key={item.id} className="border-b hover:bg-gray-50">
                <td className="p-3 w-16">
                  {fotoDe(item) ? (
                    <img 
                      src={fotoDe(item)} 
                      alt={`Foto de ${safeString(item.nombre_accesorio) || safeString(item.codigo) || 'producto'}`} 
                      className="w-10 h-10 object-cover rounded shadow-sm border cursor-pointer hover:opacity-80 transition-opacity" 
                      onClick={() => setImagenAmpliada(fotoDe(item))}
                      onError={() => setImagenesFallidas(prev => (prev[item.id] ? prev : { ...prev, [item.id]: true }))}
                      title="Clic para agrandar"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-[10px] border text-center leading-tight px-0.5"
                         title={item.imagen_url ? 'La foto no se pudo cargar' : 'Este producto no tiene foto'}>
                      {item.imagen_url ? '⚠ No carga' : 'Sin foto'}
                    </div>
                  )}
                </td>
                <td className="p-3 font-bold text-gray-600">
                  {safeString(item.categoria) === 'Armazon' ? '👓 Armazón' : '📦 Accesorio'}
                </td>
                <td className="p-3">
                  {safeString(item.categoria) === 'Armazon' ? (
                    <>
                      <div className="font-bold text-purple-900">{safeString(item.codigo)}</div>
                      <div className="text-xs text-gray-500">{safeString(item.tipo_armazon)} - {safeString(item.material)}</div>
                      {item.param_frontal && <div className="text-[10px] text-gray-400 mt-0.5">Frente: {item.param_frontal}mm | Varillas: {item.param_varillas}mm</div>}
                      {item.descripcion && <div className="text-xs text-gray-400 italic mt-0.5">📝 {safeString(item.descripcion)}</div>}
                    </>
                  ) : (
                    <>
                      <div className="font-bold text-purple-900">{safeString(item.nombre_accesorio)}</div>
                      <div className="text-xs text-gray-500">{safeString(item.caracteristica)}</div>
                    </>
                  )}
                </td>
                <td className="p-3 text-center">
                  <span className={`px-2 py-1 rounded font-bold text-xs ${safeNum(item.stock) <= 2 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{safeNum(item.stock)}</span>
                </td>
                <td className="p-3 font-bold text-green-600">${safeNum(item.precio).toFixed(2)}</td>
                <td className="p-3 text-center space-x-2">
                  {safeString(item.categoria) === 'Armazon' && (
                    <button onClick={() => imprimirEtiqueta(item)} className="bg-gray-800 text-white px-3 py-1 rounded text-xs font-bold hover:bg-gray-900 transition-colors" title="Imprimir Etiqueta Mariposa">🖨️ Etiqueta</button>
                  )}
                  <button onClick={() => cargarParaEditarInventario(item)} className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-xs font-bold hover:bg-blue-200">Editar</button>
                  <button onClick={() => eliminarItemInventario(item.id)} className="bg-red-100 text-red-700 px-3 py-1 rounded text-xs font-bold hover:bg-red-200">Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {itemsFiltrados.length === 0 && <div className="p-8 text-center text-gray-500">No hay productos que coincidan con la búsqueda.</div>}
      </div>

      {imagenAmpliada && (
        <div 
          className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm cursor-pointer" 
          onClick={() => setImagenAmpliada(null)}
        >
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <button
              className="absolute -top-12 right-0 text-white font-bold text-xl hover:text-red-400 bg-black/50 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
              onClick={() => setImagenAmpliada(null)}
              aria-label="Cerrar imagen ampliada"
            >
              <span aria-hidden="true">✖</span>
            </button>
            <img 
              src={imagenAmpliada}
              onError={() => setImagenAmpliada(null)} 
              alt="Imagen ampliada del producto" 
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl border-4 border-white/20 bg-white" 
            />
          </div>
        </div>
      )}
    </div>
  );
}