import { useState } from 'react'
import { safeString, safeNum, comprimirImagen } from './utilidades'
import { supabase } from './supabaseClient'
import { createUuid as generarId } from './localDb'
import { cambiarEstadoVentaLocal, registrarPagoLocal } from './localRepository'
import { calcularTotal, calcularSaldo } from './reglas'

export default function PedidosLista({
  crearVentaDirecta, busqueda, setBusqueda, pedidosFiltrados,
  imprimirRecibo, imprimirOrdenTrabajo, cancelarPedido, abrirPedido,
    refrescarDatos
}) {

  const [abonosRapidos, setAbonosRapidos] = useState({});
  const [formasPagoRapidas, setFormasPagoRapidas] = useState({});
  const [comprobantesRapidos, setComprobantesRapidos] = useState({});
  const [subiendoId, setSubiendoId] = useState(null);
  const [procesandoCobroId, setProcesandoCobroId] = useState(null);
  const [clavesPago, setClavesPago] = useState({});
  
  // NUEVO: Estado para controlar qué pestaña estamos viendo
  const [filtroTab, setFiltroTab] = useState('Activos');

  const manejarCambioAbono = (id, valor) => setAbonosRapidos(prev => ({ ...prev, [id]: valor }));
  const manejarCambioFormaPago = (id, valor) => setFormasPagoRapidas(prev => ({ ...prev, [id]: valor }));
  const manejarCambioArchivo = (id, archivo) => setComprobantesRapidos(prev => ({ ...prev, [id]: archivo }));

  const cambiarEstadoRapido = async (item, nuevoEstado) => {
    if (!item.pedido_id) return alert('Este registro todavía no tiene una venta local.');
    try {
      await cambiarEstadoVentaLocal({ saleId: item.pedido_id, estado: nuevoEstado });
      await refrescarDatos({ sync: false });
    } catch (err) {
      alert('Error actualizando estado: ' + err.message);
    }
  }

  const ejecutarCobro = async (item) => {
    const monto = safeNum(abonosRapidos[item.id]);
    if (monto <= 0) return alert('Por favor, ingrese un monto válido mayor a 0.');
    if (Math.abs(monto * 100 - Math.round(monto * 100)) > 0.000001) {
      return alert('El monto debe tener como máximo dos decimales.');
    }
    if (!item.pedido_id) return alert('Este registro todavía no tiene una venta local.');
    if (procesandoCobroId === item.id) return;

    const formaPago = formasPagoRapidas[item.id] || 'Efectivo';
    let urlComprobanteFinal = item.comprobante_url || '';
    setProcesandoCobroId(item.id);

    try {
      const archivoFoto = comprobantesRapidos[item.id];
      if (formaPago === 'Transferencia' && archivoFoto && navigator.onLine) {
        try {
          setSubiendoId(item.id);
          const archivoComprimido = await comprimirImagen(archivoFoto);
          const nombreArchivo = `comprobante_${Date.now()}_${archivoFoto.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
          const { data, error } = await supabase.storage.from('comprobantes_pagos').upload(nombreArchivo, archivoComprimido);
          if (error) throw error;
          const { data: urlData } = supabase.storage.from('comprobantes_pagos').getPublicUrl(data.path);
          urlComprobanteFinal = urlData.publicUrl;
        } catch (err) {
          console.error('Error subiendo comprobante:', err);
        } finally {
          setSubiendoId(null);
        }
      }

      const firmaPago = `${monto.toFixed(2)}:${formaPago}`;
      const intentoAnterior = clavesPago[item.pedido_id];
      const idEm = intentoAnterior?.firma === firmaPago ? intentoAnterior.clave : generarId();
      setClavesPago(prev => ({
        ...prev,
        [item.pedido_id]: { clave: idEm, firma: firmaPago }
      }));

      await registrarPagoLocal({
        saleId: item.pedido_id,
        amount: monto,
        method: formaPago,
        reference: null,
        receiptPath: urlComprobanteFinal || null,
        idempotencyKey: idEm
      });

      setClavesPago(prev => {
        const siguiente = { ...prev };
        delete siguiente[item.pedido_id];
        return siguiente;
      });
      setAbonosRapidos(prev => ({ ...prev, [item.id]: '' }));
      setComprobantesRapidos(prev => ({ ...prev, [item.id]: null }));
      await refrescarDatos({ sync: false });
    } catch (e) {
      // Conservar la clave evita duplicar el cobro si se reintenta la misma intención.
      alert('Error al registrar el cobro rápido: ' + e.message);
    } finally {
      setProcesandoCobroId(null);
    }
  }

  // NUEVO: Lógica para filtrar qué pedidos mostrar según la pestaña elegida
  const pedidosParaMostrar = pedidosFiltrados.filter(item => {
    if (!item) return false;
    
    const pVenta = safeNum(item.venta);
    const pFinal = calcularTotal(pVenta, item.descuento);
    const pAbono = safeNum(item.abono);
    const pSaldo = calcularSaldo(pVenta, item.descuento, pAbono);
    
    const estado = safeString(item.estado);
    if (estado === 'Anulado') return false;

    // Una fila SOLO es un pedido si tiene una venta real asociada. Antes se
    // aceptaba cualquier estado distinto de 'Ninguno', y el historial del
    // servidor asigna 'En laboratorio' por defecto a una consulta que nunca
    // teve venta: por eso guardar una clinica sola aparecia sola en Pedidos
    // con venta $0. Una consulta sin pedido_id no es un pedido.
    const tieneVenta = Boolean(safeString(item.pedido_id).trim())
      || pVenta > 0
      || safeString(item.codigo_armazon).trim() !== ''
      || safeString(item.accesorio_id).trim() !== '';
    const tienePedido = tieneVenta && estado !== 'Anulado';
    const estaPagado = pSaldo <= 0 && pFinal > 0;

    if (!tienePedido) return false;

    // Si estás buscando un paciente específico por nombre/cédula, ignoramos las pestañas y lo mostramos siempre
    if (busqueda.trim().length >= 2) return true;

    if (filtroTab === 'Activos') {
      // Muestra todos, EXCEPTO los que ya están entregados y con saldo 0
      return !(estado === 'Entregado' && estaPagado);
    }
    if (filtroTab === 'Laboratorio') return estado === 'En laboratorio';
    if (filtroTab === 'Listos') return estado === 'Listo para Entrega';
    if (filtroTab === 'Completados') return estado === 'Entregado' && estaPagado;

    return true;
  });

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-t-4 border-indigo-600">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">🛍️ Gestión de Ventas y Pedidos</h2>
        <button onClick={crearVentaDirecta} className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-2 rounded-lg font-bold shadow-md transition-colors">🛒 Nueva Venta Directa</button>
      </div>

      <div className="flex gap-3 mb-4">
        <input type="text" placeholder="🔍 Buscar paciente para generar pedido (Cédula o Nombre)..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="flex-1 p-3 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-medium" />
      </div>

      {/* --- NUEVO: BARRA DE PESTAÑAS (TABS) --- */}
      {!busqueda.trim().length && (
        <div className="flex gap-2 overflow-x-auto mb-6 pb-2 border-b border-gray-200">
          <button onClick={() => setFiltroTab('Activos')} className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors whitespace-nowrap ${filtroTab === 'Activos' ? 'bg-indigo-50 text-indigo-800 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}>
            🔥 Pendientes / Con Deuda
          </button>
          <button onClick={() => setFiltroTab('Laboratorio')} className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors whitespace-nowrap ${filtroTab === 'Laboratorio' ? 'bg-yellow-50 text-yellow-800 border-b-2 border-yellow-500' : 'text-gray-500 hover:bg-gray-50'}`}>
            🟡 En Laboratorio
          </button>
          <button onClick={() => setFiltroTab('Listos')} className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors whitespace-nowrap ${filtroTab === 'Listos' ? 'bg-blue-50 text-blue-800 border-b-2 border-blue-500' : 'text-gray-500 hover:bg-gray-50'}`}>
            🔵 Listos para Entrega
          </button>
          <button onClick={() => setFiltroTab('Completados')} className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors whitespace-nowrap ${filtroTab === 'Completados' ? 'bg-green-50 text-green-800 border-b-2 border-green-500' : 'text-gray-500 hover:bg-gray-50'}`}>
            ✅ Entregados y Pagados
          </button>
        </div>
      )}

      <div className="space-y-4">
        {pedidosParaMostrar.map(item => {
          try {
            const pVenta = safeNum(item.venta);
            const pFinal = calcularTotal(pVenta, item.descuento);
            const pAbono = safeNum(item.abono);
            const pSaldo = calcularSaldo(pVenta, item.descuento, pAbono);
            
            const estaPagado = pSaldo <= 0 && pFinal > 0;
            const metodoActual = formasPagoRapidas[item.id] || 'Efectivo';

            return (
              <div key={item.id} className={`border p-5 rounded-xl flex flex-col gap-4 shadow-sm hover:shadow-md transition-all ${estaPagado ? 'bg-green-50/30 border-green-200' : 'bg-indigo-50/10 border-indigo-100'}`}>
                
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
                  <div>
                    <h3 className="font-bold text-lg text-indigo-900">{safeString(item.nombre)}</h3>
                    <p className="text-sm text-gray-500 mb-1">Registro: {safeString(item.fecha)} | 🆔 {safeString(item.cedula)}</p>
                    <div className="flex gap-2 items-center flex-wrap mt-1">
                      
                      <select 
                        value={safeString(item.estado) || 'Ninguno'} 
                        onChange={(e) => cambiarEstadoRapido(item, e.target.value)}
                        className={`px-3 py-1 rounded-full text-xs font-bold uppercase cursor-pointer outline-none border shadow-sm transition-colors ${
                          item.estado === 'Entregado' ? 'bg-green-100 text-green-800 border-green-300' : 
                          item.estado === 'Listo para Entrega' ? 'bg-blue-100 text-blue-800 border-blue-300' : 
                          item.estado === 'En laboratorio' ? 'bg-yellow-100 text-yellow-800 border-yellow-300' :
                          'bg-gray-100 text-gray-700 border-gray-300'
                        }`}
                      >
                        <option value="Ninguno">Ninguno</option>
                        <option value="En laboratorio">🟡 En Laboratorio</option>
                        <option value="Listo para Entrega">🔵 Listo para Entrega</option>
                        <option value="Entregado">🟢 Entregado</option>
                      </select>

                      {item.comprobante_url && (
                        <a href={item.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-xs bg-indigo-50 text-indigo-700 font-bold px-3 py-1 rounded-full border border-indigo-200 hover:bg-indigo-100 flex items-center gap-1 shadow-sm">
                          👁️ Ver Comprobante Guardado
                        </a>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex gap-2 flex-wrap justify-end">
                    <button onClick={() => imprimirRecibo(item)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors">🧾 Recibo</button>
                    <button onClick={() => imprimirOrdenTrabajo(item)} className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-sm font-bold shadow-sm hover:bg-gray-900 transition-colors">🖨️ Orden Lab</button>
                    <button onClick={() => cancelarPedido(item)} className="bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-sm font-bold shadow-sm hover:bg-red-50 transition-colors">🗑️ Cancelar</button>
                    <button onClick={() => abrirPedido(item)} className="bg-indigo-600 text-white px-5 py-1.5 rounded-lg text-sm font-bold shadow hover:bg-indigo-700 transition-colors">✏️ Ver Detalle / Editar</button>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-lg border border-gray-200 flex flex-col xl:flex-row justify-between items-center gap-4">
                  <div className="flex gap-6 w-full xl:w-auto">
                    <div>
                      <p className="text-xs text-gray-500 font-bold uppercase mb-1">Costo Total</p>
                      <p className="text-lg font-bold text-gray-800">${pFinal.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 font-bold uppercase mb-1">Abonado</p>
                      <p className="text-lg font-bold text-green-600">${pAbono.toFixed(2)}</p>
                    </div>
                    <div className="pl-6 border-l border-gray-200">
                      <p className="text-xs text-gray-500 font-bold uppercase mb-1">Saldo Pendiente</p>
                      <p className={`text-xl font-black ${pSaldo > 0 ? 'text-red-500' : 'text-gray-400'}`}>${Math.max(0, pSaldo).toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="w-full xl:w-auto flex justify-end">
                    {estaPagado ? (
                      <div className="bg-green-100 text-green-800 px-6 py-2 rounded-lg font-black text-sm uppercase flex items-center gap-2 border border-green-200 shadow-sm">
                        ✅ Pago Completado
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 bg-gray-50 p-2.5 rounded-lg border">
                        <span className="text-xs font-bold text-gray-500">ABONAR:</span>
                        <span className="text-gray-500 font-bold">$</span>
                        <input 
                          type="number" 
                          placeholder="Monto" 
                          value={abonosRapidos[item.id] || ''} 
                          onChange={(e) => manejarCambioAbono(item.id, e.target.value)}
                          className="w-20 p-1.5 border rounded outline-none text-sm text-center font-bold bg-white"
                        />
                        <select 
                          value={metodoActual} 
                          onChange={(e) => manejarCambioFormaPago(item.id, e.target.value)}
                          className="p-1.5 border rounded outline-none text-xs bg-white font-medium cursor-pointer"
                        >
                          <option value="Efectivo">Efectivo</option>
                          <option value="Transferencia">Transferencia</option>
                          <option value="Tarjeta">Tarjeta</option>
                        </select>

                        {metodoActual === 'Transferencia' && (
                          <input 
                            type="file" 
                            accept="image/*" 
                            onChange={(e) => manejarCambioArchivo(item.id, e.target.files[0])} 
                            className="text-[10px] text-gray-500 w-44 cursor-pointer file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700" 
                            title="Adjuntar comprobante"
                          />
                        )}

                        <button
                          onClick={() => ejecutarCobro(item)}
                          disabled={procesandoCobroId === item.id}
                          className="bg-green-500 text-white px-4 py-1.5 rounded font-bold text-sm hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-sm transition-colors whitespace-nowrap"
                        >
                          {procesandoCobroId === item.id
                            ? (subiendoId === item.id ? 'Subiendo...' : 'Procesando...')
                            : 'Cobrar'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )
          } catch {
            return <div key={`error-${item.id}`} className="bg-red-50 p-4 rounded-xl text-red-600 font-bold border border-red-200">Error visual.</div>
          }
        })}
        {pedidosParaMostrar.length === 0 && (
          <div className="text-center bg-white p-10 rounded-xl border border-dashed border-gray-300">
            <p className="text-gray-500 font-bold text-lg mb-2">No hay pedidos en esta sección.</p>
            <p className="text-gray-400 text-sm">Cambia de pestaña o utiliza el buscador superior.</p>
          </div>
        )}
      </div>
    </div>
  )
}