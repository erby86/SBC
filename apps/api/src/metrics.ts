// Prometheus metrics at /metrics (M13, self-monitoring ADR-0010): process defaults plus one
// histogram of request durations per route. Not in the OpenAPI document.
// M35: Zabbix scrapes /api/metrics every minute; the noc_worker_*, noc_queue_*, noc_sync_job_* and
// noc_status_* gauges below are refreshed on each scrape from Redis (worker) and sync.runs.
import type { WorkerQueueState } from '@sbc-noc/shared';
import type { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

/** One job's health from sync.runs (same shape as readSyncHealth in @sbc-noc/db). */
export interface SyncJobHealth {
  job: string;
  lastFailed: boolean;
  failedSinceSuccess: number;
  lastSuccessAgeSeconds: number | null;
  runningSeconds: number | null;
}

/** Where the self-monitoring gauges come from; each read may fail on its own. */
export interface SelfMonSource {
  /** ISO time of the last worker heartbeat (Redis, expires after 90 s); null when absent. */
  heartbeat(): Promise<string | null>;
  queue(): Promise<WorkerQueueState | null>;
  /** generatedAt of the latest status snapshot; null when there is none. */
  snapshotAt(): Promise<string | null>;
  syncJobs(): Promise<SyncJobHealth[]>;
}

/** A heartbeat older than this (seconds) counts as down; it is written every 30 s. */
const WORKER_DOWN_AFTER = 90;

export function registerMetrics(app: FastifyInstance, selfmon?: SelfMonSource): Registry {
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

  const refresh = selfmon ? selfMonGauges(registry, selfmon) : undefined;

  app.get('/metrics', { schema: { hide: true } }, async (_req, reply) => {
    if (refresh) await refresh();
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  return registry;
}

function selfMonGauges(registry: Registry, src: SelfMonSource): () => Promise<void> {
  const gauge = (name: string, help: string, labelNames: string[] = []) =>
    new Gauge({ name, help, labelNames, registers: [registry] });
  const sourceUp = gauge('noc_selfmon_source_up', 'Self-monitoring source readable (1/0)', [
    'source',
  ]);
  const workerUp = gauge('noc_worker_up', 'Worker heartbeat seen in the last 90 s (1/0)');
  const heartbeatAge = gauge(
    'noc_worker_heartbeat_age_seconds',
    'Age of the last worker heartbeat',
  );
  const queueJobs = gauge('noc_queue_jobs', 'Sync queue jobs by state', ['state']);
  const oldestWaiting = gauge(
    'noc_queue_oldest_waiting_seconds',
    'Age of the oldest job waiting in the sync queue (0 when none)',
  );
  const snapshotAge = gauge('noc_status_snapshot_age_seconds', 'Age of the latest status snapshot');
  const lastFailed = gauge(
    'noc_sync_job_last_failed',
    'Latest finished attempt of the job failed (1/0)',
    ['job'],
  );
  const failedAttempts = gauge(
    'noc_sync_job_failed_attempts',
    'Failed attempts of the job since its last success',
    ['job'],
  );
  const successAge = gauge(
    'noc_sync_job_last_success_age_seconds',
    'Seconds since the job last succeeded',
    ['job'],
  );
  const running = gauge(
    'noc_sync_job_running_seconds',
    'How long the job has been running (0 when idle)',
    ['job'],
  );

  const ageOf = (iso: string, now: number) => Math.max(0, (now - Date.parse(iso)) / 1000);

  return async () => {
    const now = Date.now();
    const [hb, queue, snap, jobs] = await Promise.allSettled([
      src.heartbeat(),
      src.queue(),
      src.snapshotAt(),
      src.syncJobs(),
    ]);
    for (const g of [heartbeatAge, queueJobs, oldestWaiting, snapshotAge]) g.reset();
    for (const g of [lastFailed, failedAttempts, successAge, running]) g.reset();

    const redisOk =
      hb.status === 'fulfilled' && queue.status === 'fulfilled' && snap.status === 'fulfilled';
    sourceUp.set({ source: 'redis' }, redisOk ? 1 : 0);
    sourceUp.set({ source: 'db' }, jobs.status === 'fulfilled' ? 1 : 0);

    // Unknown (Redis unreadable) counts as down: the NOC cannot show live data either way.
    const hbAge = hb.status === 'fulfilled' && hb.value ? ageOf(hb.value, now) : null;
    if (hbAge !== null) heartbeatAge.set(hbAge);
    workerUp.set(hbAge !== null && hbAge <= WORKER_DOWN_AFTER ? 1 : 0);

    if (queue.status === 'fulfilled' && queue.value) {
      for (const [state, n] of Object.entries(queue.value.counts)) queueJobs.set({ state }, n);
      oldestWaiting.set(queue.value.oldestWaitingAt ? ageOf(queue.value.oldestWaitingAt, now) : 0);
    }
    if (snap.status === 'fulfilled' && snap.value) snapshotAge.set(ageOf(snap.value, now));

    if (jobs.status === 'fulfilled') {
      for (const j of jobs.value) {
        const job = { job: j.job };
        lastFailed.set(job, j.lastFailed ? 1 : 0);
        failedAttempts.set(job, j.failedSinceSuccess);
        if (j.lastSuccessAgeSeconds !== null) successAge.set(job, j.lastSuccessAgeSeconds);
        running.set(job, j.runningSeconds ?? 0);
      }
    }
  };
}
