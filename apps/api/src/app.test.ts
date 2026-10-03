import { healthResponseSchema, registryCheckReportSchema } from '@sbc-noc/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp();
  });

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
    const app = await buildApp({}, { checks: { db: async () => 1, redis: async () => 'PONG' } });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
    await app.close();
  });

  it('returns 503 and names the failing check', async () => {
    const app = await buildApp(
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
    const app = await buildApp(
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
    const app = await buildApp({}, { registryChecks: async () => report });
    const res = await app.inject({ method: 'GET', url: '/registry/checks' });
    expect(res.statusCode).toBe(200);
    expect(registryCheckReportSchema.parse(res.json())).toEqual(report);
    await app.close();
  });

  it('is not exposed without a checker', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/registry/checks' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('OpenAPI and metrics (M13)', () => {
  it('documents the routes from their zod schemas', async () => {
    const app = await buildApp(
      {},
      { registryChecks: async () => ({ generatedAt: '', errors: 0, warnings: 0, checks: [] }) },
    );
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{
      openapi: string;
      servers: { url: string }[];
      paths: Record<string, unknown>;
    }>();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.servers).toEqual([{ url: '/api' }]);
    expect(Object.keys(doc.paths).sort()).toEqual(['/health', '/health/ready', '/registry/checks']);
    expect(JSON.stringify(doc.paths['/health'])).toContain('"version"');
    const ui = await app.inject({ method: 'GET', url: '/docs/' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    await app.close();
  });

  it('exposes Prometheus metrics with per-route request durations', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/health' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('noc_api_process_cpu_seconds_total');
    expect(res.body).toMatch(
      /noc_api_http_request_duration_seconds_count\{method="GET",route="\/health",status="200"\} 1/,
    );
    await app.close();
  });

  it('rejects a response that breaks its schema instead of leaking it', async () => {
    const app = await buildApp({}, { registryChecks: async () => ({ wrong: true }) as never });
    const res = await app.inject({ method: 'GET', url: '/registry/checks' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
