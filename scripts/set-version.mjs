#!/usr/bin/env node
/**
 * VERSIÓN DESDE LA ETIQUETA
 * Escribe la versión en todos los archivos que la usan para nombrar e identificar los instaladores:
 *   package.json, src-tauri/tauri.conf.json y src-tauri/Cargo.toml (escritorio), android/app/build.gradle (Android).
 * Lo usa .github/workflows/release.yml antes de compilar, con la etiqueta que se subió (v2.0.1 → 2.0.1).
 * También sirve a mano:  node scripts/set-version.mjs 2.0.1
 *
 * Android: versionCode = mayor·10000 + menor·100 + parche (2.0.1 → 20001). Siempre sube con cada versión, que es lo
 * que Android exige para aceptar el APK como actualización.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const raw = (process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '').trim();
const match = raw.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
if (!match) {
  console.error(`Versión no válida: «${raw}». Usa una etiqueta como v2.0.1.`);
  process.exit(1);
}
const [major, minor, patch] = match.slice(1).map(Number);
if (minor > 99 || patch > 99) {
  console.error('La versión menor y el parche deben ser de 0 a 99 (para calcular el versionCode de Android).');
  process.exit(1);
}
const version = `${major}.${minor}.${patch}`;
const versionCode = major * 10000 + minor * 100 + patch;

/** Reemplaza una vez y falla si el patrón ya no está (para no publicar con la versión vieja sin enterarse) */
function edit(file, pattern, replacement) {
  const text = readFileSync(file, 'utf8');
  if (!pattern.test(text)) {
    console.error(`No se encontró la versión en ${file}`);
    process.exit(1);
  }
  writeFileSync(file, text.replace(pattern, replacement));
}

edit('package.json', /("version":\s*")[^"]*(")/, `$1${version}$2`);
edit('src-tauri/tauri.conf.json', /("version":\s*")[^"]*(")/, `$1${version}$2`);
// Solo la versión del paquete (la primera línea `version =`), no las de las dependencias
edit('src-tauri/Cargo.toml', /^(version\s*=\s*")[^"]*(")/m, `$1${version}$2`);
edit('android/app/build.gradle', /(versionCode\s+)\d+/, `$1${versionCode}`);
edit('android/app/build.gradle', /(versionName\s+")[^"]*(")/, `$1${version}$2`);

console.log(`Versión ${version} (Android versionCode ${versionCode})`);
