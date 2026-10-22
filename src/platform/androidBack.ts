import { App } from '@capacitor/app';
import { hasOpenModal } from '@/components/ui/useModalBehavior';

/**
 * Botón «Atrás» de Android: primero cierra el diálogo abierto (como Escape), luego vuelve a la
 * pantalla anterior y, en el inicio, deja la app en segundo plano (sin cerrarla: el temporizador sigue).
 */
export function installAndroidBackButton() {
  void App.addListener('backButton', ({ canGoBack }) => {
    if (hasOpenModal()) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    const atHome = window.location.hash === '' || window.location.hash === '#/' || window.location.hash === '#';
    if (canGoBack && !atHome) window.history.back();
    else void App.minimizeApp();
  });
}
