import { useState, useMemo } from 'react'
import { safeString, safeNum, comprimirImagen } from './utilidades'
import { mostrarAviso } from './avisos'
import { validarMontoCobro } from './cobros'
import { calcularTotal, calcularSaldo, calcularMontoDescuento, normalizarDescuento } from './reglas'
import { supabase } from './supabaseClient'
import { guardarAdjuntoLocal } from './localRepository'
import { createUuid as generarId } from './localDb'
import BotonComprobante from './BotonComprobante'

export default function PedidosForm({
  pedidoSeleccionado, setPedidoSeleccionado, setVistaActual, guardarPedido,
  manejarCambioPedido, cambiarMedicionPedido, medidasPaciente, inventario,
  accesorioOriginalId, forzarRecalculo, confirmarAccion
}) {

  const [nuevoAbonoMonto, setNuevoAbonoMonto] = useState('');
  const [nuevoAbonoForma, setNuevoAbonoForma] = useState('Efectivo');
  const [nuevoAbonoNota, setNuevoAbonoNota] = useState('');
  const [montoAbonoPendiente, setMontoAbonoPendiente] = useState(0);
  const [imagenComprobante, setImagenComprobante] = useState(null);
  const [subiendoComprobante, setSubiendoComprobante] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [abonoAlAbrir] = useState(() => safeNum(pedidoSeleccionado?.abono));

  const [avisoComprobante, setAvisoComprobante] = useState('');
  const avisarComprobantePendiente = texto => {
    setAvisoComprobante(texto);
    setTimeout(() => setAvisoComprobante(''), 6000);
  };

  const registrarAbono = async () => {
    const monto = safeNum(nuevoAbonoMonto);
    const problema = validarMontoCobro(monto);
    if (problema) return mostrarAviso(problema);

    setSubiendoComprobante(true);
    let urlComprobanteFinal = pedidoSeleccionado.comprobante_url || '';
    let comprobantePendiente = false;
    try {
      if (imagenComprobante) {
        const archivoComprimido = await comprimirImagen(imagenComprobante);
        const nombreArchivo = `comprobante_${Date.now()}_${imagenComprobante.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
        let subido = false;
        if (navigator.onLine) {
          try {
            const { data, error } = await supabase.storage.from('comprobantes_pagos').upload(nombreArchivo, archivoComprimido, { upsert: true });
            if (error) throw error;
            urlComprobanteFinal = data.path;
            subido = true;
          } catch (err) {
            console.warn('No se pudo subir comprobante en línea, guardando localmente:', err);
          }
        }
        if (!subido) {
          const refId = pedidoSeleccionado.pedido_id || pedidoSeleccionado.id || generarId();
          const adjunto = await guardarAdjuntoLocal({
            blob: archivoComprimido,
            nombre: nombreArchivo,
            mime: 'image/jpeg',
            bucket: 'comprobantes_pagos',
            refType: 'pago',
            refId
          });
          urlComprobanteFinal = adjunto.ruta;
          comprobantePendiente = true;
        }
      }

      const abonoAcumulado = safeNum(pedidoSeleccionado.abono) + monto;
      if (!pedidoSeleccionado._nueva_venta && pedidoSeleccionado.pedido_id) {
        setMontoAbonoPendiente(prev => prev + monto);
      }

      setPedidoSeleccionado({
        ...pedidoSeleccionado,
        abono: abonoAcumulado,
        forma_pago: nuevoAbonoForma,
        comprobante_url: urlComprobanteFinal
      });
      setNuevoAbonoMonto('');
      setNuevoAbonoNota('');
      setImagenComprobante(null);
      if (comprobantePendiente) {
        avisarComprobantePendiente('Comprobante guardado localmente. Se subirá al recuperar conexión.');
      }
    } catch (err) {
      mostrarAviso('No se pudo registrar el abono localmente: ' + err.message);
    } finally {
      setSubiendoComprobante(false);
    }
  };

  const pVenta = safeNum(pedidoSeleccionado?.venta);
  const pDesc = normalizarDescuento(pedidoSeleccionado?.descuento);
  const pAbono = safeNum(pedidoSeleccionado?.abono);
  const pFinal = useMemo(() => calcularTotal(pVenta, pDesc), [pVenta, pDesc]);
  const pSaldo = useMemo(() => calcularSaldo(pVenta, pDesc, pAbono), [pVenta, pDesc, pAbono]);
  const pMontoDescuento = useMemo(() => calcularMontoDescuento(pVenta, pDesc), [pVenta, pDesc]);

  const armazonUIInfo = (inventario || []).find(i => i && i.categoria === 'Armazon' && safeString(i.codigo).toUpperCase().trim() === safeString(pedidoSeleccionado?.codigo_armazon).toUpperCase().trim());
  const precioArmazonUI = armazonUIInfo ? safeNum(armazonUIInfo.precio) : 0;

  const costoTotalInterno = safeNum(pedidoSeleccionado?.costo_armazon_int) + safeNum(pedidoSeleccionado?.costo_lunas_int) + safeNum(pedidoSeleccionado?.costo_accesorio_int) + safeNum(pedidoSeleccionado?.costo_tratamientos_int) + safeNum(pedidoSeleccionado?.costo_varios_int);

  return (
    <div className="bg-white rounded-xl shadow-lg p-4 sm:p-8 pb-36 sm:pb-32 border-t-4 border-indigo-600 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b pb-4 gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Orden de Laboratorio / Venta</h2>
          {safeString(pedidoSeleccionado.nombre) === 'CONSUMIDOR FINAL' ? (
            <p className="text-amber-700 font-bold text-sm">🛒 Venta Directa (Consumidor Final)</p>
          ) : (
            <p className="text-indigo-800 font-semibold text-sm">Paciente: {safeString(pedidoSeleccionado.nombre)} ({safeString(pedidoSeleccionado.cedula)})</p>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-end">
          <button 
            type="button"
            onClick={() => {
              const salir = () => { setPedidoSeleccionado(null); setVistaActual('pedidos_lista'); };
              if (safeNum(pedidoSeleccionado?.abono) !== abonoAlAbrir) {
                confirmarAccion("Registraste abonos que aún NO se han guardado. Si sales ahora se perderán. ¿Salir de todos modos?", salir);
              } else {
                salir();
              }
            }} 
            className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            Volver
          </button>
          <button
            type="button"
            onClick={async () => {
              if (procesando) return;
              setProcesando(true);
              try { 
                const guardado = await guardarPedido({ montoAdicional: montoAbonoPendiente }); 
                if (guardado) setMontoAbonoPendiente(0); 
              } finally { 
                setProcesando(false); 
              }
            }}
            disabled={procesando}
            className={`px-6 sm:px-8 py-2 rounded-lg font-bold shadow-md text-white transition-all text-sm sm:text-base ${procesando ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'}`}
          >
            {procesando ? 'Guardando...' : 'Guardar Pedido'}
          </button>
        </div>
      </div>

      {safeString(pedidoSeleccionado.nombre) === 'CONSUMIDOR FINAL' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-amber-50 p-4 rounded-xl border border-amber-200">
          <div>
            <label htmlFor="pf-nombre" className="block text-xs sm:text-sm font-bold text-gray-800 mb-1">Nombre (Opcional)</label>
            <input id="pf-nombre" name="nombre" value={safeString(pedidoSeleccionado.nombre)} onChange={manejarCambioPedido} className="w-full p-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <div>
            <label htmlFor="pf-cedula" className="block text-xs sm:text-sm font-bold text-gray-800 mb-1">Cédula (Opcional)</label>
            <input id="pf-cedula" name="cedula" value={safeString(pedidoSeleccionado.cedula)} onChange={manejarCambioPedido} className="w-full p-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
        <div className="space-y-4">

          {safeString(pedidoSeleccionado.nombre) !== 'CONSUMIDOR FINAL' && (
            <div className="bg-indigo-50/50 p-3 sm:p-4 rounded-xl border border-indigo-100">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-3">
                <span className="font-bold text-indigo-950 whitespace-nowrap text-xs sm:text-sm">📋 Usar medición del:</span>
                <select aria-label="Usar medición de una visita anterior" onChange={cambiarMedicionPedido} className="w-full p-2 bg-white border border-indigo-200 rounded-lg outline-none font-semibold text-xs text-gray-900">
                  <option value="">-- Seleccionar de Historial Clínico --</option>
                  {medidasPaciente.map(v => (
                    <option key={v.id} value={v.id}>Fecha: {safeString(v.fecha)} | OD: {safeString(v.esfera_od) || '0'}/{safeString(v.cilindro_od) || '0'} | OI: {safeString(v.esfera_oi) || '0'}/{safeString(v.cilindro_oi) || '0'}</option>
                  ))}
                </select>
              </div>

              <h3 className="font-bold text-indigo-950 mb-2 border-b border-indigo-200 pb-1 text-xs sm:text-sm">Medidas para la Orden (Edite DNP o Altura si es necesario)</h3>
              <div className="overflow-x-auto bg-white rounded-lg border border-indigo-100 shadow-sm">
                <table className="w-full text-center text-xs min-w-[340px]">
                  <thead className="bg-indigo-100/60 text-indigo-950">
                    <tr><th className="p-1 border-r border-b">Ojo</th><th className="p-1 border-r border-b">Esfera</th><th className="p-1 border-r border-b">Cilindro</th><th className="p-1 border-r border-b">Eje</th><th className="p-1 border-r border-b">Adición</th><th className="p-1 border-r border-b">DNP</th><th className="p-1 border-b">ALTURA</th></tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="p-1 border-r font-bold text-gray-800">OD</td>
                      <td className="p-1 border-r"><input name="esfera_od" aria-label="Esfera ojo derecho" value={safeString(pedidoSeleccionado.esfera_od)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1 border-r"><input name="cilindro_od" aria-label="Cilindro ojo derecho" value={safeString(pedidoSeleccionado.cilindro_od)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1 border-r"><input name="eje_od" aria-label="Eje ojo derecho" value={safeString(pedidoSeleccionado.eje_od)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1 border-r"><input name="adicion_od" aria-label="Adición ojo derecho" value={safeString(pedidoSeleccionado.adicion_od)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1 border-r"><input name="dnp_od" aria-label="Distancia naso-pupilar ojo derecho" value={safeString(pedidoSeleccionado.dnp_od)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1"><input name="altura_od" aria-label="Altura de montaje ojo derecho" value={safeString(pedidoSeleccionado.altura_od)} onChange={manejarCambioPedido} className={`w-full text-center outline-none border rounded p-1 font-bold ${safeNum(pedidoSeleccionado.adicion_od) !== 0 && !pedidoSeleccionado.altura_od ? 'bg-red-50 border-red-400 placeholder-red-600 text-red-900' : 'bg-indigo-50 border-indigo-200 text-indigo-900'}`} placeholder={safeNum(pedidoSeleccionado.adicion_od) !== 0 ? 'Oblig' : '-'} /></td>
                    </tr>
                    <tr>
                      <td className="p-1 border-r font-bold text-gray-800">OI</td>
                      <td className="p-1 border-r"><input name="esfera_oi" aria-label="Esfera ojo izquierdo" value={safeString(pedidoSeleccionado.esfera_oi)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1 border-r"><input name="cilindro_oi" aria-label="Cilindro ojo izquierdo" value={safeString(pedidoSeleccionado.cilindro_oi)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1 border-r"><input name="eje_oi" aria-label="Eje ojo izquierdo" value={safeString(pedidoSeleccionado.eje_oi)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1 border-r"><input name="adicion_oi" aria-label="Adición ojo izquierdo" value={safeString(pedidoSeleccionado.adicion_oi)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1 border-r"><input name="dnp_oi" aria-label="Distancia naso-pupilar ojo izquierdo" value={safeString(pedidoSeleccionado.dnp_oi)} onChange={manejarCambioPedido} className="w-full text-center outline-none bg-gray-50 border rounded p-1 text-gray-900 font-semibold" /></td>
                      <td className="p-1"><input name="altura_oi" aria-label="Altura de montaje ojo izquierdo" value={safeString(pedidoSeleccionado.altura_oi)} onChange={manejarCambioPedido} className={`w-full text-center outline-none border rounded p-1 font-bold ${safeNum(pedidoSeleccionado.adicion_oi) !== 0 && !pedidoSeleccionado.altura_oi ? 'bg-red-50 border-red-400 placeholder-red-600 text-red-900' : 'bg-indigo-50 border-indigo-200 text-indigo-900'}`} placeholder={safeNum(pedidoSeleccionado.adicion_oi) !== 0 ? 'Oblig' : '-'} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <h3 className="font-bold text-indigo-900 border-b pb-1 mb-2 text-sm sm:text-base">1. Lente y Material</h3>
            <select name="tipo_lente" aria-label="Tipo de lente" value={safeString(pedidoSeleccionado.tipo_lente)} onChange={manejarCambioPedido} className="w-full p-2.5 mb-3 bg-gray-50 border border-gray-300 rounded-lg outline-none font-semibold text-gray-900 text-sm">
              <option value="">-- Seleccionar Tipo de Lente --</option>
              <option value="Monofocal">Monofocal</option>
              <option value="Bifocal">Bifocal</option>
              <option value="Ocupacional">Ocupacional</option>
              <option value="Progresivo">Progresivo</option>
              <option value="Lente de Contacto">Lente de Contacto</option>
            </select>
            <div className="flex flex-wrap gap-2.5 sm:gap-3 mb-3 text-xs sm:text-sm">
              {[
                { id: 'Plástico', label: 'Plástico [+$20]' },
                { id: 'Policarbonato', label: 'Policarbonato [+$30]' },
                { id: 'Reducido', label: 'Reducido [+$50]' },
                { id: 'Hiperreducido', label: 'Hiperreducido [+$70]' },
                { id: 'Otros', label: 'Otros' }
              ].map(mat => (
                <label key={mat.id} className="flex items-center gap-1.5 cursor-pointer font-medium text-gray-800">
                  <input type="radio" name="material_lente" value={mat.id} checked={pedidoSeleccionado.material_lente === mat.id} onChange={manejarCambioPedido} /> {mat.label}
                </label>
              ))}
            </div>
            {pedidoSeleccionado.material_lente === 'Otros' && (
              <input name="material_nota" aria-label="Nota del material, cuando se elige Otros" value={safeString(pedidoSeleccionado.material_nota)} onChange={manejarCambioPedido} type="text" className="w-full p-2 bg-gray-50 border border-gray-300 rounded-lg outline-none text-sm mb-2 text-gray-900" placeholder="Especifique el material y precio..." />
            )}
          </div>

          <div>
            <h3 className="font-bold text-indigo-900 border-b pb-1 mb-2 text-sm sm:text-base">2. Tratamientos</h3>
            <div className="space-y-2 text-xs sm:text-sm bg-gray-50 p-3 rounded-lg border border-gray-200">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-gray-800 pb-2 border-b border-gray-200"><input type="checkbox" name="tratam_ninguno" checked={pedidoSeleccionado.tratam_ninguno === 'SI'} onChange={manejarCambioPedido} /> NINGUNO / BLANCO</label>
              <label className="flex items-center gap-2 cursor-pointer text-gray-800"><input type="checkbox" name="tratam_ar" checked={pedidoSeleccionado.tratam_ar === 'SI'} onChange={manejarCambioPedido} disabled={pedidoSeleccionado.tratam_ninguno === 'SI'}/> Antirreflejo Verde <span className="text-green-700 font-bold ml-1">[+$20]</span></label>
              <label className="flex items-center gap-2 cursor-pointer text-gray-800"><input type="checkbox" name="tratam_ar_azul" checked={pedidoSeleccionado.tratam_ar_azul === 'SI'} onChange={manejarCambioPedido} disabled={pedidoSeleccionado.tratam_ninguno === 'SI'}/> Antirreflejo Azul <span className="text-green-700 font-bold ml-1">[+$20]</span></label>
              <label className="flex items-center gap-2 cursor-pointer text-gray-800"><input type="checkbox" name="tratam_azul" checked={pedidoSeleccionado.tratam_azul === 'SI'} onChange={manejarCambioPedido} disabled={pedidoSeleccionado.tratam_ninguno === 'SI'}/> Filtro Azul <span className="text-green-700 font-bold ml-1">[+$35]</span></label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-gray-800"><input type="checkbox" name="tratam_tinturado" checked={pedidoSeleccionado.tratam_tinturado === 'SI'} onChange={manejarCambioPedido} disabled={pedidoSeleccionado.tratam_ninguno === 'SI'}/> Tinturado <span className="text-green-700 font-bold ml-1">[+$20]</span></label>
                {pedidoSeleccionado.tratam_tinturado === 'SI' && <input name="tratam_tinturado_nota" aria-label="Nota del tratamiento tinturado" value={safeString(pedidoSeleccionado.tratam_tinturado_nota)} onChange={manejarCambioPedido} type="text" className="flex-1 p-1 bg-white border border-gray-300 rounded outline-none text-xs text-gray-900" placeholder="Color/Muestra..." />}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-gray-800"><input type="checkbox" name="tratam_foto" checked={pedidoSeleccionado.tratam_foto === 'SI'} onChange={manejarCambioPedido} disabled={pedidoSeleccionado.tratam_ninguno === 'SI'}/> Fotocromático <span className="text-green-700 font-bold ml-1">[+$55]</span></label>
                {pedidoSeleccionado.tratam_foto === 'SI' && <input name="tratam_foto_nota" aria-label="Nota del tratamiento fotocromático" value={safeString(pedidoSeleccionado.tratam_foto_nota)} onChange={manejarCambioPedido} type="text" className="flex-1 p-1 bg-white border border-gray-300 rounded outline-none text-xs text-gray-900" placeholder="Color..." />}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-gray-800"><input type="checkbox" name="tratam_trans" checked={pedidoSeleccionado.tratam_trans === 'SI'} onChange={manejarCambioPedido} disabled={pedidoSeleccionado.tratam_ninguno === 'SI'}/> Transition <span className="text-green-700 font-bold ml-1">[+$100]</span></label>
                {pedidoSeleccionado.tratam_trans === 'SI' && <input name="tratam_trans_nota" aria-label="Nota del tratamiento transition" value={safeString(pedidoSeleccionado.tratam_trans_nota)} onChange={manejarCambioPedido} type="text" className="flex-1 p-1 bg-white border border-gray-300 rounded outline-none text-xs text-gray-900" placeholder="Color..." />}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm sm:text-base font-bold text-teal-900 mb-2 border-b pb-1">Observaciones / Laboratorio</h3>
            <textarea name="notas" aria-label="Notas del pedido" value={safeString(pedidoSeleccionado.notas)} onChange={manejarCambioPedido} className="w-full h-16 p-2 bg-gray-50 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-xs sm:text-sm text-gray-900"></textarea>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-bold text-indigo-900 border-b pb-1 text-sm sm:text-base">3. Armazón (Opcional)</h3>
          <div>
            <label className="block text-xs sm:text-sm font-bold text-gray-800 mb-1">Código de Armazón <span className="text-xs text-gray-600 font-normal">(2905 = Del Paciente)</span></label>
            <div className="flex gap-2 items-center flex-wrap">
              <input
                name="codigo_armazon" aria-label="Código del armazón con autocompletado"
                list="lista-armazones"
                value={safeString(pedidoSeleccionado.codigo_armazon)}
                onChange={manejarCambioPedido}
                type="text"
                className="flex-1 p-2 bg-indigo-50 border border-indigo-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 font-bold uppercase text-gray-900 text-sm"
                placeholder="Escriba código..."
              />
              <datalist id="lista-armazones">
                {(inventario || []).filter(i => i && i.categoria === 'Armazon').map(i => (
                   <option key={i.id} value={i.codigo}>{i.tipo_armazon} ({i.material})</option>
                ))}
                <option value="2905">Armazón del Paciente</option>
              </datalist>
              {precioArmazonUI > 0 && <span className="text-green-800 font-bold bg-green-100 px-3 py-1.5 rounded-lg shadow-sm whitespace-nowrap border border-green-300 text-xs sm:text-sm">[+${precioArmazonUI}]</span>}
              {safeString(pedidoSeleccionado.codigo_armazon) === '2905' && <span className="bg-amber-100 text-amber-900 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border border-amber-300">Armazón del Paciente</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-800 mb-1">Tipo de Armazón</label>
              <select name="tipo_armazon" aria-label="Tipo de armazón" value={safeString(pedidoSeleccionado.tipo_armazon)} onChange={manejarCambioPedido} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-xs sm:text-sm text-gray-900 bg-white">
                <option value="">Seleccionar...</option>
                <option value="Completo">Completo</option>
                <option value="Semi al Aire">Semi al Aire</option>
                <option value="Al Aire">Al Aire</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs sm:text-sm font-bold text-gray-800 mb-1">Parámetros del Armazón</label>
            <div className="grid grid-cols-4 gap-2">
              <div><input name="param_horizontal" aria-label="Parámetro horizontal del armazón" value={safeString(pedidoSeleccionado.param_horizontal)} onChange={manejarCambioPedido} className="w-full p-1.5 sm:p-2 border border-gray-300 rounded text-center text-xs sm:text-sm placeholder-gray-500 text-gray-900 font-semibold" placeholder="Horiz." title="Horizontal"/></div>
              <div><input name="param_puente" aria-label="Puente del armazón" value={safeString(pedidoSeleccionado.param_puente)} onChange={manejarCambioPedido} className="w-full p-1.5 sm:p-2 border border-gray-300 rounded text-center text-xs sm:text-sm placeholder-gray-500 text-gray-900 font-semibold" placeholder="Puent." title="Puente"/></div>
              <div><input name="param_vertical" aria-label="Parámetro vertical del armazón" value={safeString(pedidoSeleccionado.param_vertical)} onChange={manejarCambioPedido} className="w-full p-1.5 sm:p-2 border border-gray-300 rounded text-center text-xs sm:text-sm placeholder-gray-500 text-gray-900 font-semibold" placeholder="Verti." title="Vertical"/></div>
              <div><input name="param_diagonal" aria-label="Diámetro mayor del armazón" value={safeString(pedidoSeleccionado.param_diagonal)} onChange={manejarCambioPedido} className="w-full p-1.5 sm:p-2 border border-gray-300 rounded text-center text-xs sm:text-sm placeholder-gray-500 text-gray-900 font-semibold" placeholder="D.Mayor" title="Diámetro Mayor"/></div>
            </div>
          </div>

          <h3 className="font-bold text-indigo-900 border-b pb-1 mt-6 text-sm sm:text-base">4. Accesorio (Opcional)</h3>
          <div>
            <select name="accesorio_id" aria-label="Accesorio seleccionado" value={safeString(pedidoSeleccionado.accesorio_id)} onChange={manejarCambioPedido} className="w-full p-2.5 border border-indigo-200 rounded-lg outline-none font-semibold bg-indigo-50/50 text-xs sm:text-sm text-gray-900">
              <option value="">-- Sin Accesorio --</option>
              {(inventario || []).filter(i => i && i.categoria === 'Accesorio').map(acc => (
                <option key={acc.id} value={acc.id} disabled={safeNum(acc.stock) <= 0 && String(acc.id) !== String(accesorioOriginalId)}>
                  {acc.nombre_accesorio} - ${safeNum(acc.precio).toFixed(2)} {safeNum(acc.stock) <= 0 && String(acc.id) !== String(accesorioOriginalId) ? '[AGOTADO]' : `[Stock: ${String(acc.id) === String(accesorioOriginalId) ? safeNum(acc.stock) + 1 : acc.stock}]`}
                </option>
              ))}
            </select>
          </div>

          <h3 className="font-bold text-red-900 border-b border-red-200 pb-1 mt-6 bg-red-50 p-2 rounded-t-lg text-sm sm:text-base">5. Costos de Laboratorio/Compra (Privado)</h3>
          <div className="bg-red-50 p-3 rounded-b-lg border border-t-0 border-red-200 space-y-3 mb-6 shadow-inner">
            <p className="text-xs text-red-700 mb-2 font-bold">Estos valores son privados para calcular tu balance y ganancia real.</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div><label htmlFor="pf-costo_lunas_int" className="block text-xs font-bold text-gray-800 mb-1">Costo Lunas ($)</label><input id="pf-costo_lunas_int" name="costo_lunas_int" value={safeString(pedidoSeleccionado.costo_lunas_int)} onChange={manejarCambioPedido} type="number" className="w-full p-1.5 border border-gray-300 rounded outline-none text-xs sm:text-sm text-gray-900 font-semibold bg-white" placeholder="0.00" /></div>
              <div><label htmlFor="pf-costo_tratamientos_int" className="block text-xs font-bold text-gray-800 mb-1">Tratamientos ($)</label><input id="pf-costo_tratamientos_int" name="costo_tratamientos_int" value={safeString(pedidoSeleccionado.costo_tratamientos_int)} onChange={manejarCambioPedido} type="number" className="w-full p-1.5 border border-gray-300 rounded outline-none text-xs sm:text-sm text-gray-900 font-semibold bg-white" placeholder="0.00" /></div>
              <div><label htmlFor="pf-costo_armazon_int" className="block text-xs font-bold text-gray-800 mb-1">Costo Armazón ($)</label><input id="pf-costo_armazon_int" name="costo_armazon_int" value={safeString(pedidoSeleccionado.costo_armazon_int)} onChange={manejarCambioPedido} type="number" className="w-full p-1.5 bg-gray-100 border border-gray-300 rounded outline-none text-xs sm:text-sm text-gray-700 font-semibold" placeholder="Auto" /></div>
              <div><label htmlFor="pf-costo_accesorio_int" className="block text-xs font-bold text-gray-800 mb-1">Costo Accesorio ($)</label><input id="pf-costo_accesorio_int" name="costo_accesorio_int" value={safeString(pedidoSeleccionado.costo_accesorio_int)} onChange={manejarCambioPedido} type="number" className="w-full p-1.5 bg-gray-100 border border-gray-300 rounded outline-none text-xs sm:text-sm text-gray-700 font-semibold" placeholder="Auto" /></div>
              <div><label htmlFor="pf-costo_varios_int" className="block text-xs font-bold text-gray-800 mb-1">Gastos Varios ($)</label><input id="pf-costo_varios_int" name="costo_varios_int" value={safeString(pedidoSeleccionado.costo_varios_int)} onChange={manejarCambioPedido} type="number" className="w-full p-1.5 border border-gray-300 rounded outline-none text-xs sm:text-sm font-bold text-red-800 bg-white" placeholder="Transporte..." /></div>
            </div>
            <div className="text-right pt-2 border-t border-red-200">
              <span className="text-xs sm:text-sm font-black text-red-900">Total Gasto Interno: ${costoTotalInterno.toFixed(2)}</span>
            </div>
          </div>

          <h3 className="font-bold text-indigo-900 border-b pb-1 mt-6 text-sm sm:text-base">6. Finanzas y Control de Abonos</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs sm:text-sm font-bold text-gray-800 mb-1">Costo Base ($)</label>
              <div className="flex gap-2">
                <input name="venta" aria-label="Costo base de la venta en dólares" value={safeString(pedidoSeleccionado.venta)} onChange={manejarCambioPedido} type="number" className="w-full p-2 sm:p-2.5 bg-gray-50 border border-gray-300 rounded-lg outline-none font-black text-indigo-950 text-base" />
                <button type="button" onClick={forzarRecalculo} title="Volver a calcular automáticamente" className="bg-indigo-100 hover:bg-indigo-200 text-indigo-900 p-2 sm:p-2.5 rounded-lg font-bold border border-indigo-300 transition-colors">♻️</button>
              </div>
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-bold text-gray-800 mb-1">Descuento (%)</label>
              <input name="descuento" aria-label="Descuento aplicado en porcentaje" type="number" min="0" max="100" step="0.01" value={safeString(pedidoSeleccionado.descuento)} onChange={manejarCambioPedido} placeholder="%" className="w-full p-2 sm:p-2.5 bg-gray-50 border border-gray-300 rounded-lg outline-none font-bold text-indigo-800 text-base" />
              <p className="text-xs text-gray-600 mt-1">Descuento: <span className="font-bold text-gray-800">-${pMontoDescuento.toFixed(2)}</span> &middot; Costo final: <span className="font-black text-emerald-700">${pFinal.toFixed(2)}</span></p>
            </div>
          </div>

          <div className="bg-green-50/60 border border-green-200 p-3 sm:p-4 rounded-xl mb-4">
            <h4 className="font-bold text-green-900 mb-3 border-b border-green-200 pb-1 text-sm sm:text-base">Gestión de Pagos</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">

              <div className="space-y-3">
                 <div>
                   <label className="block text-xs font-bold text-gray-800 mb-1">Monto a abonar hoy ($)</label>
                   <div className="flex gap-2">
                     <input aria-label="Monto del abono a registrar" type="number" value={nuevoAbonoMonto} onChange={e => setNuevoAbonoMonto(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg outline-none font-bold text-green-800 bg-white text-sm" placeholder="Ej: 20.00" />
                     <select aria-label="Forma de pago del abono" value={nuevoAbonoForma} onChange={e => setNuevoAbonoForma(e.target.value)} className="p-2 border border-gray-300 rounded-lg outline-none text-xs bg-white text-gray-900 font-semibold">
                        <option value="Efectivo">Efectivo</option>
                        <option value="Transferencia">Transferencia</option>
                        <option value="Tarjeta">Tarjeta</option>
                     </select>
                   </div>
                 </div>
                 <div>
                   <input aria-label="Nota o referencia del abono" type="text" value={nuevoAbonoNota} onChange={e => setNuevoAbonoNota(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg outline-none text-xs bg-white text-gray-900" placeholder="Ref. de banco o nota del abono (opcional)..." />
                 </div>

                 {nuevoAbonoForma === 'Transferencia' && (
                   <div className="bg-indigo-50 border border-indigo-200 p-2.5 rounded-lg text-xs space-y-1">
                     <label className="block font-bold text-indigo-950">📎 Adjuntar Captura de Transferencia</label>
                     <input type="file" accept="image/*" aria-label="Adjuntar captura de la transferencia" onChange={e => setImagenComprobante(e.target.files[0])} className="w-full text-xs text-gray-700 file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700" />
                   </div>
                 )}

                 <button type="button" onClick={registrarAbono} disabled={subiendoComprobante} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-xs sm:text-sm shadow-md transition-all active:scale-95">
                   {subiendoComprobante ? "Guardando comprobante..." : "➕ Registrar Abono"}
                 </button>

                 {avisoComprobante && (
                   <div className="w-full bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold px-2.5 py-2 rounded-lg">
                     ⏳ {avisoComprobante}
                   </div>
                 )}
              </div>

              <div className="bg-white p-3 rounded-lg border border-green-200 shadow-sm flex flex-col h-full">
                 <div className="flex justify-between items-center mb-1">
                   <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide">Total Abonado</label>
                    <BotonComprobante
                      ruta={pedidoSeleccionado.comprobante_url}
                      refId={pedidoSeleccionado.pedido_id || pedidoSeleccionado.id}
                      className="text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 bg-indigo-100 text-indigo-800 hover:bg-indigo-200 border border-indigo-200"
                    >
                      👁️ Ver Comprobante
                    </BotonComprobante>
                 </div>
                 <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl font-black text-green-700">${safeNum(pedidoSeleccionado.abono).toFixed(2)}</span>
                    <span className="text-xs text-gray-500 font-medium">(Acumulado)</span>
                 </div>
                 <textarea name="pago_nota" aria-label="Nota o referencia del pago" value={safeString(pedidoSeleccionado.pago_nota)} onChange={manejarCambioPedido} className="w-full flex-1 min-h-[50px] p-2 bg-gray-50 border border-gray-200 rounded outline-none resize-none text-xs font-mono text-gray-800" placeholder="Historial de pagos aparecerá aquí..."></textarea>

                 <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2">
                   <span className="text-[11px] text-gray-600 font-medium">Corrección manual:</span>
                   <input name="abono" aria-label="Monto abonado anteriormente" value={safeString(pedidoSeleccionado.abono)} onChange={manejarCambioPedido} type="number" className="w-20 p-1 border border-gray-300 rounded text-xs text-right outline-none bg-gray-50 text-gray-900 font-bold" />
                 </div>
              </div>

            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-indigo-50 p-3 sm:p-4 rounded-xl border border-indigo-100 gap-3">
            <select name="estado" aria-label="Estado de la venta" value={safeString(pedidoSeleccionado.estado)} onChange={manejarCambioPedido} className="p-2 bg-white border border-gray-300 rounded-lg outline-none font-bold text-xs sm:text-sm text-gray-900 w-full sm:w-auto">
              <option value="Ninguno">Estado: Ninguno</option>
              <option value="En laboratorio">🟡 En Laboratorio</option>
              <option value="Listo para Entrega">🔵 Listo para Entrega</option>
              <option value="Entregado">🟢 Entregado</option>
            </select>
            <div className="text-left sm:text-right w-full sm:w-auto">
              <span className="text-xs font-bold text-gray-600 uppercase">Costo Final: ${pFinal.toFixed(2)}</span><br/>
              <span className="text-xs sm:text-sm font-bold text-gray-700">Saldo Pendiente: </span>
              <span className="text-xl sm:text-2xl font-black text-red-600">${pSaldo.toFixed(2)}</span>
            </div>
          </div>

        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t-4 border-indigo-600 shadow-2xl px-4 sm:px-6 py-2.5 sm:py-3 z-40 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-4 sm:gap-8">
          <div>
            <span className="block text-[10px] sm:text-xs font-bold text-gray-600 uppercase tracking-wider">Costo Final</span>
            <span className="text-lg sm:text-xl font-black text-gray-900">${pFinal.toFixed(2)}</span>
          </div>
          <div>
            <span className="block text-[10px] sm:text-xs font-bold text-gray-600 uppercase tracking-wider">Saldo Pendiente</span>
            <span className="text-lg sm:text-xl font-black text-red-600">${Math.max(0, pSaldo).toFixed(2)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={async () => {
            if (procesando) return;
            setProcesando(true);
            try { 
              const guardado = await guardarPedido({ montoAdicional: montoAbonoPendiente }); 
              if (guardado) setMontoAbonoPendiente(0); 
            } finally { 
              setProcesando(false); 
            }
          }}
          disabled={procesando}
          className={`px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-black text-sm sm:text-base text-white shadow-lg transition-all ${procesando ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'}`}
        >
          {procesando ? '⏳ Guardando...' : '💾 Guardar Pedido'}
        </button>
      </div>

    </div>
  )
}