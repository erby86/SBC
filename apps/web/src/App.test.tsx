import type { Layout, StatusSnapshot } from '@sbc-noc/shared';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
      shape: { x: 0, z: 0, width: 20, depth: 10, rotation: 0, floorHeight: 0.9, extra: {} },
    },
  ],
  areas: [],
  locations: [
    {
      locCode: 'LOC-050',
      building: 's8',
      floor: 6,
      name: 'ห้องคอม 40',
      roomNumber: null,
      type: null,
      corridorOrder: null,
      side: null,
      hasRack: false,
      owner: 'sbc_asset',
      verifiedAt: null,
      registryPcCount: 40,
    },
  ],
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
  maintenance: [],
});

/** Extra api answers per test (M20 history, unlocated, demo). */
let extra: Record<string, unknown> = {};

beforeEach(() => {
  extra = {};
  localStorage.setItem('noc-tour', '1'); // the first-visit tour has its own test
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/registry/layout') return new Response(JSON.stringify(layout));
      if (url === '/api/health')
        return new Response(JSON.stringify({ status: 'ok', version: '0.2.0' }));
      if (url in extra) return new Response(JSON.stringify(extra[url]));
      if (url.startsWith('/api/status/')) return new Response('{}', { status: 503 });
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('tv');
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
    expect(screen.getByTestId('state-chips').textContent).toContain('เครือข่าย 0/1');
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

const push = (snap: StatusSnapshot) =>
  act(() =>
    FakeWebSocket.last?.onmessage?.({
      data: JSON.stringify({ type: 'snapshot', version: 1, snapshot: snap }),
    }),
  );
const loaded = () =>
  waitFor(() => expect(screen.getAllByTestId('buildings')[0]?.textContent).toContain('8 เซียน'));

describe('NOC screen panels and modes (M20)', () => {
  it('searches several words and opens the device found', async () => {
    renderAt('/', <App />);
    await loaded();
    push(snapshot(false));
    const input = document.getElementById('search') as HTMLInputElement;
    act(() => input.focus());
    expect(screen.getByTestId('search-results').textContent).toContain('ค้นด่วน');
    fireEvent.change(input, { target: { value: '8 เซียน main' } });
    const res = screen.getByTestId('search-results');
    expect(res.textContent).toContain('อุปกรณ์');
    expect(res.textContent).toContain('8 เซียน main');
    fireEvent.change(input, { target: { value: 'ล่ม' } });
    expect(res.textContent).toContain('8 เซียน main'); // status word
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('info').textContent).toContain('8 เซียน main');
    expect(localStorage.getItem('noc-recent')).toContain('ล่ม');
  });

  it('shows the 24 h history from Zabbix and the hosts without a position', async () => {
    extra['/api/status/history'] = {
      updatedAt: '2026-10-05T03:00:00.000Z',
      hours: 24,
      events: [
        {
          device: 'm-s8',
          host: 'S8-MAIN',
          severity: 'down',
          start: '2026-10-05T02:58:00.000Z',
          end: null,
          message: 'Unavailable by ICMP ping',
        },
        {
          device: null,
          host: 'OLD-AP',
          severity: 'warn',
          start: '2026-10-05T01:00:00.000Z',
          end: '2026-10-05T01:10:00.000Z',
          message: 'High latency',
        },
      ],
    };
    extra['/api/status/unlocated'] = {
      updatedAt: '2026-10-05T03:00:00.000Z',
      hosts: [
        {
          hostid: '1',
          name: 'SW-UNKNOWN',
          ip: '192.168.1.45',
          groups: ['02-Switch'],
          state: 'down',
        },
      ],
    };
    renderAt('/', <App />);
    await loaded();
    push(snapshot(false));
    const tab = (start: string) =>
      screen.getAllByRole('tab').find((t) => t.textContent?.startsWith(start)) as HTMLElement;
    await waitFor(() => expect(tab('ไม่มีตำแหน่ง').textContent).toBe('ไม่มีตำแหน่ง (1)'));
    act(() => tab('ประวัติ').click());
    const h = screen.getByTestId('history');
    expect(h.textContent).toContain('ทั้งโรงเรียน');
    expect(h.textContent).toContain('8 เซียน main · ล่ม');
    expect(h.textContent).toContain('ยังไม่หาย');
    expect(h.textContent).toContain('OLD-AP · เตือน');
    expect(h.textContent).toContain('กลับมาปกติ หลัง 10 นาที');
    // focusing a building keeps only its events
    act(() => screen.getAllByTestId('buildings')[0]?.querySelector('button')?.click());
    expect(screen.getByTestId('history').textContent).not.toContain('OLD-AP');
    expect(screen.getByTestId('history').textContent).toContain('เฉพาะ 8 เซียน');
    // labs of the focused building
    expect(screen.getAllByTestId('labs')[0]?.textContent).toContain('ห้องคอม 40');
    act(() => tab('ไม่มีตำแหน่ง').click());
    expect(screen.getByTestId('unlocated').textContent).toContain('SW-UNKNOWN');
    expect(screen.getByTestId('unlocated').textContent).toContain('กลุ่ม 02-Switch');
  });

  it('opens help with ? and closes it with Esc; the tour runs from help and is remembered', async () => {
    renderAt('/', <App />);
    await loaded();
    fireEvent.keyDown(document, { key: '?' });
    expect(screen.getByTestId('help').textContent).toContain('วิธีใช้ SB School NOC');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('help')).toBeNull();
    localStorage.removeItem('noc-tour');
    act(() => screen.getByRole('button', { name: 'วิธีใช้' }).click());
    act(() => screen.getByRole('button', { name: 'เริ่มแนะนำการใช้งานอีกครั้ง' }).click());
    for (let i = 0; i < 4; i++) act(() => screen.getByRole('button', { name: 'ถัดไป' }).click());
    act(() => screen.getByRole('button', { name: 'เริ่มใช้งาน' }).click());
    expect(screen.queryByTestId('tour')).toBeNull();
    expect(localStorage.getItem('noc-tour')).toBe('1');
  });

  it('TV mode enlarges the page and shows the incidents nobody has taken', async () => {
    renderAt('/', <App />);
    await loaded();
    push(snapshot(false));
    act(() => screen.getByTestId('tv').click());
    expect(document.documentElement.classList.contains('tv')).toBe(true);
    expect(screen.getByTestId('info').textContent).toContain('8 เซียน main');
    act(() => screen.getByTestId('tv').click());
    expect(document.documentElement.classList.contains('tv')).toBe(false);
  });

  it('demo mode shows a scenario under a band, with no live connection', async () => {
    const demoSnap = { ...snapshot(false), maintenance: [] };
    extra['/api/demo/scenarios'] = {
      demo: true,
      label: 'ข้อมูลสาธิต — ไม่ใช่สถานะจริง',
      scenarios: [
        { name: 'mixed', title: 'เหตุการณ์ทั่วไป', description: '' },
        { name: 's8down', title: 'main 8 เซียน ล่ม', description: '' },
      ],
    };
    extra['/api/demo/scenarios/s8down'] = {
      demo: true,
      label: 'ข้อมูลสาธิต — ไม่ใช่สถานะจริง',
      scenario: { name: 's8down', title: 'main 8 เซียน ล่ม', description: '' },
      snapshot: demoSnap,
      unlocated: { updatedAt: demoSnap.lastUpdate, hosts: [] },
      history: { updatedAt: demoSnap.lastUpdate, hours: 24, events: [] },
    };
    FakeWebSocket.last = null;
    renderAt('/?demo=s8down', <App />);
    await waitFor(() =>
      expect(screen.getByTestId('demo-bar').textContent).toContain('ข้อมูลสาธิต — ไม่ใช่สถานะจริง'),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('incidents')[0]?.textContent).toContain('8 เซียน main'),
    );
    expect(screen.getAllByTestId('incidents')[0]?.textContent).toContain('ข้อมูลสาธิต');
    expect(FakeWebSocket.last).toBeNull();
    expect(screen.getByRole('combobox', { name: 'สถานการณ์สาธิต' })).toBeDefined();
  });

  it('the real page has no demo band', async () => {
    renderAt('/', <App />);
    await loaded();
    expect(screen.queryByTestId('demo-bar')).toBeNull();
  });
});
