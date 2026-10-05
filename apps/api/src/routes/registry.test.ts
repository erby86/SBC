import type { Device, Layout } from '@sbc-noc/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { RegistryReader } from './registry.js';

const device: Device = {
  code: 'c2116',
  name: 'CCR2116',
  hostname: null,
  role: 'core',
  layer: 'net',
  model: null,
  ip: '192.168.1.1',
  mac: null,
  building: 'b2',
  floor: 1,
  locCode: 'LOC-187',
  uplink: null,
  uplinkMedia: null,
  managedBy: null,
  lifecycle: 'active',
  dataStatus: 'unverified',
  zabbixHostId: '10084',
  assetTag: null,
  placement: null,
};
let layout: Layout = {
  site: { code: 'sbc', name: 'SB School', timezone: 'Asia/Bangkok' },
  buildings: [],
  areas: [],
  locations: [],
  devices: [device],
  links: [],
  cables: [],
};

const reader: RegistryReader = {
  layout: async () => layout,
  buildings: async () => [],
  building: async () => null,
  locations: vi.fn(async () => []),
  location: async () => null,
  devices: vi.fn(async () => [device]),
  device: async () => null,
  links: async () => [],
  cables: async () => [],
  search: vi.fn(async () => []),
};

describe('registry routes (M14)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp({}, { registry: reader });
  });
  afterAll(async () => {
    await app.close();
  });

  it('serves the layout with an ETag and answers 304 while it is unchanged', async () => {
    const first = await app.inject({ method: 'GET', url: '/registry/layout' });
    expect(first.statusCode).toBe(200);
    expect(first.json<Layout>().devices[0]?.code).toBe('c2116');
    const etag = first.headers['etag'] as string;
    expect(etag).toMatch(/^W\//);
    expect(first.headers['cache-control']).toBe('no-cache');

    const again = await app.inject({
      method: 'GET',
      url: '/registry/layout',
      headers: { 'if-none-match': etag },
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');

    layout = { ...layout, devices: [{ ...device, name: 'CCR2116 (เปลี่ยน)' }] };
    const changed = await app.inject({
      method: 'GET',
      url: '/registry/layout',
      headers: { 'if-none-match': etag },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers['etag']).not.toBe(etag);
  });

  it('coerces filters from the query string and rejects bad ones', async () => {
    await app.inject({ method: 'GET', url: '/registry/devices?building=b2&floor=1&layer=ap' });
    expect(reader.devices).toHaveBeenLastCalledWith({ building: 'b2', floor: 1, layer: 'ap' });
    await app.inject({ method: 'GET', url: '/registry/locations?floor=3' });
    expect(reader.locations).toHaveBeenLastCalledWith({ floor: 3 });
    const bad = await app.inject({ method: 'GET', url: '/registry/locations?floor=three' });
    expect(bad.statusCode).toBe(400);
  });

  it('answers 404 with a Thai message for unknown codes', async () => {
    const res = await app.inject({ method: 'GET', url: '/registry/devices/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ message: 'ไม่พบอุปกรณ์ nope' });
    expect((await app.inject({ method: 'GET', url: '/registry/buildings/xx' })).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject({ method: 'GET', url: '/registry/locations/loc-999' })).statusCode,
    ).toBe(404);
  });

  it('searches with a default limit and caps it', async () => {
    const res = await app.inject({ method: 'GET', url: '/registry/search?q=icet' });
    expect(res.json()).toEqual({ q: 'icet', hits: [] });
    expect(reader.search).toHaveBeenLastCalledWith('icet', 20);
    expect(
      (await app.inject({ method: 'GET', url: '/registry/search?q=a&limit=500' })).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/registry/search' })).statusCode).toBe(400);
  });

  it('lists every registry route in the OpenAPI document', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json<{
      paths: Record<string, unknown>;
    }>();
    expect(Object.keys(doc.paths).filter((p) => p.startsWith('/registry/'))).toEqual(
      expect.arrayContaining([
        '/registry/layout',
        '/registry/buildings',
        '/registry/buildings/{code}',
        '/registry/locations',
        '/registry/locations/{locCode}',
        '/registry/devices',
        '/registry/devices/{code}',
        '/registry/links',
        '/registry/cables',
        '/registry/search',
      ]),
    );
  });
});
