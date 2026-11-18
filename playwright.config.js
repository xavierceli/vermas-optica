import { defineConfig, devices } from '@playwright/test';

// ---------------------------------------------------------------------------
// PRUEBAS E2E DE DOS EQUIPOS
// ---------------------------------------------------------------------------
// Se levanta el servidor de desarrollo (no `preview`) porque las pruebas
// importan los modulos reales de la app desde `/src/...`, igual que hace Vite en
// desarrollo. El backend es falso y vive en el proceso de Node: no se toca
// Supabase de produccion ni hace falta ninguna credencial.
//
//   npm run test:e2e           (requiere: npx playwright install chromium)
//   npm run test:e2e -- --ui   (modo interactivo)
// ---------------------------------------------------------------------------
export default defineConfig({
  testDir: './e2e',
  // Cada prueba es un escenario con dos o tres contextos y un servidor propio.
  // En paralelo se pisarian entre si, y el objetivo es justo el orden de los
  // eventos. Se ejecutan de una en una.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    video: 'off'
  },
  projects: [
    // En CI se usa el Chromium que instala Playwright. En una maquina sin esa
    // descarga se puede apuntar a un navegador ya instalado:
    //   PLAYWRIGHT_CANAL=msedge npm run test:e2e
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PLAYWRIGHT_CANAL ? { channel: process.env.PLAYWRIGHT_CANAL } : {})
      }
    }
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
});
