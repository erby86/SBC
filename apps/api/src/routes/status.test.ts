import type { StatusSnapshot } from '@sbc-noc/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const snap = (lastUpdate: string): StatusSnapshot => ({
  generatedAt: lastUpdate,
  lastUpdate,
  stale: false,
  states: { 'm-s8': 'down', 'sw-s8-a': 'cut' },
  incidents: [
    {
      device: 'm-s8',
      severity: 'down',
      since: lastUpdate,
      message: 'ping',
      impacted: 1,
      ack: null,
    },
  ],
  counts: { ok: 10, warn: 0, down: 1, cut: 1, maint: 0 },
  labOnline: {},
});

describe('GET /status (M15)', () => {
  it('returns 503 until the engine has written a snapshot', async () => {
    const app = await buildApp({}, { status: async () => null });
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('returns the snapshot, fresh', async () => {
    const app = await buildApp({}, { status: async () => snap(new Date().toISOString()) });
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ stale: false, states: { 'm-s8': 'down' } });
    expect(res.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('marks an old snapshot stale even if the worker stopped writing', async () => {
    const old = new Date(Date.now() - 3 * 60_000).toISOString();
    const app = await buildApp({}, { status: async () => snap(old) });
    expect((await app.inject({ method: 'GET', url: '/status' })).json()).toMatchObject({
      stale: true,
    });
    await app.close();
  });
});
