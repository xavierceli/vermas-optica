# Respaldo del servidor (Supabase)

> **Estado:** respaldo diario activo, verificado y **con restauración probada**
> (simulacro automático en verde el 2026-11-18). Falta decidir el respaldo de los
> comprobantes de pago y, si se quiere, el ensayo manual con la app.
>
> Un respaldo que nunca se restauró **no es un respaldo**: es la ilusión de
> tenerlo. Por eso la última sección es un simulacro paso a paso.

Auditado el 4 de octubre de 2026. Actualizado con la automatización.

---

## 1. La situación actual

| Capa | Estado | Qué protege |
|---|---|---|
| Respaldo del dispositivo (IndexedDB) | ✅ Funciona | Lo que el equipo tiene sin sincronizar |
| Respaldo automático de Supabase | ✅ Activo (gratis) | Hasta ~7 días de historial |
| **Respaldo diario propio del servidor** | 🟡 Automatización lista, secreto pendiente | El histórico largo |
| **Fotos de comprobantes e inventario** | ❌ **No se respaldan** | Evidencia de pagos y del inventario |

El único rastro de un respaldo manual es
`supabase/backups/202609240012_rls_solo_lectura.sql.bak` (copiado en septiembre).

### Qué pasa si algo sale mal hoy

| Accidente | ¿Se puede recuperar? |
|---|---|
| Se borra un paciente desde la app | ⚠️ Solo con el respaldo de 7 días de Supabase |
| Se borra la base entera | ✅ Sí, hasta ~7 días |
| **Se borra un comprobante de pago** | ❌ **No.** El bucket no entra en el respaldo de la base |
| **Se borra una foto del inventario** | ❌ **No.** Mismo caso |

**Los comprobantes de pago son el punto más delicado**: son la evidencia de que un
paciente pagó. `pg_dump` copia **datos de tablas**, nunca los archivos de Storage.

---

## 2. Qué hace la automatización

```
Cada noche 03:00 (UTC)
   └─ GitHub Actions levanta PostgreSQL 17 y hace pg_dump del esquema public
        └─ scripts/verificar-respaldo.mjs comprueba que el volcado sirva
             └─ se publica en la rama `respaldo-automatico`
                  └─ GitHub guarda el historial de cada ejecución
```

| Ventaja | Detalle |
|---|---|
| **Costo $0** | Una ejecución de ~1 min; entra en los minutos incluidos |
| **Historial largo** | Los respaldos se acumulan; no caducan a los 7 días |
| **Falla cerrado** | Un volcado cortado no se publica: el verificador corta el job |
| **Sin mantenimiento** | No hay servidor, ni cron propio, ni alertas que revisar |

### Por qué se verifica antes de publicar

`pg_dump` que se corta por red, timeout o credencial vencida deja un `.sql` que
pesa y tiene `CREATE TABLE`: parece válido. El verificador exige:

- las 10 tablas críticas y las 9 funciones críticas;
- que **cada tabla traiga bloque `COPY`** (esquema sin datos no sirve);
- la marca final `PostgreSQL database dump complete`;
- que no haya líneas `ERROR`/`FATAL` mezcladas;
- coherencia mínima (no puede haber consultas con 0 pacientes).

Además informa el número de filas por tabla, que es lo que se compara después
de restaurar.

### Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Plan de pago de Supabase | Costo mensual por algo que GitHub hace gratis |
| Cron en un servidor propio | Hay que mantener el servidor siempre encendido |
| Google Drive / OneDrive con API | Depende de que el equipo esté encendido a la hora |

---

## 3. Cómo activarlo (4 pasos)

### Paso 1 — Copiar la cadena de conexión

En Supabase: **Project Settings → Database → Connection string → Session pooler**.

> ⚠️ Usa el **Session pooler** (puerto `5432`), no el Transaction pooler
> (`6543`): el segundo no admite `pg_dump`.
>
> ⚠️ Esta contraseña **no** es la `anon key` del código. Es la contraseña real de
> la base de datos. Trátala como una tarjeta: si se filtra, hay que cambiarla.

### Paso 2 — Registrarla en GitHub (nunca en el código)

1. Repo → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
3. Nombre: `DATABASE_URL`
4. Valor: la cadena completa del paso 1

