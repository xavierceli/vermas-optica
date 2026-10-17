# Roles y usuarios (admin / personal)

VER+ separa **dos roles** y limita la app a **3 usuarios**.

| Rol | Puede hacer |
|---|---|
| **Personal** | Todo el trabajo diario: pacientes, consultas clínicas, crear/editar ventas, registrar cobros, cambiar estados, archivar consultas, ver inventario y tarifario. |
| **Admin** | Todo lo anterior **y además**: gestionar **inventario**, **tarifario (precios)**, **reembolsos**, **anular ventas** y **borrar un paciente definitivamente**. |

El personal puede **consultar** el inventario y el precios (son de solo lectura para él), pero no modificarlos.

> **Importante:** la seguridad no depende de esconder botones. El **servidor**
> comprueba el rol en cada operación (`supabase/migrations/202609240022_roles_admin_personal.sql`).
> Aunque alguien llame a la función por fuera de la app, el servidor lo rechaza.

---

## 1. Aplicar la migración (una sola vez)

Copia el contenido de `supabase/migrations/202609240022_roles_admin_personal.sql`
y ejecútalo en **Supabase → SQL Editor → New query → Run**.

Es idempotente: si lo ejecutas dos veces, no pasa nada. Crea:

- La tabla `public.perfiles` (quién es admin y quién es personal).
- Las funciones `es_admin()` y `mi_rol()`.
- Un tope de **3 usuarios** (un trigger en `auth.users`).
- La comprobación de rol dentro del servidor.

> **Orden recomendado:** aplica el SQL **antes** de publicar la nueva versión de
> la app. Así tu usuario ya queda marcado como admin cuando el navegador pregunte
> su rol.

## 2. ¿Quién es admin?

Al aplicar la migración, **el usuario más antiguo** (el tuyo, el primero que
creaste) queda como **admin** automáticamente. Todos los demás quedan como
**personal**. Sale un distintivo en la cabecera: 👑 Admin o 👤 Personal.

## 3. Comprobar los roles

En el SQL Editor:

```sql
select u.email, p.rol
from public.perfiles p
join auth.users u on u.id = p.user_id
order by u.created_at;
```

## 4. Cambiar el rol de alguien

```sql
-- Dar admin
update public.perfiles
   set rol = 'admin', actualizado_en = now()
 where user_id = (select id from auth.users where email = 'correo@ejemplo.com');

-- Quitar admin (dejarlo como personal)
update public.perfiles
   set rol = 'personal', actualizado_en = now()
 where user_id = (select id from auth.users where email = 'correo@ejemplo.com');
```

El cambio se aplica la próxima vez que esa persona inicie sesión (o al
sincronizar). Para que lo vea de inmediato, que cierre sesión y vuelva a entrar.

## 5. Añadir o quitar usuarios (máximo 3)

Los usuarios se crean en **Supabase → Authentication → Users → Add user**
(también vale "Invite"). El nuevo usuario entra como **personal**; si debe ser
admin, cámbiale el rol con el SQL del punto 4.

- El nuevo alta de perfil es automático: no hay que crear la fila a mano.
- Si ya hay **3 usuarios**, el cuarto **rebotará** con el mensaje:
  `VER+ admite 3 usuarios como maximo. Elimina un usuario antes de crear otro.`
- Para **liberar un lugar**, elimina el usuario en el panel de Supabase
  (Authentication → Users → ⋯ → Delete user). Su perfil se borra solo.

> ¿Por qué 3? Es el límite que pediste. Para cambiarlo, edita el `3` en la
> función `limitar_usuarios_vermas()` (al final del archivo de la migración) en
> una consulta nueva.

## 6. Qué pasa sin conexión

El rol se guarda en el dispositivo al iniciar sesión. Si el equipo queda sin
internet (modo PIN), la pantalla recuerda el último rol conocido y **oculta** las
acciones de admin al personal. Aunque alguien consiguiera disparar una acción
desde ese equipo, el servidor la rechaza al sincronizar, y la operación se marca
como descartada (no se reintenta en vano).

## 7. Si te equivocas y nadie queda como admin

Vuelve a marcar tu usuario como admin:

```sql
update public.perfiles set rol = 'admin'
 where user_id = (select id from auth.users where email = 'tu-correo@ejemplo.com');
```

Cierra sesión y entra de nuevo.
