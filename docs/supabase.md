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
   Se puede volver a ejecutar sin perder datos.
3. Comprueba:
   - **Table Editor**: `profiles`, `daily_stats`, `coin_ledger`, `catalog_items`… con **RLS enabled**.
   - **Storage**: buckets `avatars` (1 MB) y `catalog` (2 MB), públicos y solo `image/webp`.
   - **Database → Extensions → pg_cron** activado y, en **Integrations → Cron**, la tarea `pilas-close-week`
     (`0 5 * * 1` = lunes 00:00 de Colombia). Si el SQL avisó que no pudo programarla, activa `pg_cron` y vuelve a ejecutar
     el último bloque del archivo.
   - **Database → Publications → supabase_realtime** incluye `notifications` (avisos en tiempo real).
4. Entra en la app con tu cuenta: en el menú de perfil aparece **Panel del creador**. Desde allí puedes **Importar muestras**
   (se suben como borradores) y publicarlas.

Qué se publica: solo lo que cada persona acepta al crear su perfil público (alias, foto, cosméticos, racha, XP por día,
% de cumplimiento y los hábitos que marque como visibles). Lo demás sigue cifrado de extremo a extremo en `records`.

> ⚠️ Si la app la usan personas en Colombia aplica la Ley 1581 de 2012 de datos personales: confírmalo con asesoría legal
> antes de abrirla al público.

### Pruebas de la capa pública
`npm test` ejecuta `tests/social.sql.test.ts` contra un Postgres real en memoria (PGlite) con las dos migraciones:
topes de XP y monedas, fechas, compras, multiplicador, cierre semanal, logros, ánimos, vetos y permisos.

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
