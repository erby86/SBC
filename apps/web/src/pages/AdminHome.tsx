// /admin — back office. M21 (ADR-0020) fills it with the registry editor; for now it links the
// diagnostics that exist: registry completeness (M07) and the live-status test view (M16).
import { Link } from 'react-router';
import { useHealth } from '../data/api.js';
import { defaultWsUrl } from '../data/live.js';
import { LiveStatus } from './LiveStatus.js';
import { RegistryChecks } from './RegistryChecks.js';

export function AdminHome() {
  const health = useHealth();
  return (
    <div className="admin">
      <header className="panel admin-top">
        <h1>SB School NOC · จัดการ</h1>
        <span className="chip" data-testid="api-status">
          API:{' '}
          {health.isPending
            ? 'กำลังตรวจสอบ…'
            : health.data
              ? `ออนไลน์ (v${health.data.version})`
              : 'ออฟไลน์'}
        </span>
        <Link to="/" className="btnlink">
          ← กลับหน้าผัง
        </Link>
      </header>
      <section className="panel admin-card">
        <h2>หน้าจัดการทะเบียน</h2>
        <p className="empty">
          กำลังทำ (M21): แก้อาคาร ห้อง อุปกรณ์ uplink และกำหนดชั้นให้ AP ที่ยังไม่มีตำแหน่ง
        </p>
      </section>
      <section className="panel admin-card">
        <RegistryChecks />
      </section>
      <section className="panel admin-card">
        <LiveStatus wsUrl={defaultWsUrl()} />
      </section>
    </div>
  );
}
