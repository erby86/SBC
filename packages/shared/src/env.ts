import { z } from 'zod';

/** Env shared by api and worker (ADR-0005: values come from .env outside the repo). */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  REDIS_PREFIX: z.string().min(1).default('noc:'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Parses env and throws one readable error listing every invalid key.
 * Values are never included in the message, so secrets do not leak into logs.
 */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined>,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path.join('.') || '(root)');
    throw new Error(`Invalid environment: ${[...new Set(keys)].join(', ')}`);
  }
  return result.data;
}
