import { RegistryEditError } from '@sbc-noc/db';
import type { DeviceEdit } from '@sbc-noc/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { fakeAuth, loginCookie } from '../auth/fake-auth.test-helper.js';
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

const forwarded = { 'x-forwarded-for': '192.168.1.50, 172.20.0.5' };

/** App with the editor and two accounts; returns Cookie headers for both. */
async function appWith(ed: RegistryEditor) {
  const auth = await fakeAuth([
    { email: 'admin@sb.ac.th', label: 'STF-01', roles: ['admin'] },
    { email: 'op@sb.ac.th', roles: ['operator'] },
  ]);
  const app = await buildApp({}, { auth: auth.deps, registryEdit: ed });
  const admin = { ...forwarded, cookie: await loginCookie(app, 'admin@sb.ac.th') };
  const operator = { ...forwarded, cookie: await loginCookie(app, 'op@sb.ac.th') };
  return { app, admin, operator };
}

describe('registry editor routes (M21)', () => {
  it('are absent without login support', async () => {
    const app = await buildApp({}, { registryEdit: editor() });
    expect((await app.inject({ method: 'GET', url: '/registry/edit/options' })).statusCode).toBe(
      404,
    );
    await app.close();
  });

  it('needs an admin session (M23)', async () => {
    const { app, operator } = await appWith(editor());
    const req = (headers: Record<string, string>) =>
      app.inject({ method: 'GET', url: '/registry/edit/options', headers });
    expect((await req({})).statusCode).toBe(401);
    expect((await req({ cookie: 'noc_session=made-up' })).statusCode).toBe(401);
    const op = await req(operator);
    expect(op.statusCode).toBe(403);
    expect(op.json()).toEqual({ message: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้' });
    await app.close();
  });

  it('refuses a cross-site write even with a session cookie', async () => {
    const ed = editor();
    const { app, admin } = await appWith(ed);
    const res = await app.inject({
      method: 'PATCH',
      url: '/registry/edit/devices/m-s8',
      headers: { ...admin, host: 'noc.sbc.lan', origin: 'http://evil.example' },
      payload: { rowVersion: 3, name: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(ed.updateDevice).not.toHaveBeenCalled();
    await app.close();
  });

  it('saves with the logged-in user and client IP as actor', async () => {
    const ed = editor();
    const { app, admin } = await appWith(ed);
    const res = await app.inject({
      method: 'PATCH',
      url: '/registry/edit/devices/m-s8',
      headers: admin,
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
    const { app, admin } = await appWith(editor());
    const patch = (payload: object) =>
      app.inject({ method: 'PATCH', url: '/registry/edit/devices/m-s8', headers: admin, payload });
    expect((await patch({ rowVersion: 2, name: 'x' })).statusCode).toBe(409);
    const dup = await patch({ rowVersion: 3, ip: '192.168.1.1' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json()).toEqual({ message: 'IP ซ้ำ', field: 'ip' });
    expect((await patch({ rowVersion: 3, ip: '999.1.1.1' })).statusCode).toBe(400); // zod
    const loc = await app.inject({
      method: 'PATCH',
      url: '/registry/edit/locations/loc-999',
      headers: admin,
      payload: { rowVersion: 1, name: 'x' },
    });
    expect(loc.statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/registry/edit/devices/nope', headers: admin }))
        .statusCode,
    ).toBe(404);
    await app.close();
  });
});
