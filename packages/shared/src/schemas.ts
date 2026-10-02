import { z } from 'zod';
import { BUILDING_CODES } from './buildings.js';

/**
 * LAN outlet label: `<building>-<floor>-<room>-<NN>` (ADR-0006).
 * Example schema for M01; real domain schemas arrive with their modules.
 */
export const lanPointLabelSchema = z
  .string()
  .regex(/^([a-z0-9]{2})-(\d{1,2})-([a-z0-9]+)-(\d{2})$/, 'invalid LAN point label')
  .refine((value) => (BUILDING_CODES as readonly string[]).includes(value.slice(0, 2)), {
    message: 'unknown building code',
  });

export type LanPointLabel = z.infer<typeof lanPointLabelSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