> 🔒 Un secreto de GitHub no se muestra después de guardarlo, no aparece en el
> código y no se sube al repositorio. Por eso lo escribes tú.

### Paso 3 — El archivo ya está creado

No hay que pegar nada: `.github/workflows/respaldo-diario.yml` ya existe y está
versionado. Si el secreto falta, el trabajo termina con un aviso y **no falla**,
para no llenar la bandeja de errores mientras se configura.

### Paso 4 — Lanzar la primera vez a mano

Actions → **Respaldo diario** → **Run workflow**.

Comprueba:

1. El resumen del job muestra el informe del verificador (tablas, filas, OK).
2. En la rama `respaldo-automatico` aparece `respaldos/YYYYMMDD_HHMMSS_datos.sql`.
3. `Activity` de esa rama tiene exactamente un commit, sin código de la app.

---

## 4. Qué contiene (y qué no) el respaldo

| Incluye | No incluye |
|---|---|
| Tablas del esquema `public` | Usuarios de `auth` (se recrean: hay 3 como máximo) |
| Funciones, RLS, políticas y permisos | Archivos de Storage (fotos y comprobantes) |
| Datos de pacientes, consultas, ventas, pagos, inventario | Configuración del proyecto (URLs, claves, buckets) |
| Revisiones de consultas y operaciones aplicadas | Extensiones gestionadas por Supabase |

Se usa `--no-owner --schema=public`: el dueño lo pone el proyecto destino y no se
arrastran esquemas internos de Supabase. **Los `GRANT` sí se conservan** (no se
usa `--no-privileges`), porque sin ellos la app restaurada no podría leer nada.

---

## 5. Simulacro de restauración

Hay dos formas. La **automática** es la recomendada para el día a día: no
instala nada y no puede tocar producción. La manual sirve para probar además la
app contra la copia.

### 5.0 Opción C (recomendada) — simulacro automático en GitHub

El workflow `.github/workflows/simulacro-restauracion.yml` levanta un
PostgreSQL 17 temporal dentro de la ejecución, restaura el último respaldo y
compara los conteos con los del volcado. No usa secretos ni toca Supabase.

1. GitHub → **Actions** → **Simulacro de restauracion** → **Run workflow**.
2. Espera 2–3 minutos.
3. En el resumen verás una tabla `tabla: filas del respaldo -> filas restauradas`
   y `OK: la restauracion coincide con el respaldo`.

Qué comprueba de verdad:

- que el volcado restaure sin errores (roles, `auth`, claves foráneas, triggers);
- que los conteos coincidan tabla por tabla;
- que estén las 9 funciones críticas y las políticas RLS.

Qué **no** comprueba: que la app funcione contra esa copia (para eso, 5.2–5.5)
ni los archivos de Storage.

> Si algún día falla, el paso rojo dice exactamente qué tabla o función falta.
> Eso es precisamente lo que se quiere descubrir **antes** de necesitar el
> respaldo de verdad.

### 5.1 Descargar el respaldo

```bash
git fetch origin respaldo-automatico
git show origin/respaldo-automatico:respaldos/20261004_030000_datos.sql > respaldo.sql
node scripts/verificar-respaldo.mjs respaldo.sql   # debe decir OK

# pg_dump incluye "CREATE SCHEMA public;", que ya existe: se quita esa linea.
sed -E '/^CREATE SCHEMA (IF NOT EXISTS )?"?public"?;?[[:space:]]*$/d'   respaldo.sql > respaldo-sin-schema.sql
```

### 5.2 Opción A — PostgreSQL local con Docker

```bash
# Base limpia (puerto 5433 para no chocar con nada)
docker run -d --name vermas-restore \
  -e POSTGRES_PASSWORD=prueba -p 5433:5432 postgres:17
```

El volcado fue hecho en Supabase, así que referencia roles y funciones que un
Postgres pelado no tiene. Se crean antes de restaurar:

