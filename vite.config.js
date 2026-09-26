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
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons.svg'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          navigateFallback: 'index.html',
          // Sin esto el service worker antiguo sigue sirviendo el bundle viejo
          // aunque haya uno nuevo desplegado.
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true
        },
      manifest: {
        name: 'VER+ Óptica Sistema de Gestión',
        short_name: 'VER+ Óptica',
        description: 'Sistema de gestión de pacientes, inventario y ventas',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
        ]
      }
      })
    ]
  };
});