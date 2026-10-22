# Plan de implementación: ¡Pilas! multiplataforma + cuentas sincronizadas

> Estado: **en implementación** (revisado el 2026-10-21 tras integrar `main`). Presupuesto: **0 USD**.

## Ajustes tras revisar los cambios de `main` (2026-10-21)

Los 46 commits nuevos (coach Pilo/Pila, Laboratorio, Tienda, racha, voz) **no chocan con el plan**. Ajustes:

| Cambio en `main` | Ajuste en el plan |
|---|---|
| `api/relay.ts` se eliminó; ahora solo existe `api/fish-tts.ts` (`_fishRelay.ts`), con comprobación de `Origin`, modelo y límite de texto | S1 queda resuelto por ese relay. En nativo, Fish Audio se llama **directo** con HTTP nativo (misma petición que el relay) |
| Se eliminaron el asistente de voz y el dictado (`voice.ts`, `voiceInput.ts`, `useDictation`) | Se quita `speechRecognition` de la capa de plataforma y el permiso `RECORD_AUDIO` de Android |
| La voz vive en `lib/coachVoice.ts`; ElevenLabs y OpenAI se llaman directo (permiten CORS) | Solo Fish Audio necesita `platform.http` (TTS y saldo en `voiceCheck.ts`) |
| La bienvenida usa `isFirstRun` (miraba `localStorage['constancia-v2']`) y se empieza siempre desde cero | «Primer uso» = la cuenta no tiene datos ni en local ni en la nube tras la primera sincronización |
| Nuevos ajustes `userGender` y `coachMuted` | Se sincronizan con el resto de `settings` |
| Más usos de `localStorage` (avisos del coach, guía del mapa, notificaciones enviadas) | Son preferencias de interfaz del dispositivo, sin datos sensibles: se quedan en `localStorage` |
| La fase 0 ya estaba hecha en esta rama | Integrada con `main` (se añadió el peso 800 de Inter que usa el diseño nuevo) |

Decisiones de implementación:
- Se reemplaza el middleware `persist` de Zustand por un **suscriptor propio** (`src/db/persistence.ts`) que compara referencias y JSON por registro: no se tocan las acciones del store.
- El router es `HashRouter` en Capacitor y Tauri y `BrowserRouter` en la web.
- En Tauri no se inyecta el CSP `<meta>` de Vite (bloquearía el IPC); se usa el de `tauri.conf.json`.
- Al cerrar sesión, la casilla «olvidar también las claves API» viene **marcada** por defecto (equipos compartidos).


## Estado de implementación (2026-10-21)

| Fase | Estado | Dónde |
|---|---|---|
| F0 · Limpieza | ✅ Hecho | sin pruebas de notificaciones, Inter local, sin `HTTP-Referer` |
| F1 · Base local + plataforma | ✅ Hecho | `src/db/`, `src/platform/`, `src/store/useSecrets.ts` |
| F2 · Cuentas E2E | ✅ Hecho (falta probar con tu Supabase) | `src/crypto/`, `src/account/`, `src/components/auth/`, `supabase/migrations/0001_init.sql` |
| F3 · Sincronización | ✅ Hecho (probado con un servidor en memoria) | `src/sync/`, `tests/` |
| F4 · Android | ✅ Proyecto listo, **sin compilar** (falta Android Studio / JDK 21) | `android/`, `capacitor.config.ts`, [android.md](android.md) |
| F5 · Windows / Linux | ✅ Proyecto listo, **sin compilar** (falta Rust + C++ Build Tools) | `src-tauri/`, [desktop.md](desktop.md) |
| F6 · PWA y distribución | ✅ Hecho | `/descargar`, `.github/workflows/release.yml` |
| F7 · Verificación | 🟡 Pruebas automáticas (13) y revisión en navegador hechas; faltan la prueba real con Supabase y entre dispositivos | — |

Lo que tienes que hacer tú: [supabase.md](supabase.md) (crear el proyecto y pegar el SQL), y para generar `.apk` / `.exe`, instalar las herramientas de [android.md](android.md) y [desktop.md](desktop.md).

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Android | **Capacitor** → APK firmado con keystore propio, descargable desde la web |
| Windows / Linux | **Tauri 2** → `.exe` (NSIS) y `.msi` / `.AppImage` y `.deb` |
| iOS / macOS | **PWA** (la actual). Notificaciones solo con la app abierta |
| Datos locales | **IndexedDB (Dexie)** en todas las plataformas, como base de datos local real |
| Cuentas | **Supabase Auth, correo + contraseña, cuenta obligatoria** |
| Datos en la nube | **Cifrado de extremo a extremo (E2E)**: Supabase solo guarda texto cifrado |
| Claves API | **Nunca se sincronizan**: se quedan cifradas en cada dispositivo |
| Pruebas de notificaciones | **Se eliminan** de Ajustes |

