# Respaldo del servidor (Supabase)

> Documento de plan. **Nada de lo que se describe aquí está configurado todavía.**
> El propósito es que puedas activarlo cuando quieras, sin tener que averiguarlo todo otra vez.

Auditado el 4 de octubre de 2026.

---

## 1. La situación actual

| Capa | Estado | Qué protege |
|---|---|---|
| Respaldo del dispositivo (IndexedDB) | ✅ Funciona | Lo que el equipo tiene sin sincronizar |
| Respaldo automático de Supabase | ✅ Activo (gratis) | Hasta ~7 días de historial |
| **Respaldo diario propio del servidor** | ❌ **No existe** | El histórico largo |
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

## 2. Qué se propone

Una tarea programada en **GitHub Actions** que se ejecuta sola cada noche:

```
Cada noche 03:00 (UTC)
   └─ pg_dump de la base de Supabase
        └─ se guarda en el repositorio, en la rama respaldo-automatico
             └─ GitHub guarda el historial de cada ejecución
```

### Por qué esta opción

| Ventaja | Detalle |
|---|---|
| **Costo $0** | 2.000 min/mes incluidos en repos privados, una ejecución de ~1 min |
| **Historial largo** | Los respaldos se acumulan; no caducan a los 7 días |
| **Sin mantenimiento** | No hay servidor, ni cron, ni alertas que revisar |
| **Auditable** | Cada noche queda registrado en el historial de GitHub |

### Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Plan de pago de Supabase | Costo mensual por algo que GitHub hace gratis |
| Cron en un servidor propio | Hay que mantener el servidor siempre encendido |
| Google Drive / OneDrive con API | Depende de que el equipo esté encendido a la hora |

---

## 3. Cómo activarlo

Son cuatro pasos. **El paso 2 es el único que requiere algo que solo puedes hacer tú.**

### Paso 1 — Crear el secreto

En Supabase ve a **Project Settings → Database → Connection string** y copia la
cadena con el usuario `postgres`.

> ⚠️ Esta contraseña **no** es la `anon key` del código. Es la contraseña real de la
> base de datos. Trátala como una tarjeta: si se filtra, hay que cambiarla.

### Paso 2 — Registrarla en GitHub (nunca en el código)

1. Repo → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
3. Nombre: `DATABASE_URL`
4. Valor: la cadena de conexión del paso 1

> 🔒 **Esto es lo importante:** un secreto de GitHub no se muestra después de
> guardarlo, no aparece en el código y no se sube al repositorio. Por eso lo
> escribes tú: si lo pusiera yo en un archivo, quedaría guardado en el historial
> de Git para siempre.

### Paso 3 — Crear el archivo de la tarea

Crear `.github/workflows/respaldo-diario.yml` con el contenido que aparece en la
sección 4 de este documento.

### Paso 4 — Lanzar la primera vez a mano

Actions → **Respaldo diario** → **Run workflow**. Verifica que el archivo
`supabase/backups/YYYYMMDD_datos.sql` aparece en la rama `respaldo-automatico`.

---

## 4. El archivo de la tarea

```yaml
name: Respaldo diario

on:
  schedule:
    - cron: '0 3 * * *'   # cada noche a las 03:00 UTC
  workflow_dispatch:      # además, se puede lanzar a mano

jobs:
  respaldo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Crear el respaldo
        env:
          PGPASSWORD: ${{ secrets.DATABASE_URL }}
        run: |
          mkdir -p respaldos
          pg_dump "$DATABASE_URL" --no-owner --no-privileges \
            > "respaldos/$(date +%Y%m%d)_datos.sql"

      - name: Subirlo a la rama de respaldos
        run: |
          git config user.name  "respaldo automatico"
          git config user.email "respaldo@localhost"
          git checkout --orphan respaldo-automatico
          git add -A
          git commit -m "Respaldo $(date +%Y%m%d %H:%M)"
          git push origin respaldo-automatico
```

`--orphan` crea una rama sin historia: los respaldos **no se mezclan** con el
código de la app ni generan conflictos.

---

## 5. Cómo restaurar (para cuando haga falta)

```bash
# Descargar el respaldo de la fecha que necesites de la rama respaldo-automatico
git show respaldo-automatico:respaldos/20261004_datos.sql > respaldo.sql

# Aplicarlo a la base
psql "$DATABASE_URL" -f respaldo.sql
```

> ⚠️ **Antes de restaurar, haz una copia de lo que hay ahora.** El `psql` escribe
> sobre la base. Si restauras un respaldo viejo, **pierdes todo lo que se registró
> después de esa fecha**.

---

## 6. Las fotos: el punto ciego

Lo anterior protege **los datos**. No protege los archivos.

### Qué hay que respaldar aparte

| Bucket | Contenido | Límite por archivo |
|---|---|---|
| `comprobantes_pagos` | Comprobantes de pago | 10 MB |
| `inventario_imagenes` | Fotos del inventario | 10 MB |

Los dos son privados (`public = false`), así que un respaldo público los expondría.
No es un detalle menor.

### La opción recomendada

El respaldo del **`inventario_imagenes`** sí conviene automatizar: son fotos de
producto y se pueden volver a tomar. El de **`comprobantes_pagos`** es el delicado
y merece una decisión aparte.

### Para empezar hoy, sin instalar nada

El Supabase Dashboard permite **descargar los archivos de un bucket** a mano
(Storage → bucket → Download). Es suficiente para una copia mensual y no requiere
configurar nada.

### Para automatizarlo (opción gratuita)

Las **GitHub Actions también pueden descargar un bucket** usando la misma clave que
usa la app, guardando todo en la misma rama de respaldos.

Decisión pendiente: **¿qué pasa con los comprobantes de pago si alguien borra
uno por error desde la app?** Hoy la respuesta es "se pierde". Conviene decidirlo
antes de que ocurra.

---

## 7. Checklist

- [ ] Copiar la cadena de conexión desde Supabase → Project Settings → Database
- [ ] Registrarla como secreto `DATABASE_URL` en GitHub (Settings → Secrets → Actions)
- [ ] Crear `.github/workflows/respaldo-diario.yml` con la sección 4
- [ ] Lanzar la primera ejecución a mano y verificar el archivo `.sql`
- [ ] Decidir qué hacer con las fotos (`comprobantes_pagos` en especial)
- [ ] Probar una restauración en un entorno de pruebas **antes** de confiar en ella

> El último punto es el que más se salta la gente. Un respaldo que nunca se ha
> restaurado **no es un respaldo**: es la ilusión de tenerlo. Pruébalo una vez.

---

## 8. Nota sobre los datos de hoy

Este documento no modificó la base de datos. No se ejecutó ninguna migración,
ningún borrado masivo ni ninguna operación destructiva. El único cambio en el
repositorio es este archivo de texto.