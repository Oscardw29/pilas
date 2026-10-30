import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, LogOut, Settings as SettingsIcon, ShieldCheck, UserRound } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSession } from '@/store/useSession';
import { signOut } from '@/account/runtime';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';
import { MyAvatar } from './Avatar';
import { useSocial } from '@/social/useSocial';
import '@/components/social/social.css';
import './profile.css';

// ConfirmModal llama a onClose justo después de onConfirm: cada paso solo se cierra a sí mismo
type Step = null | 'confirm1' | 'confirm2' | 'signingOut' | 'unsynced';

/**
 * Menú de perfil: bloque abajo del panel izquierdo (escritorio/tablet) o avatar en la cabecera (móvil).
 * Opciones: Mi perfil, Ajustes y Cerrar sesión (en rojo, con doble confirmación).
 */
export const ProfileMenu: React.FC<{ variant: 'sidebar' | 'header' }> = ({ variant }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const userName = useStore((s) => s.settings.userName);
  const email = useSession((s) => s.user?.email ?? '');
  const alias = useSocial((s) => s.profile?.alias);
  const unread = useSocial((s) => s.unread);
  const isAdmin = useSocial((s) => s.isAdmin);
  const socialAvailable = useSocial((s) => s.available);
  // Con perfil público se muestra el alias; el correo sigue siendo solo para ti
  const subline = alias ? `@${alias}` : email;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const [step, setStep] = useState<Step>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayName = userName?.trim() || 'Tu perfil';

  // El menú se abre hacia arriba en el panel (está abajo) y hacia abajo en la cabecera
  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    let r = el.getBoundingClientRect();
    // En el rail de tablet el engranaje está oculto: se usa el avatar como referencia
    if (!r.width) r = el.closest('.profile-block')?.querySelector('.profile-avatar-btn')?.getBoundingClientRect() ?? r;
    const width = 232;
    const left = Math.min(Math.max(8, variant === 'header' ? r.right - width : r.left), window.innerWidth - width - 8);
    // Nunca fuera de la pantalla, aunque el disparador quede cerca de un borde
    setPos(
      variant === 'header'
        ? { left, top: Math.min(r.bottom + 8, window.innerHeight - 320) }
        : { left, bottom: Math.min(Math.max(8, window.innerHeight - r.top + 8), window.innerHeight - 320) },
    );
  }, [variant]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      const holder = anchorRef.current?.closest('.profile-block') ?? anchorRef.current;
      if (menuRef.current?.contains(t) || holder?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        anchorRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    // Foco en la primera opción para poder usarlo con teclado
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const closeStep = (which: Step) => setStep((s) => (s === which ? null : s));

  const doSignOut = async (force: boolean) => {
    setStep('signingOut');
    setBusy(true);
    try {
      // En equipos compartidos es más seguro olvidar también las claves API de este dispositivo
      const { pending: left } = await signOut({ forgetApiKeys: true, force });
      if (left > 0) {
        setPending(left);
        setStep('unsynced');
        return;
      }
      setStep(null);
      playSound.modalClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo cerrar la sesión', 'error');
      setStep(null);
    } finally {
      setBusy(false);
    }
  };

  const trigger =
    variant === 'sidebar' ? (
      <div className="profile-block">
        <button
          type="button"
          className="profile-avatar-btn"
          onClick={() => go('/perfil')}
          title="Mi perfil"
          aria-label={unread > 0 ? `Mi perfil (${unread} notificaciones sin leer)` : 'Mi perfil'}
          data-no-sound="true"
        >
          <MyAvatar size={34} />
          {unread > 0 && <span className="notif-dot" aria-hidden="true" />}
        </button>
        <div className="profile-block-name">
          <strong>{displayName}</strong>
          <span>{subline}</span>
        </div>
        <button
          ref={anchorRef}
          type="button"
          className="icon-btn sm profile-gear"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Menú de perfil"
          title="Menú de perfil"
        >
          <SettingsIcon size={16} />
        </button>
      </div>
    ) : (
      <button
        ref={anchorRef}
        type="button"
        className="profile-avatar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Menú de perfil, ${unread} notificaciones sin leer` : 'Menú de perfil'}
      >
        <MyAvatar size={32} />
        {unread > 0 && <span className="notif-dot" aria-hidden="true" />}
      </button>
    );

  return (
    <>
      {trigger}
      {/* En el rail de tablet el engranaje se oculta: el avatar abre el menú */}
      {variant === 'sidebar' && <RailAnchorFix anchorRef={anchorRef} onToggle={() => setOpen((v) => !v)} />}

      {open &&
        createPortal(
          <div ref={menuRef} className="profile-menu" role="menu" aria-label="Menú de perfil" style={pos}>
            <div className="profile-menu-head">
              <MyAvatar size={36} />
              <div>
                <strong>{displayName}</strong>
                <span>{subline}</span>
              </div>
            </div>
            <button type="button" role="menuitem" className="profile-menu-item" onClick={() => go('/perfil')}>
              <UserRound aria-hidden /> Mi perfil
            </button>
            {socialAvailable && (
              <button type="button" role="menuitem" className="profile-menu-item" onClick={() => go('/notificaciones')}>
                <Bell aria-hidden /> Notificaciones
                {unread > 0 && (
                  <span className="notif-count" style={{ marginLeft: 'auto' }} aria-label={`${unread} sin leer`}>
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            )}
            <button type="button" role="menuitem" className="profile-menu-item" onClick={() => go('/ajustes')}>
              <SettingsIcon aria-hidden /> Ajustes
            </button>
            {isAdmin && (
              <button type="button" role="menuitem" className="profile-menu-item" onClick={() => go('/creador')}>
                <ShieldCheck aria-hidden /> Panel del creador
              </button>
            )}
            <div className="profile-menu-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="profile-menu-item danger"
              onClick={() => {
                setOpen(false);
                setStep('confirm1');
              }}
            >
              <LogOut aria-hidden /> Cerrar sesión
            </button>
          </div>,
          document.body,
        )}

      <ConfirmModal
        isOpen={step === 'confirm1'}
        onClose={() => closeStep('confirm1')}
        onConfirm={() => setStep('confirm2')}
        title="¿Cerrar sesión?"
        message="Vas a salir de tu cuenta en este dispositivo."
        confirmLabel="Sí, cerrar sesión"
        danger
      />
      <ConfirmModal
        isOpen={step === 'confirm2' || step === 'signingOut'}
        onClose={() => closeStep('confirm2')}
        onConfirm={() => void doSignOut(false)}
        title="¿Seguro?"
        message="Se borrarán de este dispositivo tus datos (siguen guardados en tu cuenta) y tus claves API. Para volver a entrar necesitarás tu contraseña."
        confirmLabel={busy ? 'Cerrando sesión…' : 'Cerrar sesión definitivamente'}
        danger
      />
      <ConfirmModal
        isOpen={step === 'unsynced'}
        onClose={() => closeStep('unsynced')}
        onConfirm={() => void doSignOut(true)}
        title="Hay cambios sin subir"
        message={`No se pudieron subir ${pending} cambios a tu cuenta (¿sin conexión?). Si cierras sesión ahora, se perderán.`}
        confirmLabel={busy ? 'Cerrando sesión…' : 'Cerrar sesión y perderlos'}
        danger
      />
    </>
  );
};

/**
 * En el rail de iconos (tablet) solo se ve el avatar. Allí el avatar abre el menú en lugar de ir al perfil, para que
 * «Ajustes» y «Cerrar sesión» sigan siendo accesibles. Se detecta por el ancho, igual que el CSS del rail.
 */
const RailAnchorFix: React.FC<{ anchorRef: React.RefObject<HTMLButtonElement | null>; onToggle: () => void }> = ({ anchorRef, onToggle }) => {
  useEffect(() => {
    const gear = anchorRef.current;
    const block = gear?.closest('.profile-block');
    const avatarBtn = block?.querySelector<HTMLButtonElement>('.profile-avatar-btn');
    if (!avatarBtn) return;
    const rail = window.matchMedia('(min-width: 640px) and (max-width: 1023.98px)');
    const onClick = (e: MouseEvent) => {
      if (!rail.matches) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onToggle();
    };
    avatarBtn.addEventListener('click', onClick, true);
    return () => avatarBtn.removeEventListener('click', onClick, true);
  }, [anchorRef, onToggle]);
  return null;
};
