// /admin — back office (M21, ADR-0020). Editing works on dev only until login (M23); every save
// records the editor name typed here and the client IP in the audit trail.
import { NavLink, Route, Routes, useParams } from 'react-router';
import { useHealth } from '../data/api.js';
import { useDemoList } from '../data/extras.js';
import { defaultWsUrl } from '../data/live.js';
import { DeviceForm } from './admin/DeviceForm.js';
import { DevicesPage } from './admin/DevicesPage.js';
import { useEditor } from './admin/editApi.js';
import { RoomsPage } from './admin/RoomsPage.js';
import { UnplacedPage } from './admin/UnplacedPage.js';
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
  const [editor, setEditor] = useEditor();
  return (
    <div className="admin">
      <header className="panel admin-top">
        <h1>SB School NOC · จัดการ</h1>
        <label className="editor-name">
          ผู้แก้:
          <input
            value={editor}
            onChange={(e) => setEditor(e.target.value)}
            placeholder="เช่น STF-01"
            aria-label="ชื่อผู้แก้"
            size={10}
          />
        </label>
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
      <nav className="admin-nav" aria-label="เมนูหลังบ้าน">
        <NavLink to="/admin/devices">อุปกรณ์</NavLink>
        <NavLink to="/admin/rooms">ห้อง</NavLink>
        <NavLink to="/admin/unplaced">AP รอตำแหน่ง</NavLink>
        <NavLink to="/admin/checks">ตรวจความครบ</NavLink>
        <NavLink to="/admin/live">สถานะสด</NavLink>
      </nav>
      {!editor.trim() && (
        <p className="warnbox">ใส่ชื่อผู้แก้ที่มุมบนก่อนบันทึก — ทุกการแก้ถูกบันทึกพร้อมชื่อนี้</p>
      )}
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
    </div>
  );
}
