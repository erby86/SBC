// Exit motion for things that open on top (menu, help, confirm dialogs): when `show` turns false
// the last content stays for --t-out (0.3 s, Standard.dc.html) while it fades, inert and hidden
// from assistive tech, then unmounts. No Web Animations (tests) or reduced motion: gone at once.
import { useEffect, useRef, useState, type ReactNode } from 'react';

function outMs(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--t-out').trim();
  const s = parseFloat(v);
  return Number.isFinite(s) ? (v.endsWith('ms') ? s : s * 1000) : 300;
}

export function Leaving({ show, children }: { show: boolean; children: ReactNode }) {
  const last = useRef<ReactNode>(null);
  const box = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(!show);
  if (show) last.current = children;

  useEffect(() => {
    if (show) {
      setGone(false);
      return;
    }
    const el = box.current?.firstElementChild as HTMLElement | null | undefined;
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!el || typeof el.animate !== 'function' || reduce) {
      setGone(true);
      return;
    }
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: outMs(),
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    });
    a.onfinish = () => setGone(true);
    return () => a.cancel();
  }, [show]);

  if (!show && gone) return null;
  return (
    <div ref={box} className="leaving" inert={!show || undefined} aria-hidden={!show || undefined}>
      {show ? children : last.current}
    </div>
  );
}
