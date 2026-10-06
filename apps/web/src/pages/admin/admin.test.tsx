import type { DeviceEdit, EditOptions } from '@sbc-noc/shared';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { FakeWebSocket, renderAt } from '../../test-utils.js';

const options: EditOptions = {
  roles: [
    { code: 'main', name: 'main อาคาร', layer: 'net' },
    { code: 'ap', name: 'Access Point', layer: 'ap' },
  ],
  media: [{ code: 'fiber', name: 'ไฟเบอร์' }],
  locationTypes: [],
  buildings: [{ code: 'bb', name: 'อาคาร B', floors: [1, 2, 3, 4] }],
  models: [],
};
const dev: DeviceEdit = {
  code: 'm-s8',
  name: '8 เซียน main',
  hostname: null,
  role: 'main',
  model: null,
  locCode: null,
  building: null,
  floor: null,
  ip: null,
  mac: null,
  uplink: 'c1036',
  uplinkMedia: 'fiber',
  lifecycle: 'active',
  dataStatus: 'unverified',
  managedBy: null,
  rowVersion: 7,
};

let calls: { method: string; url: string; body?: unknown }[] = [];
let patchStatus = 200;
const admin = { email: 'a@sb-school.ac.th', label: 'STF-01', roles: ['admin'] };
let sessionUser: object | null = admin;

beforeEach(() => {
  calls = [];
  patchStatus = 200;
  sessionUser = admin;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
      if (url === '/api/auth/session') return json({ user: sessionUser });
      if (url === '/api/auth/login') {
        const b = JSON.parse(String(init?.body)) as { password: string };
        if (b.password !== 'right-password-1')
          return json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }, 401);
        sessionUser = admin;
        return json({ user: admin });
      }
      if (url === '/api/auth/logout') {
        sessionUser = null;
        return new Response(null, { status: 204 });
      }
      if (sessionUser === null && url.startsWith('/api/registry/edit/'))
        return json({ message: 'เข้าสู่ระบบก่อน' }, 401);
      if (url === '/api/registry/edit/options') return json(options);
      if (url === '/api/registry/edit/devices/m-s8' && method === 'GET') return json(dev);
      if (url === '/api/registry/edit/devices/m-s8' && method === 'PATCH') {
        return patchStatus === 409
          ? json({ message: 'มีคนแก้อุปกรณ์นี้ไปก่อนแล้ว' }, 409)
          : json({ ...dev, ...(JSON.parse(String(init?.body)) as object), rowVersion: 8 });
      }
      if (url.startsWith('/api/registry/edit/history')) return json([]);
      if (url === '/api/registry/edit/unplaced')
        return json([
          {
            system: 'unifi',
            mac: 'aa:bb:cc:dd:ee:ff',
            name: 'AC LR',
            ip: '172.16.0.1',
            message: 'x',
            since: '2026-10-03T00:00:00.000Z',
          },
        ]);
      if (url.startsWith('/api/registry/edit/unplaced/'))
        return json({ ...dev, code: 'ap-bb-4-1', role: 'ap' }, 201);
      if (url.startsWith('/api/registry/devices')) return json([]);
      if (url.startsWith('/api/registry/locations')) return json([]);
      if (url === '/api/health') return json({ status: 'ok', version: '0.1.0' });
      return json({}, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('back office (M21)', () => {
  it('sends only the changed fields with the loaded row_version', async () => {
    renderAt('/admin/devices/m-s8', <App />);
    const name = await screen.findByDisplayValue('8 เซียน main');
    fireEvent.change(name, { target: { value: '8 เซียน main (SG3428)' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    // the confirm pop-up lists what changes before anything is sent
    const dlg = await screen.findByRole('dialog');
    expect(dlg.textContent).toContain('8 เซียน main (SG3428)');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }));
    await screen.findByText(/บันทึกแล้ว/);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ rowVersion: 7, name: '8 เซียน main (SG3428)' });
  });

  it('explains a conflict and offers to reload', async () => {
    patchStatus = 409;
    renderAt('/admin/devices/m-s8', <App />);
    fireEvent.change(await screen.findByDisplayValue('8 เซียน main'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันบันทึก' }));
    expect((await screen.findByRole('alert')).textContent).toContain('มีคนแก้อุปกรณ์นี้ไปก่อนแล้ว');
    expect(screen.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' })).toBeDefined();
  });

  it('places an unplaced AP on a chosen floor', async () => {
    renderAt('/admin/unplaced', <App />);
    await screen.findByText('AC LR');
    await screen.findByRole('option', { name: 'อาคาร B' });
    fireEvent.change(screen.getByLabelText('อาคารของ AC LR'), { target: { value: 'bb' } });
    await screen.findByRole('option', { name: '4' });
    fireEvent.change(screen.getByLabelText('ชั้นของ AC LR'), { target: { value: '4' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'วางที่นี่' }));
    });
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/registry/edit/unplaced/unifi/aa%3Abb%3Acc%3Add%3Aee%3Aff');
    expect(post?.body).toEqual({ building: 'bb', floor: 4, locCode: null, no: null });
  });
});

describe('back office login (M23)', () => {
  it('asks for login, refuses a wrong password, then opens the pages', async () => {
    sessionUser = null;
    renderAt('/admin/devices/m-s8', <App />);
    const email = await screen.findByLabelText('อีเมล');
    fireEvent.change(email, { target: { value: 'a@sb-school.ac.th' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    await screen.findByText('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    expect(calls.some((c) => c.url.startsWith('/api/registry/edit/'))).toBe(false);

    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'right-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    await screen.findByDisplayValue('8 เซียน main');
    expect(screen.getByTestId('whoami').textContent).toContain('STF-01');

    fireEvent.click(screen.getByRole('button', { name: 'ออกจากระบบ' }));
    await screen.findByLabelText('อีเมล');
  });

  it('tells an operator the page needs the admin role', async () => {
    sessionUser = { email: 'op@sb-school.ac.th', label: 'op@sb-school.ac.th', roles: ['operator'] };
    renderAt('/admin/devices', <App />);
    await screen.findByText(/ไม่มีสิทธิ์จัดการทะเบียน/);
    expect(calls.some((c) => c.url.startsWith('/api/registry/edit/'))).toBe(false);
  });

  it('returns to the login form when the session ends mid-edit', async () => {
    renderAt('/admin/devices/m-s8', <App />);
    fireEvent.change(await screen.findByDisplayValue('8 เซียน main'), { target: { value: 'x' } });
    sessionUser = null; // expired on the server
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันบันทึก' }));
    await screen.findByLabelText('อีเมล');
  });
});
