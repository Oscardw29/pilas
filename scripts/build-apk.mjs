// Compila el APK firmado de Android sin escribir contraseñas en ningún archivo.
// Variables de entorno (ver docs/android.md):
//   PILAS_KEYSTORE_PATH  ruta al .jks (fuera del repositorio)
//   PILAS_KEYSTORE_PASS  contraseña del keystore
//   PILAS_KEYSTORE_ALIAS alias de la clave (por defecto «pilas»)
//   PILAS_KEY_PASS       contraseña de la clave (por defecto la del keystore)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const { PILAS_KEYSTORE_PATH, PILAS_KEYSTORE_PASS, PILAS_KEYSTORE_ALIAS = 'pilas', PILAS_KEY_PASS } = process.env;

if (!PILAS_KEYSTORE_PATH || !existsSync(PILAS_KEYSTORE_PATH) || !PILAS_KEYSTORE_PASS) {
  console.error('Falta el keystore: define PILAS_KEYSTORE_PATH y PILAS_KEYSTORE_PASS (ver docs/android.md).');
  process.exit(1);
}

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
