import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // Se actualiza solo si haces cambios en el futuro
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'], // Archivos seguros a guardar
      workbox: {
        // Le decimos que guarde en el disco duro de la PC todo el código JS, CSS y HTML
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      },
      manifest: {
        name: 'VER+ Óptica Sistema de Gestión',
        short_name: 'VER+ Óptica',
        description: 'Sistema de control de inventario y pacientes',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone', // Esto hace que se abra como una app de escritorio, sin la barra de Chrome
        icons: [
          {
            // OJO: Usaremos un ícono genérico desde la web temporalmente para evitar errores de archivos faltantes
            src: 'https://cdn-icons-png.flaticon.com/512/3014/3014297.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
})