#!/usr/bin/env node
/**
 * GENERADOR DE LA VOZ DEL COACH (frases fijas)
 *
 * Lee el catálogo src/data/coachPhrases.json y graba cada frase con la voz original del coach (Gemini TTS,
 * mismos modelos, voces y estilo que la app: src/data/coachVoiceConfig.json). Guarda los audios en
 * public/coach-voice/<pilo|pila>/<id>.<mp3|wav> y escribe public/coach-voice/manifest.json, que la app usa
 * para saber qué frases tienen audio (lib/coachVoice). Sin dependencias: solo Node 18+ (y ffmpeg opcional).
 *
 * La clave de Gemini se pasa por variable de entorno y nunca se guarda en el repositorio:
 *   PowerShell:  $env:GEMINI_API_KEY="tu-clave"; node scripts/generate-coach-voice.mjs
 *   bash:        GEMINI_API_KEY=tu-clave node scripts/generate-coach-voice.mjs
 *
 * Opciones:
 *   --dry-run           Solo valida el catálogo y lista lo que generaría (también si no hay clave).
 *   --docs              Reescribe docs/coach-voz.md con el texto exacto de cada frase y termina.
 *   --voice pilo|pila   Solo una de las dos voces.
 *   --only a,b.*        Solo esos ids (un «*» final abarca un grupo: saludo.* o app.*).
 *   --force             Vuelve a grabar aunque el audio ya esté al día.
 *   --format auto|mp3|wav  auto (por defecto): mp3 si hay ffmpeg en el PATH (≈10 veces más ligero), si no wav.
 *   --limit N           Como mucho N grabaciones en esta ejecución (útil con la cuota gratuita).
 *   --concurrency N     Peticiones a la vez (por defecto 1; máximo 4).
 *   --prune             Borra los audios de frases que ya no están en el catálogo.
 *
 * Se puede interrumpir y volver a lanzar: el manifiesto se guarda tras cada audio y lo que ya está al día
 * (mismo texto, archivo presente) se salta.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = join(ROOT, 'src/data/coachPhrases.json');
const CONFIG_PATH = join(ROOT, 'src/data/coachVoiceConfig.json');
const DOCS_PATH = join(ROOT, 'docs/coach-voz.md');

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 6;
/** Silencio que se deja al principio y al final de cada audio tras recortar (segundos) */
const EDGE_PAD_S = 0.08;
/** Umbral de silencio para el recorte (muestras de 16 bits) */
const SILENCE_LEVEL = 220;
/** Tasa de bits del mp3: voz mono, de sobra para una frase hablada */
const MP3_BITRATE = '48k';
/** Bytes por segundo aproximados por formato (para estimar el tamaño) */
const BYTES_PER_SECOND = { wav: 48_000, mp3: 6_000 };
/** Segundos estimados por carácter de texto en español a ritmo de coach */
const SECONDS_PER_CHAR = 0.065;

/* ---------------- Argumentos ---------------- */

function parseArgs(argv) {
  const opts = { dryRun: false, docs: false, voice: null, only: null, force: false, format: 'auto', limit: Infinity, concurrency: 1, prune: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case '--dry-run': opts.dryRun = true; break;
      case '--docs': opts.docs = true; break;
      case '--force': opts.force = true; break;
      case '--prune': opts.prune = true; break;
      case '--voice': opts.voice = value(); break;
      case '--only': opts.only = value().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--format': opts.format = value(); break;
      case '--limit': opts.limit = Number(value()); break;
      case '--concurrency': opts.concurrency = Number(value()); break;
      case '-h':
      case '--help': opts.help = true; break;
      default: fail(`Opción desconocida: ${argv[i]} (usa --help)`);
    }
  }
  if (opts.voice && !['pilo', 'pila'].includes(opts.voice)) fail('--voice debe ser pilo o pila');
  if (!['auto', 'mp3', 'wav'].includes(opts.format)) fail('--format debe ser auto, mp3 o wav');
  if (!(opts.limit > 0)) fail('--limit debe ser un número mayor que 0');
  if (!(opts.concurrency >= 1 && opts.concurrency <= 4)) fail('--concurrency debe estar entre 1 y 4');
  opts.concurrency = Math.floor(opts.concurrency);
  return opts;
}

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/* ---------------- Catálogo ---------------- */

const ID_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const ALLOWED_KEYS = new Set(['id', 'text', 'pilo', 'pila']);
const MAX_CHARS = 320;

