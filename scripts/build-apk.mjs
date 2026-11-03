// Compila el APK firmado de Android sin escribir contraseñas en ningún archivo.
// Variables de entorno (ver docs/android.md):
//   PILAS_KEYSTORE_PATH  ruta al .jks (fuera del repositorio)
//   PILAS_KEYSTORE_PASS  contraseña del keystore
//   PILAS_KEYSTORE_ALIAS alias de la clave (por defecto «pilas»)
//   PILAS_KEY_PASS       contraseña de la clave (por defecto la del keystore)
//   JAVA_HOME            un JDK 21 (Gradle 8.14 no funciona con Java 25)
//   ANDROID_HOME         el SDK de Android (por defecto %LOCALAPPDATA%\Android\Sdk)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const { PILAS_KEYSTORE_PATH, PILAS_KEYSTORE_PASS, PILAS_KEYSTORE_ALIAS = 'pilas', PILAS_KEY_PASS } = process.env;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!PILAS_KEYSTORE_PATH || !existsSync(PILAS_KEYSTORE_PATH) || !PILAS_KEYSTORE_PASS) {
  fail('Falta el keystore: define PILAS_KEYSTORE_PATH y PILAS_KEYSTORE_PASS (ver docs/android.md).');
}

// Gradle usa JAVA_HOME. Con otra versión falla tarde y con un error confuso («major version 69»)
const javaHome = process.env.JAVA_HOME;
const javaRelease = javaHome && join(javaHome, 'release');
const javaVersion = javaRelease && existsSync(javaRelease)
  ? readFileSync(javaRelease, 'utf8').match(/^JAVA_VERSION="([^"]+)"/m)?.[1]
  : undefined;
if (!javaVersion?.startsWith('21')) {
  fail(`Hace falta un JDK 21 en JAVA_HOME (ahora: ${javaHome ? `${javaHome}, versión ${javaVersion ?? 'desconocida'}` : 'sin definir'}). Ver docs/android.md.`);
}

// `cap build` llama a `apksigner` por su nombre, y las build-tools del SDK no suelen estar en el PATH
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk')]
  .find((dir) => dir && existsSync(join(dir, 'build-tools')));
if (!sdk) fail('No encuentro el SDK de Android: define ANDROID_HOME (ver docs/android.md).');
const buildTools = readdirSync(join(sdk, 'build-tools'))
  .filter((v) => /^\d+(\.\d+)*$/.test(v))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
if (!buildTools) fail(`No hay build-tools en ${join(sdk, 'build-tools')}: instálalas desde Android Studio (SDK Manager).`);
process.env.PATH = `${join(sdk, 'build-tools', buildTools)}${delimiter}${process.env.PATH}`;

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npm', ['run', 'build:android']);
run('npx', [
  'cap', 'build', 'android',
  '--androidreleasetype', 'APK',
  // apksigner firma con el esquema v2/v3 que exige Android 11+ (jarsigner, el predeterminado, solo v1)
  '--signing-type', 'apksigner',
  '--keystorepath', PILAS_KEYSTORE_PATH,
  '--keystorepass', PILAS_KEYSTORE_PASS,
  '--keystorealias', PILAS_KEYSTORE_ALIAS,
  '--keystorealiaspass', PILAS_KEY_PASS ?? PILAS_KEYSTORE_PASS,
]);
console.log('\nAPK firmado en android/app/build/outputs/apk/release/');
