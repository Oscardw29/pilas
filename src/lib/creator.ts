import { useSession } from '@/store/useSession';
import { useSocial } from '@/social/useSocial';

/**
 * CUENTA DEL CREADOR
 * El rol lo da el servidor (`is_admin()`, tabla `app_admins` en supabase/migrations/0002_social.sql) y se recuerda en el
 * dispositivo para la interfaz sin conexión. Todo lo que afecta a otras personas (vetar, la tienda, la economía…) lo
 * vuelve a comprobar el servidor: ocultar o mostrar botones aquí nunca da permisos.
 *
 * Mientras el servidor no tenga la capa pública (migración 0002 sin aplicar) se usa el correo solo para mostrar los
 * ajustes de prueba de este dispositivo (sonido, animaciones…), que no tienen efecto sobre nadie más.
 */
const CREATOR_EMAIL = 'oscarwis2009@gmail.com';

export const isCreatorEmail = (email: string | undefined | null) => (email ?? '').trim().toLowerCase() === CREATOR_EMAIL;

export const useIsCreator = (): boolean => {
  const isAdmin = useSocial((s) => s.isAdmin);
  const available = useSocial((s) => s.available);
  const byEmail = useSession((s) => isCreatorEmail(s.user?.email));
  return isAdmin || (!available && byEmail);
};
