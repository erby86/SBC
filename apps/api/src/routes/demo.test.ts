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
});
