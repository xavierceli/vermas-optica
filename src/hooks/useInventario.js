import { useState } from 'react';
import { safeNum, comprimirImagen } from '../utilidades';
import { createUuid as generarId } from '../localDb';
import { supabase } from '../supabaseClient';
import { guardarInventarioLocal, eliminarInventarioLocal, guardarAdjuntoLocal } from '../localRepository';
import { sincronizarAhora, sinSesionActiva } from '../syncEngine';
import { textoFotoPendiente } from '../avisosSync';
import { limpiarHtml } from '../escape';

// ---------------------------------------------------------------------------
// INVENTARIO
// ---------------------------------------------------------------------------
// Alta, edicion y baja de productos (armazones y accesorios), incluida la foto.
// La imagen se sube a la nube si hay conexion y, si falla o no hay red, se
// respalda en el dispositivo para subirla luego con el motor de sincronizacion.
// ---------------------------------------------------------------------------
export function useInventario({ invInicial, mostrarToast, obtenerDatos, solicitarConfirmacion }) {
  const [nuevoItemInv, setNuevoItemInv] = useState(invInicial);
  const [editandoInvId, setEditandoInvId] = useState(null);
  const [imagenSeleccionada, setImagenSeleccionada] = useState(null);
  const [cargandoImagen, setCargandoImagen] = useState(false);

  const manejarCambioInv = (e) => {
    let { name, value, type, tagName } = e.target;
    if (type === 'text' || tagName === 'TEXTAREA') value = limpiarHtml(value).toUpperCase();
    setNuevoItemInv({ ...nuevoItemInv, [name]: value });
  };

  const guardarItemInventario = async () => {
    try {
      setCargandoImagen(true);
      let urlImagen = nuevoItemInv.imagen_url || null;
      let fotoPendienteSync = false;

      if (imagenSeleccionada) {
        const archivoComprimido = await comprimirImagen(imagenSeleccionada);
        const nombreArchivo = `producto_${Date.now()}_${generarId().substring(0, 8)}.jpg`;

        if (navigator.onLine) {
          try {
            const { error: errSubida } = await supabase.storage
              .from('inventario_imagenes')
              .upload(nombreArchivo, archivoComprimido, { contentType: 'image/jpeg', upsert: true });
            if (errSubida) throw new Error(errSubida.message);
            urlImagen = nombreArchivo;
          } catch (errImg) {
            console.warn('[inventario] Subida online falló, respaldando localmente:', errImg);
            const adj = await guardarAdjuntoLocal({
              blob: archivoComprimido,
              nombre: nombreArchivo,
              mime: 'image/jpeg',
              bucket: 'inventario_imagenes',
              refType: 'inventario',
              refId: editandoInvId || nombreArchivo
            });
            urlImagen = adj.ruta;
            fotoPendienteSync = true;
          }
        } else {
          const adj = await guardarAdjuntoLocal({
            blob: archivoComprimido,
            nombre: nombreArchivo,
            mime: 'image/jpeg',
            bucket: 'inventario_imagenes',
            refType: 'inventario',
            refId: editandoInvId || nombreArchivo
          });
          urlImagen = adj.ruta;
          fotoPendienteSync = true;
        }
      }

      const esArmazon = nuevoItemInv.categoria === 'Armazon';
      const datosAGuardar = {
        categoria: nuevoItemInv.categoria,
        precio: Number(safeNum(nuevoItemInv.precio).toFixed(2)),
        costo_compra: Number(safeNum(nuevoItemInv.costo_compra).toFixed(2)),
        stock: nuevoItemInv.stock === '' || nuevoItemInv.stock === null ? 1 : Math.max(0, Math.round(safeNum(nuevoItemInv.stock))),
        ...(esArmazon
          ? {
              codigo: nuevoItemInv.codigo,
              tipo_armazon: nuevoItemInv.tipo_armazon,
              material: nuevoItemInv.material,
              descripcion: nuevoItemInv.descripcion,
              param_horizontal: nuevoItemInv.param_horizontal,
              param_puente: nuevoItemInv.param_puente,
              param_vertical: nuevoItemInv.param_vertical,
              param_diagonal: nuevoItemInv.param_diagonal,
              param_frontal: nuevoItemInv.param_frontal,
              param_varillas: nuevoItemInv.param_varillas
            }
          : {
              nombre_accesorio: nuevoItemInv.nombre_accesorio,
              caracteristica: nuevoItemInv.caracteristica
            })
      };

      if (urlImagen !== null) datosAGuardar.imagen_url = urlImagen;
      Object.keys(datosAGuardar).forEach(key => { if (datosAGuardar[key] === '') datosAGuardar[key] = null; });
      await guardarInventarioLocal({ id: editandoInvId || undefined, ...datosAGuardar });
      setNuevoItemInv(invInicial);
      setEditandoInvId(null);
      setImagenSeleccionada(null);
      await obtenerDatos({ sync: false });
      void sincronizarAhora({ pull: false });
      mostrarToast(
        fotoPendienteSync 
          ? textoFotoPendiente(sinSesionActiva())
          : 'Producto guardado en este dispositivo.', 
        'success'
      );
    } catch (e) {
      mostrarToast('Error: ' + e.message, 'error');
    } finally {
      setCargandoImagen(false);
    }
  };

  const cargarParaEditarInventario = (item) => { 
    let itemFormateado = { ...item };
    Object.keys(itemFormateado).forEach(key => { if (itemFormateado[key] === null) itemFormateado[key] = ''; });
    setNuevoItemInv(itemFormateado); 
    setEditandoInvId(item.id); 
    window.scrollTo({ top: 0, behavior: 'smooth' }); 
  };

  const cancelarEdicionInventario = () => { 
    setNuevoItemInv(invInicial); 
    setEditandoInvId(null); 
    setImagenSeleccionada(null); 
  };

  const eliminarItemInventario = (id) => {
    solicitarConfirmacion('¿Eliminar ítem del inventario?', async () => {
      try {
        await eliminarInventarioLocal(id);
        await obtenerDatos({ sync: false });
        void sincronizarAhora({ pull: false });
        mostrarToast('Ítem eliminado localmente.', 'success');
      } catch (err) {
        mostrarToast('Error al eliminar: ' + err.message, 'error');
      }
    });
  };

  return {
    nuevoItemInv, editandoInvId, cargandoImagen, imagenSeleccionada,
    setImagenSeleccionada, manejarCambioInv, guardarItemInventario,
    cargarParaEditarInventario, cancelarEdicionInventario, eliminarItemInventario
  };
}
