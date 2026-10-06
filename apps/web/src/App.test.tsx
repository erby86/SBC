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
      assetTag: null,
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
      root: null,
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
    expect(screen.getByRole('heading', { name: /ศูนย์ดูแลเครือข่าย/ })).toBeDefined();
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
    expect(screen.getByTestId('state-chips').textContent).toContain('อุปกรณ์ 0/1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns loudly when the data is stale', () => {
    renderAt('/', <App />);
    act(() =>
      FakeWebSocket.last?.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', version: 1, snapshot: snapshot(true) }),
      }),
    );
    // the band names the cause (UI ลูกเล่น รอบ 2): here Zabbix stopped sending, not the browser or server
    expect(screen.getByRole('alert').textContent).toContain('Zabbix ไม่ส่งข้อมูลใหม่');
    expect(screen.getByTestId('stale-band').dataset['cause']).toBe('zabbix');
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
    expect(building?.textContent).toContain('✕ 1'); // m-s8 down: listed first, one problem
    act(() => building?.click());
    const floors = screen.getAllByTestId('floors')[0];
    expect(floors?.querySelectorAll('button')).toHaveLength(9); // ทุกชั้น + 8 floors
    act(() =>
      (screen.getAllByTestId('incidents')[0]?.querySelector('.inc') as HTMLElement).click(),
    );
    const info = screen.getByTestId('info');
    expect(info.textContent).toContain('8 เซียน main');
    expect(info.textContent).toContain('ใช้งานไม่ได้');
    expect(info.textContent).toContain('กระทบ3 อุปกรณ์');
    act(() => screen.getByRole('button', { name: 'ปิดรายละเอียด' }).click());
    expect(screen.queryByTestId('info')).toBeNull();
  });

  it('links the selected device to Zabbix and GLPI with its own values (M22)', async () => {
    extra['/api/config/links'] = {
      zabbix:
        'http://zabbix.sbc.lan/zabbix.php?action=problem.view&hostids[]={zabbixHostId}' +
        ' || http://zabbix.sbc.lan/zabbix.php?action=host.view&filter_name={name}',
      grafana: 'http://grafana.sbc.lan/d/noc?var-host={hostname}', // no hostname: no button
      glpi: 'http://glpi.sbc.lan/front/search.php?globalsearch={code}',
    };
    renderAt('/', <App />);
    await waitFor(() =>
      expect(screen.getAllByTestId('buildings')[0]?.textContent).toContain('8 เซียน'),
    );
    act(() =>
      FakeWebSocket.last?.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', version: 1, snapshot: snapshot(false) }),
      }),
    );
    act(() =>
      (screen.getAllByTestId('incidents')[0]?.querySelector('.inc') as HTMLElement).click(),
    );
    const links = await screen.findByTestId('out-links');
    const hrefs = [...links.querySelectorAll('a')].map((a) => [a.textContent, a.href]);
    expect(hrefs).toEqual([
      [
        'เปิดใน Zabbix ↗',
        'http://zabbix.sbc.lan/zabbix.php?action=host.view&filter_name=8%20%E0%B9%80%E0%B8%8B%E0%B8%B5%E0%B8%A2%E0%B8%99%20main',
      ],
      ['ครุภัณฑ์ (GLPI) ↗', 'http://glpi.sbc.lan/front/search.php?globalsearch=m-s8'],
    ]);
    expect(links.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows no link buttons when the api has no templates', async () => {
    renderAt('/', <App />);
    await waitFor(() =>
      expect(screen.getAllByTestId('buildings')[0]?.textContent).toContain('8 เซียน'),
    );
    act(() =>
      FakeWebSocket.last?.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', version: 1, snapshot: snapshot(false) }),
      }),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('incidents')[0]?.querySelector('.inc')).not.toBeNull(),
    );
    act(() =>
      (screen.getAllByTestId('incidents')[0]?.querySelector('.inc') as HTMLElement).click(),
    );
    expect(screen.getByTestId('info').textContent).toContain('8 เซียน main');
    expect(screen.queryByTestId('out-links')).toBeNull();
  });

  it('switches between dark and light and remembers the choice', () => {
    renderAt('/', <App />);
    act(() => screen.getByTestId('menu').click());
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
    // devices without a position open from the menu
    act(() => screen.getByTestId('menu').click());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ยังไม่มีตำแหน่งบนผัง (1)' })).toBeDefined(),
    );
    act(() => screen.getByTestId('menu').click());
    act(() => tab('ประวัติ').click());
    const h = screen.getByTestId('history');
    expect(h.textContent).toContain('ทั้งโรงเรียน');
    expect(h.textContent).toContain('8 เซียน main · ใช้งานไม่ได้');
    expect(h.textContent).toContain('ยังไม่หาย');
    expect(h.textContent).toContain('OLD-AP · ควรตรวจสอบ');
    expect(h.textContent).toContain('กลับมาปกติ หลัง 10 นาที');
    // focusing a building keeps only its events
    act(() => screen.getAllByTestId('buildings')[0]?.querySelector('button')?.click());
    expect(screen.getByTestId('history').textContent).not.toContain('OLD-AP');
    expect(screen.getByTestId('history').textContent).toContain('เฉพาะ 8 เซียน');
    // labs of the focused building
    expect(screen.getAllByTestId('labs')[0]?.textContent).toContain('ห้องคอม 40');
    act(() => screen.getByTestId('menu').click());
    act(() => screen.getByRole('button', { name: 'ยังไม่มีตำแหน่งบนผัง (1)' }).click());
    expect(tab('ไม่มีตำแหน่ง')?.textContent).toBe('ไม่มีตำแหน่ง 1');
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
    act(() => screen.getByTestId('menu').click());
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
    act(() => screen.getByTestId('menu').click());
    act(() => screen.getByTestId('tv').click());
    expect(document.documentElement.classList.contains('tv')).toBe(true);
    expect(screen.getByTestId('info').textContent).toContain('8 เซียน main');
    act(() => screen.getByTestId('menu').click());
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
    // the band says it is demo data; the alert list no longer repeats it (declutter)
    expect(FakeWebSocket.last).toBeNull();
    expect(screen.getByRole('combobox', { name: 'สถานการณ์สาธิต' })).toBeDefined();
  });

  it('the real page has no demo band', async () => {
    renderAt('/', <App />);
    await loaded();
    expect(screen.queryByTestId('demo-bar')).toBeNull();
  });
});
