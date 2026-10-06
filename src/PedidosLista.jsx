import { useState, useMemo } from 'react';
import { safeString, safeNum, comprimirImagen } from './utilidades';
import { mostrarAviso } from './avisos';
import { validarCobroSobreVenta, validarVentaParaCambiarEstado } from './cobros';
import { supabase } from './supabaseClient';
import { createUuid as generarId } from './localDb';
import { cambiarEstadoVentaLocal, registrarPagoLocal, guardarAdjuntoLocal } from './localRepository';
import { sincronizarAhora } from './syncEngine';
import { calcularTotal, calcularSaldo } from './reglas';
import { contarSoloLocales } from './estadoSincronizacion';
import BotonComprobante from './BotonComprobante';

const formatearContador = (num) => {
  if (num > 9999) return `${(num / 1000).toFixed(1).replace('.0', '')}k`;
  if (num > 999) return '999+';
  return String(num);
};

export default function PedidosLista({
  crearVentaDirecta, busqueda, setBusqueda, pedidosFiltrados = [],
  imprimirRecibo, imprimirOrdenTrabajo, cancelarPedido, abrirPedido,
  refrescarDatos
}) {

  const [abonosRapidos, setAbonosRapidos] = useState({});
  const [formasPagoRapidas, setFormasPagoRapidas] = useState({});
  const [comprobantesRapidos, setComprobantesRapidos] = useState({});
  const [subiendoId, setSubiendoId] = useState(null);
  const [procesandoCobroId, setProcesandoCobroId] = useState(null);
  const [clavesPago, setClavesPago] = useState({});
  
  // Eliminación instantánea en el primer clic tras confirmar
  const [anulandoIds, setAnulandoIds] = useState(new Set());
  
  const [filtroTab, setFiltroTab] = useState('Activos');

  const manejarCambioAbono = (id, valor) => setAbonosRapidos(prev => ({ ...prev, [id]: valor }));
  const manejarCambioFormaPago = (id, valor) => setFormasPagoRapidas(prev => ({ ...prev, [id]: valor }));
  const manejarCambioArchivo = (id, archivo) => setComprobantesRapidos(prev => ({ ...prev, [id]: archivo }));

  const cambiarEstadoRapido = async (item, nuevoEstado) => {
    const problema = validarVentaParaCambiarEstado(item);
    if (problema) return mostrarAviso(problema, 'warning');
    try {
      await cambiarEstadoVentaLocal({ saleId: item.pedido_id, estado: nuevoEstado });
      await refrescarDatos({ sync: false });
      void sincronizarAhora({ pull: false });
    } catch (err) {
      mostrarAviso('Error actualizando estado: ' + err.message, 'error');
    }
  };

  // Corrección: oculta inmediatamente la venta con 1 solo clic tras confirmar
  const manejarCancelarOptimista = async (item) => {
    if (typeof cancelarPedido !== 'function') return;

    const idItem = item.id;
    const saleId = item.pedido_id || item.id;

    try {
      const res = await cancelarPedido(item);
      // Si el usuario confirmó (no canceló el modal con false), se retira en el acto
      if (res !== false) {
        setAnulandoIds(prev => new Set(prev).add(idItem).add(saleId));
        if (typeof refrescarDatos === 'function') {
          void refrescarDatos({ sync: false });
        }
      }
    } catch (err) {
      // Si ocurrió un error en base de datos, se reincorpora a la lista
      setAnulandoIds(prev => {
        const next = new Set(prev);
        next.delete(idItem);
        next.delete(saleId);
        return next;
      });
      mostrarAviso('No se pudo cancelar el pedido: ' + err.message, 'error');
    }
  };

  const ejecutarCobro = async (item) => {
    const monto = safeNum(abonosRapidos[item.id]);
    const problema = validarCobroSobreVenta({ item, monto });
    if (problema) return mostrarAviso(problema, 'warning');
    if (procesandoCobroId === item.id) return;

    const pVenta = safeNum(item.venta);
    const pSaldo = calcularSaldo(pVenta, item.descuento, safeNum(item.abono));
    if (monto > pSaldo + 0.005) {
      return mostrarAviso(`El abono ($${monto.toFixed(2)}) supera el saldo pendiente ($${pSaldo.toFixed(2)}).`, 'warning');
    }

    const formaPago = formasPagoRapidas[item.id] || 'Efectivo';
    let urlComprobanteFinal = item.comprobante_url || '';
    setProcesandoCobroId(item.id);

    try {
      const archivoFoto = comprobantesRapidos[item.id];
      if (formaPago === 'Transferencia' && archivoFoto) {
        setSubiendoId(item.id);
        const archivoComprimido = await comprimirImagen(archivoFoto);
        const nombreArchivo = `comprobante_${Date.now()}_${archivoFoto.name.replace(/[^a-zA-Z0-9.]/g, '')}`;

        let subido = false;
        if (navigator.onLine) {
          try {
            const { data, error } = await supabase.storage.from('comprobantes_pagos').upload(nombreArchivo, archivoComprimido, { upsert: true });
            if (error) throw error;
            urlComprobanteFinal = data.path;
            subido = true;
          } catch (err) {
            console.warn('[cobros] No se pudo subir a storage ahora; guardando localmente:', err);
          }
        }

        if (!subido) {
          const adjunto = await guardarAdjuntoLocal({
            blob: archivoComprimido,
            nombre: nombreArchivo,
            mime: 'image/jpeg',
            bucket: 'comprobantes_pagos',
            refType: 'pago',
            refId: item.pedido_id || item.id
          });
          urlComprobanteFinal = adjunto.ruta;
        }
        setSubiendoId(null);
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
      void sincronizarAhora({ pull: false }).then(() => {
        void refrescarDatos({ sync: false });
      });

      mostrarAviso('Pago registrado con éxito.', 'success');
    } catch (e) {
      mostrarAviso('Error al registrar el cobro rápido: ' + e.message, 'error');
    } finally {
      setProcesandoCobroId(null);
      setSubiendoId(null);
    }
  };

  // Conteo de pedidos en tiempo real
  const conteos = useMemo(() => {
    let pendientes = 0;
    let laboratorio = 0;
    let listos = 0;
    let completados = 0;

    for (const item of pedidosFiltrados || []) {
      if (!item) continue;
      if (anulandoIds.has(item.id) || anulandoIds.has(item.pedido_id)) continue;

      const estado = safeString(item.estado);
      if (estado === 'Anulado') continue;

      const pVenta = safeNum(item.venta);
      const tieneVenta = Boolean(safeString(item.pedido_id).trim())
        || pVenta > 0
        || safeString(item.codigo_armazon).trim() !== ''
        || safeString(item.accesorio_id).trim() !== '';

      if (!tieneVenta) continue;

      const pFinal = calcularTotal(pVenta, item.descuento);
      const pAbono = safeNum(item.abono);
      const pSaldo = calcularSaldo(pVenta, item.descuento, pAbono);
      const estaPagado = pSaldo <= 0 && pFinal > 0;

      if (pSaldo > 0) pendientes += 1;
      if (estado === 'En laboratorio') laboratorio += 1;
      if (estado === 'Listo para Entrega') listos += 1;
      if (estado === 'Entregado' && estaPagado) completados += 1;
    }

    return { pendientes, laboratorio, listos, completados };
  }, [pedidosFiltrados, anulandoIds]);

  const pedidosParaMostrar = (pedidosFiltrados || []).filter(item => {
    if (!item) return false;
    
    // Filtro optimista inmediato
    if (anulandoIds.has(item.id) || anulandoIds.has(item.pedido_id)) return false;

    const pVenta = safeNum(item.venta);
    const pFinal = calcularTotal(pVenta, item.descuento);
    const pAbono = safeNum(item.abono);
    const pSaldo = calcularSaldo(pVenta, item.descuento, pAbono);
    
    const estado = safeString(item.estado);
    if (estado === 'Anulado') return false;

    const tieneVenta = Boolean(safeString(item.pedido_id).trim())
      || pVenta > 0
      || safeString(item.codigo_armazon).trim() !== ''
      || safeString(item.accesorio_id).trim() !== '';
    const tienePedido = tieneVenta && estado !== 'Anulado';
    const estaPagado = pSaldo <= 0 && pFinal > 0;

    if (!tienePedido) return false;

    if (busqueda.trim().length >= 2) return true;

    if (filtroTab === 'Activos') return pSaldo > 0;
    if (filtroTab === 'Laboratorio') return estado === 'En laboratorio';
    if (filtroTab === 'Listos') return estado === 'Listo para Entrega';
    if (filtroTab === 'Completados') return estado === 'Entregado' && estaPagado;

    return true;
  });

  const { total: soloLocales } = contarSoloLocales(pedidosFiltrados);

  return (
    <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 border-t-4 border-indigo-600">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">🛍️ Gestión de Ventas y Pedidos</h2>
          <p className="text-xs text-gray-600">Control de órdenes de laboratorio, entregas y pagos.</p>
        </div>
        <button type="button" onClick={crearVentaDirecta} className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-white px-5 sm:px-6 py-2.5 rounded-lg font-bold shadow-md transition-all active:scale-95 text-sm sm:text-base">
          🛒 Nueva Venta Directa
        </button>
      </div>

      {soloLocales > 0 && (
        <div role="status" className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs sm:text-sm">
          <span aria-hidden="true">⏳</span>
          <p className="font-semibold">
            {soloLocales === 1
              ? '1 venta de esta lista está solo en este equipo.'
              : `${soloLocales} ventas de esta lista están solo en este equipo.`}
            {' '}Aún no están en la nube; se subirán solas. Si el equipo se apaga o se daña, se pierden.
          </p>
        </div>
      )}

      <div className="flex gap-3 mb-4">
        <input 
          type="text" 
          aria-label="Buscar paciente para generar pedido por cédula o nombre"
          placeholder="🔍 Buscar paciente por Cédula o Nombre..." 
          value={busqueda} 
          onChange={(e) => setBusqueda(e.target.value)} 
          className="flex-1 p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-medium text-sm text-gray-900 bg-gray-50 focus:bg-white" 
        />
      </div>

      {!busqueda.trim().length && (
        <div className="flex gap-2 overflow-x-auto mb-6 pb-2 border-b border-gray-200">
          <button 
            type="button" 
            onClick={() => setFiltroTab('Activos')} 
            className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold rounded-t-lg transition-colors whitespace-nowrap flex items-center gap-2 ${filtroTab === 'Activos' ? 'bg-indigo-50 text-indigo-900 border-b-2 border-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <span>🔥 Con Saldo</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-black shadow-sm ${conteos.pendientes > 0 ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-200 text-gray-600'}`}>
              {formatearContador(conteos.pendientes)}
            </span>
          </button>

          <button 
            type="button" 
            onClick={() => setFiltroTab('Laboratorio')} 
            className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold rounded-t-lg transition-colors whitespace-nowrap flex items-center gap-2 ${filtroTab === 'Laboratorio' ? 'bg-yellow-50 text-yellow-900 border-b-2 border-yellow-500' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <span>🟡 En Laboratorio</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-black shadow-sm ${conteos.laboratorio > 0 ? 'bg-yellow-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
              {formatearContador(conteos.laboratorio)}
            </span>
          </button>

          <button 
            type="button" 
            onClick={() => setFiltroTab('Listos')} 
            className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold rounded-t-lg transition-colors whitespace-nowrap flex items-center gap-2 ${filtroTab === 'Listos' ? 'bg-blue-50 text-blue-900 border-b-2 border-blue-500' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <span>🔵 Listos para Entrega</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-black shadow-sm ${conteos.listos > 0 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
              {formatearContador(conteos.listos)}
            </span>
          </button>

          <button 
            type="button" 
            onClick={() => setFiltroTab('Completados')} 
            className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold rounded-t-lg transition-colors whitespace-nowrap flex items-center gap-2 ${filtroTab === 'Completados' ? 'bg-green-50 text-green-900 border-b-2 border-green-500' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <span>✅ Entregados y Pagados</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-black bg-gray-200 text-gray-700 shadow-sm">
              {formatearContador(conteos.completados)}
            </span>
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
            const estaProcesando = procesandoCobroId === item.id;

            return (
              <div key={item.id} className={`border p-4 sm:p-5 rounded-xl flex flex-col gap-4 shadow-sm hover:shadow-md transition-all ${estaPagado ? 'bg-green-50/30 border-green-200' : 'bg-indigo-50/15 border-indigo-100'}`}>
                
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                  <div>
                    <h3 className="font-extrabold text-lg text-indigo-950">{safeString(item.nombre)}</h3>
                    <p className="text-xs sm:text-sm text-gray-700 font-semibold mb-1">{safeString(item.pedido_id) ? `Pedido: ${safeString(item.fecha_venta || item.fecha).slice(0, 10)} | ` : ''}Registro: {safeString(item.fecha)} | 🆔 {safeString(item.cedula)}</p>
                    <div className="flex gap-2 items-center flex-wrap mt-1">
                      
                      <select 
                        aria-label="Estado del pedido"
                        value={safeString(item.estado) || 'Ninguno'} 
                        onChange={(e) => cambiarEstadoRapido(item, e.target.value)}
                        disabled={estaProcesando}
                        className={`px-3 py-1 rounded-full text-xs font-bold uppercase cursor-pointer outline-none border shadow-sm transition-colors disabled:opacity-60 ${
                          item.estado === 'Entregado' ? 'bg-green-100 text-green-900 border-green-300' : 
                          item.estado === 'Listo para Entrega' ? 'bg-blue-100 text-blue-900 border-blue-300' : 
                          item.estado === 'En laboratorio' ? 'bg-yellow-100 text-yellow-900 border-yellow-300' : 
                          'bg-gray-100 text-gray-800 border-gray-300'
                        }`}
                      >
                        <option value="Ninguno">Ninguno</option>
                        <option value="En laboratorio">🟡 En Laboratorio</option>
                        <option value="Listo para Entrega">🔵 Listo para Entrega</option>
                        <option value="Entregado">🟢 Entregado</option>
                      </select>

                      {item.comprobante_url && (
                        <BotonComprobante
                          ruta={item.comprobante_url}
                          refId={item.pedido_id || item.id}
                          className="text-xs bg-indigo-50 text-indigo-700 font-bold px-3 py-1 rounded-full border border-indigo-200 hover:bg-indigo-100 flex items-center gap-1 shadow-sm"
                        />
                      )}
                    </div>
                  </div>
                  
                  <div className="flex gap-1.5 sm:gap-2 flex-wrap justify-start sm:justify-end w-full md:w-auto">
                    <button type="button" onClick={() => imprimirRecibo(item)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors">
                      🧾 Recibo
                    </button>
                    <button type="button" onClick={() => imprimirOrdenTrabajo(item)} className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold shadow-sm hover:bg-gray-900 transition-colors">
                      🖨️ Orden Lab
                    </button>
                    <button type="button" onClick={() => manejarCancelarOptimista(item)} disabled={estaProcesando} className="bg-white border border-red-200 text-red-700 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold shadow-sm hover:bg-red-50 transition-colors disabled:opacity-50 active:scale-95">
                      🗑️ Cancelar
                    </button>
                    <button type="button" onClick={() => abrirPedido(item)} disabled={estaProcesando} className="bg-indigo-600 text-white px-4 sm:px-5 py-1.5 rounded-lg text-xs sm:text-sm font-bold shadow hover:bg-indigo-700 transition-colors disabled:opacity-50">
                      ✏️ Ver / Editar
                    </button>
                  </div>
                </div>

                <div className="bg-white p-3 sm:p-4 rounded-xl border border-gray-200 flex flex-col xl:flex-row justify-between items-stretch xl:items-center gap-4">
                  <div className="flex flex-wrap sm:flex-nowrap gap-4 sm:gap-6 justify-between sm:justify-start">
                    <div>
                      <p className="text-[11px] text-gray-700 font-bold uppercase mb-0.5">Costo Total</p>
                      <p className="text-base sm:text-lg font-black text-gray-900">${pFinal.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-700 font-bold uppercase mb-0.5">Abonado</p>
                      <p className="text-base sm:text-lg font-black text-green-700">${pAbono.toFixed(2)}</p>
                    </div>
                    <div className="sm:pl-6 sm:border-l border-gray-200">
                      <p className="text-[11px] text-gray-700 font-bold uppercase mb-0.5">Saldo Pendiente</p>
                      <p className={`text-lg sm:text-xl font-black ${pSaldo > 0 ? 'text-red-600' : 'text-gray-500'}`}>${Math.max(0, pSaldo).toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="w-full xl:w-auto flex justify-end">
                    {estaPagado ? (
                      <div className="w-full sm:w-auto justify-center bg-green-100 text-green-900 px-6 py-2 rounded-lg font-black text-xs sm:text-sm uppercase flex items-center gap-2 border border-green-200 shadow-sm">
                        ✅ Pago Completado
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 bg-gray-50 p-2 sm:p-2.5 rounded-lg border border-gray-200 w-full sm:w-auto justify-end">
                        <span className="text-xs font-bold text-gray-700">ABONAR:</span>
                        <span className="text-gray-800 font-bold">$</span>
                        <input 
                          type="number" 
                          step="0.01" 
                          aria-label="Monto de abono rápido"
                          placeholder="Monto" 
                          disabled={estaProcesando}
                          value={abonosRapidos[item.id] || ''} 
                          onChange={(e) => manejarCambioAbono(item.id, e.target.value)}
                          className="w-20 p-1.5 border border-gray-300 rounded outline-none text-sm text-center font-bold bg-white text-gray-900 disabled:opacity-60" 
                        />
                        <select 
                          aria-label="Forma de pago"
                          value={metodoActual} 
                          disabled={estaProcesando}
                          onChange={(e) => manejarCambioFormaPago(item.id, e.target.value)}
                          className="p-1.5 border border-gray-300 rounded outline-none text-xs bg-white font-semibold cursor-pointer text-gray-900 disabled:opacity-60" 
                        >
                          <option value="Efectivo">Efectivo</option>
                          <option value="Transferencia">Transferencia</option>
                          <option value="Tarjeta">Tarjeta</option>
                        </select>

                        {metodoActual === 'Transferencia' && (
                          <input 
                            type="file" 
                            accept="image/*" 
                            aria-label="Adjuntar foto de comprobante de transferencia"
                            disabled={estaProcesando}
                            onChange={(e) => manejarCambioArchivo(item.id, e.target.files[0])} 
                            className="text-[10px] text-gray-700 w-44 cursor-pointer file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 disabled:opacity-60" 
                            title="Adjuntar comprobante"
                          />
                        )}

                        <button
                          type="button"
                          onClick={() => ejecutarCobro(item)}
                          disabled={estaProcesando}
                          className="bg-green-600 text-white px-4 py-1.5 rounded-lg font-bold text-xs sm:text-sm hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-sm transition-colors whitespace-nowrap active:scale-95"
                        >
                          {estaProcesando
                            ? (subiendoId === item.id ? 'Subiendo...' : 'Procesando...')
                            : 'Cobrar'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            );
          } catch {
            return <div key={`error-${item.id}`} className="bg-red-50 p-4 rounded-xl text-red-700 font-bold border border-red-200">Error visual en pedido.</div>;
          }
        })}
        {pedidosParaMostrar.length === 0 && (
          <div className="text-center bg-white p-8 sm:p-12 rounded-xl border border-dashed border-gray-300">
            <p className="text-gray-700 font-bold text-base sm:text-lg mb-2">No hay pedidos en esta sección.</p>
            <p className="text-gray-500 text-xs sm:text-sm font-medium">Cambia de pestaña o utiliza el buscador superior.</p>
          </div>
        )}
      </div>
    </div>
  );
}