---

## Arquitectura objetivo

```
                ┌────────────────────── src/ (un solo código React) ──────────────────────┐
                │  Vistas + Zustand (estado en memoria)                                    │
                │        │ persistencia async                                              │
                │  ┌─────▼──────────┐   ┌────────────┐   ┌──────────────┐                  │
                │  │ db/ (Dexie)    │◄──│ sync/      │──►│ crypto/      │                  │
                │  │ records + meta │   │ push/pull  │   │ claves, AES  │                  │
                │  └────────────────┘   └─────┬──────┘   └──────────────┘                  │
                │  platform/ ── web | capacitor | tauri  (http, notificaciones, voz, SW)   │
                └─────────────────────────────┼────────────────────────────────────────────┘
                                              │ solo texto cifrado + JWT
                                     ┌────────▼────────┐
                                     │ Supabase (free) │  auth.users · user_keys · records (RLS)
                                     └─────────────────┘
   Proveedores de IA / voz ◄── directo desde el dispositivo con las claves locales
   (en PWA, la voz sigue pasando por api/relay.ts por CORS)
```

**Principio:** la base de datos local es la fuente de verdad y la app funciona sin conexión.
Supabase es una réplica cifrada que sirve para pasar los datos de un dispositivo a otro.

---

## Fase 0 · Limpieza y arreglos rápidos (≈1 día)

1. **Eliminar las pruebas de notificaciones** (instrucción 7)
   - `src/views/SettingsView.tsx`: quitar `handleTestNotification` (~l.436), los 6 botones «Probar» (~l.1364–1581) y los imports que queden sin usar (`triggerTestNotification`, `NotificationType` si aplica).
   - `src/lib/notifications.ts`: borrar `triggerTestNotification` (~l.466–543) y los helpers que solo usaba ella.
   - Mantener el botón de **pedir permiso** y los interruptores y horarios.
2. **Fuentes locales:** reemplazar Google Fonts (`index.html:16-22`) por `@fontsource/inter`. Es necesario para que las apps nativas funcionen sin conexión y elimina una filtración de IP.
3. Arreglos de la auditoría que no dependen de lo demás (ver sección de seguridad: S1, S7, S8, S10).

## Fase 1 · Base de datos local + capa de plataforma (≈4–5 días)

### 1.1 Capa de plataforma `src/platform/`
```ts
type PlatformKind = 'web' | 'android' | 'tauri';
interface Platform {
  kind: PlatformKind;
  http: (url: string, init: RequestInit) => Promise<Response>;   // sin CORS en nativo
  notify: (p: NotificationPayload) => Promise<boolean>;
  requestNotificationPermission: () => Promise<'granted' | 'denied' | 'unsupported'>;
  speechRecognition?: SpeechAdapter;   // undefined → la UI oculta el dictado nativo
  registerServiceWorker: () => Promise<void>;  // no-op en nativo
}
```
- Detección: `Capacitor.isNativePlatform()` y `'__TAURI_INTERNALS__' in window`.
- Se cargan con `import()` dinámico para que el bundle web no incluya los plugins nativos.
- `lib/notifications.ts` llama a `platform.notify` en lugar de `new Notification` o el SW. El bucle de 25 s (`App.tsx:90`) se mantiene: avisos con la app abierta.
- `lib/voice.ts → relayFetch`: en nativo usa `platform.http` directo al proveedor; en web sigue con `/api/relay`.

### 1.2 Base de datos local `src/db/` (Dexie sobre IndexedDB)
- **¿Por qué IndexedDB y no SQLite?** Funciona igual en el navegador, en el WebView de Android y en los de Tauri (WebView2 y WebKitGTK), con una sola implementación. En las apps nativas vive en el directorio de datos de la app y solo se borra al desinstalarla. En la PWA se pide `navigator.storage.persist()`. La copia cifrada en Supabase cubre cualquier borrado.
- Una base por usuario: `pilas-<userId>`. Tablas:
  - `records`: `[collection+id]`, `value`, `updatedAt`, `deleted`, `dirty`
  - `meta`: `lastPulledAt`, `schemaVersion`, `snapshotHash`…
