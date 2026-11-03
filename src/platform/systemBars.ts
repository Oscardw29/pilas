import { registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';

/**
 * Barras del sistema de Android (estado y navegación) con el fondo del tema de la app.
 * El color lo pinta el plugin propio PilasSystemBars (android/app/src/main/java/app/pilas/habitos);
 * el color de los iconos se fija también en el SystemBars de Capacitor para que lo conserve al girar la pantalla
 * o al cambiar el modo oscuro del sistema (si no, lo volvería a calcular con el tema del sistema, no el de la app).
 */

interface PilasSystemBarsPlugin {
  setColor(options: { color: string; dark: boolean }): Promise<void>;
}

const PilasSystemBars = registerPlugin<PilasSystemBarsPlugin>('PilasSystemBars');

export async function paintSystemBars(color: string, dark: boolean) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  try {
    await SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  } catch {
    /* sin el plugin de Capacitor: el nuestro fija también los iconos */
  }
  try {
    await PilasSystemBars.setColor({ color, dark });
  } catch {
    /* APK anterior sin el plugin: las barras quedan con el color nativo */
  }
}
