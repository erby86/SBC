// M21 registry editor endpoints (ADR-0020). Registered only with REGISTRY_EDIT=true — dev until
// login (M23) exists. Writes need the X-Noc-Editor header (who is editing); the actor stored in the
// audit trail is "web:<editor>@<client ip>".
import { RegistryEditError } from '@sbc-noc/db';
import {
  deviceCreateSchema,
  deviceEditSchema,
  devicePatchSchema,
  editErrorSchema,
  editOptionsSchema,
  editorSchema,
  historyEntrySchema,
  locationCreateSchema,
  locationEditSchema,
  locationPatchSchema,
  placeApSchema,
  unplacedApSchema,
  type DeviceCreate,
  type DeviceEdit,
  type DevicePatch,
  type EditOptions,
  type HistoryEntry,
  type LocationCreate,
  type LocationEdit,
  type LocationPatch,
  type PlaceAp,
  type UnplacedAp,
} from '@sbc-noc/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export interface RegistryEditor {
  options(): Promise<EditOptions>;
  device(code: string): Promise<DeviceEdit | null>;
  updateDevice(code: string, patch: DevicePatch, actor: string): Promise<DeviceEdit>;
  createDevice(input: DeviceCreate, actor: string): Promise<DeviceEdit>;
  deleteDevice(code: string, rowVersion: number, actor: string): Promise<void>;
  location(locCode: string): Promise<LocationEdit | null>;
  updateLocation(locCode: string, patch: LocationPatch, actor: string): Promise<LocationEdit>;
  createLocation(input: LocationCreate, actor: string): Promise<LocationEdit>;
  unplaced(): Promise<UnplacedAp[]>;
  placeAp(system: string, mac: string, where: PlaceAp, actor: string): Promise<DeviceEdit>;
  history(kind: 'device' | 'location', code: string): Promise<HistoryEntry[]>;
}

const errors = { 400: editErrorSchema, 404: editErrorSchema, 409: editErrorSchema };
const tags = ['registry-edit'];

function actorOf(req: FastifyRequest): string {
  let raw = String(req.headers['x-noc-editor'] ?? '');
  try {
    raw = decodeURIComponent(raw); // the web client encodes Thai names for the header
  } catch {
    // keep as sent
  }
  const editor = editorSchema.safeParse(raw);
  if (!editor.success) {
    throw new RegistryEditError(
      'invalid',
      'ใส่ชื่อผู้แก้ก่อนบันทึก (ยังไม่มีระบบเข้าสู่ระบบ)',
      'editor',
    );
  }
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    ?.trim();
  return `web:${editor.data}@${forwarded || req.ip}`;
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof RegistryEditError) {
    const code = err.kind === 'not_found' ? 404 : err.kind === 'conflict' ? 409 : 400;
    return reply
      .code(code)
      .send({ message: err.message, ...(err.field ? { field: err.field } : {}) });
  }
  throw err;
}

