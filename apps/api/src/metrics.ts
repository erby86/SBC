// Prometheus metrics at /metrics (M13, self-monitoring ADR-0010): process defaults plus one
// histogram of request durations per route. Not in the OpenAPI document.
import type { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

export function registerMetrics(app: FastifyInstance): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'noc_api_' });
  const duration = new Histogram({
    name: 'noc_api_http_request_duration_seconds',
    help: 'HTTP request duration by route and status',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  app.addHook('onResponse', async (req, reply) => {
    // Route pattern, not the raw URL, so labels stay bounded; unknown paths share one label.
    const route = req.routeOptions.url ?? 'unmatched';
    if (route === '/metrics') return;
    duration.observe(
      { method: req.method, route, status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });

  app.get('/metrics', { schema: { hide: true } }, async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  return registry;
}
