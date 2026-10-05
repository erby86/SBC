// Edit or add one device: place (room or building + floor), uplink, IP/MAC, role, model, status.
// Saves only the fields that changed, with the row_version it was loaded at.
import { LIFECYCLES, type DeviceEdit, type EditOptions } from '@sbc-noc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, EditError, useDevices, useOptions, useRooms } from './editApi.js';
import { Field, num, val } from './Field.js';
import { History } from './History.js';
import { ConfirmDialog, notify } from './popups.js';

type Form = Omit<DeviceEdit, 'rowVersion' | 'managedBy'>;

const EMPTY: Form = {
  code: '',
  name: '',
  hostname: null,
  role: 'access',
  model: null,
  locCode: null,
  building: null,
  floor: null,
  ip: null,
  mac: null,
  uplink: null,
  uplinkMedia: null,
  lifecycle: 'active',
  dataStatus: 'unverified',
};

const LIFE_TH: Record<(typeof LIFECYCLES)[number], string> = {
  planned: 'วางแผน',
  active: 'ใช้งาน',
  spare: 'สำรอง',
  retired: 'เลิกใช้',
};

const LABEL: Record<keyof Form, string> = {
  code: 'รหัส',
  name: 'ชื่อที่แสดง',
  hostname: 'hostname',
  role: 'บทบาท',
  model: 'รุ่น',
  locCode: 'ห้อง',
  building: 'อาคาร',
  floor: 'ชั้น',
  ip: 'IP จัดการ',
  mac: 'MAC',
  uplink: 'ต่อจาก (uplink)',
  uplinkMedia: 'ชนิดสาย uplink',
  lifecycle: 'วงจรชีวิต',
  dataStatus: 'สถานะข้อมูล',
};
const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function changes(from: Form, to: Form): Partial<Form> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(to) as (keyof Form)[])
    if (k !== 'code' && from[k] !== to[k]) out[k] = to[k];
  // a room sets the floor; send the whole place together
  if ('locCode' in out || 'building' in out || 'floor' in out) {
    out['locCode'] = to.locCode;
    out['building'] = to.building;
    out['floor'] = to.floor;
  }
  return out as Partial<Form>;
}

