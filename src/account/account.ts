import type { SupabaseClient, User } from '@supabase/supabase-js';
import { deriveAccountKeys, derivePasswordKeys, normalizeEmail, unwrapRootKey, wrapRootKey, type AccountKeys } from '@/crypto/keys';
import { deviceDelete, deviceGet, deviceSet } from '@/db/localDb';
import { deviceLabel, deviceToken } from './device';

/**
 * CUENTAS (Supabase Auth)
 * - La contraseña nunca sale del dispositivo: se deriva `authSecret`, que es lo que recibe Supabase como contraseña.
 * - Los datos se guardan legibles en Supabase (protegidos por RLS): olvidar la contraseña no los pierde, basta con
 *   el código que llega al correo.
 * - Un dispositivo nuevo, además de la contraseña, se verifica con un código del correo (ver account/device.ts y
 *   supabase/migrations/0006_sin_cifrado_dispositivos.sql).
 * - Cuentas de antes: sus datos se cifraban de extremo a extremo con una clave guardada en `user_keys`. Al entrar se
 *   abre esa clave con la contraseña (`legacyKeys`) para convertir los datos a legibles una sola vez.
 */

export const MIN_PASSWORD_LENGTH = 10;

interface UserKeysRow {
  user_id: string;
  key_id: string;
  wrapped_dek_pw: string;
  /** Copia envuelta con la contraseña anterior mientras un cambio de contraseña está a medias */
  wrapped_dek_pw_prev?: string | null;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_credentials' | 'email_not_confirmed' | 'network' | 'other' = 'other',
  ) {
    super(message);
  }
}

/** Mensajes de Supabase → español claro */
function authError(err: { message?: string; code?: string; status?: number } | null | undefined): AccountError {
  const msg = err?.message ?? 'Error desconocido';
  const code = err?.code ?? '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
    return new AccountError('Correo o contraseña incorrectos.', 'invalid_credentials');
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
    return new AccountError('Tienes que confirmar tu correo con el código que te enviamos.', 'email_not_confirmed');
  }
  if (code === 'user_already_exists' || /already registered/i.test(msg)) {
    return new AccountError('Ya existe una cuenta con ese correo. Inicia sesión.');
  }
  if (code === 'otp_expired' || /token has expired|token is invalid|invalid otp/i.test(msg)) {
    return new AccountError('El código no es válido o ya caducó. Pide uno nuevo.');
  }
  if (code === 'over_email_send_rate_limit' || /rate limit|security purposes/i.test(msg)) {
    return new AccountError('Se enviaron demasiados correos. Espera unos minutos e inténtalo de nuevo.');
  }
  if (/fetch|network/i.test(msg)) return new AccountError('Sin conexión con el servidor. Revisa tu internet.', 'network');
  return new AccountError(msg);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (/^(.)\1+$/.test(password)) return 'La contraseña no puede ser un solo carácter repetido.';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(password)).length;
  if (kinds < 2 && password.length < 16) return 'Mezcla letras con números o símbolos (o usa una frase de 16+ caracteres).';
  return null;
}

/* ---------------- Estado de la cuenta en el dispositivo ---------------- */

/** Se guarda al terminar de entrar: con él, la app abre directamente la próxima vez */
export interface StoredAccount {
  /** Claves de la cuenta de antes mientras sus datos cifrados no se terminen de convertir */
  legacy?: AccountKeys;
}

const accountKey = (userId: string) => `account:${userId}`;

export async function loadAccountState(userId: string): Promise<StoredAccount | undefined> {
  const raw = await deviceGet<StoredAccount & Partial<AccountKeys>>(accountKey(userId));
  if (!raw) return undefined;
  // Formato anterior: las claves de cifrado guardadas directamente
  if (raw.encKey && raw.ridKey) return { legacy: { encKey: raw.encKey, ridKey: raw.ridKey } };
  return { legacy: raw.legacy };
}

export const storeAccountState = (userId: string, state: StoredAccount) => deviceSet(accountKey(userId), state);
export const forgetAccountState = (userId: string) => deviceDelete(accountKey(userId));

/* ---------------- Claves de las cuentas de antes (user_keys) ---------------- */

async function fetchUserKeys(sb: SupabaseClient, userId: string): Promise<UserKeysRow | null> {
  const { data, error } = await sb
    .from('user_keys')
    .select('user_id, key_id, wrapped_dek_pw, wrapped_dek_pw_prev')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw authError(error);
  return (data as UserKeysRow | null) ?? null;
}

/**
 * Abre la clave raíz de antes con la contraseña. Si un cambio de contraseña quedó a medias, la copia
 * anterior también sirve y se repara en el momento. null si ninguna copia abre con esta contraseña.
 */
