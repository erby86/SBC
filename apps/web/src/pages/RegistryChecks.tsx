import { registryCheckReportSchema, type RegistryCheckReport } from '@sbc-noc/shared';
import { useEffect, useState } from 'react';

type State =
  { state: 'loading' } | { state: 'ok'; report: RegistryCheckReport } | { state: 'error' };

/** M07: simple read-only view of the registry completeness report from /api/registry/checks. */
export function RegistryChecks() {
  const [data, setData] = useState<State>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/registry/checks')
      .then((res) => res.json())
      .then((body: unknown) => {
        if (!cancelled) setData({ state: 'ok', report: registryCheckReportSchema.parse(body) });
      })
      .catch(() => {
        if (!cancelled) setData({ state: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (data.state === 'loading') return <p>กำลังโหลดรายงานตรวจความครบ…</p>;
  if (data.state === 'error') return <p>โหลดรายงานตรวจความครบไม่ได้</p>;

  const { report } = data;
  return (
    <section aria-labelledby="checks-title">
      <h2 id="checks-title">รายงานตรวจความครบของทะเบียน</h2>
      <p data-testid="checks-summary">
        {report.errors === 0 ? '✅ ไม่มีข้อผิดพลาด' : `❌ ข้อผิดพลาด ${report.errors} รายการ`} · ⚠️
        คำเตือน {report.warnings} รายการ
      </p>
      {report.checks.map((c) => (
        <details key={c.check} open={c.severity === 'error' && c.count > 0}>
          <summary>
            {c.count === 0 ? '✅' : c.severity === 'error' ? '❌' : '⚠️'} {c.title} — {c.count}
          </summary>
          {c.items.length > 0 && (
            <ul>
              {c.items.map((i) => (
                <li key={`${c.check}:${i.code}`}>
                  <code>{i.code}</code> {i.name}
                  {i.detail ? ` (${i.detail})` : ''}
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}
      <p>
        <small>
          สร้างเมื่อ{' '}
          {new Date(report.generatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
        </small>
      </p>
    </section>
  );
}
