import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Check, KeyRound, ShieldCheck, CloudOff } from 'lucide-react';
import { BrandMark } from '@/components/ui/BrandMark';
import { useSession } from '@/store/useSession';
import { supabase } from '@/sync/supabase';
import {
  AccountError, MIN_PASSWORD_LENGTH, completePasswordReset, passwordProblem, requestPasswordReset, resendSignupCode,
  signIn, signUp, verifySignup, type SignedIn,
} from '@/account/account';
import { boot, enterAccount, enterAfterCloudReset, resolveLegacy } from '@/account/runtime';
import { isNativeApp } from '@/platform';
import { DownloadPage } from './DownloadPage';
import './auth.css';

/**
 * Puerta de acceso: la app solo se muestra con una cuenta abierta (la cuenta es obligatoria).
 * Con una sesión guardada en el dispositivo se entra directamente, incluso sin conexión.
 */
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const status = useSession((s) => s.status);
  const isDownloadPage = !isNativeApp && window.location.pathname.replace(/\/+$/, '') === '/descargar';

  useEffect(() => {
    if (!isDownloadPage) void boot();
  }, [isDownloadPage]);

  // Página pública: se puede visitar sin cuenta
  if (isDownloadPage) return <DownloadPage />;
  if (status === 'ready') return <>{children}</>;
  if (status === 'loading') return <Loading />;
  if (status === 'unconfigured') return <Unconfigured />;
  if (status === 'legacyChoice') return <LegacyChoice />;
  return <AuthScreen />;
};

const Loading: React.FC = () => (
  <div className="auth-loading" role="status" aria-live="polite">
    <div className="auth-spinner" aria-hidden />
    Abriendo ¡Pilas!…
  </div>
);

const Brand: React.FC = () => (
  <div className="auth-brand">
    <BrandMark size={44} />
    <div>
      <h1>¡Pilas!</h1>
      <p>Hábitos, rachas y un coach que te mantiene en la jugada</p>
    </div>
  </div>
);

const Unconfigured: React.FC = () => (
  <div className="auth-screen">
    <div className="card auth-card">
      <Brand />
      <div className="callout attention">
        <CloudOff aria-hidden />
        <div>
          <div className="title">Falta conectar la cuenta</div>
          <div className="detail">
            Esta compilación no tiene configurado Supabase. Crea <code>.env.local</code> con <code>VITE_SUPABASE_URL</code> y{' '}
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (ver <code>docs/supabase.md</code>) y vuelve a compilar.
          </div>
        </div>
      </div>
    </div>
  </div>
);

/* ---------------- Inicio de sesión / registro ---------------- */

type Mode = 'signin' | 'signup' | 'verify' | 'forgot' | 'reset' | 'recovery';

const message = (err: unknown) => (err instanceof Error ? err.message : 'Algo salió mal. Inténtalo de nuevo.');

