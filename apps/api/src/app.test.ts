import { healthResponseSchema, registryCheckReportSchema } from '@sbc-noc/shared';
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

describe('GET /registry/checks', () => {
  it('returns the report from the injected checker', async () => {
    const report = {
      generatedAt: '2026-10-02T00:00:00.000Z',
      errors: 1,
      warnings: 0,
      checks: [
        {
          check: 'no_position',
          severity: 'error' as const,
          title: 'x',
          count: 1,
          items: [{ code: 'sw-1', name: 'Switch 1', detail: null }],
        },
      ],
    };
    const app = buildApp({}, { registryChecks: async () => report });
    const res = await app.inject({ method: 'GET', url: '/registry/checks' });
    expect(res.statusCode).toBe(200);
    expect(registryCheckReportSchema.parse(res.json())).toEqual(report);
    await app.close();
  });

  it('is not exposed without a checker', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/registry/checks' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
