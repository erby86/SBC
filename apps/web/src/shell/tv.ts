// M20 TV mode (prototype btnTV): full screen, larger text, panels for watching only; beeps when a
// new device goes down. `/?tv` starts in TV mode (kiosk screens, M34). The camera stays on the
// whole school: it moves only when someone presses (motion standard, Standard.dc.html) — the
// incidents are on the scene's labels and in the panels. (Until 2026-10-07 it cycled every 10 s.)
import type { StatusSnapshot } from '@sbc-noc/shared';
import { useEffect, useRef, useState } from 'react';

let audio: AudioContext | null = null;
/** Two short 880 Hz beeps; silently nothing when audio is blocked. */
export function beep(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio = audio ?? new Ctx();
    const a = audio;
    for (const t of [0, 0.25]) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(a.destination);
      g.gain.setValueAtTime(0.15, a.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + t + 0.2);
      o.start(a.currentTime + t);
      o.stop(a.currentTime + t + 0.22);
    }
  } catch {
    /* no audio device or blocked by autoplay policy */
  }
}

export const tvParam = (search: string) => new URLSearchParams(search).has('tv');

export function useTvMode(opts: {
  initial: boolean;
  snap: StatusSnapshot | null;
  /** Entering TV mode: whole school, nothing selected. */
  onIdle: () => void;
  /** Leaving TV mode. */
  onExit: () => void;
}) {
  const [on, setOn] = useState(opts.initial);
  const cb = useRef(opts);
  cb.current = opts;
  const known = useRef<Set<string> | null>(null);

  // page frame: larger text (tokens.css :root.tv) + body class for the layout
  useEffect(() => {
    document.documentElement.classList.toggle('tv', on);
    return () => document.documentElement.classList.remove('tv');
  }, [on]);

  // entering TV mode: back to the whole school, then still
  useEffect(() => {
    if (on) cb.current.onIdle();
  }, [on]);

  // beep on a new down device (not on the first snapshot after loading)
  const downs = (opts.snap?.incidents ?? [])
    .filter((i) => i.severity === 'down')
    .map((i) => i.device)
    .sort()
    .join('|');
  useEffect(() => {
    const now = new Set(downs ? downs.split('|') : []);
    const prev = known.current;
    known.current = now;
    if (on && prev && [...now].some((d) => !prev.has(d))) beep();
  }, [downs, on]);

  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      if (next) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    } catch {
      /* fullscreen not allowed */
    }
    if (next) {
      beep(); // also unlocks audio for later alerts (user gesture)
    } else {
      cb.current.onExit();
    }
  };
  return { on, toggle };
}
