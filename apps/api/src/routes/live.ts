// M16: live status over WebSocket at /status/ws (browsers: /api/status/ws).
// On connect a client gets the whole snapshot; after every engine poll (Redis status:updates,
// ~30 s) it gets a delta. The hub also turns the data stale by itself when the engine goes silent
// for more than 2 minutes. Clients that lose the socket fall back to GET /status every 30 s.
import websocket from '@fastify/websocket';
import {
  diffSnapshots,
  STALE_AFTER_MS,
  statusSnapshotSchema,
  type LiveMessage,
  type StatusSnapshot,
} from '@sbc-noc/shared';
import type { FastifyInstance } from 'fastify';

export interface LiveSource {
  /** Latest stored snapshot (Redis key), used for the first clients. */
  read(): Promise<StatusSnapshot | null>;
  /** Calls `onMessage` with each snapshot JSON the engine publishes; returns an unsubscribe. */
  subscribe(onMessage: (json: string) => void): Promise<() => Promise<void>>;
}

export interface LiveHub {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Re-checks freshness (also run on a timer). */
  checkFreshness(): void;
  receive(json: string): void;
  connect(send: (msg: LiveMessage) => void): () => void;
  clients(): number;
}

export function createLiveHub(
  source: LiveSource,
  log: { warn(o: unknown, m: string): void },
  now: () => Date = () => new Date(),
): LiveHub {
  let last: StatusSnapshot | null = null;
  let version = 0;
  const clients = new Set<(msg: LiveMessage) => void>();
  let unsubscribe: (() => Promise<void>) | null = null;
  let timer: NodeJS.Timeout | undefined;

  const fresh = (s: StatusSnapshot): StatusSnapshot =>
    !s.stale && now().getTime() - Date.parse(s.lastUpdate) > STALE_AFTER_MS
      ? { ...s, stale: true }
      : s;

  const broadcast = (msg: LiveMessage) => {
    for (const send of clients) {
      try {
        send(msg);
      } catch (err) {
        log.warn({ err }, 'live: send failed');
      }
    }
  };

  const publish = (next: StatusSnapshot) => {
    const prev = last;
    last = next;
    version += 1;
    broadcast(
      prev
        ? { type: 'delta', version, delta: diffSnapshots(prev, next) }
        : { type: 'snapshot', version, snapshot: next },
    );
  };

  const hub: LiveHub = {
    async start() {
      const stored = await source.read().catch(() => null);
      if (stored) {
        last = fresh(stored);
        version = 1;
      }
      // Redis may be down when the api starts: keep serving and retry the subscription.
      const trySubscribe = async () => {
        if (unsubscribe) return;
        try {
          unsubscribe = await source.subscribe((json) => hub.receive(json));
        } catch (err) {
          log.warn({ err }, 'live: cannot subscribe to status:updates yet');
        }
      };
      await trySubscribe();
      timer = setInterval(() => {
        void trySubscribe();
        hub.checkFreshness();
      }, 30_000);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      await unsubscribe?.();
      clients.clear();
    },
    receive(json) {
      let next: StatusSnapshot;
      try {
        next = statusSnapshotSchema.parse(JSON.parse(json));
      } catch (err) {
        log.warn({ err }, 'live: bad snapshot on status:updates');
        return;
      }
      publish(fresh(next));
    },
    checkFreshness() {
      if (last && !last.stale && fresh(last).stale) publish({ ...last, stale: true });
    },
    connect(send) {
      clients.add(send);
      if (last) send({ type: 'snapshot', version, snapshot: last });
      return () => clients.delete(send);
    },
    clients: () => clients.size,
  };
  return hub;
}

export async function liveRoutes(app: FastifyInstance, hub: LiveHub): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 1024 } });
  app.addHook('onReady', () => hub.start());
  app.addHook('onClose', () => hub.stop());
  app.get('/status/ws', { websocket: true, schema: { hide: true } }, (socket) => {
    const off = hub.connect((msg) => socket.send(JSON.stringify(msg)));
    socket.on('close', off);
    socket.on('error', off);
    // Clients send nothing; anything they send is ignored.
  });
}
