import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  KDF_VERSION, PBKDF2_ITERATIONS, deriveAccountKeys, derivePasswordKeys, generateRecoveryCode, generateRootKey,
  normalizeEmail, recoveryKek, unwrapRootKey, wrapRootKey, type AccountKeys,
} from '@/crypto/keys';
import { deviceDelete, deviceGet, deviceSet } from '@/db/localDb';

/**
 * CUENTAS (Supabase Auth + claves E2E)
 * La contraseña nunca sale del dispositivo: se deriva `authSecret` (lo que recibe Supabase como
 * contraseña) y `kek` (desbloquea la clave de la cuenta guardada cifrada en `user_keys`).
 */

export const MIN_PASSWORD_LENGTH = 10;

interface UserKeysRow {
  user_id: string;
  kdf: { alg: 'PBKDF2-SHA256'; iterations: number; version: number };
  wrapped_dek_pw: string;
  wrapped_dek_recovery: string;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_credentials' | 'email_not_confirmed' | 'wrong_recovery_code' | 'keys_missing' | 'network' | 'other' = 'other',
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
  if (code === 'over_email_send_rate_limit' || /rate limit/i.test(msg)) {
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

/* ---------------- Claves guardadas en el dispositivo ---------------- */

const accountKeysKey = (userId: string) => `account:${userId}`;

export const loadAccountKeys = (userId: string) => deviceGet<AccountKeys>(accountKeysKey(userId));
const storeAccountKeys = (userId: string, keys: AccountKeys) => deviceSet(accountKeysKey(userId), keys);
export const forgetAccountKeys = (userId: string) => deviceDelete(accountKeysKey(userId));

/* ---------------- user_keys en Supabase ---------------- */

async function fetchUserKeys(sb: SupabaseClient, userId: string): Promise<UserKeysRow | null> {
  const { data, error } = await sb.from('user_keys').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw authError(error);
  return (data as UserKeysRow | null) ?? null;
}

/** Crea la clave de la cuenta (primera vez). Devuelve el código de recuperación para mostrarlo una sola vez. */
async function createUserKeys(sb: SupabaseClient, user: User, kek: CryptoKey): Promise<{ keys: AccountKeys; recoveryCode: string }> {
  const root = generateRootKey();
  const recoveryCode = generateRecoveryCode();
  const row: UserKeysRow = {
    user_id: user.id,
    kdf: { alg: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, version: KDF_VERSION },
    wrapped_dek_pw: await wrapRootKey(root, kek),
    wrapped_dek_recovery: await wrapRootKey(root, await recoveryKek(recoveryCode)),
  };
  const { error } = await sb.from('user_keys').upsert(row);
  if (error) throw authError(error);
  const keys = await deriveAccountKeys(root);
  root.fill(0);
  return { keys, recoveryCode };
}

export interface SignedIn {
  user: { id: string; email: string };
  keys: AccountKeys;
  /** Solo si la cuenta acaba de crear sus claves: mostrarlo y pedir que lo guarde */
  recoveryCode?: string;
}

/** Con sesión iniciada: obtiene (o crea la primera vez) las claves de la cuenta y las guarda en el dispositivo */
async function unlockAccount(sb: SupabaseClient, user: User, kek: CryptoKey): Promise<SignedIn> {
  const row = await fetchUserKeys(sb, user.id);
  let keys: AccountKeys;
  let recoveryCode: string | undefined;
  if (!row) {
    ({ keys, recoveryCode } = await createUserKeys(sb, user, kek));
  } else {
    try {
      const root = await unwrapRootKey(row.wrapped_dek_pw, kek);
      keys = await deriveAccountKeys(root);
      root.fill(0);
    } catch {
      throw new AccountError('No se pudieron abrir las claves de la cuenta con esta contraseña.', 'invalid_credentials');
    }
  }
  await storeAccountKeys(user.id, keys);
  return { user: { id: user.id, email: user.email ?? '' }, keys, recoveryCode };
}

/* ---------------- Flujos ---------------- */

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

export async function verifySignup(sb: SupabaseClient, email: string, code: string, password: string): Promise<SignedIn> {
  const { kek } = await derivePasswordKeys(email, password);
  const { data, error } = await sb.auth.verifyOtp({ email: normalizeEmail(email), token: code.trim(), type: 'email' });
  if (error || !data.user) throw authError(error);
  return unlockAccount(sb, data.user, kek);
}

export async function signIn(sb: SupabaseClient, email: string, password: string): Promise<SignedIn> {
  const { authSecret, kek } = await derivePasswordKeys(email, password);
  const { data, error } = await sb.auth.signInWithPassword({ email: normalizeEmail(email), password: authSecret });
  if (error || !data.user) throw authError(error);
  return unlockAccount(sb, data.user, kek);
}

/** «Olvidé mi contraseña»: envía un código de recuperación al correo */
export async function requestPasswordReset(sb: SupabaseClient, email: string): Promise<void> {
  const { error } = await sb.auth.resetPasswordForEmail(normalizeEmail(email));
  if (error) throw authError(error);
}

/**
 * Completa la recuperación con el código del correo.
 * - Con el código de recuperación de la cuenta: se conservan los datos de la nube.
 * - Sin él (`recoveryCode` null): los datos cifrados de la nube son ilegibles y se borran;
 *   se crea una clave nueva (y un código de recuperación nuevo).
 */
export async function completePasswordReset(
  sb: SupabaseClient,
  email: string,
  emailCode: string,
  newPassword: string,
  recoveryCode: string | null,
): Promise<SignedIn> {
  const problem = passwordProblem(newPassword);
  if (problem) throw new AccountError(problem);
  const { data, error } = await sb.auth.verifyOtp({ email: normalizeEmail(email), token: emailCode.trim(), type: 'recovery' });
  if (error || !data.user) throw authError(error);
  const user = data.user;
  const next = await derivePasswordKeys(email, newPassword);

  if (recoveryCode) {
    const row = await fetchUserKeys(sb, user.id);
    if (!row) throw new AccountError('Esta cuenta no tiene claves guardadas.', 'keys_missing');
    let root: Uint8Array<ArrayBuffer>;
    try {
      root = await unwrapRootKey(row.wrapped_dek_recovery, await recoveryKek(recoveryCode));
    } catch {
      throw new AccountError('El código de recuperación no es correcto.', 'wrong_recovery_code');
    }
    const { error: pwError } = await sb.auth.updateUser({ password: next.authSecret });
    if (pwError) throw authError(pwError);
    const { error: keyError } = await sb
      .from('user_keys')
      .update({ wrapped_dek_pw: await wrapRootKey(root, next.kek), updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
    if (keyError) throw authError(keyError);
    const keys = await deriveAccountKeys(root);
    root.fill(0);
    await storeAccountKeys(user.id, keys);
    return { user: { id: user.id, email: user.email ?? '' }, keys };
  }

  const { error: resetError } = await sb.rpc('reset_my_data');
  if (resetError) throw authError(resetError);
  const { error: pwError } = await sb.auth.updateUser({ password: next.authSecret });
  if (pwError) throw authError(pwError);
  const { keys, recoveryCode: fresh } = await createUserKeys(sb, user, next.kek);
  await storeAccountKeys(user.id, keys);
  return { user: { id: user.id, email: user.email ?? '' }, keys, recoveryCode: fresh };
}

/** Comprueba la contraseña actual y devuelve la clave raíz (para cambiar contraseña o código) */
async function rootFromPassword(sb: SupabaseClient, userId: string, email: string, password: string) {
  const row = await fetchUserKeys(sb, userId);
  if (!row) throw new AccountError('Esta cuenta no tiene claves guardadas.', 'keys_missing');
  const { kek } = await derivePasswordKeys(email, password);
  try {
    return await unwrapRootKey(row.wrapped_dek_pw, kek);
  } catch {
    throw new AccountError('La contraseña actual no es correcta.', 'invalid_credentials');
  }
}

export async function changePassword(sb: SupabaseClient, userId: string, email: string, current: string, next: string): Promise<void> {
  const problem = passwordProblem(next);
  if (problem) throw new AccountError(problem);
  const root = await rootFromPassword(sb, userId, email, current);
  const derived = await derivePasswordKeys(email, next);
  const { error } = await sb.auth.updateUser({ password: derived.authSecret });
  if (error) throw authError(error);
  const { error: keyError } = await sb
    .from('user_keys')
    .update({ wrapped_dek_pw: await wrapRootKey(root, derived.kek), updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  root.fill(0);
  if (keyError) throw authError(keyError);
}

/** Genera un código de recuperación nuevo (el anterior deja de servir) */
export async function regenerateRecoveryCode(sb: SupabaseClient, userId: string, email: string, password: string): Promise<string> {
  const root = await rootFromPassword(sb, userId, email, password);
  const code = generateRecoveryCode();
  const { error } = await sb
    .from('user_keys')
    .update({ wrapped_dek_recovery: await wrapRootKey(root, await recoveryKek(code)), updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  root.fill(0);
  if (error) throw authError(error);
  return code;
}

/** Borra la cuenta y todos sus datos en la nube (pide la contraseña para confirmar) */
export async function deleteAccount(sb: SupabaseClient, userId: string, email: string, password: string): Promise<void> {
  (await rootFromPassword(sb, userId, email, password)).fill(0);
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw authError(error);
}
