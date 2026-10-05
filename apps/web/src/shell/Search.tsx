// M20 search box (prototype wireSearch): a combobox in the top bar (popup list) and the same list
// inline in the phone sheet. Arrow keys move, Enter picks, Esc closes; quick and recent searches
// when empty; "ไฮไลต์ในภาพ" keeps every device found visible and fades the rest.
import { STATE_ICON } from '@sbc-noc/ui';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import {
  GROUP_TH,
  loadRecent,
  QUICK,
  runSearch,
  saveRecent,
  type SearchEntry,
  type StateOf,
} from './search.js';

const MAX = 40;

export interface SearchProps {
  id: string;
  index: SearchEntry[];
  stateOf: StateOf;
  /** Building state for building rows. */
  buildingState: (code: string) => keyof typeof STATE_ICON;
  popup: boolean;
  placeholder: string;
  onPick: (e: SearchEntry) => void;
  onHighlight: (codes: string[], label: string) => void;
  onNotFound: (q: string) => void;
}

export const SearchBox = forwardRef<HTMLInputElement, SearchProps>(function SearchBox(p, ref) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState(loadRecent);
  const list = useMemo(() => runSearch(p.index, q, p.stateOf), [p.index, q, p.stateOf]);
  const shown = list.slice(0, MAX);
  const devs = list.filter((e) => e.kind === 'd');
  const boxId = `${p.id}-res`;
  const visible = !p.popup || open;
  useEffect(() => {
    document.getElementById(`${boxId}-${sel}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [boxId, sel]);

  const remember = () => {
    const t = q.trim();
    if (t) setRecent(saveRecent(t, recent));
  };
  const choose = (i: number) => {
    const e = shown[i];
    if (!e) return;
    remember();
    p.onPick(e);
    if (p.popup) {
      setOpen(false);
      (document.activeElement as HTMLElement | null)?.blur();
    }
  };
  const iconOf = (e: SearchEntry) => {
    if (e.kind === 'b') {
      const st = p.buildingState(e.id);
      return <span className={`i ${st}`}>{STATE_ICON[st]}</span>;
    }
    if (e.kind === 'f') return <span className="i cut">≡</span>;
    if (e.kind === 'r')
      return <span className={`i ${e.lab ? 'ok' : 'cut'}`}>{e.lab ? '▬' : '□'}</span>;
    const st = p.stateOf(e) ?? 'ok';
    return <span className={`i ${st}`}>{STATE_ICON[st]}</span>;
  };

  let last: string | null = null;
  return (
    <div className={p.popup ? 'sbox' : 'sbox inline'}>
      <input
        ref={ref}
        id={p.id}
        type="search"
        role="combobox"
        aria-expanded={visible}
        aria-controls={boxId}
        aria-autocomplete="list"
        aria-activedescendant={visible && shown.length ? `${boxId}-${sel}` : undefined}
        autoComplete="off"
        placeholder={p.placeholder}
        aria-label="ค้นหา"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          const n = Math.min(list.length, MAX);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!n) return;
            setOpen(true);
            setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (n) choose(sel);
            else if (q.trim()) p.onNotFound(q.trim());
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      />
      {visible && (
        <div
          id={boxId}
          className={p.popup ? 'sres panel' : 'sres'}
          role="listbox"
          aria-label="ผลค้นหา"
          data-testid={`${p.id}-results`}
          onMouseDown={(e) => e.preventDefault()}
        >
          {!q.trim() ? (
            <>
              <p className="sgh">ค้นด่วน</p>
              <div className="sq">
                {QUICK.map((x) => (
                  <button key={x} type="button" onClick={() => setQ(x)}>
                    {x}
                  </button>
                ))}
              </div>
              {recent.length > 0 && (
                <>
                  <p className="sgh">ค้นล่าสุด</p>
                  <div className="sq">
                    {recent.map((x) => (
                      <button key={x} type="button" onClick={() => setQ(x)}>
                        {x}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="shelp">
                ค้นได้หลายคำพร้อมกัน เช่น <b>ap 8 เซียน 6</b>, <b>nvr icet1</b>, <b>ล่ม</b>,{' '}
                <b>LOC-050</b>, IP
              </p>
            </>
          ) : !list.length ? (
            <p className="shelp">
              ไม่พบ &quot;{q}&quot; ลองพิมพ์ชื่อตึก ชั้น ห้อง ประเภท (AP, NVR) สถานะ (ล่ม) หรือ IP
            </p>
          ) : (
            <>
              <div className="shead">
                <span>
                  พบ {list.length} รายการ{list.length > MAX ? ` (แสดง ${MAX})` : ''}
                </span>
                {devs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      remember();
                      p.onHighlight(
                        devs.map((e) => e.id),
                        q.trim(),
                      );
                      setOpen(false);
                    }}
                  >
                    ไฮไลต์ในภาพ {devs.length}
                  </button>
                )}
              </div>
              {shown.map((e, i) => {
                const head = e.kind !== last ? <p className="sgh">{GROUP_TH[e.kind]}</p> : null;
                last = e.kind;
                return (
                  <div key={`${e.kind}:${e.id}`}>
                    {head}
                    <div
                      id={`${boxId}-${i}`}
                      className={`sr${i === sel ? ' on' : ''}`}
                      role="option"
                      aria-selected={i === sel}
                      onClick={() => choose(i)}
                    >
                      {iconOf(e)}
                      <span>
                        <b>{e.label}</b>
                        <small>{e.sub}</small>
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
});
