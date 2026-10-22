import type { CapacitorConfig } from '@capacitor/cli';

/**
 * App de Android (Capacitor). La web compilada (`dist/`, modo `capacitor`) se empaqueta dentro del APK:
 * la app funciona sin conexión y no depende de ningún servidor propio.
 * Firma del APK: ver docs/android.md (el keystore y sus contraseñas NUNCA van al repositorio).
 */
const config: CapacitorConfig = {
  appId: 'app.pilas.habitos',
  appName: '¡Pilas!',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    buildOptions: {
      releaseType: 'APK',
      keystorePath: process.env.PILAS_KEYSTORE_PATH,
      keystoreAlias: process.env.PILAS_KEYSTORE_ALIAS ?? 'pilas',
    },
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#8b5cf6',
    },
  },
};

export default config;
