// M21 registry editor contract (ADR-0020): what the back office reads to edit, and what it sends.
// Every change carries the row_version it was based on; a stale one is refused (HTTP 409).
import { z } from 'zod';

export const DEVICE_CODE_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const MAC_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
export const LIFECYCLES = ['planned', 'active', 'spare', 'retired'] as const;
export const DATA_STATUSES = ['unverified', 'verified'] as const;
export const LOCATION_SIDES = ['north', 'south', 'east', 'west', 'inner', 'outer'] as const;

/** Who is editing (no login before M23): a staff code or name typed in the back office. */
export const editorSchema = z
  .string()
  .trim()
  .regex(/^[\p{L}\p{N} ._-]{2,40}$/u, 'ใส่ชื่อหรือรหัสผู้แก้ 2–40 ตัวอักษร');

const place = {
  /** Room (LOC). When set, building/floor follow the room. */
  locCode: z
    .string()
    .regex(/^LOC-\d{3,}$/)
    .nullable(),
  building: z.string().nullable(),
  floor: z.number().int().min(0).max(30).nullable(),
};

export const deviceEditSchema = z.object({
  code: z.string(),
  name: z.string(),
  hostname: z.string().nullable(),
  role: z.string(),
  model: z.string().nullable(),
  ...place,
  ip: z.string().nullable(),
  mac: z.string().nullable(),
  uplink: z.string().nullable(),
  uplinkMedia: z.string().nullable(),
  lifecycle: z.enum(LIFECYCLES),
  dataStatus: z.enum([...DATA_STATUSES, 'sample']),
  managedBy: z.string().nullable(),
  rowVersion: z.number().int(),
});
export type DeviceEdit = z.infer<typeof deviceEditSchema>;

const deviceFields = {
  name: z.string().trim().min(1).max(120),
  hostname: z.string().trim().max(120).nullable(),
  role: z.string(),
  model: z.string().trim().max(120).nullable(),
  ...place,
  ip: z.ipv4().nullable(),
  mac: z.string().toLowerCase().regex(MAC_RE, 'MAC เช่น aa:bb:cc:dd:ee:ff').nullable(),
  uplink: z.string().nullable(),
  uplinkMedia: z.string().nullable(),
  lifecycle: z.enum(LIFECYCLES),
  dataStatus: z.enum(DATA_STATUSES),
};

export const devicePatchSchema = z
  .object({ rowVersion: z.number().int(), ...deviceFields })
  .partial()
  .required({ rowVersion: true });
export type DevicePatch = z.infer<typeof devicePatchSchema>;

export const deviceCreateSchema = z.object({
  code: z.string().regex(DEVICE_CODE_RE, 'รหัส a-z 0-9 และ - (2–41 ตัว)'),
  ...deviceFields,
  hostname: deviceFields.hostname.default(null),
  model: deviceFields.model.default(null),
  ip: deviceFields.ip.default(null),
  mac: deviceFields.mac.default(null),
  uplink: deviceFields.uplink.default(null),
  uplinkMedia: deviceFields.uplinkMedia.default(null),
  lifecycle: deviceFields.lifecycle.default('active'),
  dataStatus: deviceFields.dataStatus.default('unverified'),
});
export type DeviceCreate = z.infer<typeof deviceCreateSchema>;

export const locationEditSchema = z.object({
  locCode: z.string(),
  building: z.string(),
  floor: z.number().int(),
  name: z.string(),
  roomNumber: z.string().nullable(),
  type: z.string().nullable(),
  corridorOrder: z.number().int().nullable(),
  side: z.enum(LOCATION_SIDES).nullable(),
  hasRack: z.boolean(),
  owner: z.string(),
  rowVersion: z.number().int(),
});
export type LocationEdit = z.infer<typeof locationEditSchema>;

const locationFields = {
  building: z.string(),
  floor: z.number().int().min(0).max(30),
  name: z.string().trim().min(1).max(120),
  roomNumber: z.string().trim().max(20).nullable(),
  type: z.string().nullable(),
  corridorOrder: z.number().int().min(0).max(999).nullable(),
  side: z.enum(LOCATION_SIDES).nullable(),
  hasRack: z.boolean(),
};

export const locationPatchSchema = z
  .object({ rowVersion: z.number().int(), ...locationFields })
  .partial()
  .required({ rowVersion: true });
export type LocationPatch = z.infer<typeof locationPatchSchema>;

/** New room: the LOC number is issued by the database (ADR-0001). */
export const locationCreateSchema = z.object({
  ...locationFields,
  roomNumber: locationFields.roomNumber.default(null),
  type: locationFields.type.default(null),
  corridorOrder: locationFields.corridorOrder.default(null),
  side: locationFields.side.default(null),
  hasRack: locationFields.hasRack.default(false),
});
export type LocationCreate = z.infer<typeof locationCreateSchema>;

/** An AP a controller reports but the import could not place (sync.issues unplaced_ap). */
export const unplacedApSchema = z.object({
  system: z.string(),
  mac: z.string(),
  name: z.string(),
  ip: z.string().nullable(),
  message: z.string(),
  since: z.string(),
});
export type UnplacedAp = z.infer<typeof unplacedApSchema>;

export const placeApSchema = z.object({
  ...place,
  /** Number on the floor for the code ap-<building>-<floor>-<no>; next free one when omitted. */
  no: z.number().int().min(1).max(999).nullable().default(null),
});
export type PlaceAp = z.infer<typeof placeApSchema>;

export const historyEntrySchema = z.object({
  at: z.string(),
  actor: z.string(),
  op: z.string(),
  changes: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const editOptionsSchema = z.object({
  roles: z.array(z.object({ code: z.string(), name: z.string(), layer: z.string() })),
  media: z.array(z.object({ code: z.string(), name: z.string() })),
  locationTypes: z.array(z.object({ code: z.string(), name: z.string() })),
  buildings: z.array(
    z.object({ code: z.string(), name: z.string(), floors: z.array(z.number().int()) }),
  ),
  models: z.array(z.string()),
});
export type EditOptions = z.infer<typeof editOptionsSchema>;

export const editErrorSchema = z.object({
  message: z.string(),
  field: z.string().optional(),
});
