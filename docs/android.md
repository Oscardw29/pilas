# App de Android (APK) · Capacitor

## Requisitos (gratis)
- [Android Studio](https://developer.android.com/studio): incluye el SDK de Android y un JDK 21 (`jbr`).
- Gradle 8.14 **no funciona con JDK 25**. Usa el JDK de Android Studio:
  ```powershell
  $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
  ```
- Supabase configurado en `.env.local` (ver [supabase.md](supabase.md)).

## Probar en el móvil o en el emulador
```bash
npm run build:android
```
```bash
npm run android:open
```
En Android Studio pulsa ▶ (Run) con el móvil conectado por USB (depuración USB activada) o con un emulador.

## Crear la clave de firma (una sola vez)
El APK se firma con una clave tuya. **Todas las actualizaciones tienen que firmarse con la misma clave**: si la pierdes, nadie
podrá actualizar la app sin desinstalarla (y perder los datos que no estén sincronizados).

```powershell
keytool -genkeypair -v -keystore C:\Users\TU-USUARIO\claves\pilas-release.jks -alias pilas -keyalg RSA -keysize 4096 -validity 10000
```
- Guarda el `.jks` **fuera del repositorio** y haz una copia en un lugar seguro (p. ej. tu gestor de contraseñas).
- `.gitignore` ya bloquea `*.jks` y `*.keystore`.

## Compilar el APK firmado
```powershell
$env:PILAS_KEYSTORE_PATH = "C:\Users\TU-USUARIO\claves\pilas-release.jks"
$env:PILAS_KEYSTORE_PASS = "la contraseña del keystore"
npm run android:apk
```
Resultado: `android/app/build/outputs/apk/release/app-release-signed.apk`. Súbelo a GitHub Releases (o deja que lo haga
`.github/workflows/release.yml`, con el keystore en *secrets* codificado en base64).

## Qué hace la app en Android
- Datos en IndexedDB dentro del almacenamiento privado de la app; **sin copia en la nube de Google** (`allowBackup=false`):
  la sincronización cifrada de la cuenta ya cubre eso.
- Notificaciones con `@capacitor/local-notifications`, en un canal «privado» (en la pantalla de bloqueo no se ve el texto).
  Android 13+ pide permiso la primera vez.
- Botón «Atrás»: cierra el diálogo abierto → vuelve a la pantalla anterior → deja la app en segundo plano.
- Fish Audio se llama directamente con HTTP nativo (en la web pasa por `/api/fish-tts`).
