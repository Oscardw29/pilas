import { useSession } from '@/store/useSession';

/**
 * CUENTA DEL CREADOR
 * Por ahora solo decide qué ajustes de prueba se muestran en la interfaz (sonido, notificaciones detalladas,
 * animaciones de prueba, seguridad de claves, restablecer datos): son preferencias del propio dispositivo, sin riesgo.
 *
 * ⚠️ No es una medida de seguridad. Cuando existan acciones con efecto sobre otros usuarios (vetar, editar la
 * tienda, la economía…), el permiso lo dará el servidor con `is_admin()` (ver docs/plan-social.md, F4), nunca
 * esta comparación de correo.
 */
const CREATOR_EMAIL = 'oscarwis2009@gmail.com';

export const isCreatorEmail = (email: string | undefined | null) => (email ?? '').trim().toLowerCase() === CREATOR_EMAIL;

export const useIsCreator = (): boolean => useSession((s) => isCreatorEmail(s.user?.email));