- **Colecciones sincronizables** (cada elemento es un registro):
  `goals, habits, sessions, energy, challenges, experiments, relations, weeklyReviews, checkins, habitReviews, rewards, redemptions, pointEvents, conversations` (por `id`),
  `logs` (por su clave `fecha|hábito`), `achievements / recommendationFeedback / dismissedInsights` (por clave del mapa), y `settings`, `hasStreakFreeze`, `streakFreezes`, `activeConversationId` como registros únicos.
- **Solo del dispositivo (no se sincronizan):** `activeTimer`, el registro de notificaciones enviadas y las claves API.

### 1.3 Persistencia de Zustand
- Sustituir `createJSONStorage(() => safeLocalStorage)` (`useStore.ts:657`) por un adaptador async que:
  - al cargar, arma `AppData` a partir de `records`;
  - al guardar (con *debounce* de ~500 ms), **compara con la instantánea anterior** colección por colección y escribe solo los elementos que cambiaron o se borraron, con `dirty=1` y `updatedAt=now`.
  - Así **no hay que tocar las ~40 acciones del store** para añadir `updatedAt`.
- Pantalla de carga mientras se hidrata (Zustand `onRehydrateStorage`).
- **Migración:** si existe `localStorage['constancia-v2']`, se importa a la base del usuario tras el primer inicio de sesión (ver Fase 3) y luego se borra.

### 1.4 Claves API en el dispositivo
- `useSecrets` pasa de `localStorage` a IndexedDB, **siempre cifradas** con una *device key* AES-GCM **no extraíble** (`extractable:false`) guardada en IndexedDB. El JavaScript puede usarla, pero no copiarla ni exportarla.
- Se mantiene la contraseña local opcional (la capa PBKDF2 actual) como protección extra.
- Se migra `localStorage['constancia-secrets']` y después se borra.

## Fase 2 · Criptografía E2E y cuentas (≈5–6 días)

### 2.1 Derivación de claves (modelo tipo Bitwarden)
```
masterKey  = PBKDF2-SHA256(contraseña, salt = email normalizado, 600 000 iter.)
authSecret = HKDF(masterKey, "pilas-auth")  → base64 → es la "contraseña" que recibe Supabase
kek        = HKDF(masterKey, "pilas-kek")   → AES-GCM 256, envuelve la DEK
DEK        = clave aleatoria AES-256 de la cuenta (cifra todos los registros)
ridKey     = HKDF(DEK, "pilas-rid")         → HMAC para ids opacos
```
- **Supabase nunca recibe la contraseña real**, solo `authSecret`, así que el servidor no puede derivar la KEK.
- **Código de recuperación** (24 caracteres, se muestra una sola vez al registrarse y se pide confirmarlo): envuelve otra copia de la DEK.
- Tras iniciar sesión, la DEK y la `ridKey` se guardan como `CryptoKey` **no extraíbles** en IndexedDB. Así la app abre sin conexión y sin volver a pedir la contraseña.

### 2.2 Flujos de cuenta (pantalla obligatoria antes de `<Shell/>`)
| Flujo | Pasos |
|---|---|
| **Registro** | correo + contraseña (mín. 10 caracteres y medidor de fuerza, porque Supabase no ve la real) → `signUp` → **código OTP de 6 dígitos** por correo (sin enlaces, para no depender de *deep links*) → se generan la DEK y el código de recuperación → se sube `user_keys` |
| **Inicio de sesión** | derivar → `signInWithPassword(email, authSecret)` → descargar `user_keys` → desenvolver la DEK → sincronizar |
| **Olvidé la contraseña** | `resetPasswordForEmail` con plantilla OTP → `verifyOtp({type:'recovery'})` → nueva contraseña + **código de recuperación** → re-envolver la DEK. Sin código: «Restablecer datos de la nube» (nueva DEK y se vuelven a subir los datos locales de este dispositivo, si los hay) |
| **Cambiar contraseña** | contraseña actual → `updateUser({password: newAuthSecret})` → re-envolver la DEK |
| **Cerrar sesión** | borra la base local del usuario, la sesión y las claves de cifrado; casilla opcional «olvidar también las claves API de este dispositivo» |
| **Eliminar cuenta** | RPC `delete_my_account()` (`security definer`) que borra `records`, `user_keys` y `auth.users` del propio usuario |