export function DeviceForm({ code }: { code: string | null }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const options = useOptions();
  const devices = useDevices();
  const loaded = useQuery({
    queryKey: ['device-edit', code],
    queryFn: () => api.device(code as string),
    enabled: code !== null,
  });
  const base: Form | null = code === null ? EMPTY : (loaded.data ?? null);
  const [form, setForm] = useState<Form | null>(null);
  const f = form ?? base;
  const rooms = useRooms(f?.building ?? undefined, f?.floor);
  const [error, setError] = useState<EditError | null>(null);
  const [ask, setAsk] = useState<'save' | 'delete' | null>(null);

  const save = useMutation({
    mutationFn: async (): Promise<DeviceEdit> => {
      if (!f) throw new Error('no form');
      if (code === null) return api.createDevice(f);
      const diff = changes(base as Form, f);
      return api.updateDevice(code, {
        rowVersion: (loaded.data as DeviceEdit).rowVersion,
        ...diff,
      });
    },
    onSuccess: async (d) => {
      setError(null);
      setForm(null);
      setAsk(null);
      notify(`บันทึกแล้ว · ${d.code} (${new Date().toLocaleTimeString('th-TH')})`);
      qc.setQueryData(['device-edit', d.code], d);
      await qc.invalidateQueries({ queryKey: ['devices'] });
      await qc.invalidateQueries({ queryKey: ['history', 'device', d.code] });
      await qc.invalidateQueries({ queryKey: ['layout'] });
      if (code === null) await nav(`/admin/devices/${d.code}`);
    },
    onError: (e) => {
      setAsk(null);
      setError(e instanceof EditError ? e : new EditError(0, String(e)));
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteDevice(code as string, (loaded.data as DeviceEdit).rowVersion),
    onSuccess: async () => {
      setAsk(null);
      notify(`ลบ ${code ?? ''} แล้ว`);
      await qc.invalidateQueries({ queryKey: ['devices'] });
      await nav('/admin/devices');
    },
    onError: (e) => {
      setAsk(null);
      setError(e instanceof EditError ? e : new EditError(0, String(e)));
    },
  });

  if (code !== null && loaded.isPending) return <p className="empty">กำลังโหลด…</p>;
  if (code !== null && !loaded.data) return <p className="empty">ไม่พบอุปกรณ์ {code}</p>;
  if (!f || !options.data) return <p className="empty">กำลังโหลด…</p>;
  const o: EditOptions = options.data;
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch });
  const err = (field: string) => (error?.field === field ? error.message : undefined);
  const floors = o.buildings.find((b) => b.code === f.building)?.floors ?? [];
  const dirty =
    code === null || (form !== null && Object.keys(changes(base as Form, f)).length > 0);

  return (
    <div className="editor">
      <form
        className="grid-form"
        onSubmit={(e) => {
          e.preventDefault();
          setAsk('save');
        }}
      >
        {code === null && (
          <Field
            label="รหัส (ไม่เปลี่ยนตลอดอายุ)"
            error={err('code')}
            hint="เช่น sw-b1-3, ap-bb-4-1"
          >
            <input
              value={f.code}
              onChange={(e) => set({ code: e.target.value.trim().toLowerCase() })}
              required
            />
          </Field>
        )}
        <Field label="ชื่อที่แสดง" error={err('name')}>
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} required />
        </Field>
        <Field label="บทบาท" error={err('role')}>
          <select value={f.role} onChange={(e) => set({ role: e.target.value })}>
            {o.roles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name} ({r.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="อาคาร" error={err('building')}>
          <select
            value={f.building ?? ''}
            onChange={(e) => set({ building: val(e.target.value), floor: null, locCode: null })}
          >
            <option value="">— ไม่ระบุ —</option>
            {o.buildings.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ชั้น" error={err('floor')}>
          <select
            value={f.floor ?? ''}
            onChange={(e) => set({ floor: num(e.target.value), locCode: null })}
          >
            <option value="">—</option>
            {floors.map((n) => (
              <option key={n} value={n}>
                ชั้น {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ห้อง (ถ้ารู้)" error={err('locCode')}>
          <select value={f.locCode ?? ''} onChange={(e) => set({ locCode: val(e.target.value) })}>
            <option value="">— ไม่ระบุห้อง —</option>
            {(rooms.data ?? []).map((r) => (
              <option key={r.locCode} value={r.locCode}>
                {r.locCode} {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ต่อจาก (uplink)" error={err('uplink')} hint="รหัสอุปกรณ์ต้นทาง">
          <input
            list="device-codes"
            value={f.uplink ?? ''}
            onChange={(e) => set({ uplink: val(e.target.value) })}
          />
        </Field>
        <Field label="ชนิดสาย uplink" error={err('uplinkMedia')}>
          <select
            value={f.uplinkMedia ?? ''}
            onChange={(e) => set({ uplinkMedia: val(e.target.value) })}
          >
            <option value="">—</option>
            {o.media.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="IP จัดการ" error={err('ip')}>
          <input
            value={f.ip ?? ''}
            onChange={(e) => set({ ip: val(e.target.value) })}
            inputMode="decimal"
          />
        </Field>
        <Field label="MAC" error={err('mac')}>
          <input
            value={f.mac ?? ''}
            onChange={(e) => set({ mac: val(e.target.value.toLowerCase()) })}
          />
        </Field>
        <Field label="hostname" error={err('hostname')}>
          <input
            value={f.hostname ?? ''}
            onChange={(e) => set({ hostname: val(e.target.value) })}
          />
        </Field>
        <Field label="รุ่น" error={err('model')}>
          <input
            list="models"
            value={f.model ?? ''}
            onChange={(e) => set({ model: val(e.target.value) })}
          />
        </Field>
        <Field label="วงจรชีวิต" error={err('lifecycle')}>
          <select
            value={f.lifecycle}
            onChange={(e) => set({ lifecycle: e.target.value as Form['lifecycle'] })}
          >
            {LIFECYCLES.map((l) => (
              <option key={l} value={l}>
                {LIFE_TH[l]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="สถานะข้อมูล" error={err('dataStatus')}>
          <select
            value={f.dataStatus}
            onChange={(e) => set({ dataStatus: e.target.value as Form['dataStatus'] })}
          >
            <option value="unverified">ยังไม่ตรวจหน้างาน</option>
            <option value="verified">ตรวจหน้างานแล้ว</option>
          </select>
        </Field>
        <datalist id="device-codes">
          {(devices.data ?? []).map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </datalist>
        <datalist id="models">
          {o.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <div className="actions">
          <button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? 'กำลังบันทึก…' : code === null ? 'เพิ่มอุปกรณ์' : 'บันทึก'}
          </button>
          {form !== null && code !== null && (
            <button type="button" onClick={() => setForm(null)}>
              ยกเลิกที่แก้
            </button>
          )}
          {code !== null && (
            <button type="button" className="danger" onClick={() => setAsk('delete')}>
              ลบ
            </button>
          )}
          {error && !error.field && (
            <span className="ferr" role="alert">
              {error.message}
              {error.status === 409 && (
                <button
                  type="button"
                  onClick={() => {
                    setForm(null);
                    setError(null);
                    void loaded.refetch();
                  }}
                >
                  โหลดข้อมูลล่าสุด
                </button>
              )}
            </span>
          )}
        </div>
      </form>
      {ask === 'save' && (
        <ConfirmDialog
          title={code === null ? 'ยืนยันเพิ่มอุปกรณ์' : `ยืนยันบันทึก ${code}`}
          confirmText={code === null ? 'เพิ่มอุปกรณ์' : 'ยืนยันบันทึก'}
          busy={save.isPending}
          onConfirm={() => save.mutate()}
          onCancel={() => setAsk(null)}
        >
          <table className="difftbl">
            <tbody>
              {code === null
                ? (Object.keys(LABEL) as (keyof Form)[])
                    .filter((k) => f[k] !== null && f[k] !== '')
                    .map((k) => (
                      <tr key={k}>
                        <th>{LABEL[k]}</th>
                        <td colSpan={2}>{shown(f[k])}</td>
                      </tr>
                    ))
                : (Object.keys(changes(base as Form, f)) as (keyof Form)[])
                    .filter((k) => (base as Form)[k] !== f[k])
                    .map((k) => (
                      <tr key={k}>
                        <th>{LABEL[k]}</th>
                        <td className="was">{shown((base as Form)[k])}</td>
                        <td className="now">{shown(f[k])}</td>
                      </tr>
                    ))}
            </tbody>
          </table>
          <p className="fhint">บันทึกพร้อมชื่อผู้แก้และ IP ในประวัติ</p>
        </ConfirmDialog>
      )}
      {ask === 'delete' && code !== null && (
        <ConfirmDialog
          title={`ลบ ${code}?`}
          confirmText="ลบอุปกรณ์"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setAsk(null)}
        >
          <p>เก็บประวัติไว้ และรหัสนี้จะไม่นำกลับมาใช้อีก</p>
        </ConfirmDialog>
      )}
      {code !== null && <History kind="device" code={code} />}
    </div>
  );
}
