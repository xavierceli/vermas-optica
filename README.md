# VER+ Óptica — Sistema de gestión

PWA **offline-first** para la operación de una óptica: ficha e historial de
pacientes, consulta optométrica, inventario de armazones y lentes, tarifario,
pedidos y ventas, comprobantes de pago y estadísticas.

El diseño clave es que **el equipo puede trabajar sin internet**: todo se guarda
primero en el dispositivo y se sincroniza con Supabase cuando hay conexión.

## Requisitos

- Node.js `>=22.12.0` (la versión recomendada está en `.nvmrc`).
- npm.

## Arranque

```bash
npm install
npm run dev        # servidor de desarrollo con recarga en vivo
```

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Desarrollo con HMR. |
| `npm run build` | Genera la PWA en `dist/`. |
| `npm run preview` | Sirve `dist/` para probar el build de producción. |
| `npm run lint` | ESLint sobre todo el proyecto. |
| `npm run test:local` | Suite de lógica y escaneo (`node --test`). |
| `npm run test:ui` | Suite de render e interacción (Vitest + jsdom). |
| `npm run test:e2e` | Dos equipos (dos contextos de navegador) contra un Supabase falso. |
| `npm test` | Las dos primeras suites. |
| `npm run verificar:tamano` | Comprueba el presupuesto del bundle tras `npm run build` (la CI lo ejecuta). |
| `npm run verificar:respaldo -- archivo.sql` | Comprueba que un volcado de `pg_dump` sea restaurable. |

## Variables de entorno (opcionales)

La app trae credenciales de respaldo en `src/supabaseClient.js`, así que
funciona sin configurar nada. Para apuntar a otro proyecto de Supabase, copia
`.env.example` a `.env` y rellena:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

> La `anon key` (publicable) está pensada para el navegador y la protegen las
> políticas RLS del servidor. **Nunca** pongas aquí la `service_role`: esa clave
> salta todas las políticas y quedaría expuesta en el bundle.

## Arquitectura

```
App.jsx ── useGestor() ── hooks/ (un hook por dominio)
   │                          │
   │                          ├─ useDatosLocales / useSincronizacion
   │                          ├─ useClinica / usePedidos / useInventario
   │                          └─ useTarifario / useAutenticacion / useAvisos
   ▼
vistas (Login, Historial, Clinica, Inventario, Tarifario, Dashboard, Pedidos…)
   ▼
repositorio/  ── acceso a datos (lectura, escritura, payloads)
   ▼
localDb.js (Dexie / IndexedDB)  ⇄  syncEngine.js  ⇄  Supabase
```

- **`src/localDb.js`** — IndexedDB (Dexie). Es la fuente de verdad local:
  pacientes, consultas, ventas, pagos, inventario, cola de salida (`outbox`),
  adjuntos binarios y caché.
- **`src/syncEngine.js`** — sincronización: sube la cola de operaciones
  pendientes y descarga el historial por páginas. Reintenta con backoff y
  clasifica los fallos (red vs. conflicto vs. descarte).
- **`src/repositorio/`** — capa de acceso a datos sobre la base local.
- **`src/useGestor.js`** — orquestador. Compone los hooks de `src/hooks/` (uno
  por dominio) y expone una única API a `App.jsx`.
- **`src/App.jsx`** — navegación entre vistas. Las vistas se cargan con
  `React.lazy` para no descargar código que aún no se usa. El offline sigue
  garantizado porque Workbox precachea **todos** los chunks del build
  (`globPatterns` incluye `**/*.js`): al instalar la PWA quedan guardados
  aunque nunca se abran. `scripts/verificar-tamano.mjs` impide que el arranque
  o el total crezcan por encima del presupuesto.

## Despliegue

Se publica en **Vercel** (`vercel.json` incluye la CSP y las cabeceras de
seguridad). La base de datos son las migraciones de `supabase/migrations/`.

- **Producción**: <https://vermasoptica.vercel.app/> — se actualiza sola con cada
  empujón a `main`.
- **CI**: `.github/workflows/ci.yml` corre lint, las dos suites de pruebas y el
  build en cada push y en cada pull request. Si algo falla, el motivo queda en la
  pestaña *Checks* del commit.
- Las direcciones que Vercel genera por despliegue (por ejemplo
  `asistencia-xxxx-xavico.vercel.app`) piden el login de Vercel. El dominio del
  proyecto, `vermasoptica.vercel.app`, es público.

El service worker se registra en modo **"prompt"**: cuando hay una versión nueva
se avisa y el usuario decide cuándo actualizar, para no perder un formulario a
medio llenar.

## Tests

```bash
npm test          # lógica + render
npm run test:local   # lógica + escaneo de fuentes (node --test)
npm run test:ui      # render e interacción (Vitest + jsdom)
npm run test:e2e     # dos equipos (Playwright; ver abajo)
```

- **`test:local`** (`src/**/*.test.js`): **lógica pura** (reglas de precio, sync,
  validaciones, fechas…) y **escaneo de fuentes** (leen los `.jsx` como texto
  para vigilar reglas como "ninguna pantalla usa `alert()`"). Corre con el runner
  integrado de Node, sin navegador ni bundler.
- **`test:ui`** (`src/**/*.test.jsx`): monta componentes de React de verdad con
  Vitest + jsdom + Testing Library para comprobar comportamiento e interacción
  (por ejemplo, el diálogo de confirmación de una venta anulada).
- **`test:e2e`** (`e2e/*.spec.js`): dos contextos de navegador aislados = dos
  equipos, compartiendo un Supabase falso que reproduce el versionado de
  consultas (40001) y el control de stock (23514). Cubre trabajar sin internet,
  reconectar, editar la misma ficha y vender la misma unidad. La app, su Dexie y
  su motor de sync son los reales.

  ```bash
  npx playwright install chromium   # una vez por máquina
  npm run test:e2e
  # sin la descarga de Playwright, con un navegador ya instalado:
  PLAYWRIGHT_CANAL=msedge npm run test:e2e
  ```

## Documentación

- `docs/ROLES_Y_USUARIOS.md` — roles **admin / personal** y tope de 3 usuarios
  (cómo aplicarlo, comprobarlo y cambiarlo).
- `docs/RESPALDO_SERVIDOR.md` — respaldo diario del servidor, verificador de
  volcados y simulacro de restauración.
- `supabase/audit/` — consultas SQL de diagnóstico (solo lectura).