async function openWithPassword(sb: SupabaseClient, row: UserKeysRow, kek: CryptoKey): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return await unwrapRootKey(row.wrapped_dek_pw, kek);
  } catch {
    if (!row.wrapped_dek_pw_prev) return null;
  }
  let root: Uint8Array<ArrayBuffer>;
  try {
    root = await unwrapRootKey(row.wrapped_dek_pw_prev, kek);
  } catch {
    return null;
  }
  await sb
    .from('user_keys')
    .update({ wrapped_dek_pw: await wrapRootKey(root, kek), wrapped_dek_pw_prev: null, updated_at: new Date().toISOString() })
    .eq('user_id', row.user_id);
  return root;
}

/** Claves de la cuenta de antes (si sus datos aún no se convirtieron) */
async function openLegacyKeys(sb: SupabaseClient, user: User, kek: CryptoKey): Promise<AccountKeys | undefined> {
  const row = await fetchUserKeys(sb, user.id);
  if (!row) return undefined;
  const root = await openWithPassword(sb, row, kek);
  if (!root) {
    console.warn('[Cuenta] La contraseña no abre las claves antiguas: los datos cifrados de antes no se podrán leer.');
    return undefined;
  }
  const keys = await deriveAccountKeys(root);
  root.fill(0);
  return keys;
}

/**
 * Cambio de contraseña en una cuenta de antes: se guarda la clave envuelta con la nueva contraseña antes de
 * cambiarla en Supabase, conservando la copia anterior; si el cambio falla, la contraseña antigua sigue sirviendo.
 */
async function rewrapAndChangePassword(
  sb: SupabaseClient,
  row: UserKeysRow,
  root: Uint8Array<ArrayBuffer>,
  next: { authSecret: string; kek: CryptoKey },
) {
  const { error: keyError } = await sb
    .from('user_keys')
    .update({ wrapped_dek_pw: await wrapRootKey(root, next.kek), wrapped_dek_pw_prev: row.wrapped_dek_pw, updated_at: new Date().toISOString() })
    .eq('user_id', row.user_id);
  if (keyError) throw authError(keyError);

  const { error: pwError } = await sb.auth.updateUser({ password: next.authSecret });
  if (pwError) {
    await sb.from('user_keys').update({ wrapped_dek_pw: row.wrapped_dek_pw, wrapped_dek_pw_prev: null }).eq('user_id', row.user_id);
    throw authError(pwError);
  }
  await sb.from('user_keys').update({ wrapped_dek_pw_prev: null }).eq('user_id', row.user_id);
}

/* ---------------- Dispositivos ---------------- */

async function isDeviceTrusted(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc('device_status', { p_token: await deviceToken() });
  if (error) throw authError(error);
  return data === true;
}

/** Marca este dispositivo como verificado (la sesión acaba de abrirse con un código del correo) */
async function trustThisDevice(sb: SupabaseClient): Promise<void> {
  const { error } = await sb.rpc('trust_device', { p_token: await deviceToken(), p_label: deviceLabel() });
  if (error) throw authError(error);
}

/** Envía al correo el código para verificar este dispositivo */
export async function sendDeviceCode(sb: SupabaseClient, email: string): Promise<void> {
  const { error } = await sb.auth.signInWithOtp({ email: normalizeEmail(email), options: { shouldCreateUser: false } });
  if (error) throw authError(error);
}

/** Comprueba el código del correo y deja este dispositivo verificado */
export async function verifyDevice(sb: SupabaseClient, email: string, code: string): Promise<void> {
  const { data, error } = await sb.auth.verifyOtp({ email: normalizeEmail(email), token: code.trim(), type: 'email' });
  if (error || !data.user) throw authError(error);
  await trustThisDevice(sb);
}

/* ---------------- Flujos ---------------- */

export interface SignedIn {
  user: { id: string; email: string };
  /** Claves de la cuenta de antes: sus datos cifrados se convierten a legibles al entrar */
  legacyKeys?: AccountKeys;
  /** La cuenta tenía datos cifrados que ya no se pueden abrir (se recuperó sin la contraseña anterior) */
  discardLegacy?: boolean;
}

export type SignInResult =
  | { status: 'ready'; signed: SignedIn }
  /** Contraseña correcta, pero el dispositivo es nuevo: se envió un código al correo (`verifyDevice`) */
  | { status: 'verifyDevice'; signed: SignedIn };

const signedUser = (user: User) => ({ id: user.id, email: user.email ?? '' });

/** Registro: Supabase envía un código de 6 dígitos al correo. Luego `verifySignup`. */
export async function signUp(sb: SupabaseClient, email: string, password: string): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new AccountError(problem);
  const { authSecret } = await derivePasswordKeys(email, password);
  const { data, error } = await sb.auth.signUp({ email: normalizeEmail(email), password: authSecret });
  if (error) throw authError(error);
  // Supabase no revela si el correo ya existía: devuelve un usuario sin identidades
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new AccountError('Ya existe una cuenta con ese correo. Inicia sesión.');
  }
}

export async function resendSignupCode(sb: SupabaseClient, email: string): Promise<void> {
  const { error } = await sb.auth.resend({ type: 'signup', email: normalizeEmail(email) });
  if (error) throw authError(error);
}

