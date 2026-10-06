// Browser tab as a status light: the title and favicon show how many devices are down or
// need a look, so a NOC tab in the background still tells you something. A new problem
// while the tab is hidden makes the title blink until someone looks.
import type { StatusSnapshot } from '@sbc-noc/shared';
import { useEffect, useRef } from 'react';
import { topCounts } from './console.js';
import type { FeedEvent } from './events.js';

export const APP_TITLE = 'ศูนย์ดูแลเครือข่าย';
const BLINK_MS = 1_200;

export type TabState = 'wait' | 'ok' | 'warn' | 'down' | 'stale';

export function tabState(snap: StatusSnapshot | null): TabState {
  if (!snap) return 'wait';
  if (snap.stale) return 'stale';
  if (snap.incidents.some((i) => i.severity === 'down')) return 'down';
  return snap.incidents.length ? 'warn' : 'ok';
}

export function tabTitle(snap: StatusSnapshot | null, demo: boolean): string {
  const pre = demo ? '[สาธิต] ' : '';
  const st = tabState(snap);
  const tc = snap ? topCounts(snap) : null;
  const down = tc?.out ?? 0;
  const warn = tc?.warn ?? 0;
  if (st === 'stale') return `${pre}ข้อมูลค้าง · ${APP_TITLE}`;
  if (st === 'down')
    return `${pre}(${down}) ✕ ใช้งานไม่ได้${warn ? ` · ▲ ${warn}` : ''} · ${APP_TITLE}`;
  if (st === 'warn') return `${pre}(${warn}) ▲ ควรตรวจสอบ · ${APP_TITLE}`;
  return `${pre}${APP_TITLE} · SB School`;
}

const BADGE: Record<TabState, string | null> = {
  wait: null,
  ok: '#3fbf8a',
  warn: '#f0b429',
  down: '#ef4b5c',
  stale: '#8a97a8',
};

/** Logo of the top bar with a status badge (count, or ! when stale) in the corner. */
export function faviconSvg(state: TabState, count: number): string {
  const logo =
    '<rect width="32" height="32" rx="8" fill="#13233a"/>' +
    '<g fill="none" stroke="#6cb8ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M16 5.5 25 10.7v10.6L16 26.5 7 21.3V10.7z"/><circle cx="16" cy="16" r="2.6"/>' +
    '<path d="M16 13.4V9M18.2 17.3l3.8 2.2M13.8 17.3 10 19.5"/></g>';
  const fill = BADGE[state];
  let badge = '';
  if (fill && state === 'ok')
    badge = `<circle cx="25" cy="25" r="5.5" fill="${fill}" stroke="#13233a" stroke-width="2"/>`;
  else if (fill) {
    const text = state === 'stale' ? '!' : count > 9 ? '9+' : String(count);
    badge =
      `<circle cx="22.5" cy="22.5" r="9" fill="${fill}" stroke="#13233a" stroke-width="2"/>` +
      `<text x="22.5" y="26.6" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="${text.length > 1 ? 10 : 12}" fill="#0b1422">${text}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${logo}${badge}</svg>`;
}

export function useTabStatus(
  snap: StatusSnapshot | null,
  events: readonly FeedEvent[],
  demo: boolean,
): void {
  const title = tabTitle(snap, demo);
  const state = tabState(snap);
  // same number as the title: devices out when any are, otherwise the warnings
  const tc = snap ? topCounts(snap) : null;
  const count = state === 'down' ? (tc?.out ?? 0) : (tc?.warn ?? 0);
  const titleRef = useRef(title);
  titleRef.current = title;
  const seen = useRef(new Set<string>());
  const blink = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = 'image/svg+xml';
    link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(state, count))}`;
  }, [state, count]);

  useEffect(() => {
    if (!blink.current) document.title = title;
  }, [title]);

  // a new or worse "down" while nobody is looking: blink until the tab is visible again
  useEffect(() => {
    const fresh = events.filter((e) => e.kind === 'down' && !seen.current.has(e.id));
    for (const e of events) seen.current.add(e.id);
    if (!fresh.length || !document.hidden || blink.current) return;
    let on = false;
    blink.current = setInterval(() => {
      on = !on;
      document.title = on ? `‼ มีอุปกรณ์ใช้งานไม่ได้ · ${APP_TITLE}` : titleRef.current;
    }, BLINK_MS);
  }, [events]);

  useEffect(() => {
    const stop = () => {
      if (document.hidden || !blink.current) return;
      clearInterval(blink.current);
      blink.current = null;
      document.title = titleRef.current;
    };
    document.addEventListener('visibilitychange', stop);
    return () => document.removeEventListener('visibilitychange', stop);
  }, []);

  useEffect(
    () => () => {
      if (blink.current) clearInterval(blink.current);
      blink.current = null;
    },
    [],
  );
}
