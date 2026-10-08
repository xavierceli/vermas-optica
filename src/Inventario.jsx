import { useState, useEffect, useRef } from 'react';
import { safeString, safeNum } from './utilidades';
import { resolverUrlImagenInventario } from './imagenesInventario';
import { imprimirEtiqueta } from './impresiones';
import { imprimirEtiquetaD30 } from './d30Printer';

export default function Inventario({
  inventario = [], nuevoItemInv, editandoInvId, cargandoImagen,
  manejarCambioInv, setImagenSeleccionada, guardarItemInventario,
  cancelarEdicionInventario, cargarParaEditarInventario, eliminarItemInventario
}) {
  const [busqueda, setBusqueda] = useState('');
  const [imagenAmpliada, setImagenAmpliada] = useState(null);
  const [urlsImagenes, setUrlsImagenes] = useState({});
  const [imagenesFallidas, setImagenesFallidas] = useState({});
  const [imprimiendoD30Id, setImprimiendoD30Id] = useState(null);
  const firmasProcesadas = useRef(new Set());
  const inputFotoRef = useRef(null);

  // Cierre de imagen ampliada con tecla Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && imagenAmpliada) {
        setImagenAmpliada(null);
      }
    };
    if (imagenAmpliada) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [imagenAmpliada]);

  // Resolución controlada de URLs de Storage sin bucles de re-render
  useEffect(() => {
    const conFoto = (inventario || []).filter(item => {
      if (!item?.id || !item?.imagen_url) return false;
      const firma = `${item.id}:${item.imagen_url}`;
      return !firmasProcesadas.current.has(firma);
    });

    if (conFoto.length === 0) return;

    let vigente = true;
    conFoto.forEach(item => firmasProcesadas.current.add(`${item.id}:${item.imagen_url}`));

    void Promise.all(conFoto.map(async item => {
      const url = await resolverUrlImagenInventario(item.imagen_url);
      return url ? [item.id, url] : null;
    })).then(resultados => {
      if (!vigente) return;
      const nuevos = {};
      for (const par of resultados) {
        if (par) nuevos[par[0]] = par[1];
      }
      if (Object.keys(nuevos).length > 0) {
        setUrlsImagenes(prev => ({ ...prev, ...nuevos }));
      }
    });

    return () => { vigente = false; };
  }, [inventario]);

  const fotoDe = item => {
    if (!item || !item.imagen_url || imagenesFallidas[item.id]) return null;
    return urlsImagenes[item.id] || null;
  };

  const handleCancelarEdicion = () => {
    if (inputFotoRef.current) inputFotoRef.current.value = '';
    cancelarEdicionInventario();
  };

  const handleGuardar = async () => {
    await guardarItemInventario();
    if (inputFotoRef.current) inputFotoRef.current.value = '';
  };

  const handleImprimirD30 = async (item) => {
    if (imprimiendoD30Id === item.id) return;
    setImprimiendoD30Id(item.id);
    try {
      await imprimirEtiquetaD30({
        codigo: item.codigo || 'S/C',
        precio: safeNum(item.precio)
      });
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        alert('Error con impresora D30: ' + (err.message || err));
      }
    } finally {
      setImprimiendoD30Id(null);
    }
  };

  const itemsFiltrados = (inventario || []).filter(item => {
    if (!item) return false;
    const term = busqueda.toLowerCase();
    return safeString(item.codigo).toLowerCase().includes(term) ||
           safeString(item.tipo_armazon).toLowerCase().includes(term) ||
           safeString(item.nombre_accesorio).toLowerCase().includes(term) ||
           safeString(item.descripcion).toLowerCase().includes(term);
  });

  const modelosArmazones = (inventario || []).filter(i => safeString(i?.categoria) === 'Armazon');
  const totalModelosArmazones = modelosArmazones.length;
  const stockArmazones = modelosArmazones.reduce((acc, curr) => acc + safeNum(curr?.stock), 0);

  const modelosAccesorios = (inventario || []).filter(i => safeString(i?.categoria) === 'Accesorio');
  const totalModelosAccesorios = modelosAccesorios.length;
  const stockAccesorios = modelosAccesorios.reduce((acc, curr) => acc + safeNum(curr?.stock), 0);

  const totalStockGeneral = stockArmazones + stockAccesorios;

  return (
    <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 border-t-4 border-purple-600 relative">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">👓 Gestión de Inventario</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-purple-50 p-4 rounded-xl border border-purple-200 flex flex-col justify-center items-center shadow-sm">
          <span className="text-xs font-bold text-purple-700 uppercase tracking-wider mb-1">📦 Total Unidades en Stock</span>
          <span className="text-3xl sm:text-4xl font-black text-purple-900">{totalStockGeneral}</span>
        </div>
        
        <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 flex flex-col justify-center items-center shadow-sm">
          <span className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-1">👓 Armazones</span>
          <span className="text-xl sm:text-2xl font-black text-blue-900">{stockArmazones} <span className="text-xs sm:text-sm font-bold text-blue-700">unid.</span></span>
          <span className="text-xs text-blue-800 font-semibold mt-1">Repartidos en {totalModelosArmazones} modelos</span>
        </div>
        
        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex flex-col justify-center items-center shadow-sm">
          <span className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-1">👜 Accesorios / Varios</span>
          <span className="text-xl sm:text-2xl font-black text-amber-950">{stockAccesorios} <span className="text-xs sm:text-sm font-bold text-amber-800">unid.</span></span>
          <span className="text-xs text-amber-900 font-semibold mt-1">Repartidos en {totalModelosAccesorios} tipos</span>
        </div>
      </div>

      <div className="bg-purple-50/70 p-4 sm:p-6 rounded-xl border border-purple-200 mb-6 sm:mb-8">
        <h3 className="font-bold text-purple-900 text-base sm:text-lg mb-4">{editandoInvId ? '✏️ Editando Producto' : '➕ Ingresar Nuevo Producto'}</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label htmlFor="inv-categoria" className="block text-xs font-bold text-gray-800 mb-1">Categoría</label>
            <select id="inv-categoria" name="categoria" aria-label="Categoría del producto" value={safeString(nuevoItemInv.categoria)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm font-bold text-purple-900 bg-white">
              <option value="Armazon">Armazón</option>
              <option value="Accesorio">Accesorio / Varios</option>
            </select>
          </div>
          
          {nuevoItemInv.categoria === 'Armazon' ? (
            <>
              <div>
                <label htmlFor="inv-codigo" className="block text-xs font-bold text-gray-800 mb-1">Código / Referencia</label>
                <input id="inv-codigo" name="codigo" aria-label="Código del producto" value={safeString(nuevoItemInv.codigo)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm uppercase font-bold text-gray-900 bg-white" placeholder="Ej: MIRAFLEX 4017" />
              </div>
              <div>
                <label htmlFor="inv-tipo-armazon" className="block text-xs font-bold text-gray-800 mb-1">Tipo de Armazón</label>
                <select id="inv-tipo-armazon" name="tipo_armazon" aria-label="Tipo de armazón" value={safeString(nuevoItemInv.tipo_armazon)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm text-gray-900 bg-white">
                  <option value="">Seleccionar...</option>
                  <option value="Completo">Completo</option>
                  <option value="Semi al Aire">Semi al Aire</option>
                  <option value="Al Aire">Al Aire</option>
                </select>
              </div>
              <div>
                <label htmlFor="inv-material" className="block text-xs font-bold text-gray-800 mb-1">Material</label>
                <input id="inv-material" name="material" aria-label="Material del armazón" value={safeString(nuevoItemInv.material)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm text-gray-900 bg-white" placeholder="Ej: TR90, Acetato..." />
              </div>
              
              <div className="md:col-span-2 bg-white p-3 rounded-lg border border-purple-200 flex flex-col mt-1">
                <span className="text-xs font-bold text-gray-700 mb-2">Parámetros y Medidas (mm):</span>
                <div className="flex flex-wrap gap-2">
                  <input name="param_horizontal" aria-label="Parámetro horizontal" value={safeString(nuevoItemInv.param_horizontal)} onChange={manejarCambioInv} className="flex-1 min-w-[55px] p-1.5 border border-gray-300 rounded text-xs text-center text-gray-900 font-semibold" placeholder="Horiz." title="Lente Horizontal"/>
                  <input name="param_puente" aria-label="Puente" value={safeString(nuevoItemInv.param_puente)} onChange={manejarCambioInv} className="flex-1 min-w-[55px] p-1.5 border border-gray-300 rounded text-xs text-center text-gray-900 font-semibold" placeholder="Puente" title="Puente"/>
                  <input name="param_vertical" aria-label="Parámetro vertical" value={safeString(nuevoItemInv.param_vertical)} onChange={manejarCambioInv} className="flex-1 min-w-[55px] p-1.5 border border-gray-300 rounded text-xs text-center text-gray-900 font-semibold" placeholder="Verti." title="Lente Vertical"/>
                  <input name="param_diagonal" aria-label="Diámetro diagonal" value={safeString(nuevoItemInv.param_diagonal)} onChange={manejarCambioInv} className="flex-1 min-w-[55px] p-1.5 border border-gray-300 rounded text-xs text-center text-gray-900 font-semibold" placeholder="D.May" title="Diámetro Mayor"/>
                  <input name="param_frontal" aria-label="Frente" value={safeString(nuevoItemInv.param_frontal)} onChange={manejarCambioInv} className="flex-1 min-w-[65px] p-1.5 border border-blue-300 rounded text-xs text-center bg-blue-50/70 text-gray-900 font-bold focus:bg-blue-100" placeholder="Frente" title="Ancho Total Frontal"/>
                  <input name="param_varillas" aria-label="Varillas" value={safeString(nuevoItemInv.param_varillas)} onChange={manejarCambioInv} className="flex-1 min-w-[65px] p-1.5 border border-blue-300 rounded text-xs text-center bg-blue-50/70 text-gray-900 font-bold focus:bg-blue-100" placeholder="Varillas" title="Largo de Varillas"/>
                </div>
              </div>
              
              <div className="md:col-span-2 mt-1">
                <label htmlFor="inv-descripcion" className="block text-xs font-bold text-gray-800 mb-1">Descripción / Detalles</label>
                <input id="inv-descripcion" name="descripcion" aria-label="Descripción del armazón" value={safeString(nuevoItemInv.descripcion)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm bg-white text-gray-900 h-[42px]" placeholder="Ej: Negro con dorado, plaquetas silicona..." />
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2">
                <label htmlFor="inv-nombre-accesorio" className="block text-xs font-bold text-gray-800 mb-1">Nombre del Accesorio</label>
                <input id="inv-nombre-accesorio" name="nombre_accesorio" aria-label="Nombre del accesorio" value={safeString(nuevoItemInv.nombre_accesorio)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm font-bold uppercase text-gray-900 bg-white" placeholder="Ej: Estuche Rígido, Gotas..." />
              </div>
              <div>
                <label htmlFor="inv-caracteristica" className="block text-xs font-bold text-gray-800 mb-1">Característica</label>
                <input id="inv-caracteristica" name="caracteristica" aria-label="Característica del accesorio" value={safeString(nuevoItemInv.caracteristica)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm text-gray-900 bg-white" placeholder="Ej: Color azul, 15ml..." />
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 border-t border-purple-200 pt-4 mt-2">
          <div>
            <label htmlFor="inv-costo" className="block text-xs font-bold text-gray-800 mb-1">Costo Compra ($)</label>
            <input id="inv-costo" type="number" step="0.01" name="costo_compra" aria-label="Costo de compra" value={safeString(nuevoItemInv.costo_compra)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm text-red-700 font-bold bg-white" />
          </div>
          <div>
            <label htmlFor="inv-precio" className="block text-xs font-bold text-gray-800 mb-1">PVP Sugerido ($)</label>
            <input id="inv-precio" type="number" step="0.01" name="precio" aria-label="Precio de venta" value={safeString(nuevoItemInv.precio)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm text-green-700 font-bold bg-white" />
          </div>
          <div>
            <label htmlFor="inv-stock" className="block text-xs font-bold text-gray-800 mb-1">Unidades en Stock</label>
            <input id="inv-stock" type="number" name="stock" aria-label="Cantidad en stock" value={safeString(nuevoItemInv.stock)} onChange={manejarCambioInv} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-sm font-bold text-gray-900 bg-white" />
          </div>
          <div>
            <label htmlFor="inv-foto" className="block text-xs font-bold text-gray-800 mb-1">Fotografía (Opcional)</label>
            <input id="inv-foto" ref={inputFotoRef} type="file" accept="image/*" aria-label="Seleccionar foto del producto" onChange={(e) => setImagenSeleccionada(e.target.files[0] || null)} className="w-full text-xs text-gray-700 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-purple-200 file:text-purple-900 hover:file:bg-purple-300" />
          </div>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row justify-end gap-3">
          {editandoInvId && (
            <button type="button" onClick={handleCancelarEdicion} className="px-5 py-2.5 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-bold transition-colors">
              Cancelar
            </button>
          )}
          <button type="button" onClick={handleGuardar} disabled={cargandoImagen} className={`px-8 py-2.5 rounded-lg font-bold text-white shadow-md transition-all ${cargandoImagen ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 active:scale-95'}`}>
            {cargandoImagen ? 'Guardando Producto...' : 'Guardar Producto'}
          </button>
        </div>
      </div>

      <input 
        type="text" 
        aria-label="Buscar producto por código, tipo, detalle o nombre" 
        placeholder="🔍 Buscar por código, tipo, detalle o nombre..." 
        value={busqueda} 
        onChange={(e) => setBusqueda(e.target.value)} 
        className="w-full p-3 mb-4 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-purple-500 shadow-sm text-sm font-medium text-gray-900 bg-gray-50 focus:bg-white" 
      />
      
      <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
        <table className="w-full text-left text-xs sm:text-sm bg-white min-w-[680px]">
          <thead className="bg-purple-50 text-purple-950 border-b">
            <tr>
              <th className="p-3 w-16">Img</th>
              <th className="p-3">Categoría</th>
              <th className="p-3">Detalle / Modelo</th>
              <th className="p-3 text-center">Stock</th>
              <th className="p-3">PVP</th>
              <th className="p-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {itemsFiltrados.map(item => (
              <tr key={item.id} className="border-b hover:bg-gray-50 transition-colors">
                <td className="p-3 w-16">
                  {fotoDe(item) ? (
                    <img 
                      src={fotoDe(item)} 
                      alt={`Foto de ${safeString(item.nombre_accesorio) || safeString(item.codigo) || 'producto'}`} 
                      className="w-10 h-10 object-cover rounded-lg shadow-sm border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity" 
                      onClick={() => setImagenAmpliada(fotoDe(item))}
                      onError={() => setImagenesFallidas(prev => (prev[item.id] ? prev : { ...prev, [item.id]: true }))}
                      title="Clic para agrandar"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500 text-[10px] border border-gray-200 text-center leading-tight px-0.5 font-medium"
                         title={item.imagen_url ? 'La foto no se pudo cargar o está pendiente de subida' : 'Este producto no tiene foto'}>
                      {item.imagen_url ? '⏳ Local' : 'Sin foto'}
                    </div>
                  )}
                </td>
                <td className="p-3 font-bold text-gray-700">
                  {safeString(item.categoria) === 'Armazon' ? '👓 Armazón' : '📦 Accesorio'}
                </td>
                <td className="p-3">
                  {safeString(item.categoria) === 'Armazon' ? (
                    <>
                      <div className="font-black text-purple-900">{safeString(item.codigo)}</div>
                      <div className="text-xs text-gray-700 font-medium">{safeString(item.tipo_armazon)} - {safeString(item.material)}</div>
                      {item.param_frontal && <div className="text-[11px] text-gray-600 font-semibold mt-0.5">Frente: {item.param_frontal}mm | Varillas: {item.param_varillas}mm</div>}
                      {item.descripcion && <div className="text-xs text-gray-700 italic mt-0.5">📝 {safeString(item.descripcion)}</div>}
                    </>
                  ) : (
                    <>
                      <div className="font-black text-purple-900">{safeString(item.nombre_accesorio)}</div>
                      <div className="text-xs text-gray-700 font-medium">{safeString(item.caracteristica)}</div>
                    </>
                  )}
                </td>
                <td className="p-3 text-center">
                  <span className={`px-2.5 py-0.5 rounded-full font-black text-xs ${safeNum(item.stock) <= 2 ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-green-100 text-green-800 border border-green-200'}`}>
                    {safeNum(item.stock)}
                  </span>
                </td>
                <td className="p-3 font-bold text-green-700">${safeNum(item.precio).toFixed(2)}</td>
                <td className="p-3 text-center">
                  <div className="flex flex-wrap gap-1.5 justify-center items-center">
                    {safeString(item.categoria) === 'Armazon' && (
                      <>
                        <button 
                          type="button" 
                          onClick={() => handleImprimirD30(item)}
                          disabled={imprimiendoD30Id === item.id}
                          className="bg-purple-700 text-white px-2.5 py-1 rounded text-xs font-bold hover:bg-purple-800 active:scale-95 transition-all shadow-sm flex items-center gap-1 disabled:opacity-50" 
                          title="Imprimir en rotuladora Phomemo D30 vía Bluetooth"
                        >
                          {imprimiendoD30Id === item.id ? '⏳ Conectando...' : '🏷️ D30'}
                        </button>
                        <button 
                          type="button" 
                          onClick={() => imprimirEtiqueta(item)} 
                          className="bg-gray-800 text-white px-2.5 py-1 rounded text-xs font-bold hover:bg-gray-900 transition-colors shadow-sm" 
                          title="Imprimir Etiqueta Mariposa estándar"
                        >
                          🖨️ Etiqueta
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => cargarParaEditarInventario(item)} className="bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 px-2.5 py-1 rounded text-xs font-bold transition-colors shadow-sm">
                      Editar
                    </button>
                    <button type="button" onClick={() => eliminarItemInventario(item.id)} className="bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 px-2.5 py-1 rounded text-xs font-bold transition-colors shadow-sm">
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {itemsFiltrados.length === 0 && <div className="p-8 text-center text-gray-600 font-semibold">No hay productos que coincidan con la búsqueda.</div>}
      </div>

      {imagenAmpliada && (
        <div 
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-sm cursor-pointer isolate" 
          onClick={() => setImagenAmpliada(null)}
        >
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="absolute -top-12 right-0 text-white font-black text-xl hover:text-red-400 bg-black/60 w-10 h-10 rounded-full flex items-center justify-center transition-colors shadow-lg"
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