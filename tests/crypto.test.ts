import { describe, expect, it } from 'vitest';
import {
  deriveAccountKeys, derivePasswordKeys, generateRecoveryCode, generateRootKey, opaqueId, openJson, recoveryKek,
  sealJson, unwrapRootKey, wrapRootKey,
} from '@/crypto/keys';

const FAST = 1000; // iteraciones bajas solo para que las pruebas sean rápidas

describe('claves E2E', () => {
  it('la misma contraseña y correo derivan el mismo authSecret; otro correo no', async () => {
    const a = await derivePasswordKeys('Ana@Mail.com ', 'una clave larga 123', FAST);
    const b = await derivePasswordKeys('ana@mail.com', 'una clave larga 123', FAST);
    const c = await derivePasswordKeys('otra@mail.com', 'una clave larga 123', FAST);
    expect(a.authSecret).toBe(b.authSecret);
    expect(a.authSecret).not.toBe(c.authSecret);
    expect(a.authSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('con authSecret (lo que ve el servidor) no se abre la clave de la cuenta', async () => {
    const pw = await derivePasswordKeys('ana@mail.com', 'una clave larga 123', FAST);
    const root = generateRootKey();
    const wrapped = await wrapRootKey(root, pw.kek);
    const fromServerSide = await derivePasswordKeys('ana@mail.com', pw.authSecret, FAST);
    await expect(unwrapRootKey(wrapped, fromServerSide.kek)).rejects.toThrow();
    expect(await unwrapRootKey(wrapped, pw.kek)).toEqual(root);
  });

  it('el código de recuperación abre su copia; uno distinto no', async () => {
    const root = generateRootKey();
    const code = generateRecoveryCode();
    expect(code).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    const wrapped = await wrapRootKey(root, await recoveryKek(code));
    expect(await unwrapRootKey(wrapped, await recoveryKek(code.toLowerCase().replace(/-/g, ' ')))).toEqual(root);
    await expect(unwrapRootKey(wrapped, await recoveryKek(generateRecoveryCode()))).rejects.toThrow();
  });

  it('cifra registros y genera ids opacos estables', async () => {
    const keys = await deriveAccountKeys(generateRootKey());
    const sealed = await sealJson(keys.encKey, { k: 'habits:h1', v: { name: 'Leer' } });
    expect(sealed).not.toContain('Leer');
    expect(await openJson(keys.encKey, sealed)).toEqual({ k: 'habits:h1', v: { name: 'Leer' } });
    expect(await opaqueId(keys.ridKey, 'habits:h1')).toBe(await opaqueId(keys.ridKey, 'habits:h1'));
    expect(await opaqueId(keys.ridKey, 'habits:h1')).not.toContain('habits');
    const other = await deriveAccountKeys(generateRootKey());
    await expect(openJson(other.encKey, sealed)).rejects.toThrow();
  });
});
