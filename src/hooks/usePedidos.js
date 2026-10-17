import { useState, useMemo, useRef } from 'react';
import { safeString, safeNum } from '../utilidades';
import { createUuid as generarId } from '../localDb';
import { guardarVentaLocal, anularVentaLocal, anularVentaConReembolso } from '../localRepository';
import { sincronizarAhora } from '../syncEngine';
import { motivoDocumentoInvalido } from '../validacion';
import { validarMontosVenta } from '../reglas';
import { autocompletarArmazon, fechaDelPedido, problemaFechaPedido } from '../pedidos';
import { autoCalcularPrecio as calcularPrecioBase, fieldsQueAfectanPrecio } from '../calculoPrecio';
import { unificarPedidos, filtrarPedidos, calcularEstadisticas, prefijoDelMesActual } from '../estadisticas';
import { limpiarHtml } from '../escape';

// ---------------------------------------------------------------------------
// PEDIDOS Y VENTAS
// ---------------------------------------------------------------------------
// Apertura del formulario de venta, seleccion de medicion, recalculo de precio,
// guardado, anulacion, envio por WhatsApp y las listas derivadas (pedidos
// filtrados y estadisticas). Recibe los datos ya cargados y sus setters, los
// avisos/confirmaciones y la navegacion.
// ---------------------------------------------------------------------------
export function usePedidos({
  historial, ventasArchivadas, ventasLocales, setHistorial, setVentasLocales,
  inventario, listaPrecios, estadoInicial, hoy,
  mostrarToast, obtenerDatos, solicitarConfirmacion, setVistaActual
}) {
  const [busqueda, setBusqueda] = useState('');
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);
  const [accesorioOriginalId, setAccesorioOriginalId] = useState('');
  const [medidasPaciente, setMedidasPaciente] = useState([]);

  const abrirPedido = (item) => {
    let itemFormateado = { ...item };
    Object.keys(itemFormateado).forEach(key => { if (itemFormateado[key] === null) itemFormateado[key] = ''; });
    ['tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_foto', 'tratam_trans', 'tratam_ninguno'].forEach(k => { 
      if(!itemFormateado[k]) itemFormateado[k] = 'NO'; 
    });
    if(!itemFormateado.descuento) itemFormateado.descuento = '0';
    if(!itemFormateado.forma_pago) itemFormateado.forma_pago = 'Efectivo';

    const esVentaNueva = !safeString(itemFormateado.pedido_id);
    itemFormateado._nueva_venta = esVentaNueva;
    if (esVentaNueva) {
      itemFormateado.pedido_id = generarId();
      const CAMPOS_DE_LA_VENTA = [
        'codigo_armazon', 'tipo_armazon', 'param_horizontal', 'param_puente',
        'param_vertical', 'param_diagonal', 'tipo_lente', 'material_lente',
        'material_nota', 'accesorio_id', 'venta', 'abono', 'pago_nota',
        'estado', 'notas', 'comprobante_url', 'costo_armazon_int',
        'costo_lunas_int', 'costo_accesorio_int', 'costo_tratamientos_int',
        'costo_varios_int', 'codigo_armazon_confirmado', 'tratam_tinturado_nota',
        'tratam_foto_nota', 'tratam_trans_nota'
      ];
      CAMPOS_DE_LA_VENTA.forEach(k => { itemFormateado[k] = ''; });
      itemFormateado.descuento = '0';
      itemFormateado.forma_pago = 'Efectivo';
      itemFormateado.estado = 'En laboratorio';
      itemFormateado.tratam_ar = 'NO'; itemFormateado.tratam_ar_azul = 'NO';
      itemFormateado.tratam_azul = 'NO'; itemFormateado.tratam_tinturado = 'NO';
      itemFormateado.tratam_foto = 'NO'; itemFormateado.tratam_trans = 'NO';
      itemFormateado.tratam_ninguno = 'SI';
    }

    const visitasBrutas = (historial || []).filter(h => safeString(h?.cedula) === safeString(item.cedula) && safeString(h?.nombre) !== 'CONSUMIDOR FINAL');
    const mapaUnico = new Map();
    for (const v of visitasBrutas) {
      const fecha = safeString(v.fecha).trim();
      const esfOD = safeString(v.esfera_od).trim();
      const cilOD = safeString(v.cilindro_od).trim();
      const clave = `${fecha}_${esfOD}_${cilOD}`;
      if (!mapaUnico.has(clave) && !mapaUnico.has(fecha)) {
        mapaUnico.set(fecha, v);
      }
    }
    setMedidasPaciente(Array.from(mapaUnico.values())); 
    setPedidoSeleccionado(itemFormateado); 
    setAccesorioOriginalId(itemFormateado.accesorio_id || ''); 
    setVistaActual('pedidos_form');
  };

  const crearVentaDirecta = () => {
    const ventaNueva = {
      ...estadoInicial,
      pedido_id: generarId(),
      _nueva_venta: true,
      nombre: 'CONSUMIDOR FINAL',
      cedula: '9999999999',
      estado: 'Entregado'
    };
    setMedidasPaciente([]); 
    setPedidoSeleccionado(ventaNueva); 
    setAccesorioOriginalId(''); 
    setVistaActual('pedidos_form');
  };

  const cambiarMedicionPedido = (e) => {
    const idVisit = e.target.value; 
    const visit = (historial || []).find(h => String(h?.id) === String(idVisit));
    if (visit) {
      setPedidoSeleccionado(prev => ({ 
        ...prev, 
        esfera_od: visit.esfera_od, cilindro_od: visit.cilindro_od, eje_od: visit.eje_od, 
        adicion_od: visit.adicion_od, dnp_od: visit.dnp_od, altura_od: visit.altura_od, 
        esfera_oi: visit.esfera_oi, cilindro_oi: visit.cilindro_oi, eje_oi: visit.eje_oi, 
        adicion_oi: visit.adicion_oi, dnp_oi: visit.dnp_oi, altura_oi: visit.altura_oi 
      }));
    }
  };

  const forzarRecalculo = () => { 
    if (!pedidoSeleccionado) return; 
    setPedidoSeleccionado(prev => ({ ...prev, venta: calcularPrecioBase(prev, inventario, listaPrecios) || '' })); 
  };

  const manejarCambioPedido = (e) => {
    let { name, value, type, checked, tagName } = e.target;
    let val = type === 'checkbox' ? (checked ? 'SI' : 'NO') : value;
    if (type === 'text' || tagName === 'TEXTAREA') val = limpiarHtml(val).toUpperCase();
    
    if (name === 'venta') { 
      setPedidoSeleccionado(prev => ({ ...prev, venta: val })); 
      return; 
    }

    setPedidoSeleccionado(prev => {
      const nuevo = { ...prev, [name]: val };

      if (name === 'codigo_armazon') {
        Object.assign(nuevo, autocompletarArmazon({
          codigoAnterior: prev.codigo_armazon, codigoNuevo: val, actuales: prev, inventario
        }));
      }

      if (fieldsQueAfectanPrecio(name)) {
        if (name === 'tratam_ninguno' && val === 'SI') {
          nuevo.tratam_ar = 'NO'; nuevo.tratam_ar_azul = 'NO'; nuevo.tratam_azul = 'NO'; 
          nuevo.tratam_tinturado = 'NO'; nuevo.tratam_foto = 'NO'; nuevo.tratam_trans = 'NO';
        } else if (name.startsWith('tratam_') && name !== 'tratam_ninguno' && val === 'SI') {
          nuevo.tratam_ninguno = 'NO';
        }
        nuevo.venta = calcularPrecioBase(nuevo, inventario, listaPrecios);
      }
      return nuevo;
    });
  };

  const guardandoPedidoRef = useRef(false);
  const guardarPedido = async ({ montoAdicional = 0 } = {}) => {
    if (guardandoPedidoRef.current) return false;
    if (!pedidoSeleccionado) return false;
    guardandoPedidoRef.current = true;

    try {
      const problemaDocumento = motivoDocumentoInvalido(pedidoSeleccionado.cedula);
      if (problemaDocumento) {
        mostrarToast('No se puede guardar el pedido: ' + problemaDocumento.toLowerCase() + '.', 'warning', 7000);
        return false;
      }

      const cedulaPedido = safeString(pedidoSeleccionado.cedula).trim().toUpperCase();
      const nombrePedido = safeString(pedidoSeleccionado.nombre).trim() || (cedulaPedido === '9999999999' ? 'CONSUMIDOR FINAL' : '');
      if (!nombrePedido) {
        mostrarToast('Falta el nombre del paciente. Sin nombre no se puede emitir el recibo.', 'warning', 7000);
        return false;
      }

      const problemaMontos = validarMontosVenta({ venta: pedidoSeleccionado.venta, descuento: pedidoSeleccionado.descuento });
      if (problemaMontos) {
        mostrarToast('No se puede guardar el pedido: ' + problemaMontos, 'warning', 7000);
        return false;
      }

      const idPedido = pedidoSeleccionado.pedido_id || pedidoSeleccionado.id || generarId();
      const consultationId = pedidoSeleccionado.id || generarId();
      const cedulaPaciente = cedulaPedido;
      const nombrePaciente = nombrePedido;

      const patientId = pedidoSeleccionado.patient_id || pedidoSeleccionado.paciente_id || generarId();
      const camposPedido = [
        'venta', 'abono', 'descuento', 'forma_pago', 'pago_nota', 'estado', 
        'notas', 'comprobante_url', 'codigo_armazon', 'tipo_armazon', 
        'param_horizontal', 'param_puente', 'param_vertical', 'param_diagonal', 
        'tipo_lente', 'material_lente', 'material_nota', 'accesorio_id', 
        'tratam_ninguno', 'tratam_ar', 'tratam_ar_azul', 'tratam_azul', 
        'tratam_tinturado', 'tratam_tinturado_nota', 'tratam_foto', 
        'tratam_foto_nota', 'tratam_trans', 'tratam_trans_nota', 
        'costo_armazon_int', 'costo_lunas_int', 'costo_accesorio_int', 
        'costo_tratamientos_int', 'costo_varios_int'
      ];
      
      const venta = {};
      camposPedido.forEach(k => { venta[k] = pedidoSeleccionado[k] === '' ? null : pedidoSeleccionado[k]; });
      venta.id = idPedido;
      venta.pedido_id = idPedido;
      venta.patient_id = patientId;
      venta.consultation_id = consultationId;

      const problemaFecha = problemaFechaPedido(pedidoSeleccionado, hoy);
      if (problemaFecha) {
        mostrarToast('No se puede guardar el pedido: ' + problemaFecha, 'warning', 7000);
        return false;
      }
      venta.fecha = fechaDelPedido(pedidoSeleccionado, hoy);
      venta.abono = pedidoSeleccionado._nueva_venta ? '0' : safeString(pedidoSeleccionado.abono || '0');
      venta.pago_nota = pedidoSeleccionado.pago_nota || '';
      venta.descuento = venta.descuento ?? '0';
      venta.forma_pago = venta.forma_pago || 'Efectivo';
      venta.estado = venta.estado || 'En laboratorio';

      const montoAPagar = pedidoSeleccionado._nueva_venta
        ? Number(safeNum(pedidoSeleccionado.abono).toFixed(2))
        : Number(safeNum(montoAdicional).toFixed(2));
        
      const initialPayment = montoAPagar > 0
        ? {
            monto: montoAPagar,
            metodo: venta.forma_pago,
            referencia: safeString(pedidoSeleccionado.pago_nota) || null,
            comprobantePath: safeString(pedidoSeleccionado.comprobante_url) || null,
            idempotencyKey: pedidoSeleccionado._nueva_venta ? idPedido : generarId()
          }
        : null;

      await guardarVentaLocal({
        patient: {
          id: patientId,
          patient_id: patientId,
          cedula: cedulaPaciente,
          nombre: nombrePaciente,
          alias: pedidoSeleccionado.alias,
          telefono: pedidoSeleccionado.telefono,
          correo: pedidoSeleccionado.correo,
          fecha_nacimiento: pedidoSeleccionado.fecha_nacimiento,
          antecedentes: pedidoSeleccionado.antecedentes
        },
        consultationId,
        sale: venta,
        initialPayment
      });

      const ventaActualizada = {
        ...pedidoSeleccionado,
        ...venta,
        id: consultationId,
        pedido_id: idPedido,
        abono: String(montoAPagar > 0 ? (safeNum(venta.abono) + montoAPagar).toFixed(2) : venta.abono)
      };

      setHistorial(prev => {
        const existe = prev.some(h => String(h.id) === String(consultationId) || (safeString(h.cedula) === cedulaPaciente && !h.pedido_id));
        if (existe) {
          return prev.map(h => (String(h.id) === String(consultationId) || (safeString(h.cedula) === cedulaPaciente && !h.pedido_id)) ? { ...h, ...ventaActualizada } : h);
        }
        return [ventaActualizada, ...prev];
      });

      setVentasLocales(prev => {
        const index = prev.findIndex(v => String(v.id) === String(idPedido));
        if (index >= 0) {
          const copia = [...prev];
          copia[index] = { ...copia[index], ...ventaActualizada };
          return copia;
        }
        return [ventaActualizada, ...prev];
      });

      setPedidoSeleccionado(null);
      setVistaActual('pedidos_lista');

      const estadoSync = await sincronizarAhora({ pull: false });
      await obtenerDatos({ sync: false });

      const pendientes = estadoSync?.pending || 0;
      const descartadas = estadoSync?.descartadas || 0;
      const fallos = (estadoSync?.fallos || []).length;

      if (fallos > 0 || descartadas > 0) {
        mostrarToast(
          'Venta guardada SOLO en este dispositivo: el servidor la rechazó. Revisa el panel de sincronización.',
          'error', 9000
        );
      } else if (pendientes > 0 || estadoSync?.phase === 'offline') {
        mostrarToast(
          'Venta guardada localmente. Se subirá al recuperar conexión.',
          'warning', 5000
        );
      } else {
        mostrarToast('Venta guardada y sincronizada.', 'success');
      }
      return true;
    } catch (e) {
      mostrarToast('Error al guardar pedido: ' + e.message, 'error');
      return false;
    } finally {
      guardandoPedidoRef.current = false;
    }
  };

  const cancelarPedido = (item) => {
    if (!item.pedido_id) {
      return mostrarToast(
        'Este registro no tiene venta local, solo la consulta clínica. No hay nada que anular aquí.',
        'warning'
      );
    }

    const abono = Number(safeNum(item.abono).toFixed(2));
    const mensaje = abono > 0
      ? `¿Anular la venta? Tiene $${abono.toFixed(2)} abonado: primero se le devolverá ese dinero y luego se devolverá el stock.`
      : '¿Anular la venta y devolver el stock local?';

    solicitarConfirmacion(mensaje, async () => {
      try {
        const saleId = item.pedido_id;

        setHistorial(prev => prev.map(h => (String(h.pedido_id) === String(saleId) || String(h.id) === String(item.id)) ? { ...h, estado: 'Anulado', abono: '0' } : h));
        setVentasLocales(prev => prev.map(v => String(v.id) === String(saleId) ? { ...v, estado: 'Anulado', abono: '0' } : v));

        const resultado = abono > 0
          ? await anularVentaConReembolso({ saleId, method: 'Efectivo' })
          : await anularVentaLocal(saleId);
          
        await obtenerDatos({ sync: false });
        const estado = await sincronizarAhora({ pull: true });
        const falloServidor = estado?.phase === 'error' ? estado.lastError : null;
        
        if (falloServidor) {
          mostrarToast('Hecho en este dispositivo, pero el servidor lo rechazó: ' + falloServidor, 'error');
          return;
        }
        
        if (resultado?.productosAusentes?.length) {
          mostrarToast(
            'Venta anulada. El stock de ' + resultado.productosAusentes.length +
            ' producto(s) no se pudo devolver aquí porque no existen en este dispositivo; se devolverá al sincronizar.',
            'warning'
          );
        } else {
          mostrarToast('Venta anulada localmente.', 'success');
        }
      } catch (err) {
        mostrarToast('Error al anular: ' + err.message, 'error');
      }
    });
  };

  const enviarWhatsApp = (item) => {
    if (!item || !item.telefono) return mostrarToast("Sin teléfono.", "warning");
    const msj = `¡Hola, ${safeString(item.nombre).split(' ')[0]}! Tus lentes están listos en VER+ ÓPTICA.`;
    let telf = safeString(item.telefono).replace(/\D/g, ''); 
    if (telf.startsWith('09')) telf = '593' + telf.substring(1);
    window.open(`https://wa.me/${telf}?text=${encodeURIComponent(msj)}`, '_blank');
  };

  const queryGlobal = safeString(busqueda).toLowerCase();

  const todosLosPedidosUnificados = useMemo(
    () => unificarPedidos({ historial, ventasArchivadas, ventasLocales }),
    [historial, ventasArchivadas, ventasLocales]
  );

  const pedidosFiltrados = useMemo(
    () => filtrarPedidos(todosLosPedidosUnificados, queryGlobal),
    [todosLosPedidosUnificados, queryGlobal]
  );

  const mesActual = useMemo(() => prefijoDelMesActual(), []);

  const stats = useMemo(
    () => calcularEstadisticas({ pedidos: todosLosPedidosUnificados, historial, mesActual }),
    [todosLosPedidosUnificados, historial, mesActual]
  );

  return {
    busqueda, setBusqueda,
    pedidoSeleccionado, setPedidoSeleccionado, medidasPaciente, accesorioOriginalId,
    crearVentaDirecta, abrirPedido, cambiarMedicionPedido, forzarRecalculo,
    manejarCambioPedido, guardarPedido, cancelarPedido, enviarWhatsApp,
    pedidosFiltrados, stats
  };
}