/** Confirma el correo del registro; el dispositivo donde se creó la cuenta queda verificado */
export async function verifySignup(sb: SupabaseClient, email: string, code: string): Promise<SignedIn> {
  const { data, error } = await sb.auth.verifyOtp({ email: normalizeEmail(email), token: code.trim(), type: 'email' });
  if (error || !data.user) throw authError(error);
  await trustThisDevice(sb);
  return { user: signedUser(data.user) };
}

export async function signIn(sb: SupabaseClient, email: string, password: string): Promise<SignInResult> {
  const { authSecret, kek } = await derivePasswordKeys(email, password);
  const { data, error } = await sb.auth.signInWithPassword({ email: normalizeEmail(email), password: authSecret });
  if (error || !data.user) throw authError(error);
  const signed: SignedIn = { user: signedUser(data.user), legacyKeys: await openLegacyKeys(sb, data.user, kek) };
  if (await isDeviceTrusted(sb)) return { status: 'ready', signed };
  await sendDeviceCode(sb, email);
  return { status: 'verifyDevice', signed };
}

/** «Olvidé mi contraseña»: envía un código al correo */
export async function requestPasswordReset(sb: SupabaseClient, email: string): Promise<void> {
  const { error } = await sb.auth.resetPasswordForEmail(normalizeEmail(email));
  if (error) throw authError(error);
}

/**
 * Completa la recuperación con el código del correo: contraseña nueva y los mismos datos.
 * Este dispositivo queda verificado; los demás se cierran y tendrán que verificarse otra vez.
 */
export async function completePasswordReset(sb: SupabaseClient, email: string, emailCode: string, newPassword: string): Promise<SignedIn> {
  const problem = passwordProblem(newPassword);
  if (problem) throw new AccountError(problem);
  const { data, error } = await sb.auth.verifyOtp({ email: normalizeEmail(email), token: emailCode.trim(), type: 'recovery' });
  if (error || !data.user) throw authError(error);
  const user = data.user;
  await trustThisDevice(sb);

  // Cuenta de antes sin convertir: sus datos cifrados solo se pueden abrir con las claves que guarde este dispositivo
  const legacyRow = await fetchUserKeys(sb, user.id);
  const legacyKeys = legacyRow ? (await loadAccountState(user.id))?.legacy : undefined;

  const { authSecret } = await derivePasswordKeys(email, newPassword);
  const { error: pwError } = await sb.auth.updateUser({ password: authSecret });
  if (pwError) throw authError(pwError);

  // Quien tuviera la contraseña anterior ya no entra: se cierran las demás sesiones y se olvidan los demás dispositivos
  const { error: devError } = await sb.rpc('forget_other_devices', { p_token: await deviceToken() });
  if (devError) console.warn('[Cuenta] No se pudieron olvidar los demás dispositivos:', devError.message);
  await sb.auth.signOut({ scope: 'others' }).catch(() => undefined);
  return { user: signedUser(user), legacyKeys, discardLegacy: Boolean(legacyRow && !legacyKeys) };
}

/** Comprueba la contraseña actual (abre una sesión nueva con ella) */
async function checkPassword(sb: SupabaseClient, email: string, password: string) {
  const derived = await derivePasswordKeys(email, password);
  const { error } = await sb.auth.signInWithPassword({ email: normalizeEmail(email), password: derived.authSecret });
  if (error) throw new AccountError('La contraseña actual no es correcta.', 'invalid_credentials');
  return derived;
}

export async function changePassword(sb: SupabaseClient, userId: string, email: string, current: string, next: string): Promise<void> {
  const problem = passwordProblem(next);
  if (problem) throw new AccountError(problem);
  const cur = await checkPassword(sb, email, current);
  const nextKeys = await derivePasswordKeys(email, next);
  // Cuenta de antes sin convertir del todo: la clave antigua se vuelve a envolver con la contraseña nueva
  const row = await fetchUserKeys(sb, userId);
  const root = row ? await openWithPassword(sb, row, cur.kek) : null;
  if (row && root) {
    try {
      await rewrapAndChangePassword(sb, row, root, nextKeys);
    } finally {
      root.fill(0);
    }
    return;
  }
  const { error } = await sb.auth.updateUser({ password: nextKeys.authSecret });
  if (error) throw authError(error);
}

/** Borra la cuenta y todos sus datos en la nube (pide la contraseña para confirmar) */
export async function deleteAccount(sb: SupabaseClient, userId: string, email: string, password: string): Promise<void> {
  await checkPassword(sb, email, password);
  // Fotos del perfil público: Storage no las borra en cascada con la cuenta (si falla, se sigue igual)
  try {
    const { data } = await sb.storage.from('avatars').list(userId, { limit: 100 });
    if (data?.length) await sb.storage.from('avatars').remove(data.map((f) => `${userId}/${f.name}`));
  } catch {
    /* sin capa pública o sin conexión con Storage */
  }
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw authError(error);
}