- La sesión de Supabase (*refresh token*) se guarda con un `storage` personalizado en IndexedDB, no en `localStorage`.
- **No se permite cambiar el correo** en esta versión, porque es el *salt*.

### 2.3 Esquema Supabase (`supabase/migrations/0001_init.sql`)
```sql
create table public.user_keys (
  user_id uuid primary key references auth.users on delete cascade,
  kdf jsonb not null,                    -- {alg, iterations, version}
  wrapped_dek_pw text not null,
  wrapped_dek_recovery text not null,
  updated_at timestamptz not null default now()
);

create table public.records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  rid text not null,                     -- HMAC(ridKey, coleccion|id): opaco
  ciphertext text not null,              -- AES-GCM(iv‖{collection,id,value})
  client_updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, rid)
);
create index on public.records (user_id, server_updated_at);

alter table public.user_keys enable row level security;
alter table public.records  enable row level security;
create policy own_keys on public.user_keys for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_records on public.records for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- trigger: server_updated_at = now() en insert/update
-- rpc push_records(jsonb): upsert ... on conflict do update ... where records.client_updated_at < excluded.client_updated_at
-- rpc delete_my_account()
```
- El servidor no ve ni nombres de colección ni ids: solo cuántos registros hay y cuándo cambian.
- En el cliente solo va la **publishable/anon key** (es pública por diseño; la protección es RLS). La `service_role` **nunca** entra al repo ni al bundle.
- Variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env.local`, más un `.env.example`.

## Fase 3 · Motor de sincronización `src/sync/` (≈4–5 días)

- **Push:** registros con `dirty=1` → cifrar → `rpc('push_records')` en lotes de 200 → `dirty=0`.
- **Pull:** `select * where server_updated_at > lastPulledAt order by server_updated_at` (paginado) → descifrar → aplicar con **LWW por registro** (gana el `client_updated_at` mayor) → refrescar Zustand.
- **Cuándo se sincroniza:** al abrir, al recuperar conexión o foco, 5 s después de cada cambio y cada 2 min con la app abierta. Realtime queda para después.
- **Borrados:** se guardan como lápidas (`deleted=true`); se purgan pasados 90 días.
- **Primer inicio de sesión en un dispositivo con datos locales previos** (`constancia-v2`):
  - nube vacía → se suben los datos locales;
  - nube con datos → diálogo: «Usar los de la nube» / «Combinar» (LWW) / «Reemplazar la nube con este dispositivo».
- Indicador en el Shell: sincronizado · pendiente · sin conexión · error.
- Ajustes: «Cuenta y sincronización» (correo, última sincronización, cambiar contraseña, ver o regenerar el código de recuperación, cerrar sesión, eliminar cuenta).
- **El respaldo JSON se mantiene** (exportar e importar), con opción de cifrarlo con contraseña.

## Fase 4 · Android con Capacitor (≈3–4 días) — *paralelizable con la Fase 5*

- `npm i @capacitor/core @capacitor/android @capacitor/local-notifications @capacitor/app` + `-D @capacitor/cli @capacitor/assets`; `npx cap init "¡Pilas!" app.pilas.habitos --web-dir dist`; `npx cap add android`.
- `capacitor.config.ts`: `plugins.CapacitorHttp.enabled = true` (fetch nativo sin CORS para la voz), `android.allowMixedContent = false`.
- Notificaciones: `@capacitor/local-notifications` (el WebView de Android **no** soporta `new Notification`). Hay que pedir `POST_NOTIFICATIONS` (Android 13+).
- Dictado: `@capacitor-community/speech-recognition` (el WebView no tiene `webkitSpeechRecognition`) más `RECORD_AUDIO` en el manifiesto. Deepgram sigue como alternativa.
- Iconos y *splash*: `npx capacitor-assets generate` a partir de `public/icon-512.png`.
- Botón «Atrás» de Android: `App.addListener('backButton')` cierra el modal o navega hacia atrás.
- **APK firmado (gratis):** `keytool -genkey -v -keystore pilas-release.jks …` → `./gradlew assembleRelease`. El `.jks` y sus contraseñas van **fuera del repo** (se añaden `*.jks` y `*.keystore` a `.gitignore`). **Si se pierde el keystore no se pueden publicar actualizaciones**, así que hay que guardar una copia segura.
- Requisitos locales: JDK 21 y Android Studio (SDK), ambos gratis.
- Scripts: `build:android` = `vite build && cap sync android`.

## Fase 5 · Windows y Linux con Tauri 2 (≈3–4 días) — *paralelizable con la Fase 4*

- `npm i -D @tauri-apps/cli` + `npm i @tauri-apps/api @tauri-apps/plugin-http @tauri-apps/plugin-notification`; `npx tauri init` → `src-tauri/`.
- `tauri.conf.json`: `frontendDist: ../dist`, `devUrl: http://localhost:5173`, identificador `app.pilas.habitos`, `bundle.targets: ["nsis","msi","appimage","deb"]`, CSP propia con Supabase y los proveedores.
- `capabilities/default.json`: `http:default` con **allowlist** solo de los hosts de IA, voz y Supabase; `notification:default`.
- Micrófono: WebView2 lo pide por sí mismo. El dictado nativo **no existe** en WebView2 ni en WebKitGTK → se oculta y se ofrece Deepgram.
- Ventana: tamaño mínimo y opción de minimizar a la bandeja (opcional, fuera del alcance mínimo).
- **Builds:**
  - Windows: local (`npx tauri build`), con Rust + Visual Studio Build Tools (gratis).
  - Linux: **no se puede compilar desde Windows** → GitHub Actions con `tauri-apps/tauri-action` (gratis en repos públicos; 2000 min/mes en privados) o WSL2.
