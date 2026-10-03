// M14: read-only registry and 3D layout endpoints. Responses carry an ETag (@fastify/etag) so the
// 3D page re-downloads the layout only when the registry changed (If-None-Match → 304).
import {
  buildingDetailSchema,
  buildingSchema,
  cableSchema,
  deviceDetailSchema,
  deviceSchema,
  layoutSchema,
  linkSchema,
  locationSchema,
  searchResultSchema,
  type Building,
  type BuildingDetail,
  type Cable,
  type Device,
  type DeviceDetail,
  type Layout,
  type Link,
  type Location,
  type SearchHit,
} from '@sbc-noc/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

/** Data access for the routes; server.ts binds it to the database pool. */
export interface RegistryReader {
  layout(): Promise<Layout>;
  buildings(): Promise<Building[]>;
  building(code: string): Promise<BuildingDetail | null>;
  locations(f: { building?: string | undefined; floor?: number | undefined }): Promise<Location[]>;
  location(locCode: string): Promise<Location | null>;
  devices(f: {
    building?: string | undefined;
    floor?: number | undefined;
    role?: string | undefined;
    layer?: string | undefined;
  }): Promise<Device[]>;
  device(code: string): Promise<DeviceDetail | null>;
  links(): Promise<Link[]>;
  cables(): Promise<Cable[]>;
  search(q: string, limit: number): Promise<SearchHit[]>;
}

const notFound = z.object({ message: z.string() });
const tags = ['registry'];

export function registryRoutes(app: FastifyInstance, reader: RegistryReader): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/registry/layout',
    {
      schema: {
        tags,
        summary: 'ข้อมูลผัง 3D ทั้งหมดในครั้งเดียว (อาคาร พื้นที่ ห้อง อุปกรณ์ สาย)',
        response: { 200: layoutSchema },
      },
    },
    async () => reader.layout(),
  );

  r.get(
    '/registry/buildings',
    { schema: { tags, summary: 'อาคารทั้งหมด', response: { 200: z.array(buildingSchema) } } },
    async () => reader.buildings(),
  );

  r.get(
    '/registry/buildings/:code',
    {
      schema: {
        tags,
        summary: 'อาคาร + ชั้น (จำนวนห้อง/อุปกรณ์ต่อชั้น)',
        params: z.object({ code: z.string() }),
        response: { 200: buildingDetailSchema, 404: notFound },
      },
    },
    async (req, reply) =>
      (await reader.building(req.params.code)) ??
      reply.code(404).send({ message: `ไม่พบอาคาร ${req.params.code}` }),
  );

  r.get(
    '/registry/locations',
    {
      schema: {
        tags,
        summary: 'ห้อง/พื้นที่ (LOC) กรองตามอาคาร/ชั้นได้',
        querystring: z.object({
          building: z.string().optional(),
          floor: z.coerce.number().int().optional(),
        }),
        response: { 200: z.array(locationSchema) },
      },
    },
    async (req) => reader.locations(req.query),
  );

  r.get(
    '/registry/locations/:locCode',
    {
      schema: {
        tags,
        summary: 'ห้องเดียวตามรหัส LOC',
        params: z.object({ locCode: z.string() }),
        response: { 200: locationSchema, 404: notFound },
      },
    },
    async (req, reply) =>
      (await reader.location(req.params.locCode.toUpperCase())) ??
      reply.code(404).send({ message: `ไม่พบห้อง ${req.params.locCode}` }),
  );

  r.get(
    '/registry/devices',
    {
      schema: {
        tags,
        summary: 'อุปกรณ์เครือข่าย กรองตามอาคาร/ชั้น/บทบาท/ชั้นของเครือข่ายได้',
        querystring: z.object({
          building: z.string().optional(),
          floor: z.coerce.number().int().optional(),
          role: z.string().optional(),
          layer: z.string().optional(),
        }),
        response: { 200: z.array(deviceSchema) },
      },
    },
    async (req) => reader.devices(req.query),
  );

  r.get(
    '/registry/devices/:code',
    {
      schema: {
        tags,
        summary: 'รายละเอียดอุปกรณ์ + อุปกรณ์ที่ต่อลงไป + รหัสในระบบอื่น',
        params: z.object({ code: z.string() }),
        response: { 200: deviceDetailSchema, 404: notFound },
      },
    },
    async (req, reply) =>
      (await reader.device(req.params.code)) ??
      reply.code(404).send({ message: `ไม่พบอุปกรณ์ ${req.params.code}` }),
  );

  r.get(
    '/registry/links',
    {
      schema: {
        tags,
        summary: 'การเชื่อมต่อ (ต้นไม้ uplink)',
        response: { 200: z.array(linkSchema) },
      },
    },
    async () => reader.links(),
  );

  r.get(
    '/registry/cables',
    { schema: { tags, summary: 'สายจริง (ไฟเบอร์/LAN)', response: { 200: z.array(cableSchema) } } },
    async () => reader.cables(),
  );

  r.get(
    '/registry/search',
    {
      schema: {
        tags,
        summary: 'ค้นหาอาคาร ห้อง อุปกรณ์ (ชื่อ, LOC, เลขห้อง, IP, MAC)',
        querystring: z.object({
          q: z.string().max(100),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: searchResultSchema },
      },
    },
    async (req) => ({ q: req.query.q, hits: await reader.search(req.query.q, req.query.limit) }),
  );
}
