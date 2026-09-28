import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { instalarCapturaGlobal } from './capturaGlobal.js'

// Se instala ANTES de pintar: asi los errores que ocurren fuera de React (una
// promesa rechazada, un manejador de evento) tambien quedan registrados. Antes
// solo se veian en la consola, que se cierra al cerrar la pestana, y el
// soporte se quedaba sin con que trabajar.
instalarCapturaGlobal();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary etiqueta="la aplicación">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
