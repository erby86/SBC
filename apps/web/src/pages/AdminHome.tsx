// /admin — back office (M21, ADR-0020). Needs login with the admin role (M23, ADR-0023); every
// save records the logged-in user and the client IP in the audit trail.
import { hasRole } from '@sbc-noc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NavLink, Route, Routes, useParams } from 'react-router';
import { useHealth } from '../data/api.js';
import { SESSION_KEY, useLogout, useSession } from '../data/auth.js';
import { useDemoList } from '../data/extras.js';
import { defaultWsUrl } from '../data/live.js';
import { DeviceForm } from './admin/DeviceForm.js';
import { DevicesPage } from './admin/DevicesPage.js';
import { onUnauthorized } from './admin/editApi.js';
import { LoginForm } from './admin/Login.js';
import { RoomsPage } from './admin/RoomsPage.js';
import { UnplacedPage } from './admin/UnplacedPage.js';
import { Toaster } from './admin/popups.js';
import { LiveStatus } from './LiveStatus.js';
import { RegistryChecks } from './RegistryChecks.js';

function DeviceRoute() {
  const { code } = useParams();
  const isNew = code === 'new';
  return (
    <section className="panel admin-card">
      <h2>{isNew ? 'เพิ่มอุปกรณ์' : `แก้อุปกรณ์ ${code ?? ''}`}</h2>
      <DeviceForm key={code} code={isNew ? null : (code ?? null)} />
    </section>
  );
}

export function AdminHome() {
  const health = useHealth();
  const demo = useDemoList(true);
  const session = useSession();
  const logout = useLogout();
  const qc = useQueryClient();
  // a 401 from an edit call (session expired, account disabled) brings back the login form
  useEffect(() => onUnauthorized(() => void qc.invalidateQueries({ queryKey: SESSION_KEY })), [qc]);
  const user = session.data ?? null;
  return (
    <div className="admin">
      <header className="panel admin-top">
        <h1>ศูนย์ดูแลเครือข่าย · จัดการ</h1>
        {user && (
          <span className="whoami" data-testid="whoami">
            {user.label}
            <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
              ออกจากระบบ
            </button>
          </span>
        )}
        <span className="chip" data-testid="api-status">
          API:{' '}
          {health.isPending
            ? 'กำลังตรวจสอบ…'
            : health.data
              ? `ออนไลน์ (v${health.data.version})`
              : 'ออฟไลน์'}
        </span>
        <NavLink to="/" className="btnlink">
          ← หน้าผัง
        </NavLink>
        {demo.data && (
          <NavLink
            to="/?demo=mixed"
            className="btnlink"
            title="สถานการณ์ตัวอย่างสำหรับอบรม (ADR-0014)"
          >
            โหมดสาธิต
          </NavLink>
        )}
      </header>
      {session.isPending ? (
        <p className="login-note">กำลังตรวจสอบการเข้าสู่ระบบ…</p>
      ) : session.isError ? (
        <p className="warnbox">ติดต่อ API ไม่ได้ — ลองโหลดหน้าใหม่</p>
      ) : !user ? (
        <LoginForm />
      ) : !hasRole(user, 'admin') ? (
        <p className="warnbox">บัญชี {user.label} ไม่มีสิทธิ์จัดการทะเบียน (ต้องเป็น admin)</p>
      ) : (
        <>
          <nav className="admin-nav" aria-label="เมนูหลังบ้าน">
            <NavLink to="/admin/devices">อุปกรณ์</NavLink>
            <NavLink to="/admin/rooms">ห้อง</NavLink>
            <NavLink to="/admin/unplaced">AP รอตำแหน่ง</NavLink>
            <NavLink to="/admin/checks">ตรวจความครบ</NavLink>
            <NavLink to="/admin/live">สถานะสด</NavLink>
          </nav>
          <Routes>
            <Route index element={<DevicesPage />} />
            <Route path="devices" element={<DevicesPage />} />
            <Route path="devices/:code" element={<DeviceRoute />} />
            <Route path="rooms" element={<RoomsPage />} />
            <Route path="unplaced" element={<UnplacedPage />} />
            <Route
              path="checks"
              element={
                <section className="panel admin-card">
                  <RegistryChecks />
                </section>
              }
            />
            <Route
              path="live"
              element={
                <section className="panel admin-card">
                  <LiveStatus wsUrl={defaultWsUrl()} />
                </section>
              }
            />
          </Routes>
        </>
      )}
      <Toaster />
    </div>
  );
}
