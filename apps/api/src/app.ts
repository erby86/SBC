import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { HealthResponse } from '@sbc-noc/shared';
import { readVersion } from './version.js';

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);
  const version = readVersion();

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok', version }));

  return app;
}
