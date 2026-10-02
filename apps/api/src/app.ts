import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { HealthResponse } from '@sbc-noc/shared';
import { readVersion } from './version.js';

/** A dependency probe for /health/ready; rejects when the dependency is down. */
export type ReadinessCheck = () => Promise<unknown>;

export interface AppDeps {
  checks?: Record<string, ReadinessCheck>;
  checkTimeoutMs?: number;
}

type CheckStatus = 'ok' | 'error';

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

export function buildApp(options: FastifyServerOptions = {}, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify(options);
  const version = readVersion();
  const checks = deps.checks ?? {};
  const timeoutMs = deps.checkTimeoutMs ?? 2000;

  // Liveness: the process is up. Never touches dependencies.
  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok', version }));

  // Readiness: every dependency answers (PostgreSQL, Redis).
  app.get('/health/ready', async (_req, reply) => {
    const results: Record<string, CheckStatus> = {};
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
  });

  return app;
}
