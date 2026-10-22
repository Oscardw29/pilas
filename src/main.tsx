import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/ui/ToastContext';
import { AuthGate } from './components/auth/AuthGate';
import { isNativeApp } from './platform';
// Fuente incluida en la app (sin Google Fonts): funciona sin conexión y no expone la IP a terceros
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import './styles/global.css';

// En las apps nativas los archivos se sirven desde el propio paquete: con rutas tipo #/ruta
// recargar o abrir una ruta nunca depende de que el servidor devuelva index.html
const Router = isNativeApp ? HashRouter : BrowserRouter;

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Router>
        <ToastProvider>
          <AuthGate>
            <App />
          </AuthGate>
        </ToastProvider>
      </Router>
    </React.StrictMode>
  );
}