const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [noRecovery, setNoRecovery] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const notice = useSession((s) => s.notice);
  /** Cuenta abierta que aún tiene que guardar su código de recuperación */
  const [pending, setPending] = useState<{ signed: SignedIn; cloudReset: boolean } | null>(null);

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
    setCode('');
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof AccountError && err.code === 'email_not_confirmed') {
        await resendSignupCode(supabase(), email).catch(() => undefined);
        go('verify');
        setInfo('Te enviamos un código nuevo para confirmar tu correo.');
      } else {
        setError(message(err));
      }
    } finally {
      setBusy(null);
    }
  };

  const afterSignedIn = async (signed: SignedIn, cloudReset = false) => {
    if (signed.recoveryCode) {
      setPending({ signed, cloudReset });
      go('recovery');
      return;
    }
    await (cloudReset ? enterAfterCloudReset(signed) : enterAccount(signed));
  };

  const onSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    void run('Protegiendo tu contraseña…', async () => afterSignedIn(await signIn(supabase(), email, password)));
  };

  const onSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== password2) return setError('Las contraseñas no coinciden.');
    void run('Creando tu cuenta…', async () => {
      await signUp(supabase(), email, password);
      go('verify');
      setInfo(`Te enviamos un código de 6 dígitos a ${email.trim()}.`);
    });
  };

  const onVerify = (e: React.FormEvent) => {
    e.preventDefault();
    void run('Confirmando…', async () => afterSignedIn(await verifySignup(supabase(), email, code, password)));
  };

  const onForgot = (e: React.FormEvent) => {
    e.preventDefault();
    void run('Enviando código…', async () => {
      await requestPasswordReset(supabase(), email);
      go('reset');
      setInfo(`Si hay una cuenta con ${email.trim()}, te llegó un código de 6 dígitos.`);
    });
  };

  const onReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== password2) return setError('Las contraseñas no coinciden.');
    if (!noRecovery && !recovery.trim()) return setError('Escribe tu código de recuperación o marca que no lo tienes.');
    void run('Recuperando tu cuenta…', async () => {
      const signed = await completePasswordReset(supabase(), email, code, password, noRecovery ? null : recovery);
      await afterSignedIn(signed, noRecovery);
    });
  };

  const emailField = (
    <label className="field">
      <span className="label">Correo</span>
      <input
        className="input"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        data-autofocus
      />
    </label>
  );

  const codeField = (
    <label className="field">
      <span className="label">Código del correo</span>
      <input
        className="input auth-code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6,10}"
        maxLength={10}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
    </label>
  );

  const feedback = (
    <>
      {info && <p className="auth-lead" role="status">{info}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="auth-busy" aria-live="polite">{busy ?? ''}</p>
    </>
  );

  const submit = (label: string) => (
    <button className="btn btn-primary lg block" type="submit" disabled={busy !== null}>
      {label}
    </button>
  );

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <Brand />

        {notice && mode === 'signin' && (
          <div className="callout attention" role="status">
            <KeyRound aria-hidden />
            <div className="detail">{notice}</div>
          </div>
        )}

        {(mode === 'signin' || mode === 'signup') && (
          <div className="segmented auth-tabs" role="tablist" aria-label="Acceso">
            <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => go('signin')}>
              Entrar
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => go('signup')}>
              Crear cuenta
            </button>
          </div>
        )}

        {mode === 'signin' && (
          <form className="form" onSubmit={onSignIn}>
            {emailField}
            <label className="field">
              <span className="label">Contraseña</span>
              <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {feedback}
            {submit('Entrar')}
            <div className="auth-links">
              <button type="button" className="auth-link" onClick={() => go('forgot')}>
                Olvidé mi contraseña
              </button>
            </div>
          </form>
        )}

        {mode === 'signup' && (
          <form className="form" onSubmit={onSignUp}>
            {emailField}
            <PasswordFields password={password} password2={password2} onPassword={setPassword} onPassword2={setPassword2} />
            <p className="auth-lead">
              Tus datos se cifran en tu dispositivo antes de subirse: <strong>nadie más puede leerlos</strong>, ni siquiera
              nosotros. Por eso la contraseña no se puede ver ni restablecer sin tu código de recuperación.
            </p>
            {feedback}
            {submit('Crear cuenta')}
          </form>
        )}

        {mode === 'verify' && (
          <form className="form" onSubmit={onVerify}>
            <div>
              <h2 className="auth-title">Confirma tu correo</h2>
              <p className="auth-lead">Escribe el código que te enviamos a {email.trim()}.</p>
            </div>
            {codeField}
            {feedback}
            {submit('Confirmar')}
            <div className="auth-links">
              <button type="button" className="auth-link" onClick={() => void run('Enviando…', async () => { await resendSignupCode(supabase(), email); setInfo('Código reenviado.'); })}>
                Reenviar código
              </button>
              <button type="button" className="auth-link" onClick={() => go('signin')}>
                Volver
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot' && (
          <form className="form" onSubmit={onForgot}>
            <div>
              <h2 className="auth-title">Recuperar la cuenta</h2>
              <p className="auth-lead">Te enviaremos un código al correo. Para conservar tus datos necesitarás también tu código de recuperación.</p>
            </div>
            {emailField}
            {feedback}
            {submit('Enviar código')}
            <div className="auth-links">
              <button type="button" className="auth-link" onClick={() => go('signin')}>
                Volver
              </button>
            </div>
          </form>
        )}

        {mode === 'reset' && (
          <form className="form" onSubmit={onReset}>
            <div>
              <h2 className="auth-title">Nueva contraseña</h2>
            </div>
            {codeField}
            <PasswordFields password={password} password2={password2} onPassword={setPassword} onPassword2={setPassword2} newLabel />
            {!noRecovery && (
              <label className="field">
                <span className="label">Código de recuperación</span>
                <input
                  className="input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                />
              </label>
            )}
            <label className="checkbox">
              <input type="checkbox" checked={noRecovery} onChange={(e) => setNoRecovery(e.target.checked)} />
              No tengo el código de recuperación
            </label>
            {noRecovery && (
              <div className="callout attention">
                <KeyRound aria-hidden />
                <div className="detail">
                  Sin el código, los datos guardados en la nube <strong>no se pueden descifrar y se borrarán</strong>. La cuenta
                  empezará de nuevo con lo que haya en este dispositivo.
                </div>
              </div>
            )}
            {feedback}
            {submit(noRecovery ? 'Restablecer y empezar de nuevo' : 'Recuperar mi cuenta')}
            <div className="auth-links">
              <button type="button" className="auth-link" onClick={() => go('signin')}>
                Volver
              </button>
            </div>
          </form>
        )}

        {mode === 'recovery' && pending && (
          <RecoveryCodeStep
            code={pending.signed.recoveryCode!}
            onDone={() => void run('Abriendo tu cuenta…', () => (pending.cloudReset ? enterAfterCloudReset(pending.signed) : enterAccount(pending.signed)))}
            busy={busy}
          />
        )}

        <p className="auth-foot">
          Tus claves API nunca salen de este dispositivo.
          {!isNativeApp && (
            <>
              {' '}
              <a className="auth-link" href="/descargar">
                Descargar la app
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
};

/* ---------------- Piezas ---------------- */

function strength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= MIN_PASSWORD_LENGTH) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z\d]/.test(pw)) score++;
  if (passwordProblem(pw)) score = Math.min(score, 1);
  const levels = [
    { label: 'Muy débil', color: 'var(--danger)' },
    { label: 'Débil', color: 'var(--danger)' },
    { label: 'Aceptable', color: 'var(--warning)' },
    { label: 'Buena', color: 'var(--success)' },
    { label: 'Fuerte', color: 'var(--success)' },
    { label: 'Muy fuerte', color: 'var(--success)' },
  ];
  return { score, ...levels[score] };
}

