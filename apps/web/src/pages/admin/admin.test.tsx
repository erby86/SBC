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

let calls: { method: string; url: string; body?: unknown; editor?: string | null }[] = [];
let patchStatus = 200;

beforeEach(() => {
  calls = [];
  patchStatus = 200;
  localStorage.setItem('noc-editor', 'ครูเอ');
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        editor: headers['X-Noc-Editor'] ?? null,
      });
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
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
  it('sends only the changed fields with the loaded row_version and the editor name', async () => {
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
    expect(decodeURIComponent(patch?.editor ?? '')).toBe('ครูเอ');
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
