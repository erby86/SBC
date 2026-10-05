import {
  applyDelta,
  liveMessageSchema,
  type LiveMessage,
  type StatusSnapshot,
} from '@sbc-noc/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createLiveHub, type LiveSource } from './live.js';

const base = (lastUpdate: string, states: StatusSnapshot['states'] = {}): StatusSnapshot => ({
  generatedAt: lastUpdate,
  lastUpdate,
  stale: false,
  states,
  incidents: [],
  counts: { ok: 3, warn: 0, down: 0, cut: 0, maint: 0 },
  labOnline: {},
  maintenance: [],
});

function fakeSource(initial: StatusSnapshot | null) {
  let push: ((json: string) => void) | null = null;
  const source: LiveSource = {
    read: async () => initial,
    subscribe: async (cb) => {
      push = cb;
      return async () => {
        push = null;
      };
    },
  };
  return { source, publish: (s: StatusSnapshot) => push?.(JSON.stringify(s)) };
}
const quiet = { warn: () => undefined };

describe('live hub (M16)', () => {
  it('sends the snapshot on connect and deltas after each engine poll', async () => {
    const t0 = new Date().toISOString();
    const { source, publish } = fakeSource(base(t0));
    const hub = createLiveHub(source, quiet);
    await hub.start();
    const got: LiveMessage[] = [];
    hub.connect((m) => got.push(m));
    publish({ ...base(t0, { 'm-s8': 'down', 'sw-s8-a': 'cut' }) });
    publish({ ...base(t0, { 'm-s8': 'down' }) });

    expect(got.map((m) => [m.type, m.version])).toEqual([
      ['snapshot', 1],
      ['delta', 2],
      ['delta', 3],
    ]);
    // A client rebuilds the engine's snapshot from the first message plus the deltas.
    let view = (got[0] as Extract<LiveMessage, { type: 'snapshot' }>).snapshot;
    for (const m of got.slice(1)) if (m.type === 'delta') view = applyDelta(view, m.delta);
    expect(view.states).toEqual({ 'm-s8': 'down' });
    await hub.stop();
  });

  it('turns stale by itself when the engine stops publishing', async () => {
    let now = new Date('2026-10-05T03:00:00.000Z');
    const { source } = fakeSource(base(now.toISOString()));
    const hub = createLiveHub(source, quiet, () => now);
    await hub.start();
    const got: LiveMessage[] = [];
    hub.connect((m) => got.push(m));
    now = new Date(now.getTime() + 2.5 * 60_000);
    hub.checkFreshness();
    hub.checkFreshness(); // only once
    expect(got.map((m) => m.type)).toEqual(['snapshot', 'delta']);
    expect(got[1]?.type === 'delta' && got[1].delta.stale).toBe(true);
    await hub.stop();
  });

  it('keeps running when Redis cannot be subscribed yet', async () => {
    const hub = createLiveHub(
      { read: async () => null, subscribe: () => Promise.reject(new Error('ECONNREFUSED')) },
      quiet,
    );
    await expect(hub.start()).resolves.toBeUndefined();
    await hub.stop();
  });
});

describe('WebSocket /status/ws', () => {
  it('delivers the snapshot and live deltas to a browser socket', async () => {
    const t0 = new Date().toISOString();
    const { source, publish } = fakeSource(base(t0));
    const hub = createLiveHub(source, quiet);
    const app = await buildApp({}, { live: hub });
    await app.ready();
    const messages: LiveMessage[] = [];
    let resolveTwo: () => void = () => undefined;
    const two = new Promise<void>((resolve) => {
      resolveTwo = resolve;
    });
    const ws = await app.injectWS(
      '/status/ws',
      {},
      {
        onInit(socket) {
          socket.on('message', (data: Buffer) => {
            messages.push(liveMessageSchema.parse(JSON.parse(data.toString())));
            if (messages.length === 2) resolveTwo();
          });
        },
      },
    );
    // the snapshot is sent on connect; give the socket a tick before publishing
    await new Promise((r) => setTimeout(r, 20));
    publish(base(t0, { 'm-b1': 'warn' }));
    await two;
    expect(messages.map((m) => m.type)).toEqual(['snapshot', 'delta']);
    expect(messages[1]?.type === 'delta' && messages[1].delta.changed).toEqual({ 'm-b1': 'warn' });
    expect(hub.clients()).toBe(1);
    ws.terminate();
    await app.close();
  });
});
