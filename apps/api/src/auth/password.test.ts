import { describe, expect, it } from 'vitest';
import { generatePassword, hashPassword, verifyPassword } from './password.js';

describe('password hashing (M23, argon2id)', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('รหัสผ่าน-ยาวพอ-123');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword('รหัสผ่าน-ยาวพอ-123', hash)).toBe(true);
    expect(await verifyPassword('รหัสผ่าน-ยาวพอ-124', hash)).toBe(false);
    expect(await hashPassword('same')).not.toBe(await hashPassword('same')); // salted
  });

  it('rejects hashes it cannot read', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', '$2b$10$bcrypt-style')).toBe(false);
  });

  it('generates long random passwords without look-alike characters', () => {
    const a = generatePassword();
    expect(a).toHaveLength(20);
    expect(a).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]+$/);
    expect(generatePassword()).not.toBe(a);
  });
});