export function registryEditRoutes(app: FastifyInstance, ed: RegistryEditor): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const run = async <T>(reply: FastifyReply, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      return sendError(reply, err);
    }
  };

  r.get(
    '/registry/edit/options',
    {
      schema: {
        tags,
        summary: 'ตัวเลือกในฟอร์ม: บทบาท ชนิดสาย ประเภทห้อง อาคาร/ชั้น รุ่น',
        response: { 200: editOptionsSchema },
      },
    },
    async () => ed.options(),
  );

  const codeParam = z.object({ code: z.string() });
  r.get(
    '/registry/edit/devices/:code',
    {
      schema: {
        tags,
        summary: 'อุปกรณ์สำหรับแก้ (มี rowVersion)',
        params: codeParam,
        response: { 200: deviceEditSchema, ...errors },
      },
    },
    async (req, reply) =>
      (await ed.device(req.params.code)) ??
      reply.code(404).send({ message: `ไม่พบอุปกรณ์ ${req.params.code}` }),
  );
  r.patch(
    '/registry/edit/devices/:code',
    {
      schema: {
        tags,
        summary: 'แก้อุปกรณ์ (ส่งเฉพาะช่องที่เปลี่ยน + rowVersion)',
        params: codeParam,
        body: devicePatchSchema,
        response: { 200: deviceEditSchema, ...errors },
      },
    },
    async (req, reply) =>
      run(reply, () => ed.updateDevice(req.params.code, req.body, actorOf(req))),
  );
  r.post(
    '/registry/edit/devices',
    {
      schema: {
        tags,
        summary: 'เพิ่มอุปกรณ์',
        body: deviceCreateSchema,
        response: { 201: deviceEditSchema, ...errors },
      },
    },
    async (req, reply) =>
      run(reply, async () => reply.code(201).send(await ed.createDevice(req.body, actorOf(req)))),
  );
  r.delete(
    '/registry/edit/devices/:code',
    {
      schema: {
        tags,
        summary: 'ลบอุปกรณ์ (เก็บประวัติ รหัสไม่นำกลับมาใช้)',
        params: codeParam,
        querystring: z.object({ rowVersion: z.coerce.number().int() }),
        response: { 204: z.null(), ...errors },
      },
    },
    async (req, reply) =>
      run(reply, async () => {
        await ed.deleteDevice(req.params.code, req.query.rowVersion, actorOf(req));
        return reply.code(204).send(null);
      }),
  );

  const locParam = z.object({ locCode: z.string() });
  r.get(
    '/registry/edit/locations/:locCode',
    {
      schema: {
        tags,
        summary: 'ห้องสำหรับแก้',
        params: locParam,
        response: { 200: locationEditSchema, ...errors },
      },
    },
    async (req, reply) =>
      (await ed.location(req.params.locCode.toUpperCase())) ??
      reply.code(404).send({ message: `ไม่พบห้อง ${req.params.locCode}` }),
  );
  r.patch(
    '/registry/edit/locations/:locCode',
    {
      schema: {
        tags,
        summary: 'แก้ห้อง',
        params: locParam,
        body: locationPatchSchema,
        response: { 200: locationEditSchema, ...errors },
      },
    },
    async (req, reply) =>
      run(reply, () => ed.updateLocation(req.params.locCode.toUpperCase(), req.body, actorOf(req))),
  );
  r.post(
    '/registry/edit/locations',
    {
      schema: {
        tags,
        summary: 'เพิ่มห้อง (ออกเลข LOC ให้)',
        body: locationCreateSchema,
        response: { 201: locationEditSchema, ...errors },
      },
    },
    async (req, reply) =>
      run(reply, async () => reply.code(201).send(await ed.createLocation(req.body, actorOf(req)))),
  );

  r.get(
    '/registry/edit/unplaced',
    {
      schema: {
        tags,
        summary: 'AP ที่ controller รายงานแต่ยังไม่มีตำแหน่ง',
        response: { 200: z.array(unplacedApSchema) },
      },
    },
    async () => ed.unplaced(),
  );
  r.post(
    '/registry/edit/unplaced/:system/:mac',
    {
      schema: {
        tags,
        summary: 'กำหนดชั้น/ห้องให้ AP ที่ยังไม่มีตำแหน่ง',
        params: z.object({ system: z.string(), mac: z.string() }),
        body: placeApSchema,
        response: { 201: deviceEditSchema, ...errors },
      },
    },
    async (req, reply) =>
      run(reply, async () =>
        reply
          .code(201)
          .send(
            await ed.placeAp(
              req.params.system,
              req.params.mac.toLowerCase(),
              req.body,
              actorOf(req),
            ),
          ),
      ),
  );

  r.get(
    '/registry/edit/history/:kind/:code',
    {
      schema: {
        tags,
        summary: 'ประวัติการแก้',
        params: z.object({ kind: z.enum(['device', 'location']), code: z.string() }),
        response: { 200: z.array(historyEntrySchema) },
      },
    },
    async (req) => ed.history(req.params.kind, req.params.code),
  );
}
