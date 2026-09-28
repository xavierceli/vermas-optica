import { useState, useEffect, useRef, Fragment } from 'react'
import { safeString, calcularCerca, buscarPacientesEnSupabase } from './utilidades'
import { LIMITE_QUERATOMETRIA, esQueratometriaAlta } from './reglas'

const claseQueratometria = alta => `w-14 p-1 border rounded outline-none text-center text-sm font-bold focus:ring-1 focus:ring-teal-500 ${alta ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-300'}`;

// Los campos de estas tablas no pueden usar <label for>: su texto visible vive
// en el <th> de la cabecera y en el <td> del ojo, y HTML no permite etiquetar
// un input con un td. Sin aria-label, un lector de pantalla anunciaba decenas de
// veces "campo de texto, sin nombre", sin poder distinguir ojo derecho de
// izquierdo. El nombre accesible combina los dos ejes, que es como los nombra
// el optometra ("esfera ojo derecho"), y no un nombre de campo interno.
const etiqueta = (ojo, concepto) => `${concepto} ${ojo === 'od' ? 'ojo derecho' : 'ojo izquierdo'}`;

const FilaRefraccion = ({ ojo, label, paciente, manejarCambio, claseInputRef }) => (
  <tr className={ojo === 'od' ? "border-b hover:bg-gray-50" : "hover:bg-gray-50"}>
    <td className="p-2 border-r font-extrabold text-center bg-gray-50">{label}</td>
    <td className="border-r p-0"><input name={`avsl_${ojo}`} aria-label={etiqueta(ojo, 'Agudeza visual de lejos sin correccion')} value={safeString(paciente[`avsl_${ojo}`])} onChange={manejarCambio} className={claseInputRef(`avsl_${ojo}`, 'focus:bg-blue-50')} /></td>
    <td className="border-r p-0 bg-teal-50/20"><input name={`avsc_${ojo}`} aria-label={etiqueta(ojo, 'Agudeza visual de cerca sin correccion')} value={safeString(paciente[`avsc_${ojo}`])} onChange={manejarCambio} className={claseInputRef(`avsc_${ojo}`, 'focus:bg-teal-50 bg-transparent font-medium')} /></td>
    <td className="border-r p-0"><input name={`esfera_${ojo}`} aria-label={etiqueta(ojo, 'Esfera')} value={safeString(paciente[`esfera_${ojo}`])} onChange={manejarCambio} className={claseInputRef(`esfera_${ojo}`, 'focus:bg-blue-50 font-medium')} /></td>
    <td className="border-r p-0"><input name={`cilindro_${ojo}`} aria-label={etiqueta(ojo, 'Cilindro')} value={safeString(paciente[`cilindro_${ojo}`])} onChange={manejarCambio} className={claseInputRef(`cilindro_${ojo}`, 'focus:bg-blue-50 font-medium')} /></td>
    <td className="border-r p-0"><input name={`eje_${ojo}`} aria-label={etiqueta(ojo, 'Eje')} value={safeString(paciente[`eje_${ojo}`])} onChange={manejarCambio} className={claseInputRef(`eje_${ojo}`, 'focus:bg-blue-50')} /></td>
    <td className="border-r p-0"><input name={`adicion_${ojo}`} aria-label={etiqueta(ojo, 'Adicion')} value={safeString(paciente[`adicion_${ojo}`])} onChange={manejarCambio} className={claseInputRef(`adicion_${ojo}`, 'focus:bg-blue-50')} /></td>
    <td className="border-r p-0"><input name={`dnp_${ojo}`} aria-label={etiqueta(ojo, 'Distancia naso-pupilar')} value={safeString(paciente[`dnp_${ojo}`])} onChange={manejarCambio} className={claseInputRef(`dnp_${ojo}`, 'focus:bg-blue-50')} /></td>
    <td className="border-r p-0 bg-teal-50/20"><input readOnly aria-label={etiqueta(ojo, 'Cerca, suma de esfera y adicion, calculado')} value={calcularCerca(paciente[`esfera_${ojo}`], paciente[`adicion_${ojo}`])} className="w-full p-2 bg-transparent outline-none font-bold text-center text-teal-800" title="Calculado automaticamente" /></td>
    <td className="border-r p-0 bg-blue-50/30"><input name={`avcl_${ojo}`} aria-label={etiqueta(ojo, 'Agudeza visual de lejos con correccion')} value={safeString(paciente[`avcl_${ojo}`])} onChange={manejarCambio} className={claseInputRef(`avcl_${ojo}`, 'focus:bg-blue-100 bg-transparent font-medium text-blue-800')} /></td>
    <td className="p-0 bg-blue-50/30"><input name={`avcc_${ojo}`} aria-label={etiqueta(ojo, 'Agudeza visual de cerca con correccion')} value={safeString(paciente[`avcc_${ojo}`])} onChange={manejarCambio} className={claseInputRef(`avcc_${ojo}`, 'focus:bg-blue-100 bg-transparent font-medium text-blue-800')} /></td>
  </tr>
);

