// Hamburger menu of the top bar: everything that is not needed every minute (view modes, layers,
// fibre colours, devices without a position, help, back office). Esc or a click outside closes it.
import { LAYERS, type LayerKey } from '@sbc-noc/ui';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from './icons.js';
import { Leaving } from './leaving.js';

export interface MenuProps {
  ready: boolean;
  top: boolean;
  tv: boolean;
  eco: boolean;
  dark: boolean;
  layers: Record<LayerKey, boolean>;
  wanNames: boolean;
  /** Number of fibre links; their colours open in a dialog of their own (FiberColors). */
  fibers: number;
  unlocated: number;
  onTop: () => void;
  onTv: () => void;
  onEco: () => void;
  onTheme: () => void;
  onLayer: (key: LayerKey) => void;
  onWanNames: () => void;
  onUnlocated: () => void;
  onHelp: () => void;
  onFibers: () => void;
}

function Item({
  icon,
  label,
  hint,
  pressed,
  disabled,
  testid,
  onClick,
}: {
  icon: IconName;
  label: ReactNode;
  hint?: string;
  pressed?: boolean;
  disabled?: boolean;
  testid?: string;
  onClick: () => void;
}) {
  return (
    <button
      className="mitem"
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testid}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="ml">{label}</span>
      {hint && <kbd aria-hidden="true">{hint}</kbd>}
    </button>
  );
}

export function Menu(p: MenuProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // the panel ends above the window's bottom edge whatever sits above the top bar (demo band),
  // and scrolls inside when the window is short
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const el = panel.current;
      if (!el) return;
      el.style.maxHeight = `${Math.max(160, window.innerHeight - el.getBoundingClientRect().top - 12)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      // outside the menu, or on its dim layer (.menu::before, whose target is the menu box)
      if (box.current && (!box.current.contains(e.target as Node) || e.target === box.current))
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      box.current?.querySelector<HTMLButtonElement>('.mbtn')?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  /** Run an action and close the menu (toggles that are watched in place keep it open). */
  const act =
    (f: () => void, close = true) =>
    () => {
      f();
      if (close) setOpen(false);
    };

  return (
    <div className="menu" ref={box}>
      <button
        className="ib mbtn"
        aria-label="เมนู"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="menuPanel"
        title="เมนู: มุมมอง ชั้นข้อมูล วิธีใช้ และจัดการ"
        onClick={() => setOpen(!open)}
        data-testid="menu"
      >
        <Icon name="menu" />
      </button>
      <Leaving show={open}>
        <div id="menuPanel" ref={panel} className="panel" role="group" aria-label="เมนู">
          <p className="mh">มุมมอง</p>
          <Item
            icon="top"
            label="มองจากด้านบน"
            hint="T"
            pressed={p.top}
            disabled={!p.ready}
            onClick={act(p.onTop)}
          />
          <Item icon="tv" label="โหมดทีวี" pressed={p.tv} testid="tv" onClick={act(p.onTv)} />
          <Item
            icon="leaf"
            label="โหมดประหยัด"
            hint="E"
            pressed={p.eco}
            disabled={!p.ready}
            onClick={act(p.onEco, false)}
          />
          <Item
            icon={p.dark ? 'sun' : 'moon'}
            label={p.dark ? 'โหมดสว่าง' : 'โหมดมืด'}
            hint="L"
            testid="theme-toggle"
            onClick={act(p.onTheme, false)}
          />

          <p className="mh">ชั้นข้อมูลบนผัง</p>
          <div className="mlayers" role="group" aria-label="ชั้นข้อมูล" data-testid="layers">
            {LAYERS.map((l) => (
              <button key={l.key} aria-pressed={p.layers[l.key]} onClick={() => p.onLayer(l.key)}>
                <span
                  className="sw"
                  style={{
                    borderColor: l.color,
                    background: p.layers[l.key] ? l.color : 'transparent',
                  }}
                />
                {l.label}
              </button>
            ))}
          </div>
          <Item
            icon="pin"
            label="ชื่อ ISP บนผัง"
            pressed={p.wanNames}
            testid="wan-names"
            onClick={act(p.onWanNames, false)}
          />

          <p className="mh">ข้อมูล</p>
          {p.fibers > 0 && (
            <Item
              icon="fiber"
              label={`สีสายไฟเบอร์ (${p.fibers})`}
              testid="fiber-colors-open"
              onClick={act(p.onFibers)}
            />
          )}
          {p.unlocated > 0 && (
            <Item
              icon="pin"
              label={`ยังไม่มีตำแหน่งบนผัง (${p.unlocated})`}
              onClick={act(p.onUnlocated)}
            />
          )}
          <Item icon="help" label="วิธีใช้" hint="?" onClick={act(p.onHelp)} />
          <Link className="mitem" to="/admin">
            <Icon name="gear" />
            <span className="ml">จัดการทะเบียน</span>
          </Link>
        </div>
      </Leaving>
    </div>
  );
}