/** Comprueba el catálogo: ids únicos, textos de una línea, sin markdown ni emojis. Devuelve la lista de errores. */
function validateCatalog(phrases) {
  const errors = [];
  const seen = new Set();
  if (!Array.isArray(phrases) || !phrases.length) return ['El catálogo no tiene frases'];
  phrases.forEach((p, i) => {
    const where = `frase ${i + 1}${p?.id ? ` (${p.id})` : ''}`;
    if (!p || typeof p !== 'object') return errors.push(`${where}: no es un objeto`);
    for (const k of Object.keys(p)) if (!ALLOWED_KEYS.has(k)) errors.push(`${where}: campo desconocido «${k}»`);
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) errors.push(`${where}: id inválido (minúsculas, números, _ y puntos, con al menos un punto)`);
    else if (seen.has(p.id)) errors.push(`${where}: id repetido`);
    else seen.add(p.id);
    const hasText = typeof p.text === 'string';
    const hasBoth = typeof p.pilo === 'string' && typeof p.pila === 'string';
    if (hasText === hasBoth) errors.push(`${where}: usa «text» o bien «pilo» y «pila» (no ambos ni solo uno)`);
    for (const key of ['text', 'pilo', 'pila']) {
      const t = p[key];
      if (t === undefined) continue;
      if (typeof t !== 'string' || !t.trim()) { errors.push(`${where}: «${key}» vacío`); continue; }
      if (t !== t.trim()) errors.push(`${where}: «${key}» tiene espacios al principio o al final`);
      if (/[\r\n]/.test(t)) errors.push(`${where}: «${key}» debe ser una sola línea`);
      if (/[*_`#|[\]<>~]/.test(t)) errors.push(`${where}: «${key}» lleva caracteres de markdown`);
      if (/\p{Extended_Pictographic}/u.test(t)) errors.push(`${where}: «${key}» lleva emojis`);
      if (t.length > MAX_CHARS) errors.push(`${where}: «${key}» supera ${MAX_CHARS} caracteres`);
      if (!/[.!?:…]$/.test(t)) errors.push(`${where}: «${key}» debe terminar en puntuación (. ! ? : …)`);
    }
  });
  return errors;
}

const textFor = (p, voice) => p[voice] ?? p.text;

function matchesOnly(id, only) {
  if (!only) return true;
  return only.some((pat) => (pat.endsWith('*') ? id.startsWith(pat.slice(0, -1)) : id === pat));
}

/* ---------------- Documentación ---------------- */

function writeDocs(phrases, config) {
  const esc = (s) => s.replace(/\|/g, '\\|');
  const voices = Object.entries(config.clipVoices); // [['male','pilo'], ['female','pila']]
  const lines = [
    '# Voz del coach: frases fijas',
    '',
    '<!-- Archivo generado por `node scripts/generate-coach-voice.mjs --docs`: no lo edites a mano; edita src/data/coachPhrases.json -->',
    '',
    'Texto exacto de cada frase fija del coach, por voz, para grabarla con TTS. Las usan el motor de respuestas local',
    '(`src/lib/coachLocal.ts`) y los textos por defecto del chat. Cuando una línea de un mensaje coincide con una de estas',
    'frases y existe su audio en `public/coach-voice/`, la app la reproduce aunque no haya clave de TTS configurada.',
    '',
    '## Cómo generar los audios',
    '',
    '1. Consigue una clave de Gemini (Google AI Studio). No la guardes en el repositorio: pásala solo por variable de entorno.',
    '2. Prueba en seco (valida el catálogo y lista lo que falta): `node scripts/generate-coach-voice.mjs --dry-run`',
    '3. Genera:',
    '   - PowerShell: `$env:GEMINI_API_KEY="tu-clave"; node scripts/generate-coach-voice.mjs`',
    '   - bash: `GEMINI_API_KEY=tu-clave node scripts/generate-coach-voice.mjs`',
    '4. Con ffmpeg en el PATH los audios salen en mp3 (unas 10 veces más ligeros que wav). Sin ffmpeg el script pide',
    '   `--format wav` a propósito, porque los audios viajan con la web, la APK y la .exe.',
    '5. Se puede interrumpir y relanzar: solo graba lo que falta o cambió. Con la cuota gratuita, usa `--limit` o',
    '   `--voice pilo` / `--voice pila` y repite otro día.',
    '6. Si cambias el texto de una frase, su audio viejo deja de usarse solo; vuelve a lanzar el script para regrabarla',
    '   (y `--docs` para actualizar este documento). `--prune` borra los audios de frases que ya no existen.',
    '',
    '## Cómo los usa la app',
    '',
    '- El script escribe `public/coach-voice/manifest.json` con el archivo y el texto exacto de cada frase grabada.',
    '- `src/lib/coachVoice.ts` lee el manifiesto y, al leer un mensaje, busca cada línea entre las frases grabadas',
    '  (sin distinguir mayúsculas, puntuación, negritas ni viñetas).',
    '- Sin clave de TTS suenan solo esas líneas; el resto del mensaje se queda en texto. Si no hay ninguna frase',
    '  grabada ni voz configurada, el coach no suena y el botón del altavoz avisa de dónde configurar la voz.',
    '- Con Gemini como voz también se usan los audios (misma voz, ahorran cuota). Con Fish Audio, ElevenLabs u OpenAI',
    '  se lee todo con esa voz para no mezclar dos voces en un mensaje.',
    '',
    '## Voz',
    '',
    `- Modelos de Gemini TTS (en orden): ${config.geminiTtsModels.map((m) => `\`${m}\``).join(', ')}`,
    ...voices.map(([gender, folder]) => `- ${folder === 'pilo' ? 'Pilo' : 'Pila'}: voz \`${config.geminiVoices[gender]}\` → \`public/${config.clipsDir}/${folder}/<id>.mp3\` (o .wav)`),
    `- Indicación de estilo (va delante de cada frase): «${config.stylePrompt}»`,
    `- Formato que devuelve la API: PCM de 16 bits, mono, ${config.sampleRate} Hz (el script lo recorta y lo guarda como mp3 o wav).`,
    '',
  ];
  for (const [, folder] of voices) {
    const title = folder === 'pilo' ? 'Pilo (entrenador)' : 'Pila (entrenadora)';
    lines.push(`## ${title}`, '', '| id | texto |', '| --- | --- |');
    for (const p of phrases) lines.push(`| \`${p.id}\` | ${esc(textFor(p, folder))} |`);
    lines.push('');
  }
  lines.push(`Total: ${phrases.length} frases por voz (${phrases.filter((p) => p.pilo).length} cambian entre Pilo y Pila).`, '');
  mkdirSync(dirname(DOCS_PATH), { recursive: true });
  writeFileSync(DOCS_PATH, lines.join('\n'), 'utf8');
  console.log(`✔ Documentación escrita en ${relative(ROOT, DOCS_PATH)}`);
}

/* ---------------- Audio ---------------- */

/** Quita el silencio de los extremos (deja un pequeño margen): la frase empieza a sonar al instante */
function trimSilence(pcm, sampleRate) {
  const samples = Math.floor(pcm.length / 2);
  const amp = (i) => Math.abs(pcm.readInt16LE(i * 2));
  let start = 0;
  while (start < samples && amp(start) < SILENCE_LEVEL) start++;
  let end = samples - 1;
  while (end > start && amp(end) < SILENCE_LEVEL) end--;
  if (end <= start) return pcm;
  const pad = Math.round(EDGE_PAD_S * sampleRate);
  return pcm.subarray(Math.max(0, start - pad) * 2, Math.min(samples, end + pad + 1) * 2);
}

/** Cabecera WAV (PCM 16 bits mono) delante de las muestras */
function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const hasFfmpeg = () => {
  try {
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

/** PCM → mp3 con ffmpeg (argumentos sin shell; la salida va a un archivo temporal que luego se renombra) */
function pcmToMp3(pcm, sampleRate, outPath) {
  return new Promise((resolve, reject) => {
    const tmp = `${outPath}.tmp.mp3`;
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', MP3_BITRATE, tmp], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg terminó con código ${code}: ${err.trim()}`));
      renameSync(tmp, outPath);
      resolve();
    });
    ff.stdin.end(pcm);
  });
}

/* ---------------- Gemini TTS ---------------- */

class FatalError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera que pide la API en un 429 (RetryInfo «retryDelay: "7s"») o una creciente */
function retryDelayMs(body, attempt) {
  const asked = String(body).match(/retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return asked ? Number(asked[1]) * 1000 + 500 : Math.min(60_000, 2000 * 2 ** (attempt - 1));
}

let modelIdx = 0;

async function synthesize(key, config, text, voiceName) {
  for (let attempt = 1; ; attempt++) {
    const model = config.geminiTtsModels[modelIdx];
    let res;
    try {
      res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST',
        // La clave va en cabecera, nunca en la URL (no queda en logs ni historiales)
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${config.stylePrompt}: ${text}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      await sleep(retryDelayMs('', attempt));
      continue;
    }

    if (res.ok) {
      const json = await res.json();
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) {
        if (attempt >= MAX_ATTEMPTS) throw new Error('Respuesta sin audio');
        await sleep(retryDelayMs('', attempt));
        continue;
      }
      const mime = part.inlineData.mimeType || '';
      return { data: Buffer.from(part.inlineData.data, 'base64'), mime, model };
    }

    const body = await res.text().catch(() => '');
    if (res.status === 404 && modelIdx < config.geminiTtsModels.length - 1) {
      console.warn(`  · El modelo ${model} no está disponible; pruebo con ${config.geminiTtsModels[modelIdx + 1]}`);
      modelIdx++;
      continue;
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new FatalError(`Gemini rechazó la petición (HTTP ${res.status}). Revisa la clave y que tenga acceso a ${model}.`);
    }
    if (res.status === 429 && /per ?day|PerDay|daily/i.test(body)) {
      throw new FatalError('Se agotó la cuota diaria de Gemini TTS. Lo grabado queda guardado: vuelve a lanzar el script mañana.');
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      const wait = retryDelayMs(body, attempt);
      console.warn(`  · HTTP ${res.status}; reintento en ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

/* ---------------- Manifiesto ---------------- */

function loadManifest(path) {
  try {
    const m = readJson(path);
    return { version: 1, voices: {}, ...m };
  } catch {
    return { version: 1, voices: {} };
  }
}

/** Escritura atómica: si se corta a mitad, el manifiesto anterior sigue entero */
function saveManifest(path, manifest) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/* ---------------- Principal ---------------- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    return;
  }

  const config = readJson(CONFIG_PATH);
  const phrases = readJson(CATALOG_PATH).phrases;
  const errors = validateCatalog(phrases);
  if (errors.length) {
    console.error(`✖ El catálogo tiene ${errors.length} error(es):`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`✔ Catálogo válido: ${phrases.length} frases (${phrases.filter((p) => p.pilo).length} con variante para Pilo y Pila).`);

  if (opts.docs) {
    writeDocs(phrases, config);
    return;
  }

  const outDir = join(ROOT, 'public', config.clipsDir);
  const manifestPath = join(outDir, 'manifest.json');
  const manifest = loadManifest(manifestPath);
  const ffmpeg = hasFfmpeg();
  const format = opts.format === 'auto' ? (ffmpeg ? 'mp3' : 'wav') : opts.format;
  if (format === 'mp3' && !ffmpeg) fail('--format mp3 necesita ffmpeg en el PATH (o usa --format wav)');

  const voices = Object.entries(config.clipVoices).filter(([, folder]) => !opts.voice || folder === opts.voice);
  const ids = new Set(phrases.map((p) => p.id));

  // Qué falta por grabar en cada voz
  const jobs = [];
  const summary = [];
  for (const [gender, folder] of voices) {
    const clips = manifest.voices?.[folder]?.clips ?? {};
    let upToDate = 0;
    for (const p of phrases) {
      if (!matchesOnly(p.id, opts.only)) continue;
      const text = textFor(p, folder);
      const current = clips[p.id];
      const fresh = current && current.text === text && existsSync(join(outDir, current.file));
      if (fresh && !opts.force) upToDate++;
      else jobs.push({ gender, folder, id: p.id, text, voiceName: config.geminiVoices[gender] });
    }
    const orphans = Object.keys(clips).filter((id) => !ids.has(id));
    summary.push({ folder, voiceName: config.geminiVoices[gender], upToDate, pending: jobs.filter((j) => j.folder === folder).length, orphans });
  }

  const planned = jobs.slice(0, opts.limit);
  const seconds = planned.reduce((a, j) => a + j.text.length * SECONDS_PER_CHAR, 0);
  console.log(`  Formato: ${format}${opts.format === 'auto' ? (ffmpeg ? ' (ffmpeg encontrado)' : ' (sin ffmpeg: instálalo para obtener mp3, mucho más ligeros)') : ''}`);
  for (const s of summary) {
    console.log(`  ${s.folder} (voz ${s.voiceName}): ${s.upToDate} al día, ${s.pending} por grabar${s.orphans.length ? `, ${s.orphans.length} sin frase en el catálogo${opts.prune ? ' (se borrarán)' : ''}` : ''}`);
  }
  console.log(`  Esta ejecución: ${planned.length} grabaciones${jobs.length > planned.length ? ` de ${jobs.length} (--limit)` : ''}, ≈${Math.round(seconds)} s de audio, ≈${(seconds * BYTES_PER_SECOND[format] / 1e6).toFixed(1)} MB.`);

  const key = process.env.GEMINI_API_KEY?.trim();
  if (opts.dryRun || !key) {
    if (!opts.dryRun) console.log('\nSin GEMINI_API_KEY: modo de prueba (no se graba nada).');
    planned.slice(0, 400).forEach((j) => console.log(`  · ${j.folder}/${j.id}: ${j.text.length > 90 ? `${j.text.slice(0, 87)}…` : j.text}`));
    console.log('\nPara grabar: $env:GEMINI_API_KEY="tu-clave"; node scripts/generate-coach-voice.mjs   (bash: GEMINI_API_KEY=… node …)');
    return;
  }
  // Sin ffmpeg, todo el catálogo en wav pesa decenas de MB (viajan con la web, la APK y la .exe): que sea a propósito
  if (opts.format === 'auto' && !ffmpeg && planned.length > 20) {
    fail('No encuentro ffmpeg: en wav estos audios ocuparían mucho. Instala ffmpeg (mp3, ≈10 veces menos) o pasa --format wav para seguir igualmente.');
  }

  // Manifiesto: se conservan solo las frases que siguen en el catálogo con el mismo texto
  manifest.version = 1;
  manifest.stylePrompt = config.stylePrompt;
  manifest.voices ??= {};
  for (const [gender, folder] of Object.entries(config.clipVoices)) {
    const entry = (manifest.voices[folder] ??= { voiceName: config.geminiVoices[gender], clips: {} });
    entry.voiceName = config.geminiVoices[gender];
    entry.clips ??= {};
    for (const [id, clip] of Object.entries(entry.clips)) {
      const p = phrases.find((x) => x.id === id);
      if (!p || textFor(p, folder) !== clip.text || !existsSync(join(outDir, clip.file))) delete entry.clips[id];
    }
  }

  if (opts.prune) {
    for (const [, folder] of voices) {
      const dir = join(outDir, folder);
      if (!existsSync(dir)) continue;
      const keep = new Set(Object.values(manifest.voices[folder].clips).map((c) => c.file.split('/')[1]));
      const pendingFiles = new Set(planned.filter((j) => j.folder === folder).map((j) => j.id));
      for (const f of readdirSync(dir)) {
        const id = f.replace(/\.(mp3|wav)$/, '');
        if (keep.has(f) || pendingFiles.has(id) || !/\.(mp3|wav)$/.test(f) || !statSync(join(dir, f)).isFile()) continue;
        unlinkSync(join(dir, f));
        console.log(`  - borrado ${folder}/${f}`);
      }
    }
  }
  saveManifest(manifestPath, manifest);

  let done = 0;
  let failed = 0;
  let stop = null;
  const queue = [...planned];
  const worker = async () => {
    while (queue.length && !stop) {
      const job = queue.shift();
      try {
        const { data, mime, model } = await synthesize(key, config, job.text, job.voiceName);
        const rate = Number(mime.match(/rate=(\d+)/)?.[1]) || config.sampleRate;
        const isPcm = /L16|pcm/i.test(mime) || !mime;
        const dir = join(outDir, job.folder);
        mkdirSync(dir, { recursive: true });
        let file;
        if (isPcm) {
          const pcm = trimSilence(data, rate);
          file = `${job.folder}/${job.id}.${format}`;
          if (format === 'mp3') await pcmToMp3(pcm, rate, join(outDir, file));
          else writeFileSync(join(outDir, file), pcmToWav(pcm, rate));
        } else {
          // Otro formato ya contenedorizado (wav/mp3): se guarda tal cual
          const ext = /mpeg|mp3/i.test(mime) ? 'mp3' : 'wav';
          file = `${job.folder}/${job.id}.${ext}`;
          writeFileSync(join(outDir, file), data);
        }
        // Si antes existía con otra extensión, se borra para no dejar audios duplicados
        for (const ext of ['mp3', 'wav']) {
          const other = join(outDir, `${job.folder}/${job.id}.${ext}`);
          if (`${job.folder}/${job.id}.${ext}` !== file && existsSync(other)) unlinkSync(other);
        }
        manifest.voices[job.folder].clips[job.id] = { file, text: job.text, model };
        manifest.generatedAt = new Date().toISOString();
        saveManifest(manifestPath, manifest);
        done++;
        console.log(`  ✔ [${done + failed}/${planned.length}] ${file}`);
      } catch (err) {
        if (err instanceof FatalError) {
          stop = err.message;
          break;
        }
        failed++;
        console.error(`  ✖ [${done + failed}/${planned.length}] ${job.folder}/${job.id}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, planned.length) }, worker));

  console.log(`\n${stop ? `✖ ${stop}\n` : ''}Grabadas: ${done} · Con error: ${failed} · Pendientes: ${jobs.length - done}`);
  console.log(`Manifiesto: ${relative(ROOT, manifestPath)}`);
  if (stop || failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✖ ${err?.message ?? err}`);
  process.exit(1);
});
