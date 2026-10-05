import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { LiveMessage, StatusSnapshot } from '@sbc-noc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveStatus } from './LiveStatus.js';

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.last = this;
  }
  close() {
    this.onclose?.();
  }
  emit(msg: LiveMessage) {
    act(() => this.onmessage?.({ data: JSON.stringify(msg) }));
  }
}

const snap = (
  states: StatusSnapshot['states'],
  extra: Partial<StatusSnapshot> = {},
): StatusSnapshot => ({
  generatedAt: '2026-10-05T03:00:00.000Z',
  lastUpdate: '2026-10-05T03:00:00.000Z',
  stale: false,
  states,
  incidents: [],
  counts: { ok: 10, warn: 0, down: 0, cut: 0, maint: 0 },
  labOnline: {},
  maintenance: [],
  ...extra,
});

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LiveStatus (M16)', () => {
  it('shows the snapshot, then applies deltas and lists the change', () => {
    render(<LiveStatus wsUrl="ws://x/api/status/ws" />);
    const ws = FakeWebSocket.last as FakeWebSocket;
    expect(ws.url).toBe('ws://x/api/status/ws');
    ws.emit({ type: 'snapshot', version: 1, snapshot: snap({}) });
    expect(screen.getByTestId('live-mode').textContent).toContain('สด (WebSocket)');
    ws.emit({
      type: 'delta',
      version: 2,
      delta: {
        ...snap({}),
        changed: { 'm-s8': 'down' },
        incidents: [
          {
            device: 'm-s8',
            severity: 'down',
            since: '2026-10-05T03:00:00.000Z',
            message: 'Unavailable by ICMP ping',
            impacted: 3,
            ack: null,
          },
        ],
        counts: { ok: 6, warn: 0, down: 1, cut: 3, maint: 0 },
      },
    });
    expect(screen.getByTestId('live-incidents').textContent).toContain(
      'm-s8: Unavailable by ICMP ping (กระทบ 3)',
    );
    expect(screen.getByTestId('live-changes').textContent).toContain('m-s8 → ใช้งานไม่ได้');
    expect(screen.getByTestId('live-counts').textContent).toContain('ล่ม 1');
  });

  it('marks stale data', () => {
    render(<LiveStatus wsUrl="ws://x" />);
    FakeWebSocket.last?.emit({ type: 'snapshot', version: 1, snapshot: snap({}, { stale: true }) });
    expect(screen.getByTestId('live-fresh').textContent).toContain('ข้อมูลค้าง');
  });

  it('falls back to GET /api/status every 30 s when the socket closes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'] });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(snap({ 'm-b1': 'warn' }))));
    vi.stubGlobal('fetch', fetchMock);
    render(<LiveStatus wsUrl="ws://x" />);
    act(() => FakeWebSocket.last?.onclose?.());
    expect(screen.getByTestId('live-mode').textContent).toContain('ดึงทุก 30 วินาที');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByTestId('live-counts')).toBeDefined());
  });
});