const FilaLensometria = ({ ojo, label, paciente, manejarCambio }) => (
  <tr className={ojo === 'od' ? "border-b hover:bg-gray-50" : "hover:bg-gray-50"}>
    <td className="p-1.5 border-r font-extrabold bg-gray-50">{label}</td>
    <td className="border-r p-0"><input name={`lenso_esf_${ojo}`} aria-label={etiqueta(ojo, 'Lensometria esfera')} value={safeString(paciente[`lenso_esf_${ojo}`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50" /></td>
    <td className="border-r p-0"><input name={`lenso_cil_${ojo}`} aria-label={etiqueta(ojo, 'Lensometria cilindro')} value={safeString(paciente[`lenso_cil_${ojo}`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50" /></td>
    <td className="border-r p-0"><input name={`lenso_eje_${ojo}`} aria-label={etiqueta(ojo, 'Lensometria eje')} value={safeString(paciente[`lenso_eje_${ojo}`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50" /></td>
    <td className="border-r p-0"><input name={`lenso_add_${ojo}`} aria-label={etiqueta(ojo, 'Lensometria adicion')} value={safeString(paciente[`lenso_add_${ojo}`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50" /></td>
    <td className="border-r p-0 bg-blue-50/30"><input name={`lenso_avl_${ojo}`} aria-label={etiqueta(ojo, 'Lensometria agudeza de lejos')} value={safeString(paciente[`lenso_avl_${ojo}`])} onChange={manejarCambio} className="w-full p-2 bg-transparent outline-none text-center focus:bg-blue-100 font-medium text-blue-800" /></td>
    <td className="p-0 bg-blue-50/30"><input name={`lenso_avc_${ojo}`} aria-label={etiqueta(ojo, 'Lensometria agudeza de cerca')} value={safeString(paciente[`lenso_avc_${ojo}`])} onChange={manejarCambio} className="w-full p-2 bg-transparent outline-none text-center focus:bg-blue-100 font-medium text-blue-800" /></td>
  </tr>
);

const BloqueAutoRef = ({ ojo, label, paciente, manejarCambio }) => (
  <Fragment>
    <tr className="border-b hover:bg-gray-50">
      <td className="p-1.5 border-r font-extrabold bg-gray-50" rowSpan="2">{label}</td>
      <td className="border-r p-0"><input name={`auto_esf_${ojo}`} aria-label={etiqueta(ojo, 'Autorrefractometria esfera')} value={safeString(paciente[`auto_esf_${ojo}`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50 border-b border-gray-100" /></td>
      <td className="border-r p-0"><input name={`auto_cil_${ojo}`} aria-label={etiqueta(ojo, 'Autorrefractometria cilindro')} value={safeString(paciente[`auto_cil_${ojo}`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50 border-b border-gray-100" /></td>
      <td className="p-0"><input name={`auto_eje_${ojo}`} aria-label={etiqueta(ojo, 'Autorrefractometria eje')} value={safeString(paciente[`auto_eje_${ojo}`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50 border-b border-gray-100" /></td>
    </tr>
    <tr className={ojo === 'od' ? "border-b hover:bg-gray-50" : "hover:bg-gray-50"}>
      <td className="border-r p-0"><input name={`auto_esf_${ojo}_2`} aria-label={etiqueta(ojo, 'Autorrefractometria esfera, segunda medida')} value={safeString(paciente[`auto_esf_${ojo}_2`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50" /></td>
      <td className="border-r p-0"><input name={`auto_cil_${ojo}_2`} aria-label={etiqueta(ojo, 'Autorrefractometria cilindro, segunda medida')} value={safeString(paciente[`auto_cil_${ojo}_2`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50" /></td>
      <td className="p-0"><input name={`auto_eje_${ojo}_2`} aria-label={etiqueta(ojo, 'Autorrefractometria eje, segunda medida')} value={safeString(paciente[`auto_eje_${ojo}_2`])} onChange={manejarCambio} className="w-full p-2 outline-none text-center focus:bg-teal-50" /></td>
    </tr>
  </Fragment>
);

const BloqueQueratometria = ({ ojo, label, paciente, manejarCambio }) => {
  // CÁLCULOS AUTOMÁTICOS DE QUERATOMETRÍA
  const k1 = parseFloat(paciente[`k1_d_${ojo}`]);
  const k2 = parseFloat(paciente[`k2_d_${ojo}`]);
  const eje1 = parseFloat(paciente[`eje_k1_${ojo}`]);
  const eje2 = parseFloat(paciente[`eje_k2_${ojo}`]);
  const k1Valido = !isNaN(k1) && k1 > 30 && k1 < 60;
  const k2Valido = !isNaN(k2) && k2 > 30 && k2 < 60;
  const k1Alta = esQueratometriaAlta(paciente, `k1_d_${ojo}`);
  const k2Alta = esQueratometriaAlta(paciente, `k2_d_${ojo}`);

  // mm = 337.5 / D (índice queratométrico estándar) — solo visual
  const k1mm = k1Valido ? (337.5 / k1).toFixed(2) : '';
  const k2mm = k2Valido ? (337.5 / k2).toFixed(2) : '';

  // Astigmatismo corneal = |K2 - K1|
  const astig = (k1Valido && k2Valido) ? Math.abs(k2 - k1).toFixed(2) : '';

  // Eje del astigmatismo = eje del meridiano MÁS PLANO (menor dioptría)
  const ejeAstig = (k1Valido && k2Valido)
    ? (k1 <= k2 ? safeString(paciente[`eje_k1_${ojo}`]) : safeString(paciente[`eje_k2_${ojo}`]))
    : '';

  // Validación: los meridianos deben ser perpendiculares (±5° de tolerancia)
  let perpendiculares = true;
  if (!isNaN(eje1) && !isNaN(eje2)) {
    let diff = Math.abs(eje1 - eje2) % 180;
    if (diff > 90) diff = 180 - diff;
    perpendiculares = Math.abs(diff - 90) <= 5;
  }

  return (
  <Fragment>
    <tr className={ojo === 'od' ? "border-b" : "border-b border-t-2 border-gray-300"}>
      <td className="p-1 border-r font-extrabold bg-gray-50 text-sm" rowSpan="3">{label}</td>
      <td className="border-r border-b p-2">
        <div className="flex justify-between items-center gap-1">
          <span className="text-xs font-bold text-gray-700">K1(pla)</span>
          <input name={`k1_d_${ojo}`} aria-label={etiqueta(ojo, 'Queratometria K1 en dioptrias')} value={safeString(paciente[`k1_d_${ojo}`])} onChange={manejarCambio} className={claseQueratometria(k1Alta)} aria-invalid={k1Alta} aria-describedby={k1Alta ? `alerta-k1-${ojo}` : undefined} title={k1Alta ? `Valor alto: supera ${LIMITE_QUERATOMETRIA.toFixed(2)} D` : ''} />{k1Alta && <span id={`alerta-k1-${ojo}`} role="status" className="text-[9px] font-black text-red-600">ALTA</span>}
        </div>
      </td>
      <td className="border-r border-b p-2 bg-gray-50">
        <div className="flex justify-between items-center gap-1">
          <span className="text-xs font-bold text-gray-700">K1</span>
          <input readOnly aria-label={etiqueta(ojo, 'Radio de curvatura K1, calculado como 337.5 dividido para K1')} value={k1mm} className="w-14 p-1 bg-transparent outline-none font-black text-gray-800 text-center text-sm" title="Calculado: 337.5 / K1" />
        </div>
      </td>
      <td className="border-r border-b p-2">
        <div className="flex justify-between items-center gap-1">
          <span className="text-xs font-bold text-gray-700">Rad1</span>
          <input name={`eje_k1_${ojo}`} aria-label={etiqueta(ojo, 'Eje de K1')} value={safeString(paciente[`eje_k1_${ojo}`])} onChange={manejarCambio} className="w-14 p-1 border border-gray-300 rounded outline-none text-center text-sm font-bold focus:ring-1 focus:ring-teal-500" placeholder="°" />
        </div>
      </td>
      <td className="p-1" rowSpan="3">
        <textarea name={`obs_k_${ojo}`} aria-label={etiqueta(ojo, 'Observaciones de queratometria')} value={safeString(paciente[`obs_k_${ojo}`])} onChange={manejarCambio} className="w-full h-full min-h-[90px] p-2 border border-gray-300 rounded outline-none resize-none text-xs bg-gray-50 focus:bg-white focus:ring-1 focus:ring-teal-500" placeholder="Notas..."></textarea>
      </td>
    </tr>
    <tr className="border-b">
      <td className="border-r border-b p-2">
        <div className="flex justify-between items-center gap-1">
          <span className="text-xs font-bold text-gray-700">K2(cur)</span>
          <input name={`k2_d_${ojo}`} aria-label={etiqueta(ojo, 'Queratometria K2 en dioptrias')} value={safeString(paciente[`k2_d_${ojo}`])} onChange={manejarCambio} className={claseQueratometria(k2Alta)} aria-invalid={k2Alta} aria-describedby={k2Alta ? `alerta-k2-${ojo}` : undefined} title={k2Alta ? `Valor alto: supera ${LIMITE_QUERATOMETRIA.toFixed(2)} D` : ''} />{k2Alta && <span id={`alerta-k2-${ojo}`} role="status" className="text-[9px] font-black text-red-600">ALTA</span>}
        </div>
      </td>
      <td className="border-r border-b p-2 bg-gray-50">
        <div className="flex justify-between items-center gap-1">
          <span className="text-xs font-bold text-gray-700">K2</span>
          <input readOnly aria-label={etiqueta(ojo, 'Radio de curvatura K2, calculado como 337.5 dividido para K2')} value={k2mm} className="w-14 p-1 bg-transparent outline-none font-black text-gray-800 text-center text-sm" title="Calculado: 337.5 / K2" />
        </div>
      </td>
      <td className="border-r border-b p-2">
        <div className="flex justify-between items-center gap-1">
          <span className="text-xs font-bold text-gray-700">Rad2</span>
          <input name={`eje_k2_${ojo}`} aria-label={etiqueta(ojo, 'Eje de K2')} value={safeString(paciente[`eje_k2_${ojo}`])} onChange={manejarCambio} className={`w-14 p-1 border rounded outline-none text-center text-sm font-bold focus:ring-1 focus:ring-teal-500 ${perpendiculares ? 'border-gray-300' : 'border-amber-400 bg-amber-50'}`} placeholder="°" title={perpendiculares ? '' : 'Aviso: Rad1 y Rad2 no son perpendiculares (deberían diferir ~90°) — revisa la lectura'} />
        </div>
      </td>
    </tr>
    <tr className="bg-teal-50/40">
      <td className="border-r p-2">
        <div className="flex justify-between items-center gap-1">
          <span className="text-xs font-black text-teal-800">Ast.Cor</span>
          <input readOnly aria-label={etiqueta(ojo, 'Astigmatismo corneal, diferencia entre K2 y K1')} value={astig} className="w-14 p-1 bg-white border border-teal-400 rounded outline-none font-black text-teal-800 text-center text-sm shadow-sm" title="Calculado: |K2 - K1|" />
        </div>
      </td>
      <td className="border-r p-2 bg-gray-50"></td>
      <td className="border-r p-2">
        <div className="flex justify-between items-center gap-1">
          <span className="text-xs font-bold text-gray-700">Eje</span>
          <input readOnly aria-label={etiqueta(ojo, 'Eje del astigmatismo, meridiano mas plano')} value={ejeAstig} className="w-14 p-1 bg-white border border-teal-400 rounded outline-none font-black text-teal-800 text-center text-sm shadow-sm" title="Calculado: eje del meridiano más plano" />
        </div>
      </td>
    </tr>
  </Fragment>
);
};

export default function Clinica({
  paciente, setPaciente, estadoInicial, editandoId, setEditandoId,
  guardarPacienteClinico, manejarCambio, edadActual, claseInputRef, historial,
  guardando
}) {
  const [sugerenciasCedula, setSugerenciasCedula] = useState([]);
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);
    const [sugerenciasNube, setSugerenciasNube] = useState([]);
  const timerNube = useRef(null);

  useEffect(() => () => { if (timerNube.current) clearTimeout(timerNube.current); }, []);

  const manejarEscrituraCedula = (e) => {
    manejarCambio(e); 
    const val = e.target.value.trim();
    
    // Búsqueda en la NUBE con pausa: encuentra pacientes aunque no estén en los últimos 100 locales
    if (timerNube.current) clearTimeout(timerNube.current);
    if (val.length >= 3 && navigator.onLine) {
      timerNube.current = setTimeout(async () => {
        try {
          const resultados = await buscarPacientesEnSupabase(val);
          setSugerenciasNube((resultados || []).filter(r => safeString(r?.nombre) !== 'CONSUMIDOR FINAL').slice(0, 5));
        } catch { /* silencioso: si falla, las sugerencias locales siguen */ }
      }, 400);
    } else {
      setSugerenciasNube([]);
    }
    
    if (val.length >= 2) {
      const base = [...sugerenciasNube, ...(historial || [])];
      const matches = base.filter(h => 
        h && safeString(h?.nombre) !== 'CONSUMIDOR FINAL' &&
        (safeString(h?.cedula).includes(val) || safeString(h?.nombre).toLowerCase().includes(val.toLowerCase()) || safeString(h?.alias).toLowerCase().includes(val.toLowerCase()))
      );
      const unicos = Array.from(new Set(matches.map(s => s.cedula)))
        .map(ced => matches.find(s => s.cedula === ced));
      setSugerenciasCedula(unicos.slice(0, 5));
      setMostrarSugerencias(true);
    } else {
      setSugerenciasCedula([]);
      setMostrarSugerencias(false);
    }
  };

  const seleccionarPacienteSugerido = (pac) => {
    setPaciente({
      ...estadoInicial,
      cedula: pac.cedula || '',
      nombre: pac.nombre || '',
      alias: pac.alias || '',
      telefono: pac.telefono || '',
      correo: pac.correo || '',
      fecha_nacimiento: pac.fecha_nacimiento || '',
      antecedentes: pac.antecedentes || ''
    });
    setSugerenciasNube([]);
    setMostrarSugerencias(false);
  };

  const [visitaSeleccionadaId, setVisitaSeleccionadaId] = useState('');
  
  const visitasAnteriores = (historial || []).filter(h => 
    safeString(h?.cedula) === safeString(paciente?.cedula) && safeString(h?.cedula) !== '' && safeString(h?.nombre) !== 'CONSUMIDOR FINAL'
  );

  const cargarVisitaAnterior = (e) => {
    const id = e.target.value;
    setVisitaSeleccionadaId(id);
    if (!id) return;
    const encontrada = visitasAnteriores.find(v => String(v.id) === String(id));
    if (encontrada) {
      setPaciente(prev => ({
        ...prev,
        ...encontrada,
        id: prev.id, 
        fecha: prev.fecha 
      }));
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-8 border-t-4 border-teal-600 space-y-6 relative pb-10">
      {/* 1. BOTÓN SUPERIOR */}
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">{editandoId ? 'Editando Medición Clínica' : 'Registrar Nueva Medición Clínica'}</h2>
          <p className="text-xs text-gray-500">Completa los campos o consulta visitas anteriores.</p>
        </div>
        <div className="flex items-center gap-3">
          {editandoId && (
            <button 
              type="button"
              disabled={guardando}
              onClick={() => {setEditandoId(null); setPaciente(estadoInicial)}} 
              className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            >
              Cancelar
            </button>
          )}
          <button 
            type="button"
            onClick={guardarPacienteClinico} 
            disabled={guardando}
            className={`text-white px-6 py-2.5 rounded-lg font-bold shadow-md transition-all flex items-center justify-center gap-2 ${
              guardando 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-teal-600 hover:bg-teal-700 active:scale-95'
            }`}
          >
            {guardando ? <><span>⏳</span> Guardando...</> : '💾 Guardar Clínica'}
          </button>
        </div>
      </div>

      {visitasAnteriores.length > 0 && !editandoId && (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex flex-col md:flex-row justify-between items-center gap-3">
          <div>
            <h4 className="font-bold text-blue-900 text-sm">📁 Historial Clínico Previo Encontrado</h4>
            <p className="text-xs text-blue-700">Este paciente ya tiene {visitasAnteriores.length} consulta(s) previa(s) registrada(s).</p>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <select value={visitaSeleccionadaId} onChange={cargarVisitaAnterior} className="p-2 bg-white border border-blue-300 rounded-lg text-xs font-medium outline-none flex-1 md:w-64">
              <option value="">-- Ver medidas de fechas anteriores --</option>
              {visitasAnteriores.map(v => (
                <option key={v.id} value={v.id}>📅 Fecha: {v.fecha} | Esf OD: {v.esfera_od || '0'} / OI: {v.esfera_oi || '0'}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-6 gap-5 relative">
        <div><label htmlFor="clin-fecha" className="block text-sm font-semibold text-gray-700 mb-1">Fecha</label><input id="clin-fecha" name="fecha" value={safeString(paciente.fecha)} onChange={manejarCambio} type="date" className="w-full p-2 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500" /></div>
        
        <div className="relative">
          <label htmlFor="clin-cedula" className="block text-sm font-semibold text-teal-700 mb-1">Cédula o Nombre</label>
          <input 
            id="clin-cedula"
            name="cedula" 
            value={safeString(paciente.cedula)} 
            onChange={manejarEscrituraCedula} 
            onFocus={() => { if(safeString(paciente.cedula).length >= 2) setMostrarSugerencias(true); }}
            type="text" 
            className="w-full p-2 bg-teal-50 border border-teal-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 placeholder-teal-600/50 font-bold" 
            placeholder="Escribe para buscar..." 
          />
          {mostrarSugerencias && sugerenciasCedula.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-teal-200 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
              <div className="p-1 bg-teal-100 text-[10px] font-bold text-teal-800 uppercase px-2">Pacientes Coincidentes:</div>
              {sugerenciasCedula.map(s => (
                <div key={s.id} onClick={() => seleccionarPacienteSugerido(s)} className="p-2 hover:bg-teal-50 cursor-pointer border-b border-gray-100 text-xs flex justify-between items-center">
                  <span className="font-bold text-gray-800">{s.nombre} {s.alias && <span className="text-gray-500 font-normal italic">({s.alias})</span>}</span>
                  <span className="text-teal-600 font-mono">🆔 {s.cedula}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="md:col-span-2"><label htmlFor="clin-nombre" className="block text-sm font-semibold text-gray-700 mb-1">Nombre Completo</label><input id="clin-nombre" name="nombre" value={safeString(paciente.nombre)} onChange={manejarCambio} type="text" className="w-full p-2 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500 font-medium" /></div>
        <div><label htmlFor="clin-nacimiento" className="block text-sm font-semibold text-gray-700 mb-1">F. Nacimiento {edadActual !== '' && <span className="text-teal-600">({edadActual} años)</span>}</label><input id="clin-nacimiento" name="fecha_nacimiento" value={safeString(paciente.fecha_nacimiento)} onChange={manejarCambio} type="date" className="w-full p-2 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500" /></div>
        <div><label htmlFor="clin-telefono" className="block text-sm font-semibold text-gray-700 mb-1">Teléfono</label><input id="clin-telefono" name="telefono" value={safeString(paciente.telefono)} onChange={manejarCambio} type="text" className="w-full p-2 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500" /></div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div>
          <label htmlFor="clin-correo" className="block text-sm font-semibold text-gray-700 mb-1">Correo Electrónico</label>
          <input id="clin-correo" name="correo" value={safeString(paciente.correo)} onChange={manejarCambio} type="email" className="w-full p-2 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <div>
          <label htmlFor="clin-alias" className="block text-sm font-semibold text-gray-700 mb-1">Alias / Referencia <span className="font-normal text-xs text-gray-400">(Opcional)</span></label>
          <input id="clin-alias" name="alias" value={safeString(paciente.alias)} onChange={manejarCambio} type="text" className="w-full p-2 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500 placeholder-gray-400" placeholder="Ej: Vecino panadería, Papá de Luis..." />
        </div>
        <div>
          <label htmlFor="clin-notas_clinicas" className="block text-sm font-semibold text-teal-700 mb-1">Notas Clínicas:</label>
          <input id="clin-notas_clinicas" name="notas_clinicas" value={safeString(paciente.notas_clinicas)} onChange={manejarCambio} type="text" className="w-full p-2 bg-teal-50/30 border border-teal-100 rounded-lg outline-none focus:ring-2 focus:ring-teal-500" placeholder="Novedades del paciente..." />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-teal-800 mb-2 border-b pb-1">Agudeza Visual y Refracción <span className="text-xs font-normal text-gray-500">(Obligatorios)</span></h3>
        <div className="overflow-x-auto border rounded-lg shadow-sm">
          <table className="w-full text-left border-collapse bg-white text-sm">
            <thead>
              <tr className="bg-blue-50/50 text-blue-900 border-b">
                <th className="p-2 border-r font-bold w-10 text-center">Ojo</th><th className="p-2 border-r font-semibold">A.V.S.L</th><th className="p-2 border-r font-semibold text-teal-700">A.V.S.C</th><th className="p-2 border-r font-semibold">Esfera</th><th className="p-2 border-r font-semibold">Cilindro</th><th className="p-2 border-r font-semibold">Eje</th><th className="p-2 border-r font-semibold">Add</th><th className="p-2 border-r font-semibold">DNP</th><th className="p-2 border-r font-semibold text-teal-700" title="Esfera + Adición">CERCA</th><th className="p-2 border-r font-semibold text-blue-700">A.V.C.L</th><th className="p-2 font-semibold text-blue-700">A.V.C.C</th>
              </tr>
            </thead>
            <tbody>
              <FilaRefraccion ojo="od" label="OD" paciente={paciente} manejarCambio={manejarCambio} claseInputRef={claseInputRef} />
              <FilaRefraccion ojo="oi" label="OI" paciente={paciente} manejarCambio={manejarCambio} claseInputRef={claseInputRef} />
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div>
            <h3 className="text-md font-bold text-teal-800 mb-2 border-b pb-1">Lensometría (RX Anterior)</h3>
            <div className="overflow-hidden border rounded-lg shadow-sm">
              <table className="w-full text-center border-collapse bg-white text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-700 border-b">
                    <th className="p-1.5 border-r w-10">Ojo</th><th className="p-1.5 border-r">Esfera</th><th className="p-1.5 border-r">Cilindro</th><th className="p-1.5 border-r">Eje</th><th className="p-1.5 border-r">Add</th><th className="p-1.5 border-r text-blue-700">A.V.L</th><th className="p-1.5 text-blue-700">A.V.C</th>
                  </tr>
                </thead>
                <tbody>
                  <FilaLensometria ojo="od" label="O.D" paciente={paciente} manejarCambio={manejarCambio} />
                  <FilaLensometria ojo="oi" label="O.I" paciente={paciente} manejarCambio={manejarCambio} />
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-md font-bold text-teal-800 mb-2 border-b pb-1">Autorrefractometría</h3>
            <div className="overflow-hidden border rounded-lg shadow-sm">
              <table className="w-full text-center border-collapse bg-white text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-700 border-b">
                    <th className="p-1.5 border-r w-10">Ojo</th><th className="p-1.5 border-r">Esfera (SPH)</th><th className="p-1.5 border-r">Cilindro (CYL)</th><th className="p-1.5">Eje (AX)</th>
                  </tr>
                </thead>
                <tbody>
                  <BloqueAutoRef ojo="od" label="O.D" paciente={paciente} manejarCambio={manejarCambio} />
                  <BloqueAutoRef ojo="oi" label="O.I" paciente={paciente} manejarCambio={manejarCambio} />
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 flex flex-col gap-4">
          <div>
            <h3 className="text-md font-bold text-teal-800 mb-2 border-b pb-1">Antecedentes Clínicos</h3>
            <textarea name="antecedentes" aria-label="Antecedentes medicos del paciente" value={safeString(paciente.antecedentes)} onChange={manejarCambio} className="w-full min-h-[55px] p-2 border rounded-lg outline-none resize-none text-sm focus:ring-2 focus:ring-teal-500 shadow-sm" placeholder="Alergias, cirugías previas, diabetes, hipertensión..."></textarea>
          </div>
          <div>
            <h3 className="text-md font-bold text-teal-800 mb-2 border-b pb-1">Queratometría</h3>
            <div className="border rounded-lg shadow-sm bg-white p-2 overflow-x-auto">
              <table className="w-full text-center border-collapse text-xs min-w-[500px]">
                <thead>
                  <tr className="bg-gray-100 text-gray-700 border-b">
                    <th className="p-2 border-r w-[8%]">Ojo</th>
                    <th className="p-2 border-r w-[27%]">Dioptrías (D)</th>
                    <th className="p-2 border-r w-[20%] bg-gray-50">M/M (Auto)</th>
                    <th className="p-2 border-r w-[20%]">Eje</th>
                    <th className="p-2 w-[25%]">Observaciones</th>
                  </tr>
                </thead>
                <tbody>
                  <BloqueQueratometria ojo="od" label="O.D" paciente={paciente} manejarCambio={manejarCambio} />
                  <BloqueQueratometria ojo="oi" label="O.I" paciente={paciente} manejarCambio={manejarCambio} />
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* 2. BOTÓN INFERIOR VISIBLE Y CONTRASTADO */}
      <div className="w-full border-t-2 border-teal-500 pt-6 mt-6 bg-teal-50/40 p-4 rounded-xl flex flex-col sm:flex-row justify-end items-center gap-4">
        {editandoId && (
          <button 
            type="button"
            disabled={guardando}
            onClick={() => {setEditandoId(null); setPaciente(estadoInicial)}} 
            className="w-full sm:w-auto bg-gray-400 hover:bg-gray-500 text-white px-6 py-3 rounded-xl font-bold transition-colors"
          >
            Cancelar Edición
          </button>
        )}
        <button 
          type="button"
          onClick={guardarPacienteClinico} 
          disabled={guardando}
          className={`w-full sm:w-auto text-white px-10 py-3.5 rounded-xl font-black text-base shadow-xl transition-all flex items-center justify-center gap-2 ${
            guardando 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-teal-600 hover:bg-teal-700 active:scale-95 shadow-teal-300'
          }`}
        >
          {guardando ? <><span>⏳</span> Guardando...</> : '💾 Guardar Medición Clínica'}
        </button>
      </div>
    </div>
  );
}