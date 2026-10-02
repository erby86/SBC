import { describe, expect, it } from 'vitest';
import { parseEnv, serverEnvSchema } from './env.js';

const valid = {
  DATABASE_URL: 'postgres://noc:pw@sbc-noc-db:5432/sbc_noc',
  REDIS_URL: 'redis://sbc-redis:6379/0',
};

describe('serverEnvSchema', () => {
  it('applies defaults', () => {
    const env = parseEnv(serverEnvSchema, valid);
    expect(env.REDIS_PREFIX).toBe('noc:');
    expect(env.NODE_ENV).toBe('development');
  });

  it('lists missing keys without leaking values', () => {
    expect(() => parseEnv(serverEnvSchema, { DATABASE_URL: 'postgres://u:secret@h/db' })).toThrow(
      'Invalid environment: REDIS_URL',
    );
    try {
      parseEnv(serverEnvSchema, { DATABASE_URL: 'mysql://u:secret@h/db', REDIS_URL: 'x' });
    } catch (err) {
      expect(String(err)).not.toContain('secret');
      expect(String(err)).toContain('DATABASE_URL');
    }
  });
});
