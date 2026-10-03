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

describe('NOC screen frame (M18)', () => {
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

  it('has a back office page with the API version', async () => {
    renderAt('/admin', <App />);
    await waitFor(() => expect(screen.getByTestId('api-status').textContent).toContain('v0.2.0'));
  });
});
