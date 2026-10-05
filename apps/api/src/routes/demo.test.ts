import { DEMO_LABEL } from '@sbc-noc/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

describe('demo mode (M38)', () => {
  it('is absent unless enabled', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/demo/scenarios' })).statusCode).toBe(404);
    await app.close();
  });

  it('lists the four prototype scenarios, labelled as demo data', async () => {
    const app = await buildApp({}, { demo: true });
    const res = await app.inject({ method: 'GET', url: '/demo/scenarios' });
    expect(res.json()).toMatchObject({ demo: true, label: DEMO_LABEL });
    expect(res.json<{ scenarios: { name: string }[] }>().scenarios.map((s) => s.name)).toEqual([
      'mixed',
      's8down',
      'stale',
      'normal',
    ]);
    await app.close();
  });

  it('computes a scenario now with the shared status rules', async () => {
    const app = await buildApp({}, { demo: true });
    const res = await app.inject({ method: 'GET', url: '/demo/scenarios/s8down' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      demo: boolean;
      snapshot: { incidents: { device: string; impacted: number }[] };
    }>();
    expect(body.demo).toBe(true);
    expect(body.snapshot.incidents).toMatchObject([{ device: 'm-s8', impacted: 4 }]);
    expect((await app.inject({ method: 'GET', url: '/demo/scenarios/nope' })).statusCode).toBe(404);
    await app.close();
  });

  it('gives history (open problems + resolved) and unlocated hosts in the live shapes', async () => {
    const app = await buildApp({}, { demo: true });
    const body = (await app.inject({ method: 'GET', url: '/demo/scenarios/mixed' })).json<{
      history: { events: { device: string; end: string | null }[] };
      unlocated: { hosts: { name: string; groups: string[] }[] };
      snapshot: { maintenance: { device: string }[] };
    }>();
    const open = body.history.events.filter((e) => e.end === null).map((e) => e.device);
    expect(open.sort()).toEqual(['ap-s8-6-1', 'm-a1', 'nvr-i1-1', 'wan1']);
    expect(body.history.events).toHaveLength(8);
    expect(body.unlocated.hosts[0]).toMatchObject({ name: 'SW-UNKNOWN-01', groups: ['Switches'] });
    expect(body.snapshot.maintenance).toEqual([
      { device: 'sw-bb-6', message: 'เปลี่ยนสวิตช์ 13:00–15:00', by: 'STF-02' },
    ]);
    await app.close();
  });
});
