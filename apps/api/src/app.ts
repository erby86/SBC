import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import {
  healthResponseSchema,
  registryCheckReportSchema,
  type RegistryCheckReport,
} from '@sbc-noc/shared';
import { z } from 'zod';
import { registerMetrics } from './metrics.js';
import { readVersion } from './version.js';

/** A dependency probe for /health/ready; rejects when the dependency is down. */
export type ReadinessCheck = () => Promise<unknown>;

export interface AppDeps {
  checks?: Record<string, ReadinessCheck>;
  checkTimeoutMs?: number;
  /** M07 registry completeness report (read-only). Route is registered only when provided. */
  registryChecks?: () => Promise<RegistryCheckReport>;
}

const readinessSchema = z.object({
  status: z.enum(['ok', 'error']),
  version: z.string(),
  checks: z.record(z.string(), z.enum(['ok', 'error'])),
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Builds the API (M13): zod schemas validate requests and serialise responses, and the same
 * schemas produce the OpenAPI document at /docs (served to browsers as /api/docs/ by the web nginx).
 */
export async function buildApp(
  options: FastifyServerOptions = {},
  deps: AppDeps = {},
): Promise<FastifyInstance> {
  const app = Fastify(options).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const version = readVersion();
  const checks = deps.checks ?? {};
  const timeoutMs = deps.checkTimeoutMs ?? 2000;

  await app.register(fastifySwagger, {
    openapi: {
      info: { title: 'sbc-noc API', description: 'NOC ผังเครือข่าย SB School', version },
      // Browsers reach the api through the web nginx under /api (apps/web/nginx.conf.template).
      servers: [{ url: '/api' }],
      tags: [
        { name: 'ops', description: 'สถานะของระบบ' },
        { name: 'registry', description: 'ทะเบียนอุปกรณ์และพื้นที่' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  registerMetrics(app);

  // Liveness: the process is up. Never touches dependencies.
  app.get(
    '/health',
    { schema: { tags: ['ops'], summary: 'ทำงานอยู่', response: { 200: healthResponseSchema } } },
    async () => ({ status: 'ok' as const, version }),
  );

  // Readiness: every dependency answers (PostgreSQL, Redis).
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['ops'],
        summary: 'พร้อมให้บริการ (ฐานข้อมูล, Redis)',
        response: { 200: readinessSchema, 503: readinessSchema },
      },
    },
    async (_req, reply) => {
      const results: Record<string, 'ok' | 'error'> = {};
      await Promise.all(
        Object.entries(checks).map(async ([name, check]) => {
          try {
            await withTimeout(check(), timeoutMs);
            results[name] = 'ok';
          } catch (err) {
            app.log.warn({ check: name, err }, 'readiness check failed');
            results[name] = 'error';
          }
        }),
      );
      const ok = Object.values(results).every((s) => s === 'ok');
      return reply
        .code(ok ? 200 : 503)
        .send({ status: ok ? 'ok' : 'error', version, checks: results });
    },
  );

  const registryChecks = deps.registryChecks;
  if (registryChecks) {
    app.get(
      '/registry/checks',
      {
        schema: {
          tags: ['registry'],
          summary: 'รายงานตรวจความครบของทะเบียน (M07)',
          response: { 200: registryCheckReportSchema },
        },
      },
      async () => registryChecks(),
    );
  }

  return app;
}
