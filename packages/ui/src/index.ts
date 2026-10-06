// Shared UI constants (M18). Styles: import '@sbc-noc/ui/tokens.css'.
export type UiState = 'ok' | 'warn' | 'down' | 'cut' | 'maint';

/** Status symbols of the prototype — never colour alone (accessibility). */
export const STATE_ICON: Record<UiState, string> = {
  ok: '●',
  warn: '▲',
  down: '✕',
  cut: '○',
  maint: '◆',
};

/** Map layers of the 3D view and their colour token. */
export const LAYERS = [
  { key: 'net', label: 'เครือข่าย', color: 'var(--main)' },
  { key: 'ap', label: 'Wi-Fi', color: 'var(--ap)' },
  { key: 'lab', label: 'ห้องคอมฯ', color: 'var(--lab)' },
  { key: 'nvr', label: 'CCTV', color: 'var(--nvr)' },
  { key: 'wan', label: 'อินเทอร์เน็ต', color: 'var(--wan)' },
  { key: 'planned', label: 'controller (วางแผน)', color: 'var(--planned)' },
] as const;
export type LayerKey = (typeof LAYERS)[number]['key'];

/** Responsive breakpoints shared by CSS and code: < phone one column with the alerts first,
 * < stack one column with the map first, < wide map + alerts (buildings as chips), else 3 columns. */
export const BREAKPOINTS = { phone: 600, stack: 980, wide: 1180 } as const;