- Aviso de SmartScreen: documentar «Más información → Ejecutar de todas formas». Más adelante: Microsoft Store (registro gratuito para particulares).

## Fase 6 · PWA (iOS/macOS) y distribución (≈2 días)

- PWA: el SW y el manifiesto se mantienen; `connect-src` del CSP (`vite.config.ts`) añade `https://<proyecto>.supabase.co`; `navigator.storage.persist()`.
- Router: verificar que `BrowserRouter` funciona al recargar en Capacitor y en Tauri; si falla, usar `HashRouter` solo en nativo.
- Página **/descargar** en la web: botones de APK, `.exe` y `.AppImage` (enlaces a GitHub Releases), instrucciones para «Añadir a pantalla de inicio» en iOS y «Añadir al Dock» en macOS, y avisos de SmartScreen y de «orígenes desconocidos» en Android.
- GitHub Actions `release.yml`: con cada tag `v*` se compila Windows, Linux y Android (keystore como *secret* del repo) y se publica la *release*.

## Fase 7 · Verificación (≈2–3 días)

- Añadir **Vitest**: cifrado (ida y vuelta, código de recuperación, cambio de contraseña), diff de instantáneas → registros, LWW, migración desde `constancia-v2`.
- Prueba manual entre dispositivos: crear un hábito en Android → aparece en Windows y en la PWA; editar sin conexión en ambos → se resuelve el conflicto.
- Revisar que `records.ciphertext` no contenga texto legible (consulta directa en el panel de Supabase).
- Repetir la revisión de seguridad sobre el diff completo.

---

## Auditoría de seguridad (instrucción 6)

Lo que **ya está bien**: las claves van en cabeceras (nunca en la URL), están separadas de los respaldos, el import de respaldos se valida, las acciones del coach usan lista blanca y piden confirmación, no hay `dangerouslySetInnerHTML` ni `eval`, el SW no cachea `/api` ni otros orígenes y `.gitignore` cubre `.env` y los respaldos.

