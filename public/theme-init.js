// Tema antes de pintar (sin destello al abrir): la app guarda en este dispositivo el último tema elegido
// (src/lib/theme.ts, clave 'pilas:theme'; sin valor = oscuro). Va en un archivo aparte y no en línea porque la
// Content-Security-Policy de la web, Android y Tauri solo permite scripts propios (script-src 'self').
(function () {
  var theme = 'dark';
  try {
    if (localStorage.getItem('pilas:theme') === 'light') theme = 'light';
  } catch (e) {
    /* almacenamiento bloqueado: tema oscuro */
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c0c10' : '#f5f4fa');
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', theme);
})();
