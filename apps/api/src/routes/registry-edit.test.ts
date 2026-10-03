import { RegistryEditError } from '@sbc-noc/db';
import type { DeviceEdit } from '@sbc-noc/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { RegistryEditor } from './registry-edit.js';

const dev: DeviceEdit = {
  code: 'm-s8',
  name: '8 เซียน main',
  hostname: null,
  role: 'main',
  model: null,
  locCode: null,
  building: 's8',
  floor: 3,
  ip: '192.168.1.152',
  mac: null,
  uplink: 'c1036',
  uplinkMedia: 'fiber',
  lifecycle: 'active',
  dataStatus: 'unverified',
  managedBy: null,
  rowVersion: 3,
};

function editor(): RegistryEditor {
  return {
    options: async () => ({ roles: [], media: [], locationTypes: [], buildings: [], models: [] }),
    device: async (code) => (code === 'm-s8' ? dev : null),
    updateDevice: vi.fn(async (_code, patch) => {
      if (patch.rowVersion !== 3) throw new RegistryEditError('conflict', 'มีคนแก้ไปก่อนแล้ว');
      if (patch.ip === '192.168.1.1') throw new RegistryEditError('invalid', 'IP ซ้ำ', 'ip');
      return { ...dev, ...patch, rowVersion: 4 } as DeviceEdit;
    }),
    createDevice: async () => dev,
    deleteDevice: async () => undefined,
    location: async () => null,
    updateLocation: async () => {
      throw new RegistryEditError('not_found', 'ไม่พบห้อง');
    },
    createLocation: async () => {
      throw new Error('unused');
    },
    unplaced: async () => [],
    placeAp: async () => dev,
    history: async () => [],
  };
}

const headers = { 'x-noc-editor': 'STF-01', 'x-forwarded-for': '192.168.1.50, 172.20.0.5' };

describe('registry editor routes (M21)', () => {
  it('are absent unless REGISTRY_EDIT is on', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/registry/edit/options' })).statusCode).toBe(
      404,
    );
    await app.close();
  });

  it('saves with the editor name and client IP as actor', async () => {
    const ed = editor();
    const app = await buildApp({}, { registryEdit: ed });
    const res = await app.inject({
      method: 'PATCH',
      url: '/registry/edit/devices/m-s8',
      headers,
      payload: { rowVersion: 3, name: 'ใหม่' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'ใหม่', rowVersion: 4 });
    expect(ed.updateDevice).toHaveBeenCalledWith(
      'm-s8',
      { rowVersion: 3, name: 'ใหม่' },
      'web:STF-01@192.168.1.50',
    );
    await app.close();
  });

  it('maps refusals to 400 (field), 404 and 409', async () => {
    const app = await buildApp({}, { registryEdit: editor() });
    const patch = (payload: object, h: Record<string, string> = headers) =>
      app.inject({ method: 'PATCH', url: '/registry/edit/devices/m-s8', headers: h, payload });
    const noEditor = await patch({ rowVersion: 3, name: 'x' }, {});
    expect(noEditor.statusCode).toBe(400);
    expect(noEditor.json()).toMatchObject({ field: 'editor' });
    expect((await patch({ rowVersion: 2, name: 'x' })).statusCode).toBe(409);
    const dup = await patch({ rowVersion: 3, ip: '192.168.1.1' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json()).toEqual({ message: 'IP ซ้ำ', field: 'ip' });
    expect((await patch({ rowVersion: 3, ip: '999.1.1.1' })).statusCode).toBe(400); // zod
    const loc = await app.inject({
      method: 'PATCH',
      url: '/registry/edit/locations/loc-999',
      headers,
      payload: { rowVersion: 1, name: 'x' },
    });
    expect(loc.statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/registry/edit/devices/nope' })).statusCode,
    ).toBe(404);
    await app.close();
  });
});
