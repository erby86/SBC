// Fibre colours as a dialog of its own (like help): the menu keeps one item and never grows with
// the list. A dim scrim over the page; Esc, the close button or a click on the scrim closes it.
import { useEffect, useRef } from 'react';

export interface FiberRow {
  key: string;
  color: string | null;
  text: string;
  cable: string | null;
}

export function FiberColors({ fibers, onClose }: { fibers: FiberRow[]; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div
      className="helpScrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        id="fibers"
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fibersTitle"
        data-testid="fiber-colors"
      >
        <header className="helpHead">
          <h2 id="fibersTitle">สีสายไฟเบอร์ ({fibers.length} เส้น)</h2>
          <button ref={close} className="close" onClick={onClose}>
            ปิด
          </button>
        </header>
        <p className="hp">สีของเส้นบนผัง 3 มิติ ตามสายไฟเบอร์แต่ละเส้นในทะเบียน</p>
        <div id="fiberLegend" data-testid="fiber-legend">
          {fibers.map((f) => (
            <span key={f.key}>
              <i className="fl" style={{ background: f.color ?? undefined }} />
              <span className="ft">{f.text}</span>
              {f.cable ? <small>{f.cable}</small> : null}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
