import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useDevices, useOptions } from './editApi.js';

/** All devices with filters; click to edit. */
export function DevicesPage() {
  const devices = useDevices();
  const options = useOptions();
  const [q, setQ] = useState('');
  const [building, setBuilding] = useState('');
  const [role, setRole] = useState('');
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (devices.data ?? []).filter(
      (d) =>
        (!building || d.building === building) &&
        (!role || d.role === role) &&
        (!t || [d.code, d.name, d.hostname, d.ip, d.mac].some((v) => v?.toLowerCase().includes(t))),
    );
  }, [devices.data, q, building, role]);

  return (
    <section className="panel admin-card">
      <div className="toolbar">
        <h2>อุปกรณ์ ({rows.length})</h2>
        <input
          placeholder="ค้นหา รหัส ชื่อ IP MAC"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="ค้นหาอุปกรณ์"
        />
        <select value={building} onChange={(e) => setBuilding(e.target.value)} aria-label="อาคาร">
          <option value="">ทุกอาคาร</option>
          {options.data?.buildings.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="บทบาท">
          <option value="">ทุกบทบาท</option>
          {options.data?.roles.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        <Link to="/admin/devices/new" className="btnlink">
          + เพิ่มอุปกรณ์
        </Link>
      </div>
      <div className="table-wrap">
        <table className="tbl" data-testid="device-table">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อ</th>
              <th>บทบาท</th>
              <th>ที่ตั้ง</th>
              <th>IP</th>
              <th>ต่อจาก</th>
              <th>ข้อมูล</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.code}>
                <td>
                  <Link to={`/admin/devices/${d.code}`}>{d.code}</Link>
                </td>
                <td>{d.name}</td>
                <td>{d.role}</td>
                <td>
                  {d.building ? `${d.building} ชั้น ${d.floor ?? '?'}` : '—'}
                  {d.locCode ? ` · ${d.locCode}` : ''}
                </td>
                <td>{d.ip ?? '—'}</td>
                <td>{d.uplink ?? '—'}</td>
                <td>{d.dataStatus === 'verified' ? '✓ ตรวจแล้ว' : 'ยังไม่ตรวจ'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
