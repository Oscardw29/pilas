/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Nombre antiguo de la clave pública de Supabase (se acepta igual) */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Página de descargas (p. ej. https://github.com/<usuario>/<repo>/releases/latest) */
  readonly VITE_DOWNLOADS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
