// Dark/light switch. Without a saved choice the page follows the system (prefers-color-scheme);
// a choice sets data-theme on <html>, which the CSS tokens and the 3D scene both follow.
import { useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'noc-theme';

export function savedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

/** The theme on screen now: the saved choice, else the system setting. */
export function currentTheme(): Theme {
  const saved = savedTheme();
  if (saved) return saved;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function applyTheme(t: Theme | null): void {
  if (t) document.documentElement.dataset['theme'] = t;
  else delete document.documentElement.dataset['theme'];
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: this page only */
    }
  };
  return { theme, toggle };
}
