// APs the controllers report without a floor (ADR-0020): pick building + floor (and room if known)
// here instead of renaming them in UniFi/Omada.
import type { UnplacedAp } from '@sbc-noc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { notify } from './popups.js';
import { api, EditError, useOptions, useRooms } from './editApi.js';
import { num, val } from './Field.js';

function PlaceRow({ ap }: { ap: UnplacedAp }) {
  const qc = useQueryClient();
  const options = useOptions();
  const [building, setBuilding] = useState('');
  const [floor, setFloor] = useState<number | null>(null);
  const [locCode, setLoc] = useState<string | null>(null);
  const rooms = useRooms(building || undefined, floor);
  const [error, setError] = useState<string | null>(null);
  const place = useMutation({
    mutationFn: () =>
      api.placeAp(ap.system, ap.mac, { building: building || null, floor, locCode, no: null }),
    onSuccess: async () => {
      notify(`วาง ${ap.name} แล้ว`);
      await qc.invalidateQueries({ queryKey: ['unplaced'] });
      await qc.invalidateQueries({ queryKey: ['devices'] });
      await qc.invalidateQueries({ queryKey: ['layout'] });
    },
    onError: (e) => setError(e instanceof EditError ? e.message : String(e)),
  });
  const floors = options.data?.buildings.find((b) => b.code === building)?.floors ?? [];
  return (
    <tr>
      <td>
        <b>{ap.name}</b>
        <small className="fhint">
          {ap.system} · {ap.mac} · {ap.ip ?? 'ไม่มี IP'}
        </small>
      </td>
      <td>
        <select
          value={building}
          onChange={(e) => {
            setBuilding(e.target.value);
            setFloor(null);
            setLoc(null);
          }}
          aria-label={`อาคารของ ${ap.name}`}
        >
          <option value="">อาคาร…</option>
          {options.data?.buildings.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>{' '}
        <select
          value={floor ?? ''}
          onChange={(e) => setFloor(num(e.target.value))}
          aria-label={`ชั้นของ ${ap.name}`}
        >
          <option value="">ชั้น…</option>
          {floors.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>{' '}
        <select
          value={locCode ?? ''}
          onChange={(e) => setLoc(val(e.target.value))}
          aria-label={`ห้องของ ${ap.name}`}
        >
          <option value="">ห้อง (ถ้ารู้)</option>
          {floor !== null &&
            (rooms.data ?? []).map((r) => (
              <option key={r.locCode} value={r.locCode}>
                {r.locCode} {r.name}
              </option>
            ))}
        </select>
      </td>
      <td>
        <button
          disabled={!building || floor === null || place.isPending}
          onClick={() => place.mutate()}
        >
          วางที่นี่
        </button>
        {error && <small className="ferr">{error}</small>}
      </td>
    </tr>
  );
}

export function UnplacedPage() {
  const list = useQuery({ queryKey: ['unplaced'], queryFn: api.unplaced });
  return (
    <section className="panel admin-card">
      <div className="toolbar">
        <h2>AP รอตำแหน่ง ({list.data?.length ?? '…'})</h2>
      </div>
      <p className="fhint">
        เลือกอาคารและชั้น (และห้องถ้ารู้) แล้วกด "วางที่นี่" — ระบบสร้าง AP ในทะเบียนผูกด้วย MAC;
        รอบนำเข้าถัดไปจะอัปเดตชื่อ/IP ให้เอง แต่ไม่ย้ายตำแหน่งที่วางไว้
      </p>
      {list.data && list.data.length === 0 ? (
        <p className="empty">ไม่มี AP รอตำแหน่ง</p>
      ) : (
        <div className="table-wrap">
          <table className="tbl" data-testid="unplaced-table">
            <thead>
              <tr>
                <th>AP</th>
                <th>ตำแหน่ง</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((ap) => (
                <PlaceRow key={`${ap.system}/${ap.mac}`} ap={ap} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
