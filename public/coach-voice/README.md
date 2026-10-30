# Voz grabada del coach

Audios de las frases fijas de Pilo y Pila (`pilo/<id>.mp3` y `pila/<id>.mp3`, o `.wav` si no hay ffmpeg) y
`manifest.json`, que le dice a la app qué frases tienen audio y con qué texto se grabaron.

No se editan a mano: los genera `scripts/generate-coach-voice.mjs` a partir de `src/data/coachPhrases.json`
con la voz original del coach (Gemini TTS). Instrucciones y texto de cada frase en `docs/coach-voz.md`.

Con el manifiesto vacío (como viene en el repositorio) no hay frases grabadas: sin una voz configurada en
Ajustes, el coach no suena.
