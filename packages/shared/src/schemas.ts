import { z } from 'zod';
import { BUILDING_CODES } from './buildings.js';

const BUILDING_SET: ReadonlySet<string> = new Set(BUILDING_CODES);
const isBuilding = (code: string | undefined): boolean =>
  code !== undefined && BUILDING_SET.has(code.toLowerCase());

/** LAN outlet label `<อาคาร>-<ชั้น>-<เลขห้อง>-<NN>`, e.g. `B2-3-2310-05` (ADR-0006, net.outlets.code). */
export const outletCodeSchema = z
  .string()
  .regex(/^([A-Z0-9]{2})-(\d{1,2})-([A-Z0-9]+)-(\d{2})$/, 'invalid LAN outlet label')
  .refine((value) => isBuilding(value.split('-')[0]), { message: 'unknown building code' });

/** Rack label `RK-<อาคาร>-<ห้อง>-<NN>`, e.g. `RK-B2-SRV-01` (ADR-0006, net.racks.code). */
export const rackCodeSchema = z
  .string()
  .regex(/^RK-([A-Z0-9]{2})-([A-Z0-9]+)-(\d{2})$/, 'invalid rack label')
  .refine((value) => isBuilding(value.split('-')[1]), { message: 'unknown building code' });

/** Cable label: fiber `FO-<a>-<b>-<NN>` or inter-building copper `CU-...` (ADR-0006, net.cables.code). */
export const cableCodeSchema = z
  .string()
  .regex(/^(FO|CU)-([A-Z0-9]+)-([A-Z0-9]+)-(\d{2})$/, 'invalid cable label');

/** Location code issued by core.next_loc_code(): LOC-001..186 from SBC ASSET, 187 = server room (ADR-0001). */
export const locCodeSchema = z.string().regex(/^LOC-\d{3,}$/, 'invalid LOC code');

export type OutletCode = z.infer<typeof outletCodeSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