| # | Hallazgo | Riesgo | Arreglo (fase) |
|---|---|---|---|
| S1 | `api/relay.ts` es un **proxy abierto**: cualquiera puede usarlo para llamar a OpenAI, ElevenLabs y demás con sus propias claves y gastar tu cuota de Vercel; acepta **cualquier ruta** de esos hosts y no limita el tamaño | Medio | Allowlist de rutas exactas (`v1/tts`, `v1/audio/speech`, `v1/listen`, `v1/text-to-speech/*`), comprobar `Origin`, límite de tamaño del cuerpo (F0) |
| S2 | Claves API en `localStorage` **en texto plano por defecto**: cualquier XSS o extensión del navegador las lee | Medio | Cifradas siempre con una *device key* no extraíble (F1.4) |
| S3 | Los datos personales que se sincronicen quedarían visibles para el dueño del proyecto Supabase | Alto (nuevo) | E2E + ids opacos (F2) |
| S4 | Supabase vería la contraseña real y podría derivar la clave E2E | Alto (nuevo) | Se envía `authSecret` derivado, no la contraseña (F2.1) |
| S5 | RLS mal configurado = datos de todos los usuarios expuestos | Crítico (nuevo) | RLS en todas las tablas + prueba con dos cuentas (F2.3, F7) |
| S6 | El *refresh token* de Supabase en `localStorage` | Medio (nuevo) | `storage` personalizado en IndexedDB y borrado al cerrar sesión (F2.2) |
| S7 | Google Fonts filtra la IP en cada arranque | Bajo | Fuentes locales (F0) |
| S8 | OpenRouter recibe `HTTP-Referer: window.location.origin` | Bajo | Enviar un valor fijo `https://pilas.app` o quitarlo (F0) |
| S9 | El coach envía hábitos, fallos y notas a la IA elegida | Informativo | Aviso claro en el Coach + interruptor «no compartir notas» |
| S10 | `npm run dev:lan` expone el proxy de voz a toda la red local | Bajo | Documentarlo; usarlo solo en redes de confianza (F0) |
| S11 | Los respaldos JSON exportados van sin cifrar (incluyen los chats) | Bajo | Opción «cifrar respaldo con contraseña» (F3) |
| S12 | Las notificaciones muestran nombres de hábitos en la pantalla de bloqueo | Bajo | `visibility: private` en Android (F4) |
| S13 | El CSP solo existe en la build web | Medio (nuevo) | CSP propio en `tauri.conf.json`; en Capacitor, el `<meta>` del build (F4/F5) |
| S14 | El keystore de Android o la clave del *updater* se suben al repo por error | Alto (nuevo) | `.gitignore` + *secrets* de GitHub (F4) |
| S15 | La copia de seguridad automática de Android subiría a Google Drive la base local, la sesión y las claves del dispositivo sin cifrar | Alto (nuevo) | `allowBackup=false` + reglas de extracción vacías (F4) ✅ |
| S16 | Sin conexión y con el token caducado, la app se quedaba en «Abriendo…» (Supabase reintenta la renovación) | Medio (nuevo) | Límite de 3 s y sesión guardada (F2) ✅ |
| S17 | Al cerrar sesión con una renovación de token en curso, los tokens podían quedar guardados | Medio (nuevo) | Borrado explícito de `auth:*` (F2) ✅ |

**Estado:** S1–S8 y S10–S17 resueltos. S9 (el coach envía un resumen de hábitos a la IA) es inherente a usar IA en la nube: se añadió el aviso bajo el chat; el contexto no incluye notas personales.

---

## Coste 0 USD: límites a tener en cuenta

- **Supabase Free:** 500 MB de base de datos y 50 000 usuarios activos al mes. **El proyecto se pausa tras ~1 semana sin actividad**: se reactiva desde el panel. Mientras está pausado, los dispositivos con sesión iniciada siguen funcionando sin conexión, pero nadie puede registrarse ni iniciar sesión en otro equipo.
- **Correos de Supabase:** el SMTP incluido envía solo unos pocos correos por hora. Para registros reales hay que configurar un SMTP gratuito (Resend: 3 000 al mes; Brevo: 300 al día).
- **Cuenta obligatoria:** el primer uso necesita conexión.
- **iOS/macOS:** sin notificaciones con la app cerrada y con un almacenamiento más frágil (la copia en la nube lo compensa).

## Orden y paralelismo

```
F0 ─► F1 ─► F2 ─► F3 ─┬─► F4 (Android) ─┐
                      └─► F5 (Tauri)  ──┴─► F6 ─► F7
```
- F4 y F5 se pueden empezar en cuanto exista la capa `platform/` de F1 (aunque F2 y F3 no estén terminadas) y pueden ir en sesiones paralelas porque tocan archivos distintos (`android/` y `src-tauri/`).
- **Total estimado: 4–5 semanas** de trabajo a tiempo parcial.

## Lo que necesitas preparar tú (todo gratis)

1. Crear un proyecto en **supabase.com** y pasarme la URL y la *publishable key* (en `.env.local`, nunca en el chat).
2. Configurar en Supabase **Auth → Email**: confirmación activada y plantillas con `{{ .Token }}` (código OTP).
3. Instalar **Rust** (rustup) y **Visual Studio Build Tools** (C++) para Tauri.
4. Instalar **Android Studio** (incluye el SDK) y **JDK 21** para Capacitor.
5. Un repositorio en **GitHub** para las *releases* y el build de Linux.
