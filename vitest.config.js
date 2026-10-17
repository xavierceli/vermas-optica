import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Configuración aparte de vite.config.js a propósito: aquí no hacen falta la PWA
// ni el build de producción, solo el transformador de JSX y un DOM (jsdom) para
// montar componentes de React de verdad.
//
// Se separa con claridad de la suite de `node --test`:
//   - src/**/*.test.js   -> lógica pura y escaneo de fuentes (npm run test:local)
//   - src/**/*.test.jsx  -> render e interacción (npm run test:ui)
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.jsx'],
    setupFiles: ['./src/pruebas/setup.js'],
  },
});
