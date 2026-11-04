import './lib/polyfills';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter, createHashRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/ui/ToastContext';
import { AuthGate } from './components/auth/AuthGate';
import { isNativeApp, platformKind } from './platform';
// Fuente incluida en la app (sin Google Fonts): funciona sin conexión y no expone la IP a terceros
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import './styles/global.css';
import './styles/motion.css';
import './styles/mobile.css';
import { installChartTouchDismiss } from './lib/chartTouch';
import { runBootSplash } from './lib/bootSplash';

/**
 * Router «de datos» (createBrowserRouter): hace falta para `useBlocker` (aviso de cambios sin guardar en Ajustes).
 * Una sola ruta comodín: las rutas reales siguen definidas con <Routes> dentro de <App>.
 * En las apps nativas los archivos se sirven desde el propio paquete: con rutas tipo #/ruta recargar o abrir una
 * ruta nunca depende de que el servidor devuelva index.html.
 */
const routes = [
  {
    path: '*',
    element: (
      <ToastProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </ToastProvider>
    ),
  },
];
const router = isNativeApp ? createHashRouter(routes) : createBrowserRouter(routes);

installChartTouchDismiss();
runBootSplash();

if (platformKind === 'android') void import('./platform/androidBack').then((m) => m.installAndroidBackButton());

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  );
}