```bash
# El preludio vive en el repositorio: crea auth, extensions, los roles internos
# de Supabase y las funciones auth.uid()/role()/jwt()/email().
docker exec -i vermas-restore psql -U postgres -d postgres   -v ON_ERROR_STOP=1 < scripts/restauracion/preludio.sql

# Recrea en auth.users los ids que referencia public.perfiles.
node scripts/preparar-restauracion.mjs respaldo-sin-schema.sql   | docker exec -i vermas-restore psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Restaurar con `ON_ERROR_STOP=1` (si algo falla, se ve en el acto):

```bash
docker exec -i vermas-restore psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < respaldo-sin-schema.sql
```

### 5.3 Opción B — Proyecto de prueba de Supabase

1. Crear un proyecto gratuito **aparte** del de producción.
2. Copiar su cadena del **Session pooler**.
3. `psql "$DATABASE_URL_PRUEBA" -v ON_ERROR_STOP=1 -f respaldo-sin-schema.sql`
4. Crear un usuario de prueba en Authentication → Users (los usuarios no vienen
   en el respaldo).

### 5.4 Comprobar que los datos están

```sql
select 'pacientes' as tabla, count(*) from public.pacientes_perfil
union all select 'consultas', count(*) from public.consultas_clinicas
union all select 'ventas', count(*) from public.pedidos_ventas
union all select 'items', count(*) from public.pedido_items
union all select 'pagos', count(*) from public.pagos
union all select 'inventario', count(*) from public.inventario
union all select 'precios', count(*) from public.lista_precios;

-- Debe haber políticas y las funciones críticas
select count(*) as politicas from pg_policies where schemaname = 'public';
select proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('aplicar_operaciones','guardar_consulta_clinica_v2','crear_venta');
```

Los conteos deben coincidir con los que imprimió el verificador al crear el
respaldo. Si cambian, el respaldo no es de la fecha que crees.

### 5.5 Probar la app contra la copia

```bash
# .env.local (no se sube: está en .gitignore)
VITE_SUPABASE_URL=https://<proyecto-de-prueba>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key del proyecto de prueba>
npm run dev
```

Recorrido mínimo:

1. Iniciar sesión con el usuario de prueba.
2. Abrir el historial y comprobar que aparecen pacientes y ventas.
3. Guardar una consulta nueva y una venta.
4. Recargar y confirmar que siguen ahí.

Anota el tiempo total del simulacro. Si un día hay que restaurar de verdad, ese
número es el que importa.

### 5.6 Limpiar

```bash
docker rm -f vermas-restore
```

---

## 6. Las fotos: el punto ciego

Lo anterior protege **los datos**. No protege los archivos.

| Bucket | Contenido | Límite por archivo |
|---|---|---|
| `comprobantes_pagos` | Comprobantes de pago | 10 MB |
| `inventario_imagenes` | Fotos del inventario | 10 MB |

Los dos son privados (`public = false`), así que un respaldo público los expondría.

- **`inventario_imagenes`**: se puede automatizar; son fotos de producto y se
  pueden volver a tomar.
- **`comprobantes_pagos`**: es el delicado y merece una decisión aparte. Hoy, si
  alguien borra uno desde la app, se pierde.

Para empezar sin configurar nada, el Dashboard permite descargar un bucket a mano
(Storage → bucket → Download): sirve para una copia mensual.

Decisión pendiente: **¿qué pasa con los comprobantes de pago si alguien borra
uno por error desde la app?**

---

## 7. Checklist

- [ ] Copiar la cadena del **Session pooler** desde Supabase
- [ ] Registrarla como secreto `DATABASE_URL` en GitHub
- [x] Crear `.github/workflows/respaldo-diario.yml`
- [x] Verificar el volcado antes de publicarlo (`scripts/verificar-respaldo.mjs`)
- [ ] Lanzar la primera ejecución a mano y ver el `.sql` en la rama
- [x] Simulacro automático de restauración (`simulacro-restauracion.yml`)
- [x] Simulacro automático ejecutado en verde (2026-11-18): restauración completa y conteos coincidentes
- [ ] Hacer el simulacro manual con la app (sección 5.2–5.5) y anotar el tiempo
- [ ] Decidir qué hacer con las fotos (`comprobantes_pagos` en especial)

---

## 8. Nota sobre los datos de hoy

Este documento y la automatización no modificaron la base de datos. No se ejecutó
ninguna migración, ningún borrado masivo ni ninguna operación destructiva. El
workflow solo lee (`pg_dump`) y, si el secreto no está, ni siquiera eso.
