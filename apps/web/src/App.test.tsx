import type { Layout, StatusSnapshot } from '@sbc-noc/shared';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { FakeWebSocket, renderAt } from './test-utils.js';

const layout: Layout = {
  site: { code: 'sbc', name: 'SB School', timezone: 'Asia/Bangkok' },
  buildings: [
    {
      code: 's8',
      name: '8 เซียน',
      nameEn: null,
      aliases: [],
      assetName: null,
      form: null,
      floorCount: 8,
      roomsPerFloor: null,
      hasNetwork: true,
      shape: null,
    },
  ],
  areas: [],
  locations: [],
  devices: [
    {
      code: 'm-s8',
      name: '8 เซียน main',
      hostname: null,
      role: 'main',
      layer: 'net',
      model: null,
      ip: null,
      mac: null,
      building: 's8',
      floor: 3,
      locCode: null,
      uplink: null,
      uplinkMedia: null,
      managedBy: null,
      lifecycle: 'active',
      dataStatus: 'unverified',
      zabbixHostId: null,
      placement: null,
    },
  ],
  links: [],
  cables: [],
};
const snapshot = (stale: boolean): StatusSnapshot => ({
  generatedAt: '2026-10-05T03:00:00.000Z',
  lastUpdate: '2026-10-05T03:00:00.000Z',
  stale,
  states: { 'm-s8': 'down' },
  incidents: [
    {
      device: 'm-s8',
      severity: 'down',
      since: '2026-10-05T02:58:00.000Z',
      message: 'Unavailable by ICMP ping',
      impacted: 3,
      ack: null,
    },
  ],
  counts: { ok: 10, warn: 0, down: 1, cut: 3, maint: 0 },
  labOnline: {},
});

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/registry/layout') return new Response(JSON.stringify(layout));
      if (url === '/api/health')
        return new Response(JSON.stringify({ status: 'ok', version: '0.2.0' }));
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NOC screen (M18 frame, M19 scene)', () => {
  it('shows buildings from the layout and incidents from the live status', async () => {
    renderAt('/', <App />);
    expect(screen.getByRole('heading', { name: 'SB School NOC' })).toBeDefined();
    await waitFor(() =>
      expect(screen.getAllByTestId('buildings')[0]?.textContent).toContain('8 เซียน'),
    );
    act(() =>
      FakeWebSocket.last?.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', version: 1, snapshot: snapshot(false) }),
      }),
    );
    expect(screen.getAllByTestId('incidents')[0]?.textContent).toContain('8 เซียน main');
    expect(screen.getAllByTestId('incidents')[0]?.textContent).toContain('กระทบ 3 อุปกรณ์');
    expect(screen.getByTestId('open-incidents').textContent).toContain('1');
    expect(screen.getByTestId('state-chips').textContent).toContain('ล่ม 1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns loudly when the data is stale', () => {
    renderAt('/', <App />);
    act(() =>
      FakeWebSocket.last?.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', version: 1, snapshot: snapshot(true) }),
      }),
    );
    expect(screen.getByRole('alert').textContent).toContain('ข้อมูลค้าง');
    expect(screen.getByTestId('fresh').textContent).toContain('ข้อมูลค้าง');
  });

  it('says so when the browser cannot draw 3D (M19)', async () => {
    renderAt('/', <App />);
    await waitFor(() => expect(screen.getByTestId('scene').textContent).toContain('WebGL'));
  });

  it('focuses a building with floor buttons and opens device details from an incident (M19)', async () => {
    renderAt('/', <App />);
    await waitFor(() =>
      expect(screen.getAllByTestId('buildings')[0]?.textContent).toContain('8 เซียน'),
    );
    act(() =>
      FakeWebSocket.last?.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', version: 1, snapshot: snapshot(false) }),
      }),
    );
    const building = screen.getAllByTestId('buildings')[0]?.querySelector('button');
    expect(building?.textContent).toContain('1 จุด'); // m-s8 down
    act(() => building?.click());
    const floors = screen.getAllByTestId('floors')[0];
    expect(floors?.querySelectorAll('button')).toHaveLength(9); // ทุกชั้น + 8 floors
    act(() =>
      (screen.getAllByTestId('incidents')[0]?.querySelector('.inc') as HTMLElement).click(),
    );
    const info = screen.getByTestId('info');
    expect(info.textContent).toContain('8 เซียน main');
    expect(info.textContent).toContain('ล่ม');
    expect(info.textContent).toContain('กระทบ3 อุปกรณ์');
    act(() => screen.getByRole('button', { name: 'ปิดรายละเอียด' }).click());
    expect(screen.queryByTestId('info')).toBeNull();
  });

  it('switches between dark and light and remembers the choice', () => {
    renderAt('/', <App />);
    const btn = screen.getByTestId('theme-toggle');
    act(() => btn.click());
    const first = document.documentElement.dataset['theme'];
    expect(['dark', 'light']).toContain(first);
    expect(localStorage.getItem('noc-theme')).toBe(first);
    act(() => btn.click());
    expect(document.documentElement.dataset['theme']).toBe(first === 'dark' ? 'light' : 'dark');
    localStorage.removeItem('noc-theme');
    delete document.documentElement.dataset['theme'];
  });

  it('has a back office page with the API version', async () => {
    renderAt('/admin', <App />);
    await waitFor(() => expect(screen.getByTestId('api-status').textContent).toContain('v0.2.0'));
  });
});
