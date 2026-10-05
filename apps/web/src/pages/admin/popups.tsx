// Back-office pop-ups: a confirm dialog that shows what a save will change, and a short
// "บันทึกแล้ว" notice after it. The notice store is module-level so any form can call notify().
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

interface Notice {
  id: number;
  text: string;
}
let notices: Notice[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Show "✓ text" at the corner for a few seconds. */
export function notify(text: string, ms = 4000): void {
  const n = { id: ++seq, text };
  notices = [...notices, n];
  emit();
  setTimeout(() => {
    notices = notices.filter((x) => x !== n);
    emit();
  }, ms);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => notices,
  );
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map((n) => (
        <div key={n.id} className="toastok">
          <span className="tick" aria-hidden="true">
            ✓
          </span>
          {n.text}
        </div>
      ))}
    </div>
  );
}

/** Modal confirm: Esc or the backdrop cancels, focus starts on the confirm button. */
export function ConfirmDialog({
  title,
  children,
  confirmText,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmText: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ok.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="panel dialog" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
        <h2 id="dlgTitle">{title}</h2>
        <div className="dlgbody">{children}</div>
        <div className="dlgbtns">
          <button type="button" onClick={onCancel}>
            ยกเลิก
          </button>
          <button
            ref={ok}
            type="button"
            className={danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
