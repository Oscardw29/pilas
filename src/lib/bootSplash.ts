import { useSession } from '@/store/useSession';

/**
 * ANIMACIÓN DE APERTURA (#boot-splash en index.html)
 * La animación va en el HTML (SVG + CSS) y empieza sola en cuanto se pinta la página. Aquí solo se decide cuándo
 * quitarla: cuando ha terminado (≈2 s) y la sesión ya cargó. Si la app tarda más, el CSS muestra la barra de carga
 * debajo del logo y se espera a la sesión. Con la app ya lista, tocar la pantalla la salta.
 * Sale cada vez que la app arranca de cero (abrirla tras cerrarla, recargar); navegar dentro de la app no la repite.
 */

/** Por si el navegador no sabe listar animaciones (WebView antiguas): lo que dura la secuencia */
const INTRO_MS = 2100;
/** Nunca más de esto esperando a que acabe la animación (pestaña en segundo plano, animaciones pausadas…) */
const INTRO_MAX_MS = 3500;
const LEAVE_MS = 420;

function introFinished(splash: HTMLElement): Promise<void> {
  const cap = new Promise<void>((r) => setTimeout(r, INTRO_MAX_MS));
  if (typeof splash.getAnimations !== 'function') return new Promise((r) => setTimeout(r, INTRO_MS));
  // Las de la secuencia: ni las infinitas (halo, barra) ni la entrada de la barra de carga
  const intro = splash.getAnimations({ subtree: true }).filter((a) => {
    const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
    return a.effect?.getTiming().iterations !== Infinity && !target?.closest('.sp-loader');
  });
  return Promise.race([Promise.all(intro.map((a) => a.finished.catch(() => undefined))).then(() => undefined), cap]);
}

/** La página pública de descarga no abre sesión (AuthGate): ahí no hay nada que esperar */
const isDownloadPage = () => typeof location !== 'undefined' && location.pathname.replace(/\/+$/, '') === '/descargar';
const sessionReady = () => isDownloadPage() || useSession.getState().status !== 'loading';

function whenSessionReady(): Promise<void> {
  if (sessionReady()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useSession.subscribe(() => {
      if (!sessionReady()) return;
      off();
      resolve();
    });
  });
}

let started = false;
/** Copia intacta del HTML de la animación (antes de que empiece a irse) para poder repetirla en el panel */
let template: HTMLElement | null = null;

/** Quita la animación con su fundido */
function makeLeave(splash: HTMLElement) {
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    splash.classList.add('is-leaving');
    setTimeout(() => splash.remove(), LEAVE_MS);
  };
}

export function runBootSplash() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  template = splash.cloneNode(true) as HTMLElement;
  const leave = makeLeave(splash);

  // Con la app lista, un toque salta lo que quede de animación
  splash.addEventListener('pointerdown', () => {
    if (sessionReady()) leave();
  });

  void Promise.all([introFinished(splash), whenSessionReady()]).then(leave);
}

/** El HTML de la animación: la copia guardada al arrancar o, si no la hay (recarga en caliente), el de index.html */
async function splashTemplate(): Promise<HTMLElement | null> {
  if (template) return template;
  try {
    const html = await (await fetch(new URL('index.html', document.baseURI).href)).text();
    const el = new DOMParser().parseFromString(html, 'text/html').getElementById('boot-splash');
    if (el) template = document.importNode(el, true) as HTMLElement;
  } catch {
    /* sin acceso al HTML: no se puede repetir */
  }
  return template;
}

/**
 * Panel del creador → «Probar animaciones»: repite la animación de apertura tal como sale al abrir la app.
 * `slowLoad`: simula una carga lenta; la barra de carga aparece debajo del logo y se queda hasta tocar la pantalla
 * (o 10 s). Solo es visual: no recarga ni toca nada de la app.
 */
export async function replayBootSplash({ slowLoad = false }: { slowLoad?: boolean } = {}): Promise<boolean> {
  const tpl = await splashTemplate();
  if (!tpl) return false;
  document.querySelectorAll('.boot-splash.is-replay').forEach((n) => n.remove());
  const splash = tpl.cloneNode(true) as HTMLElement;
  splash.removeAttribute('id');
  splash.classList.remove('is-leaving');
  splash.classList.add('is-replay');
  document.body.appendChild(splash);
  const leave = makeLeave(splash);
  let introDone = false;
  // Un toque la cierra cuando ya terminó la secuencia (o en cualquier momento si no se simula carga lenta)
  splash.addEventListener('pointerdown', () => {
    if (introDone || !slowLoad) leave();
  });
  await introFinished(splash);
  introDone = true;
  if (!slowLoad) leave();
  else setTimeout(leave, 10_000);
  return true;
}
