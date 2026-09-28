import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(() => {
  // Se inyecta una marca de version en el bundle. Sirve para saber de un
  // vistazo que codigo ejecuta el navegador: sin esto era imposible
  // distinguir "el arreglo no funciona" de "el navegador sirve el bundle viejo".
  const buildId = Date.now().toString(36).toUpperCase();
  return {
    define: {
      __BUILD_ID__: JSON.stringify(buildId)
    },
    plugins: [
      react(),
      VitePWA({
        // 'prompt' en vez de 'autoUpdate': con autoUpdate el service worker
        // reemplaza el bundle por detras y recarga la pagina, y en una app
        // offline-first eso destruye la venta que el optometra tiene a medio
        // llenar. Con 'prompt' se avisa y el usuario decide cuando actualizar.
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'icons.svg'],
        workbox: {
          // Los PNG (icono-512.png pesa 234 kB) ya no se precachean: se
          // descargan solo cuando hacen falta. Precargarlos multiplicaba la
          // descarga de cada despliegue sin aportar nada.
          globPatterns: ['**/*.{js,css,html,ico,svg}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          // SIN skipWaiting ni clientsClaim: el service worker nuevo espera a
          // que la app llame a updateServiceWorker(true) desde el aviso de
          // "hay una version nueva". Es lo que evita perder el formulario.
        },
      manifest: {
        name: 'VER+ Óptica Sistema de Gestión',
        short_name: 'VER+ Óptica',
        description: 'Sistema de gestión de pacientes, inventario y ventas',
        // Sin esto el manifest declara lang:"en" y el launcher del PWA puede
        // tratar la app como inglesa.
        lang: 'es',
        dir: 'ltr',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Icono "maskable": Android recorta los bordes de los iconos normales
          // y dejaban el logo deformado. Este se genera con margen de seguridad.
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
      })
    ]
  };
});