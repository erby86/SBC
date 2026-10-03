// Read model of the registry and the 3D layout (M14). The api serialises with these schemas and
// the web client (M18–M20) parses with them, so both sides share one contract.
import { z } from 'zod';

const nullableStr = z.string().nullable();
const nullableInt = z.number().int().nullable();

export const shapeSchema = z.object({
  x: z.number(),
  z: z.number(),
  width: z.number(),
  depth: z.number(),
  rotation: z.number(),
});

export const floorSchema = z.object({
  level: z.number().int(),
  name: nullableStr,
  locations: z.number().int(),
  devices: z.number().int(),
});

export const buildingSchema = z.object({
  code: z.string(),
  name: z.string(),
  nameEn: nullableStr,
  aliases: z.array(z.string()),
  assetName: nullableStr,
  form: nullableStr,
  floorCount: z.number().int(),
  roomsPerFloor: nullableInt,
  hasNetwork: z.boolean(),
  shape: shapeSchema
    .extend({ floorHeight: z.number(), extra: z.record(z.string(), z.unknown()) })
    .nullable(),
});

export const buildingDetailSchema = buildingSchema.extend({ floors: z.array(floorSchema) });

export const areaSchema = shapeSchema.extend({
  code: z.string(),
  name: z.string(),
  kind: z.string(),
});

export const locationSchema = z.object({
  locCode: z.string(),
  building: z.string(),
  floor: z.number().int(),
  name: z.string(),
  roomNumber: nullableStr,
  type: nullableStr,
  corridorOrder: nullableInt,
  side: nullableStr,
  hasRack: z.boolean(),
  owner: z.string(),
  verifiedAt: nullableStr,
  /** PCs in the room per SBC ASSET (core.location_metrics registry_pc_count). */
  registryPcCount: nullableInt,
});

export const devicePlacementSchema = z.object({
  mode: z.string(),
  u: z.number().nullable(),
  v: z.number().nullable(),
  heightOffset: z.number(),
});

export const deviceSchema = z.object({
  code: z.string(),
  name: z.string(),
  hostname: nullableStr,
  role: z.string(),
  /** catalog.device_roles.layer: core, main, access, ap, nvr, wan, planned … */
  layer: z.string(),
  model: nullableStr,
  ip: nullableStr,
  mac: nullableStr,
  building: nullableStr,
  floor: nullableInt,
  locCode: nullableStr,
  uplink: nullableStr,
  uplinkMedia: nullableStr,
  managedBy: nullableStr,
  lifecycle: z.string(),
  dataStatus: z.string(),
  zabbixHostId: nullableStr,
  placement: devicePlacementSchema.nullable(),
});

export const deviceDetailSchema = deviceSchema.extend({
  firmware: nullableStr,
  rack: nullableStr,
  powerSource: nullableStr,
  assetTag: nullableStr,
  warrantyUntil: nullableStr,
  eolDate: nullableStr,
  verifiedAt: nullableStr,
  /** Devices whose uplink is this one. */
  downlinks: z.array(z.object({ code: z.string(), name: z.string(), layer: z.string() })),
  /** Other systems that know this device: zabbix hostid, unifi/omada MAC … */
  externalRefs: z.array(
    z.object({ system: z.string(), id: z.string(), key: nullableStr, lastSeenAt: nullableStr }),
  ),
});

export const linkSchema = z.object({
  code: nullableStr,
  a: z.string(),
  b: z.string(),
  media: z.string(),
  isUplink: z.boolean(),
  cable: nullableStr,
  cableCores: z.array(z.number().int()).nullable(),
  speedMbps: nullableInt,
  color: nullableStr,
  /** viz.link_routes: parallel lane of the cable run and hand-drawn bends [x, z] (M19). */
  lane: nullableInt,
  waypoints: z.array(z.tuple([z.number(), z.number()])),
});

export const cableSchema = z.object({
  code: z.string(),
  kind: z.string(),
  coreCount: nullableInt,
  lengthM: nullableInt,
  aLocCode: nullableStr,
  bLocCode: nullableStr,
  route: nullableStr,
  status: z.string(),
});

/** Everything the 3D page needs in one request (cache with ETag). */
export const layoutSchema = z.object({
  site: z.object({ code: z.string(), name: z.string(), timezone: z.string() }),
  buildings: z.array(buildingSchema),
  areas: z.array(areaSchema),
  locations: z.array(locationSchema),
  devices: z.array(deviceSchema),
  links: z.array(linkSchema),
  cables: z.array(cableSchema),
});

export const searchHitSchema = z.object({
  kind: z.enum(['building', 'location', 'device']),
  code: z.string(),
  label: z.string(),
  building: nullableStr,
  floor: nullableInt,
  /** Why it matched, e.g. "IP 192.168.1.1" or "LOC-031". */
  match: z.string(),
});

export const searchResultSchema = z.object({ q: z.string(), hits: z.array(searchHitSchema) });

export type Building = z.infer<typeof buildingSchema>;
export type BuildingDetail = z.infer<typeof buildingDetailSchema>;
export type Area = z.infer<typeof areaSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type DeviceDetail = z.infer<typeof deviceDetailSchema>;
export type Link = z.infer<typeof linkSchema>;
export type Cable = z.infer<typeof cableSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type SearchHit = z.infer<typeof searchHitSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
