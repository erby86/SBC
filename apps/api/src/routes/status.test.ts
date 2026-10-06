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
      root: null,
      ack: null,
    },
  ],
  counts: { ok: 10, warn: 0, down: 1, cut: 1, maint: 0 },
  labOnline: {},
  maintenance: [],
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

describe('GET /status/history, /status/unlocated (M20)', () => {
  const at = '2026-10-05T03:00:00.000Z';
  it('503 until the worker has written them, then the stored lists', async () => {
    let ready = false;
    const app = await buildApp(
      {},
      {
        statusExtras: {
          history: async () =>
            ready
              ? {
                  updatedAt: at,
                  hours: 24,
                  events: [
                    {
                      device: 'm-s8',
                      host: 'S8-MAIN',
                      severity: 'down' as const,
                      start: at,
                      end: null,
                      message: 'Unavailable by ICMP ping',
                    },
                  ],
                }
              : null,
          unlocated: async () =>
            ready
              ? {
                  updatedAt: at,
                  hosts: [
                    {
                      hostid: '10500',
                      name: 'SW-UNKNOWN',
                      ip: '192.168.1.45',
                      groups: ['02-Switches'],
                      state: 'ok' as const,
                    },
                  ],
                }
              : null,
        },
      },
    );
    expect((await app.inject({ method: 'GET', url: '/status/history' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'GET', url: '/status/unlocated' })).statusCode).toBe(503);
    ready = true;
    const h = await app.inject({ method: 'GET', url: '/status/history' });
    expect(h.json()).toMatchObject({ hours: 24, events: [{ device: 'm-s8', end: null }] });
    const u = await app.inject({ method: 'GET', url: '/status/unlocated' });
    expect(u.json()).toMatchObject({ hosts: [{ name: 'SW-UNKNOWN', groups: ['02-Switches'] }] });
    await app.close();
  });
});
