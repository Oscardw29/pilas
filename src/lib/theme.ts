/**
 * TEMA CLARO / OSCURO
 * `settings.theme` (sin valor = oscuro) se aplica como `data-theme` en <html>; los colores de cada tema viven en
 * styles/global.css. Se guarda además una copia en este dispositivo (localStorage) para que public/theme-init.js la
 * aplique antes de pintar la primera vez: así la app no destella en claro al abrirla en oscuro (ni al revés).
 */

import { platformKind } from '@/platform';

export type Theme = 'light' | 'dark';

/** Copia del último tema en este dispositivo (la lee public/theme-init.js: si cambias el nombre, cámbialo allí) */
export const THEME_STORAGE_KEY = 'pilas:theme';

/** Fondo de cada tema (= --bg de global.css) por si la hoja de estilos aún no cargó */
const FALLBACK_BG: Record<Theme, string> = { light: '#f5f4fa', dark: '#0c0c10' };

export const themeOf = (t: string | null | undefined): Theme => (t === 'light' ? 'light' : 'dark');

/** Aplica el tema a la página, a la barra del sistema (theme-color) y lo recuerda en el dispositivo */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* almacenamiento bloqueado: el tema se aplica igual, solo puede destellar al abrir */
  }
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || FALLBACK_BG[theme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  // En la app de Android el theme-color no pinta las barras del sistema: lo hace un plugin nativo
  if (platformKind === 'android') {
    void import('@/platform/systemBars').then((m) => m.paintSystemBars(bg, theme === 'dark'));
  }
}
