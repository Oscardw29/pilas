# App de escritorio (Windows / Linux) · Tauri 2

## Requisitos en Windows (gratis)
1. **Rust**: instala `rustup` desde [rustup.rs](https://rustup.rs) (toolchain `stable`, MSVC).
2. **Visual Studio Build Tools** con la carga de trabajo **«Desarrollo para el escritorio con C++»**
   (ya tienes Visual Studio 2026 Community: añade esa carga desde el *Visual Studio Installer*).
3. **WebView2**: viene con Windows 10/11.
4. Supabase configurado en `.env.local` (ver [supabase.md](supabase.md)).

## Desarrollo
```bash
npm run desktop:dev
```
Abre la ventana nativa con recarga en caliente (usa el servidor de Vite en el puerto 5173).

## Instaladores de Windows
```bash
npm run desktop:build
```
Resultado:
- `src-tauri/target/release/bundle/nsis/Pilas_2.0.0_x64-setup.exe`: instalador `.exe` (no pide permisos de administrador).
- `src-tauri/target/release/bundle/msi/Pilas_2.0.0_x64_es-ES.msi`

La primera compilación tarda varios minutos (compila Rust); después es mucho más rápida.

### Aviso «Windows protegió tu PC»
Sin un certificado de firma de pago, SmartScreen muestra ese aviso. Quien instala pulsa **Más información → Ejecutar de todas
formas**. Opciones gratis para quitarlo más adelante:
- Publicar en la **Microsoft Store** (registro gratuito para particulares; la tienda firma la app).
- [SignPath Foundation](https://signpath.org) si el proyecto es de código abierto.

## Linux (.AppImage / .deb)
Tauri no compila para Linux desde Windows. Dos opciones:
- **GitHub Actions** (recomendado): `.github/workflows/release.yml` lo compila al subir una etiqueta `v*`.
- **WSL2 con Ubuntu**:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential
  ```
  y después instala Rust y ejecuta `npm ci && npm run desktop:build`.

## Qué hace la app de escritorio
- Datos en IndexedDB del WebView (carpeta de datos de la app en el usuario).
- Notificaciones del sistema con `tauri-plugin-notification` (con la app abierta).
- El fetch nativo solo puede llegar a `https://api.fish.audio/*` (`src-tauri/capabilities/default.json`).
- CSP propio en `src-tauri/tauri.conf.json` (el `<meta>` de la web se omite en este build).
