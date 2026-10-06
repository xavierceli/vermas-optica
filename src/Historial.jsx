import { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { safeString, buscarPacientesEnSupabase } from './utilidades';
import { normalizeCedula } from './localRepository';
import ExpedientePaciente from './componentes/ExpedientePaciente.jsx';
import ListaTarjetas from './componentes/ListaTarjetas.jsx';
import { listaSegunBusqueda } from './historial';

export default function Historial({
  historialReciente,
  enviarWhatsApp, cargarParaEditarClinico, iniciarNuevaConsulta, borrarHistoriaClinica, archivarConsultaPuntual, abrirPedido, crearNuevoPaciente,
  confirmarAccion
}) {
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState({ termino: '', datos: [] });
  const [buscando, setBuscando] = useState(false);
  const INCREMENTO = 50;
  const [visibles, setVisibles] = useState(50);
  const filasPorMostrar = visibles;

  const [expedienteActivo, setExpedienteActivo] = useState(null);
  const [registrosPaciente, setRegistrosPaciente] = useState([]);
  const [cargandoExpediente, setCargandoExpediente] = useState(false);
  
  const [filasExpandidas, setFilasExpandidas] = useState({});
  const [aliasVisibles, setAliasVisibles] = useState({});

  // BÚSQUEDA LOCAL + NUBE (con descarte de respuestas desfasadas)
  useEffect(() => {
    let activo = true;
    const termino = busquedaTexto.trim();
    if (termino.length < 2) return;

    const timer = setTimeout(async () => {
      setBuscando(true);
      const histLocal = historialReciente || [];
      const busqueda = termino.toLowerCase();
      const filtradosLocales = histLocal.filter(item =>
        safeString(item?.nombre).toLowerCase().includes(busqueda) ||
        safeString(item?.cedula).includes(busqueda) ||
        safeString(item?.alias).toLowerCase().includes(busqueda)
      );
      if (activo && filtradosLocales.length > 0) {
        setResultadosBusqueda({ termino, datos: filtradosLocales });
      }

      try {
        if (navigator.onLine) {
          const datos = await buscarPacientesEnSupabase(termino);
          if (!activo) return;
          if (datos && datos.length > 0) {
            setResultadosBusqueda({ termino, datos });
          } else if (filtradosLocales.length === 0) {
            setResultadosBusqueda({ termino, datos: [] });
          }
        }
      } catch {
        console.warn("Búsqueda en nube falló, usando datos locales.");
      } finally {
        if (activo) setBuscando(false);
      }
    }, 300);

    return () => {
      activo = false;
      clearTimeout(timer);
    };
  }, [busquedaTexto, historialReciente]);

  const hayTermino = busquedaTexto.trim().length >= 2;

  const pacientesAgrupados = useMemo(() => {
    return listaSegunBusqueda({
      busquedaTexto, resultados: resultadosBusqueda, historial: historialReciente
    }).lista;
  }, [busquedaTexto, resultadosBusqueda, historialReciente]);

  const filasVisibles = pacientesAgrupados.slice(0, filasPorMostrar);

  // Helper para generar una clave única y evitar duplicados en la evolución
  const generarClaveConsulta = (r) => {
    const id = safeString(r?.id).trim();
    const fecha = safeString(r?.fecha).trim();
    const cedula = normalizeCedula(r?.cedula);
    // Si viene un ID real no temporal lo usamos; en caso contrario, clave compuesta por cédula y fecha
    return id && !id.startsWith('temp_') ? id : `${cedula}_${fecha}`;
  };

  const abrirExpedienteCompleto = async (paciente) => {
    setExpedienteActivo(paciente);
    setFilasExpandidas({});
    setCargandoExpediente(true);
    
    const cedulaObjetivo = normalizeCedula(paciente?.cedula);
    if (!cedulaObjetivo) {
      setCargandoExpediente(false);
      return;
    }

    let mapaVisitas = new Map();

    try {
      (historialReciente || [])
        .filter(r => normalizeCedula(r?.cedula) === cedulaObjetivo)
        .filter(r => !r?.archived_at && !r?.archivedAt)
        .forEach(r => {
          const clave = generarClaveConsulta(r);
          mapaVisitas.set(clave, r);
        });

      if (mapaVisitas.size > 0) {
        const listaInicial = Array.from(mapaVisitas.values())
          .sort((a, b) => safeString(b?.fecha).localeCompare(safeString(a?.fecha)));
        setRegistrosPaciente(listaInicial);
      }
    } catch (err) {
      console.warn("Fallo al leer datos locales del paciente:", err);
    }

    try {
      if (navigator.onLine) {
        let datosConsultas = [];

        if (paciente?.patient_id || paciente?.id) {
          const resPorPid = await supabase
            .from('consultas_clinicas')
            .select('*')
            .eq('paciente_id', paciente?.patient_id || paciente?.id)
            .is('archived_at', null)
            .order('fecha', { ascending: false });
          if (resPorPid.data && resPorPid.data.length > 0) {
            datosConsultas = resPorPid.data;
          }
        }

        if (datosConsultas.length === 0) {
          const resVista = await supabase
            .from('vista_pacientes')
            .select('*')
            .eq('cedula', paciente?.cedula)
            .order('fecha', { ascending: false });
          if (resVista.data) datosConsultas = resVista.data;
        }

        if (datosConsultas && datosConsultas.length > 0) {
          datosConsultas
            .filter(d => !d?.archived_at)
            .forEach(d => {
              const clave = generarClaveConsulta(d);
              // Si ya existía, unificamos manteniendo las propiedades más completas
              const existente = mapaVisitas.get(clave);
              mapaVisitas.set(clave, { ...existente, ...d });
            });
        }

        const listaFinal = Array.from(mapaVisitas.values())
          .sort((a, b) => safeString(b?.fecha).localeCompare(safeString(a?.fecha)));

        if (listaFinal.length > 0) {
          setRegistrosPaciente(listaFinal);
        }
      }
    } catch (e) { 
      console.warn("Supabase no respondió para el expediente completo:", e);
    } finally {
      setCargandoExpediente(false);
    }
  };

  const toggleExpandir = (id) => {
    setFilasExpandidas(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAlias = (id) => {
    setAliasVisibles(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const eliminarRegistroDeExpediente = async (reg) => {
    confirmarAccion(
      `¿Deseas archivar únicamente la consulta del ${safeString(reg?.fecha)}?`,
      async () => {
        const archivada = await archivarConsultaPuntual(reg);
        if (archivada) {
          setRegistrosPaciente(prev => prev.filter(r => r?.id !== reg?.id));
        }
      }
    );
  };

  const manejarBorradoCompleto = async (item, opciones) => {
    const cedula = normalizeCedula(item?.cedula);
    const eliminado = await borrarHistoriaClinica(item, opciones);
    if (eliminado) {
      setResultadosBusqueda(prev => ({
        ...prev,
        datos: (prev.datos || []).filter(d => normalizeCedula(d?.cedula) !== cedula)
      }));
    }
    return eliminado;
  };

  const claveExpediente = safeString(expedienteActivo?.id) || safeString(expedienteActivo?.cedula);

  if (expedienteActivo) {
    return (
      <ExpedientePaciente
        expediente={expedienteActivo}
        claveExpediente={claveExpediente}
        aliasVisibles={aliasVisibles}
        cargando={cargandoExpediente}
        registros={registrosPaciente}
        filasExpandidas={filasExpandidas}
        onToggleAlias={toggleAlias}
        onToggleExpandir={toggleExpandir}
        onEliminarRegistro={eliminarRegistroDeExpediente}
        onNuevaConsulta={iniciarNuevaConsulta}
        onCargarParaEditar={cargarParaEditarClinico}
        onAbrirPedido={abrirPedido}
        onVolver={() => { setExpedienteActivo(null); setRegistrosPaciente([]); }}
      />
    );
  }

  return (
    <ListaTarjetas
      busquedaTexto={busquedaTexto}
      setBusquedaTexto={setBusquedaTexto}
      hayTermino={hayTermino}
      pacientesAgrupados={pacientesAgrupados}
      filasPorMostrar={filasPorMostrar}
      filasVisibles={filasVisibles}
      visibles={visibles}
      setVisibles={setVisibles}
      incremento={INCREMENTO}
      buscando={buscando}
      aliasVisibles={aliasVisibles}
      toggleAlias={toggleAlias}
      abrirExpedienteCompleto={abrirExpedienteCompleto}
      cargarParaEditarClinico={cargarParaEditarClinico}
      iniciarNuevaConsulta={iniciarNuevaConsulta}
      abrirPedido={abrirPedido}
      enviarWhatsApp={enviarWhatsApp}
      manejarBorradoCompleto={manejarBorradoCompleto}
      crearNuevoPaciente={crearNuevoPaciente}
    />
  );
}