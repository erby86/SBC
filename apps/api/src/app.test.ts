import { healthResponseSchema } from '@sbc-noc/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /health', () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it('returns status ok with the package version', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body).toEqual({ status: 'ok', version: '0.1.0' });
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when every check passes', async () => {
    const app = buildApp({}, { checks: { db: async () => 1, redis: async () => 'PONG' } });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
    await app.close();
  });

  it('returns 503 and names the failing check', async () => {
    const app = buildApp(
      {},
      {
        checks: {
          db: async () => 1,
          redis: () => Promise.reject(new Error('ECONNREFUSED')),
        },
      },
    );
    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error', checks: { db: 'ok', redis: 'error' } });
    await app.close();
  });

  it('treats a hanging check as failed', async () => {
    const app = buildApp(
      {},
      { checkTimeoutMs: 20, checks: { db: () => new Promise(() => undefined) } },
    );
    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
