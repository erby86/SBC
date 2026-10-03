// Rooms (LOC) by building/floor: edit name, room number, type, corridor order, side; add a room
// (the database issues the next LOC number, ADR-0001).
import { LOCATION_SIDES, type LocationEdit } from '@sbc-noc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, EditError, useOptions, useRooms } from './editApi.js';
import { Field, num, val } from './Field.js';
import { History } from './History.js';

const SIDE_TH: Record<(typeof LOCATION_SIDES)[number], string> = {
  north: 'เหนือ',
  south: 'ใต้',
  east: 'ตะวันออก',
  west: 'ตะวันตก',
  inner: 'ด้านใน',
  outer: 'ด้านนอก',
};

type RoomForm = Omit<LocationEdit, 'locCode' | 'owner' | 'rowVersion'>;

function RoomEditor({
  loc,
  building,
  floor,
  onDone,
}: {
  loc: LocationEdit | null;
  building: string;
  floor: number;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const options = useOptions();
  const [f, setF] = useState<RoomForm>(
    loc ?? {
      building,
      floor,
      name: '',
      roomNumber: null,
      type: null,
      corridorOrder: null,
      side: null,
      hasRack: false,
    },
  );
  const [error, setError] = useState<EditError | null>(null);
  const save = useMutation({
    mutationFn: () =>
      loc
        ? api.updateLocation(loc.locCode, { ...f, rowVersion: loc.rowVersion })
        : api.createLocation(f),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rooms'] });
      await qc.invalidateQueries({ queryKey: ['layout'] });
      onDone();
    },
    onError: (e) => setError(e instanceof EditError ? e : new EditError(0, String(e))),
  });
  const err = (k: string) => (error?.field === k ? error.message : undefined);
  return (
    <form
      className="grid-form inline-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="ชื่อห้อง/พื้นที่" error={err('name')}>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </Field>
      <Field label="เลขห้อง" error={err('roomNumber')}>
        <input
          value={f.roomNumber ?? ''}
          onChange={(e) => setF({ ...f, roomNumber: val(e.target.value) })}
        />
      </Field>
      <Field label="ประเภท" error={err('type')}>
        <select value={f.type ?? ''} onChange={(e) => setF({ ...f, type: val(e.target.value) })}>
          <option value="">—</option>
          {options.data?.locationTypes.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="ลำดับตามทางเดิน" error={err('corridorOrder')} hint="1 = ใกล้บันได/ทางขึ้น">
        <input
          type="number"
          min={0}
          value={f.corridorOrder ?? ''}
          onChange={(e) => setF({ ...f, corridorOrder: num(e.target.value) })}
        />
      </Field>
      <Field label="ฝั่งทางเดิน" error={err('side')}>
        <select
          value={f.side ?? ''}
          onChange={(e) => setF({ ...f, side: (val(e.target.value) as RoomForm['side']) ?? null })}
        >
          <option value="">—</option>
          {LOCATION_SIDES.map((s) => (
            <option key={s} value={s}>
              {SIDE_TH[s]}
            </option>
          ))}
        </select>
      </Field>
      <label className="field check">
        <input
          type="checkbox"
          checked={f.hasRack}
          onChange={(e) => setF({ ...f, hasRack: e.target.checked })}
        />{' '}
        มีตู้/จุดเครือข่าย
      </label>
      <div className="actions">
        <button type="submit" disabled={save.isPending}>
          {loc ? 'บันทึก' : 'เพิ่มห้อง (ออกเลข LOC ให้)'}
        </button>
        <button type="button" onClick={onDone}>
          ปิด
        </button>
        {error && !error.field && <span className="ferr">{error.message}</span>}
      </div>
      {loc && <History kind="location" code={loc.locCode} />}
    </form>
  );
}

export function RoomsPage() {
  const options = useOptions();
  const [building, setBuilding] = useState('b1');
  const [floor, setFloor] = useState(1);
  const rooms = useRooms(building, floor);
  const [editing, setEditing] = useState<LocationEdit | 'new' | null>(null);
  const floors = options.data?.buildings.find((b) => b.code === building)?.floors ?? [];

  const open = async (locCode: string) => setEditing(await api.location(locCode));

  return (
    <section className="panel admin-card">
      <div className="toolbar">
        <h2>ห้อง (LOC)</h2>
        <select
          value={building}
          onChange={(e) => {
            setBuilding(e.target.value);
            setFloor(1);
            setEditing(null);
          }}
          aria-label="อาคาร"
        >
          {options.data?.buildings.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
        <select value={floor} onChange={(e) => setFloor(Number(e.target.value))} aria-label="ชั้น">
          {floors.map((n) => (
            <option key={n} value={n}>
              ชั้น {n}
            </option>
          ))}
        </select>
        <button onClick={() => setEditing('new')}>+ เพิ่มห้อง</button>
      </div>
      {editing === 'new' && (
        <RoomEditor loc={null} building={building} floor={floor} onDone={() => setEditing(null)} />
      )}
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>LOC</th>
              <th>ชื่อ</th>
              <th>เลขห้อง</th>
              <th>ลำดับ</th>
              <th>เครื่อง (SBC ASSET)</th>
              <th>ที่มา</th>
            </tr>
          </thead>
          <tbody>
            {(rooms.data ?? []).map((r) => (
              <tr key={r.locCode}>
                <td>
                  <button className="linkish" onClick={() => void open(r.locCode)}>
                    {r.locCode}
                  </button>
                </td>
                <td>{r.name}</td>
                <td>{r.roomNumber ?? '—'}</td>
                <td>{r.corridorOrder ?? '—'}</td>
                <td>{r.registryPcCount ?? '—'}</td>
                <td>{r.owner === 'sbc_asset' ? 'SBC ASSET' : 'NOC'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && editing !== 'new' && (
        <RoomEditor
          key={editing.locCode}
          loc={editing}
          building={building}
          floor={floor}
          onDone={() => setEditing(null)}
        />
      )}
      <p className="fhint">
        ห้องที่มาจาก SBC ASSET: แก้ชื่อ/อาคาร/ชั้นที่ SBC ASSET จะดีกว่า
        (ไม่งั้นงานซิงก์ขึ้นรายการขัดแย้ง) — ลำดับทางเดินและฝั่งแก้ที่นี่ได้
      </p>
    </section>
  );
}