const PasswordFields: React.FC<{
  password: string;
  password2: string;
  onPassword: (v: string) => void;
  onPassword2: (v: string) => void;
  newLabel?: boolean;
}> = ({ password, password2, onPassword, onPassword2, newLabel }) => {
  const s = useMemo(() => strength(password), [password]);
  const problem = password ? passwordProblem(password) : null;
  return (
    <>
      <label className="field">
        <span className="label">{newLabel ? 'Contraseña nueva' : 'Contraseña'}</span>
        <input className="input" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => onPassword(e.target.value)} />
        {password && (
          <>
            <div className="pw-meter" aria-hidden>
              <span style={{ width: `${(s.score / 5) * 100}%`, background: s.color }} />
            </div>
            <span className="hint">{problem ?? s.label}</span>
          </>
        )}
      </label>
      <label className="field">
        <span className="label">Repite la contraseña</span>
        <input className="input" type="password" autoComplete="new-password" required value={password2} onChange={(e) => onPassword2(e.target.value)} />
      </label>
    </>
  );
};

export const RecoveryCodeStep: React.FC<{ code: string; onDone: () => void; busy?: string | null; doneLabel?: string }> = ({
  code,
  onDone,
  busy,
  doneLabel = 'Continuar',
}) => {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* el usuario puede copiarlo a mano: el texto es seleccionable */
    }
  };

  const download = () => {
    const blob = new Blob([`Código de recuperación de ¡Pilas!\n\n${code}\n\nGuárdalo en un lugar seguro. Sin él no podrás recuperar tus datos si olvidas la contraseña.\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pilas-codigo-recuperacion.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="form">
      <div>
        <h2 className="auth-title">Tu código de recuperación</h2>
        <p className="auth-lead">
          Si algún día olvidas la contraseña, este código es <strong>la única forma</strong> de recuperar tus datos. Solo se
          muestra ahora: anótalo o guárdalo en tu gestor de contraseñas.
        </p>
      </div>
      <div className="recovery-code" aria-label="Código de recuperación">{code}</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary sm" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copiado' : 'Copiar'}
        </button>
        {!isNativeApp && (
          <button type="button" className="btn btn-secondary sm" onClick={download}>
            Descargar .txt
          </button>
        )}
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        Lo guardé en un lugar seguro
      </label>
      <p className="auth-busy" aria-live="polite">{busy ?? ''}</p>
      <button type="button" className="btn btn-primary lg block" disabled={!saved || Boolean(busy)} onClick={onDone}>
        <ShieldCheck aria-hidden /> {doneLabel}
      </button>
    </div>
  );
};

/* ---------------- Datos de una versión anterior en este navegador ---------------- */

const LegacyChoice: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const accountHasData = useSession((s) => s.legacyAccountHasData);
  const choose = (c: Parameters<typeof resolveLegacy>[0]) => {
    setBusy(true);
    void resolveLegacy(c).finally(() => setBusy(false));
  };
  if (!accountHasData) {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <Brand />
          <div>
            <h2 className="auth-title">Este dispositivo tiene datos sin cuenta</h2>
            <p className="auth-lead">
              Encontramos hábitos guardados en este dispositivo de antes de usar cuentas. Si son tuyos, puedes subirlos a tu
              cuenta. Si son de otra persona que usa este dispositivo, descártalos.
            </p>
          </div>
          <div className="form">
            <button className="btn btn-primary block" disabled={busy} onClick={() => choose('replace')}>
              Subir estos datos a mi cuenta
            </button>
            <button className="btn btn-ghost block" disabled={busy} onClick={() => choose('discard')}>
              Empezar de cero (descartarlos)
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <Brand />
        <div>
          <h2 className="auth-title">Este dispositivo tiene datos sin cuenta</h2>
          <p className="auth-lead">
            Encontramos hábitos guardados en este dispositivo de antes de usar cuentas, y tu cuenta también tiene datos. ¿Qué
            hacemos con los de este dispositivo?
          </p>
        </div>
        <div className="form">
          <button className="btn btn-primary block" disabled={busy} onClick={() => choose('merge')}>
            Combinar (añadir lo que falte a la cuenta)
          </button>
          <button className="btn btn-secondary block" disabled={busy} onClick={() => choose('replace')}>
            Reemplazar la cuenta con los de este dispositivo
          </button>
          <button className="btn btn-ghost block" disabled={busy} onClick={() => choose('discard')}>
            Usar solo los de la cuenta (descartar estos)
          </button>
        </div>
      </div>
    </div>
  );
};
