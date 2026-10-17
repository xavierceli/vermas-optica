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
| `npm run test:local` | Suite de tests (`node --test`, sin dependencias extra). |

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
- **`src/App.jsx`** — navegación entre vistas. Las vistas se importan de forma
  **estática a propósito**: el service worker precachea un único bundle para que
  todo funcione sin conexión. Por eso no se usa `React.lazy`.

## Despliegue

Se publica en **Vercel** (`vercel.json` incluye la CSP y las cabeceras de
seguridad). La base de datos son las migraciones de `supabase/migrations/`.

El service worker se registra en modo **"prompt"**: cuando hay una versión nueva
se avisa y el usuario decide cuándo actualizar, para no perder un formulario a
medio llenar.

## Tests

```bash
npm run test:local
```

Son dos tipos: **lógica pura** (reglas de precio, sync, validaciones, fechas…) y
**de escaneo de fuentes** (leen los `.jsx` como texto para vigilar reglas como
"ninguna pantalla usa `alert()`"). No renderizan React, por eso corren con el
runner integrado de Node y sin navegador ni bundler.

## Documentación

- `docs/RESPALDO_SERVIDOR.md` — plan de respaldo del servidor (pendiente de
  activar).
- `supabase/audit/` — consultas SQL de diagnóstico (solo lectura).
