// M16 live status: WebSocket /api/status/ws, falling back to GET /api/status every 30 s.
import {
  applyDelta,
  DEVICE_STATE_TH,
  liveMessageSchema,
  statusSnapshotSchema,
  type StatusSnapshot,
} from '@sbc-noc/shared';
import { useEffect, useRef, useState } from 'react';

export const POLL_MS = 30_000;

export type LiveMode = 'connecting' | 'live' | 'poll';
/** Can this browser reach the NOC server? `down` = the last fetch or socket attempt failed. */
export type LinkState = 'ok' | 'down';
interface Change {
  at: string;
  text: string;
}

/** `ws://<host>/api/status/ws` (or wss on https). */
export function defaultWsUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/status/ws`;
}

/**
 * M16: live status over WebSocket (/api/status/ws). When the socket is unavailable it
 * falls back to GET /api/status every 30 s and keeps retrying the socket. `null` = off (demo mode).
 */
export function useLiveStatus(wsUrl: string | null) {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [mode, setMode] = useState<LiveMode>('connecting');
  const [changes, setChanges] = useState<Change[]>([]);
  const [link, setLink] = useState<LinkState>('ok');
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [tries, setTries] = useState(0);
  const current = useRef<StatusSnapshot | null>(null);
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => {
      removeEventListener('online', up);
      removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (wsUrl === null) return; // demo mode (M20): no live data at all
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const show = (next: StatusSnapshot, text: string | null) => {
      current.current = next;
      setSnapshot(next);
      if (text) {
        setChanges((c) =>
          [{ at: new Date().toLocaleTimeString('th-TH'), text }, ...c].slice(0, 10),
        );
      }
    };
    const fetchOnce = () =>
      fetch('/api/status')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((body: unknown) => {
          setLink('ok');
          setTries(0);
          show(statusSnapshotSchema.parse(body), null);
        })
        .catch(() => {
          setLink('down');
          setTries((n) => n + 1);
        });
    kick.current = () => void fetchOnce();
    const startPolling = () => {
      setMode('poll');
      if (!poll) {
        void fetchOnce();
        poll = setInterval(() => void fetchOnce(), POLL_MS);
      }
    };
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(wsUrl);
      ws.onmessage = (ev: MessageEvent<string>) => {
        const msg = liveMessageSchema.parse(JSON.parse(ev.data));
        if (poll) {
          clearInterval(poll);
          poll = undefined;
        }
        setMode('live');
        setLink('ok');
        setTries(0);
        if (msg.type === 'snapshot') {
          show(msg.snapshot, null);
        } else if (current.current) {
          const changed = Object.entries(msg.delta.changed).map(
            ([code, st]) => `${code} → ${DEVICE_STATE_TH[st]}`,
          );
          show(applyDelta(current.current, msg.delta), changed.length ? changed.join(', ') : null);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        startPolling();
        retry = setTimeout(connect, POLL_MS);
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
      if (poll) clearInterval(poll);
      if (retry) clearTimeout(retry);
    };
  }, [wsUrl]);

  /** Try the server now (the "ลองเชื่อมต่อตอนนี้" button) instead of waiting for the next poll. */
  const retry = () => kick.current();
  return { snapshot, mode, changes, link, online, tries, retry };
}
