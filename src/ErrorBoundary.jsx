// ---------------------------------------------------------------------------
// PANTALLA BLANCA NUNCA MAS
// ---------------------------------------------------------------------------
// Si un componente revienta al dibujarse, React limpia el arbol y el usuario se
// queda con una pagina en blanco. En una optica eso es lo peor que puede pasar:
// la venta esta a medio llenar y no hay forma de volver a los datos, que si
// estan a salvo en el dispositivo pero sin interfaz donde llegar a ellos.
//
// Este componente se coloca en DOS niveles:
//   - alrededor de <App/>: si algo grave falla, la app sigue siendo usable.
//   - alrededor de cada vista: si falla el Inventario, el usuario conserva la
//     barra de navegacion y puede cambiar de seccion en lugar de perderlo todo.
//     La prop `clave` hace que al cambiar de vista se vuelva a montar, con lo
//     que el error se olvida solo en cuanto el usuario se mueve.
//
// Lo que jamas se hace aqui: borrar datos ni vaciar la cola de salida. El panel
// explica que los datos siguen ahi y ofrece tres salidas: reintentar, recargar
// la pagina o copiar el diagnostico para pedir ayuda.
import { Component } from 'react';
import { localDb } from './localDb';
import {
  describirError, detalleTecnicoError, leerErrores, registrarError, resumenErrores, textoDiagnostico
} from './registroErrores';

const BOTON = 'px-4 py-3 rounded-xl font-bold transition-colors text-sm';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, pendientes: 0, copiado: false, detalle: null };
    this.reintentar = this.reintentar.bind(this);
    this.copiar = this.copiar.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error, copiado: false, detalle: null };
  }

  componentDidCatch(error, info) {
    // Que el panel aparezca no puede depender de que la base de datos responda.
    this.setState({ info });
    void Promise.resolve(registrarError(localDb.meta, error, this.props.etiqueta || 'la aplicación'))
      .catch(() => {});
    void this.contarPendientes();
  }

  async contarPendientes() {
    try {
      const total = await localDb.outbox.count();
      this.setState({ pendientes: total });
    } catch { /* la base no responde: se muestran 0, no un error */ }
  }

  reintentar() {
    this.setState({ error: null, info: null, copiado: false, detalle: null });
  }

  async copiar() {
    const version = typeof __BUILD_ID__ === 'undefined' ? 'sin identificar' : __BUILD_ID__;
    let errores = [];
    try { errores = await leerErrores(localDb.meta); } catch { /* seguimos sin historial */ }
    const texto = textoDiagnostico({
      errores: errores.length ? errores : [describirError(this.state.error, this.props.etiqueta)],
      pendientes: this.state.pendientes,
      version
    });
    try {
      await navigator.clipboard.writeText(texto);
      this.setState({ copiado: true });
    } catch {
      // Sin permiso de portapapeles: se muestra el texto para copiarlo a mano.
      this.setState({ detalle: texto });
    }
  }

  render() {
    const { error, info, pendientes, copiado, detalle } = this.state;
    if (!error) return this.props.children;

    const seccion = this.props.etiqueta;
    const hayTrabajo = pendientes > 0;
    const detalleComponentes = typeof info?.componentStack === 'string' ? info.componentStack : '';
    const detalleCompleto = [detalleTecnicoError(error), detalleComponentes && `Componentes:\n${detalleComponentes}`]
      .filter(Boolean)
      .join('\n\n');

    return (
      <div
        role="alert"
        className="bg-white border-4 border-red-200 rounded-2xl shadow-2xl p-6 sm:p-8 max-w-2xl mx-auto my-6 text-center"
      >
        <div className="text-5xl mb-3" aria-hidden="true">🛟</div>
        <h2 className="text-xl font-black text-gray-800 mb-2">
          {seccion ? `Esta sección (${seccion}) no pudo dibujarse` : 'La aplicación no pudo dibujarse'}
        </h2>
        <p className="text-sm text-gray-600 mb-4 leading-relaxed">
          <strong className="text-gray-800">Tus datos NO se han perdido.</strong>
          {hayTrabajo
            ? ` Quedan ${pendientes} cambio(s) guardados en este dispositivo esperando enviarse.`
            : ' Lo que habías guardado sigue guardado en este dispositivo.'}
          {' '}Puedes volver a intentarlo o cambiar de sección con los botones de arriba.
        </p>

        <div className="flex flex-wrap gap-3 justify-center">
          <button type="button" onClick={this.reintentar} className={`${BOTON} bg-teal-600 hover:bg-teal-700 text-white`}>
            🔄 Reintentar
          </button>
          <button type="button" onClick={() => window.location.reload()} className={`${BOTON} bg-gray-100 hover:bg-gray-200 text-gray-700`}>
            ↻ Recargar la página
          </button>
          <button type="button" onClick={this.copiar} className={`${BOTON} bg-white border border-gray-200 hover:bg-gray-50 text-gray-600`}>
            {copiado ? '✓ Diagnóstico copiado' : '📋 Copiar diagnóstico'}
          </button>
        </div>

        {copiado && (
          <p className="mt-4 text-xs text-teal-700 font-bold">
            Pégalo en un mensaje para pedir ayuda. Incluye la versión y los errores, no datos de pacientes.
          </p>
        )}

        {detalle && (
          <textarea
            readOnly
            aria-label="Diagnóstico del error"
            className="mt-4 w-full h-40 text-[10px] font-mono border border-gray-200 rounded-lg p-2 text-left"
            value={detalle}
            onFocus={e => e.target.select()}
          />
        )}

        <details className="mt-5 text-left">
          <summary className="text-xs font-bold text-gray-500 cursor-pointer select-none">
            Detalle técnico ({resumenErrores([describirError(error, seccion)])})
          </summary>
          <pre className="mt-2 text-[10px] font-mono text-gray-500 whitespace-pre-wrap break-all bg-gray-50 rounded-lg p-3 max-h-48 overflow-auto">
            {detalleCompleto.slice(0, 1200)}
          </pre>
        </details>
      </div>
    );
  }
}
