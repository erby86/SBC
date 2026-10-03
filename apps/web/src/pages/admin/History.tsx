import { useQuery } from '@tanstack/react-query';
import { api } from './editApi.js';

const show = (v: unknown) =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v);

/** Who changed what and when (audit.change_log). */
export function History({ kind, code }: { kind: 'device' | 'location'; code: string }) {
  const h = useQuery({ queryKey: ['history', kind, code], queryFn: () => api.history(kind, code) });
  return (
    <section className="history">
      <h3>ประวัติการแก้</h3>
      {!h.data || h.data.length === 0 ? (
        <p className="empty">ยังไม่มีประวัติ</p>
      ) : (
        <ol>
          {h.data.map((e, i) => (
            <li key={i}>
              <b>{new Date(e.at).toLocaleString('th-TH')}</b> · {e.actor} ·{' '}
              {e.op === 'INSERT' ? 'สร้าง' : e.op === 'DELETE' ? 'ลบ' : 'แก้'}
              {e.op === 'UPDATE' && (
                <ul>
                  {e.changes.map((c) => (
                    <li key={c.field}>
                      {c.field}: {show(c.before)} → {show(c.after)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
