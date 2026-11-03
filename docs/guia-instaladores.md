# Guía paso a paso: instaladores, publicación y mantenimiento

Esta guía cubre los pasos 5 a 8: el `.exe` de Windows, el `.apk` de Android, publicar la app para que otros la descarguen y mantenerla.
Está pensada para hacerla en orden y sin experiencia previa. Los textos **en negrita** son los botones y menús tal como aparecen
en pantalla (si tu programa está en inglés, va entre paréntesis).

> **Estado de tu equipo (comprobado el 01-11-2026):** C++ de Visual Studio ✅, Rust ✅ (el `.exe` ya compila), Android Studio
> y SDK ✅, `JAVA_HOME` y `ANDROID_HOME` definidos ✅, **JDK 21 ❌** (paso 6.2), clave de firma ❌ (paso 6.4),
> GitHub CLI con sesión iniciada como `Oscardw29` ✅, repositorio en GitHub ❌, proyecto en Vercel ❌.
> Supabase: tablas 0001–0005 aplicadas ✅, función `pilas-ai` sin desplegar ❌ ([supabase.md](supabase.md), «IA de la app»).
>
> Ya tienes hechos los pasos 5.1, 5.2 y 6.1. Empieza por el 6.2.

---

## 0. Antes de empezar

### 0.1 Requisito: Supabase listo
Haz antes el paso 2 ([supabase.md](supabase.md)). En la carpeta principal del proyecto
(`C:\Users\oscar\Documents\antigravity\App_organizadora`) tiene que existir el archivo `.env.local` con tu URL y tu clave.
**Sin él, los instaladores muestran «Falta conectar la cuenta»**, porque la configuración se mete dentro de la app al compilar.

### 0.2 Cómo abrir una terminal en la carpeta del proyecto
Casi todos los pasos son «escribe este comando en la terminal». Para abrirla en el sitio correcto:
1. Abre el **Explorador de archivos** y entra en `C:\Users\oscar\Documents\antigravity\App_organizadora`.
2. Clic derecho en un hueco vacío de la carpeta → **Abrir en Terminal**.
3. Se abre una ventana negra o azul que termina en `...App_organizadora>`. Ahí pegas los comandos (clic derecho pega) y pulsas **Enter**.

> Cuando la guía diga «cierra y vuelve a abrir la terminal», cierra esa ventana y repite estos tres pasos.
> Los programas recién instalados solo se ven en terminales nuevas.

---

## 5. Instalador de Windows (`.exe`)

Necesitas dos herramientas: el compilador de C++ de Microsoft (ya tienes Visual Studio, solo falta activarlo) y Rust.

### 5.1 Añadir C++ a Visual Studio (~10–20 min, ~6 GB)
1. Pulsa la tecla **Windows**, escribe `Visual Studio Installer` y ábrelo.
   Verás una tarjeta **Visual Studio Community 2026** con los botones **Modificar**, **Iniciar** y **Más**.
2. Pulsa **Modificar** (*Modify*). Se abre una ventana con pestañas arriba: **Cargas de trabajo**, **Componentes individuales**,
   **Paquetes de idioma** y **Ubicaciones de instalación**.
3. En **Cargas de trabajo** (*Workloads*) marca la casilla de la tarjeta
   **Desarrollo de escritorio con C++** (*Desktop development with C++*); su icono es un monitor con «C++».
4. A la derecha aparece el **Resumen** con los componentes incluidos. Déjalos como vienen: ya incluyen
   *MSVC … herramientas de compilación de C++ x64/x86* y *Windows 11 SDK*.
5. Abajo a la derecha pulsa **Modificar** (*Modify*) y espera a que la barra llegue al 100 %. Si te pide reiniciar, reinicia.

