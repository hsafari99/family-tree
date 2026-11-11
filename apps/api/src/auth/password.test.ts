import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('hashes with argon2id at the OWASP minimum parameters', async () => {
    expect(await hashPassword('Correct horse 1')).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('Correct horse 1');
    expect(await verifyPassword({ hash, password: 'Correct horse 1' })).toBe(true);
    expect(await verifyPassword({ hash, password: 'Wrong horse 1' })).toBe(false);
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    await expect(verifyPassword({ hash: 'not-a-hash', password: 'anything' })).resolves.toBe(false);
  });
});
