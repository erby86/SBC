import { z } from 'zod';

/** One finding of the M07 registry completeness report. */
export const registryCheckItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  detail: z.string().nullable(),
});

export const registryCheckSchema = z.object({
  check: z.string(),
  severity: z.enum(['error', 'warning']),
  title: z.string(),
  count: z.number().int().nonnegative(),
  items: z.array(registryCheckItemSchema),
});

export const registryCheckReportSchema = z.object({
  generatedAt: z.string(),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  checks: z.array(registryCheckSchema),
});

export type RegistryCheckItem = z.infer<typeof registryCheckItemSchema>;
export type RegistryCheck = z.infer<typeof registryCheckSchema>;
export type RegistryCheckReport = z.infer<typeof registryCheckReportSchema>;
