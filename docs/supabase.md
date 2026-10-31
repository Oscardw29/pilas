# Configurar Supabase (cuentas y sincronización) · gratis

La app **no funciona sin esto**: la cuenta es obligatoria. Son unos 15 minutos.

## 1. Crear el proyecto
1. Entra en [supabase.com](https://supabase.com) → **New project** (plan Free).
2. Elige una región cercana y una contraseña de base de datos (guárdala; la app no la usa).

## 2. Crear las tablas y la seguridad
1. **SQL Editor** → **New query**.
2. Pega todo el contenido de [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) → **Run**.
3. Comprueba en **Table Editor** que existen `records` y `user_keys` con **RLS enabled**.

## 3. Autenticación por correo
**Authentication → Sign In / Providers → Email**:
- **Enable Email provider**: activado.
- **Confirm email**: activado.
- **Secure password change**: desactivado. La app ya pide la contraseña actual antes de cambiarla; con esta opción activada, Supabase exigiría además un código por correo.
- **Password requirements**: déjalo en lo mínimo (sin exigir símbolos). La app nunca envía la contraseña real: envía una clave derivada de 43 caracteres. La fuerza de la contraseña la comprueba la propia app (mínimo 10 caracteres).

## 4. Plantillas de correo con código (sin enlaces)
La app usa **códigos de 6 dígitos**, no enlaces, para que funcione igual en Android y en Windows.
En **Authentication → Emails → Templates**:

**Confirm signup**
```html
<h2>Confirma tu cuenta de ¡Pilas!</h2>
<p>Tu código es:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>Si no creaste una cuenta, ignora este correo.</p>
```

**Reset password**
```html
<h2>Recupera tu cuenta de ¡Pilas!</h2>
<p>Tu código es:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>Para conservar tus datos necesitarás también tu código de recuperación.</p>
```

## 5. Correo real (SMTP gratis)
El correo incluido en Supabase solo envía unos pocos mensajes por hora: sirve para probar, no para usuarios reales.
Crea una cuenta gratis en [Resend](https://resend.com) (3 000 correos/mes) o [Brevo](https://brevo.com) (300/día) y configúrala en
**Authentication → Emails → SMTP Settings**.

## 6. Conectar la app
**Project Settings → API Keys**: copia la **Project URL** y la **Publishable key** (`sb_publishable_…`).
Si tu proyecto solo muestra las claves antiguas, usa la `anon` `public`.

```bash
cp .env.example .env.local
```
Rellena `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env.local`.

> ⚠️ **Nunca** uses la clave `service_role` / `secret` en la app ni la subas al repositorio: salta todas las políticas RLS.

- **Web (Vercel)**: añade las mismas dos variables en *Project → Settings → Environment Variables*.
- **Instaladores (GitHub Actions)**: añádelas como *secrets* del repositorio (ver `.github/workflows/release.yml`).

## 7. Capa pública: perfiles, clasificaciones, ligas, logros, amigos y tienda
Sin este paso la app funciona igual, pero sin la sección **Comunidad** ni el panel del creador.

1. **Antes**, crea tu cuenta de creador en la app (con `oscarwis2009@gmail.com`). El rol de creador se da por correo
   **solo en el SQL**; si la cuenta aún no existe, al terminar vuelve a ejecutar la línea `insert into public.app_admins …`
   del archivo.
2. **SQL Editor** → **New query** → pega todo [`supabase/migrations/0002_social.sql`](../supabase/migrations/0002_social.sql) → **Run**.
   Si ya lo habías aplicado antes, no hace falta repetirlo.
3. **Después de 0002**, en otra **New query** pega todo
   [`supabase/migrations/0003_perfiles_ligas.sql`](../supabase/migrations/0003_perfiles_ligas.sql) → **Run**.
   Se puede volver a ejecutar sin perder datos. Una vez aplicado, para repetir la instalación ejecuta **solo 0003**:
   volver a ejecutar 0002 encima falla («cannot drop columns from view») y se cancela sin cambiar nada.

   Qué cambia con 0003:
   - **Todo perfil es público** y la app lo crea sola al entrar: el alias pasa a ser opcional y hay nombre visible
     (`display_name`, ≤ 40), biografía (`bio`, ≤ 160), color del banner por defecto (`banner_color`) y fotos por defecto
     (`avatar_path = 'default:1'` … `'default:5'`, las dibuja la app y no ocupan Storage). Los perfiles que ya existían
     toman su alias como nombre. Un perfil nuevo muestra las cinco tarjetas.
   - Las clasificaciones, el podio, Mi liga, amigos, publicaciones y la ficha del creador devuelven también `display_name`.
     `public_profile` y `admin_user` aceptan el alias o el id de la persona.
   - **«Me gusta» a perfiles** (`toggle_profile_like`): uno por persona, se puede quitar, no a uno mismo ni con un bloqueo
     (bloquear los borra), máximo 100 al día y el aviso `profile_like` llega solo la primera vez.
   - **Semanas del perfil** (`profile_week`): XP de los 7 días y hábitos visibles de cualquier semana, con las mismas
     reglas de privacidad que el perfil. `public_profile` trae `likes`, `liked_by_me` y `first_week`. Los hábitos visibles
     de otra persona solo se pueden leer (también directamente en la tabla) si muestra la tarjeta de hábitos.
   - **Publicaciones**: se puede editar el comentario (`edit_post`, máximo 30 al día; queda marcada con `edited_at`).
     «Publicaciones de tus amigos» ya no incluye las propias.
   - **Ligas por puestos**: del 1.º al 5.º suben, del 6.º al 10.º se quedan y del 11.º en adelante bajan (en Diamante nadie
     sube y en Bronce nadie baja). Si en el grupo solo compite una persona, no sube ni baja y gana 25 monedas de
     participación. Parámetros de la economía: `leaguePromoteCount` (5), `leagueStayCount` (5) y `leagueSoloPrize` (25);
     `leaguePromotePct` y `leagueDemotePct` dejan de usarse.
   - **Creador**: `admin_set_achievement` le marca o quita un logro en su propia cuenta (sin premio ni aviso; queda registrado).
   - **Reiniciar el progreso** (`reset_my_progress(p_reset_at)`, máximo 10 al día): cuando los datos del dispositivo
     cambian por completo (empezar de cero, quitar la demostración, importar una copia; cargar la demostración no reinicia:
     con datos de demostración la app simplemente no publica) borra lo publicado desde el dispositivo (días, hábitos
     visibles, logros de racha / XP / hábitos cumplidos, saldo de partida, monedas del día, extras y gastos) y deja libre el
     punto de partida. `p_reset_at` es la hora del cambio: llega desde todos los dispositivos de la cuenta, pero solo se
     atiende una vez (`profile_stats.last_reset_at`). Conserva compras, premios de liga y de logros (no se vuelven a
     cobrar), logros de monedas gastadas, ajustes del creador, publicaciones, amistades y la liga. Si el saldo queda
     negativo (por las compras), se devuelve a 0 con un ajuste `admin` de referencia `reset:…` que no cuenta como monedas
     ganadas. Al volver a reclamar el punto de partida, el tope es lo más alto que hubo publicado hasta anteayer
     (`cap_xp`, `cap_best`, `cap_done`, `cap_coins`) más lo que se pudo ganar desde el reinicio, o la antigüedad de la
     cuenta sin el año extra del primer reclamo: reiniciar no sirve para inflar el perfil. Sustituye a la versión anterior
     sin argumentos (se borra al aplicar el archivo).
   - **XP y monedas siempre enteros**: el servidor redondea lo que recibe y, al aplicar el archivo, lo ya guardado.
4. Comprueba:
   - **Table Editor**: `profiles`, `daily_stats`, `coin_ledger`, `catalog_items`… con **RLS enabled**.
   - **Storage**: buckets `avatars` (1 MB) y `catalog` (2 MB), públicos y solo `image/webp`.
   - **Database → Extensions → pg_cron** activado y, en **Integrations → Cron**, la tarea `pilas-close-week`
     (`0 5 * * 1` = lunes 00:00 de Colombia). Si el SQL avisó que no pudo programarla, activa `pg_cron` y vuelve a ejecutar
     el último bloque del archivo de 0002.
   - **Database → Publications → supabase_realtime** incluye `notifications` (avisos en tiempo real).
   - **Table Editor → profiles** tiene las columnas `display_name`, `bio` y `banner_color`, y existe `profile_likes` con
     **RLS enabled** (señal de que 0003 quedó aplicado).
5. Entra en la app con tu cuenta: en el menú de perfil aparece **Panel del creador**. Desde allí puedes **Importar muestras**
   (se suben como borradores) y publicarlas.

Qué se publica: el perfil público que la app crea al entrar (nombre, alias si lo elige, foto, biografía, cosméticos,
racha, XP por día, % de cumplimiento y los hábitos que la persona marque como visibles). Lo demás sigue cifrado de
extremo a extremo en `records`.

> ⚠️ Si la app la usan personas en Colombia aplica la Ley 1581 de 2012 de datos personales: confírmalo con asesoría legal
> antes de abrirla al público.

### Pruebas de la capa pública
`npm test` ejecuta `tests/social.sql.test.ts` contra un Postgres real en memoria (PGlite) con las migraciones 0001, 0002
y 0003: topes de XP y monedas (enteros), fechas, compras, multiplicador, cierre semanal y zonas de las ligas, logros,
ánimos, «me gusta», semanas del perfil, edición de publicaciones, reinicio del progreso, vetos y permisos.

### Cuentas en el panel del creador
Para ver todas las cuentas en **Panel del creador → Moderación** y poder eliminarlas: **SQL Editor** → **New query** → pega todo
[`supabase/migrations/0005_cuentas_panel.sql`](../supabase/migrations/0005_cuentas_panel.sql) → **Run**. Se puede volver a ejecutar.

La cuenta del creador no se puede eliminar, ni desde el panel ni desde Ajustes: el servidor lo rechaza.

### IA de la app: tus claves para todos
Con esto quien no tenga clave propia usa la IA y la voz sin configurar nada. Tus claves se guardan en el servidor y nunca
llegan a los dispositivos: la app le pide cada respuesta a una función de Supabase. Sin este paso la app funciona igual,
con el motor local y los avisos de configurar una clave.

1. **SQL Editor** → **New query** → pega todo [`supabase/migrations/0004_ia_de_la_app.sql`](../supabase/migrations/0004_ia_de_la_app.sql)
   → **Run**. Se puede volver a ejecutar.
2. **Edge Functions** → **Deploy a new function** → **Via Editor** → nómbrala exactamente `pilas-ai` → pega todo
   [`supabase/functions/pilas-ai/index.ts`](../supabase/functions/pilas-ai/index.ts) → **Deploy function**.
3. En la función, **Details** → desactiva **Verify JWT** (o «Enforce JWT verification») → **Save**. La función comprueba la
   sesión por su cuenta; dejar esa opción activa puede bloquear las peticiones de la app.
4. En la app: **Panel del creador → IA de la app** → elige proveedor, pega la clave → **Guardar** → **Probar**.

Cada servicio tiene un límite de usos al día por persona (tú no tienes tope) y el panel muestra los usos de hoy. Para
retirarlas, **Quitar clave**: se borra del servidor y vuelven el modo local y los avisos. Una clave propia en Ajustes
siempre tiene prioridad sobre las tuyas.

Si **Probar** dice que no hay respuesta de la función, revisa el nombre (`pilas-ai`) y que esté desplegada. El plan gratuito
incluye 500 000 ejecuciones de funciones al mes; lo que cobre el proveedor de IA corre por tu cuenta, por eso el límite diario.
El mensaje de cada persona pasa por la función hacia el proveedor y no se guarda en ningún sitio.

Pruebas: `tests/appAi.sql.test.ts` (la clave no se puede leer desde la app y el límite se cumple),
`tests/appAi.function.test.ts` y `tests/appAi.client.test.ts`.

## 8. Comprobar que nadie ve datos ajenos
1. Crea dos cuentas de prueba (A y B) y añade un hábito en cada una.
2. En **Table Editor → records** verás filas con `ciphertext` ilegible: no aparece ningún nombre de hábito.
3. Inicia sesión con B en otro navegador: solo aparecen los datos de B.

## Límites del plan gratuito
- 500 MB de base de datos y 50 000 usuarios activos al mes.
- **El proyecto se pausa tras ~7 días sin actividad.** Se reactiva desde el panel. Mientras está pausado, los dispositivos con sesión
  siguen funcionando sin conexión, pero nadie puede registrarse ni entrar en un dispositivo nuevo.
- La función `push_records` limita cada cuenta a 200 000 registros para que nadie llene la base.
- Storage: 1 GB de archivos y unos 5 GB al mes de transferencia. Los banners animados (hasta 2 MB) gastan rápido: los
  archivos se suben con caché de un año y nombre único, y lo animado solo se reproduce en pantalla.
- Realtime: 200 conexiones a la vez (una por app abierta con perfil público).