### 5.2 Instalar Rust (~5 min)
1. Entra en [rustup.rs](https://rustup.rs) y pulsa el botón de descarga **rustup-init.exe (64-bit)**.
2. Ejecuta el archivo descargado. Se abre una ventana de texto (no tiene botones, se maneja con el teclado).
   - Si dice que faltan los prerrequisitos de Visual Studio y ofrece `1) Quick install via the Visual Studio Community installer`,
     significa que el paso 5.1 no terminó: ciérrala y revisa ese paso.
   - Lo normal es que muestre `1) Proceed with standard installation (default - just press enter)`. **Pulsa Enter.**
3. Cuando termine verás `Rust is installed now. Great!`. Pulsa **Enter** para cerrar.
4. **Cierra y vuelve a abrir la terminal** (paso 0.2) y comprueba la instalación:
   ```powershell
   rustc --version
   ```
   Debe responder algo como `rustc 1.9x.x (...)`. Si dice «no se reconoce», reinicia el PC.

### 5.3 Compilar el instalador (~10–20 min la primera vez; luego ~2 min)
En la terminal, dentro de la carpeta del proyecto:
```powershell
npm install
```
```powershell
npm run desktop:build
```
Verás muchas líneas `Compiling ...`: es Rust compilando cientos de piezas la primera vez, y es normal.
Termina con `Finished 1 bundle at:` y la ruta del instalador:
```
src-tauri\target\release\bundle\nsis\Pilas_2.0.0_x64-setup.exe
```
Ese `.exe` (~5–10 MB) es el que repartes.

### 5.4 Probar el instalador (y el aviso de Windows)
1. Haz doble clic en `Pilas_2.0.0_x64-setup.exe`.
2. Aparecerá una ventana azul: **Windows protegió su PC** (*Windows protected your PC*), con el texto
   «Microsoft Defender SmartScreen impidió el inicio de una aplicación no reconocida…» y solo el botón **No ejecutar**.
3. Pulsa el enlace **Más información** (*More info*). Aparecen el nombre del archivo, «Editor: Editor desconocido» y un botón nuevo.
4. Pulsa **Ejecutar de todas formas** (*Run anyway*).
5. Sigue el instalador: **Siguiente → Instalar → Finalizar**. No pide permisos de administrador.
   La app queda en el menú Inicio como **Pilas**.

> Este aviso sale porque el instalador no está firmado con un certificado (cuestan dinero). Es la misma advertencia que verá
> cualquiera que lo descargue. La página `/descargar` de la app ya les explica cómo pasarla.

---

## 6. App de Android (`.apk`)

### 6.1 Instalar Android Studio (~20–40 min, ~5 GB)
1. Entra en [developer.android.com/studio](https://developer.android.com/studio) y pulsa **Download Android Studio** (versión actual: *Rabbit*).
2. Se abre el acuerdo de licencia. Baja hasta el final, marca **I have read and agree with the above terms and conditions**
   y pulsa el botón de descarga del archivo `.exe` de Windows.
3. Ejecuta el `.exe` descargado. Si Windows pregunta «¿Quieres permitir que esta aplicación haga cambios…?», pulsa **Sí**.
4. Asistente de instalación:
   - **Welcome to Android Studio Setup** → **Next**.
   - **Choose Components**: deja marcados *Android Studio* y *Android Virtual Device* → **Next**.
   - **Configuration Settings** (carpeta): deja `C:\Program Files\Android\Android Studio` → **Next**.
   - **Choose Start Menu Folder** → **Install**. Espera la barra → **Next** → **Finish**, con *Start Android Studio* marcado.
5. Primer arranque (asistente de configuración):
   - Si pregunta **Import Android Studio Settings**, elige **Do not import settings** → **OK**.
   - Si pregunta por enviar estadísticas a Google, elige la opción que prefieras (no afecta).
   - **Welcome** → **Next**.
   - **Install Type**: deja **Standard** → **Next**.
   - **Select UI Theme**: elige claro u oscuro → **Next**.
   - **Verify Settings**: es un resumen de lo que va a descargar (el SDK de Android) → **Next**.
   - **License Agreement**: a la izquierda hay **varias** licencias (`android-sdk-license`, `android-sdk-preview-license`…).
     **Selecciona cada una y pulsa Accept** en todas. Hasta que estén todas aceptadas, **Finish** no se activa.
   - **Finish**. Empieza la descarga de componentes (*Downloading Components*). Espera a que termine y pulsa **Finish**.
6. Aparece **Welcome to Android Studio** con **New Project** y **Open**. Ya puedes cerrarlo.

### 6.2 Instalar Java 21 y decirle a Gradle que lo use (una sola vez)
El compilador de Android (Gradle 8.14) no funciona con Java 25, y el plugin de notificaciones exige Java 21. Tu PC tiene Java 25
y el Java que trae Android Studio (`jbr`) **también es el 25**, así que hay que instalar un Java 21 aparte (gratis):
1. En la terminal:
   ```powershell
   winget install EclipseAdoptium.Temurin.21.JDK
   ```
   Si pregunta por los términos, escribe `Y` y pulsa **Enter**. Si Windows pide permiso para hacer cambios, pulsa **Sí**.
   <details><summary>Sin comandos</summary>

   Entra en [adoptium.net](https://adoptium.net/temurin/releases/?version=21&os=windows), descarga el `.msi` de **JDK 21**
   para Windows x64 y ejecútalo con **Next → Install → Finish**.
   </details>
2. Abre el **Explorador de archivos** en `C:\Program Files\Eclipse Adoptium`. Verás una carpeta del tipo
   `jdk-21.0.x.y-hotspot`. Entra en ella y copia su ruta desde la barra de direcciones.
3. Pulsa **Windows**, escribe `variables de entorno` y abre **Editar las variables de entorno de esta cuenta**.
4. En la parte de arriba (**Variables de usuario para oscar**) selecciona `JAVA_HOME` → **Editar…** → en **Valor de la variable**
   pega la ruta del paso 2 (por ejemplo `C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot`) → **Aceptar**.
   Si `JAVA_HOME` no existe, créala con **Nueva…**.
5. Comprueba que existe `ANDROID_HOME` con el valor `C:\Users\oscar\AppData\Local\Android\Sdk` (ya la tienes). Si no, créala
   con **Nueva…**. **Aceptar** para cerrar la ventana.
6. **Cierra y vuelve a abrir la terminal** y comprueba:
   ```powershell
   & "$env:JAVA_HOME\bin\java.exe" -version
   ```
   Debe decir `openjdk version "21...`. Si dice 25, revisa el paso 4.

> `npm run android:apk` comprueba que `JAVA_HOME` sea Java 21 antes de empezar y busca solo `apksigner` en el SDK:
> no hace falta tocar el `PATH`.

### 6.3 Abrir el proyecto de Android una vez (para que se configure)
```powershell
npm run build:android
```
```powershell
npm run android:open
```
1. Se abre Android Studio con el proyecto `android`. Si pregunta **Trust and Open Project?**, pulsa **Trust Project**.
2. Abajo a la derecha verás una barra de progreso *Gradle sync* o *Importing…*. La primera vez descarga cosas (5–10 min).
   **Espera a que desaparezca.** Si arriba sale una barra amarilla o azul ofreciendo actualizar Gradle o AGP, **ignórala**.
   Si falla con `Unsupported class file major version 69`, Android Studio está usando su Java 25: **File → Settings →
   Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK** → elige **JAVA_HOME** (el 21 del paso 6.2) → **OK**
   y pulsa el icono del elefante (**Sync Project with Gradle Files**).
3. Opcional, para probar sin firmar:
   - **Con tu móvil:** activa la *Depuración USB* en el móvil (en *Opciones de desarrollador*), conéctalo por cable, elígelo en el
     desplegable de dispositivos de arriba y pulsa el triángulo verde **▶ Run 'app'**.
   - **Con un emulador:** en ese mismo desplegable, usa **Device Manager** para crear uno.
4. Cierra Android Studio.

### 6.4 Crear tu clave de firma (una sola vez en la vida de la app)
Android exige que cada APK esté firmado, y **todas las versiones futuras deben firmarse con la misma clave**.
Si la pierdes, nadie podrá actualizar la app sin desinstalarla.

1. Crea la carpeta `C:\Users\oscar\claves` (fuera del proyecto).
2. En la terminal:
   ```powershell
   & "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -keystore C:\Users\oscar\claves\pilas-release.jks -alias pilas -keyalg RSA -keysize 4096 -validity 10000
   ```
3. Responde a lo que pregunta. Al escribir la contraseña **no se ve nada**: es normal.
   - *Introduzca la contraseña del almacén de claves* (*Enter keystore password*): inventa una de 12+ caracteres. Te la pide dos veces.
   - *¿Cuáles son su nombre y su apellido?*, *unidad de organización*, *organización*, *ciudad*, *provincia*, *código de país*
     (por ejemplo `CO`, `MX` o `ES`): rellena lo que quieras; no se muestra a los usuarios.
   - *¿Es correcto CN=…?* escribe `sí` (o `yes`) y pulsa **Enter**.
4. Se crea `C:\Users\oscar\claves\pilas-release.jks`. **Guarda una copia** del archivo y de su contraseña en tu gestor de
   contraseñas o en una memoria USB. **Nunca** lo metas en la carpeta del proyecto ni lo subas a GitHub.

### 6.5 Compilar el APK firmado
En la terminal (cambia `TU-CONTRASEÑA` por la del paso anterior):
```powershell
$env:PILAS_KEYSTORE_PATH = "C:\Users\oscar\claves\pilas-release.jks"; $env:PILAS_KEYSTORE_PASS = "TU-CONTRASEÑA"; npm run android:apk
```
Tarda unos minutos y termina con `APK firmado en android/app/build/outputs/apk/release/`. En esa carpeta está el archivo que
termina en **`-signed.apk`**: es el que repartes (cámbiale el nombre a `Pilas.apk` si quieres).

### 6.6 Instalarlo en un móvil Android
1. Pasa el `.apk` al móvil: por cable USB (cópialo a *Descargas*), por Google Drive o enviándotelo por Telegram o WhatsApp.
2. En el móvil, ábrelo desde **Archivos → Descargas** (o desde la app donde lo recibiste).
3. Android avisa: *«Por tu seguridad, tu teléfono no puede instalar apps desconocidas de esta fuente»*. Pulsa **Configuración**,
   activa **Permitir de esta fuente** (*Allow from this source*) y vuelve atrás.
4. Pulsa **Instalar**.
5. Puede salir **Google Play Protect** diciendo que no reconoce al desarrollador. Pulsa **Más detalles** →
   **Instalar de todas formas** (*Install anyway*). Si ofrece «Enviar app para análisis», es opcional.
6. Abre **¡Pilas!**. La primera vez que active los avisos, Android pedirá permiso para **notificaciones**: pulsa **Permitir**.

> Google está implantando poco a poco la «verificación de desarrolladores» también para APK fuera de Play, empezando por algunos
> países. Si un día el móvil se niega a instalarlo por ese motivo, avísame y vemos la opción gratuita de registro.

---

## 7. Publicar para que otras personas lo descarguen

La idea es esta:
- **GitHub** guarda el código y, cada vez que publicas una versión, compila en sus servidores el `.exe`, el `.apk` y la versión de
  **Linux** (que no se puede compilar en Windows). Además aloja los archivos para descargarlos.
- **Vercel** publica la app web (la que usan iPhone, iPad y Mac) y la página `/descargar`.

Ambos son gratis.

### 7.1 Decidir: repositorio público o privado
- **Público (recomendado):** cualquiera puede descargar los instaladores de *Releases*. El código también es visible.
  No contiene secretos: `.env.local` y las claves de firma están excluidos por `.gitignore`.
- **Privado:** el código queda oculto, pero **los archivos de *Releases* tampoco se pueden descargar** sin acceso al repo.
  Tendrías que subir los instaladores a otro sitio (por ejemplo Google Drive) y poner ese enlace en `VITE_DOWNLOADS_URL`.

### 7.2 Crear el repositorio y subir el código
Tu terminal ya tiene sesión de GitHub (`Oscardw29`). En la carpeta del proyecto:
1. Primero guarda o descarta tus cambios sin confirmar (`git status` los muestra). Solo se sube lo confirmado.
   > Si el repo es público, cualquiera verá tu correo `oscarwis2009@gmail.com`: está en `src/lib/creator.ts`,
   > en `supabase/migrations/0002_social.sql`, en las pruebas y como autor de los commits.
2. Crea el repo y súbelo. Cambia `--public` por `--private` si así lo decidiste:
   ```powershell
   gh repo create pilas --public --source . --remote origin --push
   ```
3. Abre `https://github.com/Oscardw29/pilas`. Deberías ver las carpetas del proyecto y **no** debe aparecer `.env.local`.

<details><summary>Alternativa sin comandos (web)</summary>

En github.com: botón **+** (arriba a la derecha) → **New repository** → **Repository name** `pilas` → **Public** →
**no** marques «Add a README» → **Create repository**. GitHub muestra comandos «…or push an existing repository from the command
line»: cópialos y pégalos en la terminal.
</details>

### 7.3 Guardar los secretos en GitHub (para que pueda compilar)
1. En la página del repo, pestaña **Settings** (con el engranaje; si no la ves, está en el menú **⋯**).
2. Menú izquierdo, sección **Security** → **Secrets and variables** → **Actions**.
3. En la pestaña **Secrets**, pulsa **New repository secret**. Crea estos seis, uno por uno: escribe el **Name**, pega el valor en
   **Secret** y pulsa **Add secret**.

| Name | Secret (valor) |
|---|---|
| `VITE_SUPABASE_URL` | la URL de tu `.env.local` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | la clave de tu `.env.local` |
| `ANDROID_KEYSTORE_BASE64` | tu `.jks` convertido a texto (ver abajo) |
| `ANDROID_KEYSTORE_PASS` | la contraseña del keystore |
| `ANDROID_KEY_ALIAS` | `pilas` |
| `ANDROID_KEY_PASS` | la misma contraseña (salvo que pusieras otra distinta a la clave) |

Para `ANDROID_KEYSTORE_BASE64`, este comando copia el `.jks` convertido a texto al portapapeles; luego lo pegas con **Ctrl+V**:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\oscar\claves\pilas-release.jks")) | Set-Clipboard
```

### 7.4 Publicar una versión
1. En la terminal:
   ```powershell
   git tag v2.0.0
   ```
   ```powershell
   git push origin v2.0.0
   ```
2. En GitHub, pestaña **Actions**. Verás «Publicar versión» con un círculo **amarillo** girando (en marcha). Tarda unos
   **15–30 minutos**: compila Windows, Linux y Android a la vez. Al terminar, el círculo se vuelve un **✓ verde**.
   Si sale una **✗ roja**, ábrelo, copia el error y pásamelo.
3. Pestaña **Code** → a la derecha, **Releases** → aparece **¡Pilas! v2.0.0** con la etiqueta **Draft** (borrador).
   Dentro, en **Assets**, verás: `Pilas_2.0.0_x64-setup.exe`, `Pilas_2.0.0_amd64.AppImage`, `pilas_2.0.0_amd64.deb` y `Pilas-v2.0.0.apk`.
4. Pulsa el **lápiz (Edit)**, revisa el texto y pulsa **Publish release**. Ya es pública.
5. El enlace que siempre apunta a la última versión es: `https://github.com/Oscardw29/pilas/releases/latest`.

> **Próximas versiones:**
> 1. Sube el número de versión en `package.json` y en `src-tauri/tauri.conf.json` (por ejemplo `2.0.1`).
> 2. Guarda los cambios con un commit y súbelos.
> 3. Repite el punto 1 con `v2.0.1`.

### 7.5 Publicar la app web en Vercel
1. Entra en [vercel.com](https://vercel.com) → **Sign Up** → plan **Hobby** (gratis) → **Continue with GitHub** y autoriza.
2. En el panel: **Add New…** (arriba a la derecha) → **Project**.
3. **Import Git Repository**: aparece la lista de tus repos. Si `pilas` no aparece, pulsa **Adjust GitHub App Permissions** y
   dale acceso. Junto a `pilas`, pulsa **Import**.
4. Pantalla **Configure Project**:
   - **Framework Preset:** debe decir **Vite** (lo detecta solo).
   - **Root Directory:** `./`. No toques **Build and Output Settings**: ya vienen `npm run build` y `dist`.
   - Despliega **Environment Variables** y añade, una por una (escribe **Key** y **Value** y pulsa **Add**):
     `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y
     `VITE_DOWNLOADS_URL` = `https://github.com/Oscardw29/pilas/releases/latest`.
5. Pulsa **Deploy**. En 1–2 minutos sale **Congratulations!** con una vista previa → **Continue to Dashboard**.
6. En **Domains** verás tu dirección, del tipo `pilas-xxxx.vercel.app`. Compártela:
   - `https://pilas-xxxx.vercel.app/descargar` → página con los instaladores e instrucciones para cada sistema.
   - `https://pilas-xxxx.vercel.app` → la app web (en iPhone: Safari → **Compartir** → **Añadir a pantalla de inicio**).

> Si más adelante cambias una variable (**Settings → Environment Variables**), hay que volver a desplegar:
> pestaña **Deployments** → **⋯** en el último despliegue → **Redeploy**.
> Cada vez que subas cambios a `main`, Vercel publica la web solo.

---

## 8. Mantenimiento

| Situación | Qué hacer |
|---|---|
| Nadie puede iniciar sesión ni registrarse | El proyecto gratuito de Supabase se pausa tras ~7 días sin uso. Entra a [supabase.com/dashboard](https://supabase.com/dashboard): el proyecto mostrará **Paused** y un botón **Restore project**. Púlsalo y espera 1–3 minutos. |
| Los correos de confirmación no llegan | El correo incluido de Supabase solo envía unos pocos por hora. Configura SMTP gratis con Resend (ver [supabase.md](supabase.md), punto 5). |
| Quieres publicar una versión nueva | Ver el recuadro de «Próximas versiones» al final de 7.4. |
| Cambiaste de PC | Copia `C:\Users\oscar\claves\pilas-release.jks` al nuevo equipo. Sin él no puedes actualizar la app de Android. |
| Olvidaste tu contraseña de ¡Pilas! | En la app: **Olvidé mi contraseña**. Necesitas el código del correo y tu **código de recuperación**. |

### Problemas comunes

| Mensaje | Causa y solución |
|---|---|
| `rustc no se reconoce como nombre de un cmdlet` | La terminal es anterior a la instalación: ciérrala y ábrela de nuevo. Si sigue, reinicia el PC. |
| `linker 'link.exe' not found` | Falta el C++ de Visual Studio: repite el paso 5.1. |
| `Unsupported class file major version 69` o `Hace falta un JDK 21` | Gradle está usando Java 25: `JAVA_HOME` debe apuntar al JDK 21 de Adoptium, no al `jbr` de Android Studio (paso 6.2). Abre una terminal nueva. |
| `No encuentro el SDK de Android` o `No hay build-tools` | Revisa `ANDROID_HOME` (paso 6.2) o instala las *SDK Build-Tools* en Android Studio → **SDK Manager**. |
| `SDK location not found` | Falta `ANDROID_HOME` (paso 6.2), o no se abrió el proyecto una vez en Android Studio (paso 6.3). |
| «La app no está instalada» / «el paquete no es válido» en el móvil | Ya había otra versión firmada con una clave distinta: desinstálala primero. |
| La app abre en «Falta conectar la cuenta» | Compilaste sin `.env.local` (local) o sin los secretos `VITE_SUPABASE_*` (GitHub o Vercel). |
| `Falta el keystore` al compilar el APK | No definiste `PILAS_KEYSTORE_PATH` y `PILAS_KEYSTORE_PASS` en esa misma terminal (paso 6.5). |
