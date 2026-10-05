import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import type { SelfMonSource } from './metrics.js';

const NOW = new Date('2026-10-05T03:00:00Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();

const healthy = (): SelfMonSource => ({
  heartbeat: async () => ago(20),
  queue: async () => ({
    at: ago(20),
    counts: { wait: 1, active: 1, delayed: 4, failed: 2 },
    oldestWaitingAt: ago(45),
  }),
  snapshotAt: async () => ago(12),
  syncJobs: async () => [
    {
      job: 'unifi-aps',
      lastFailed: true,
      failedSinceSuccess: 3,
      lastSuccessAgeSeconds: 7200,
      runningSeconds: null,
    },
    {
      job: 'registry-stats',
      lastFailed: false,
      failedSinceSuccess: 0,
      lastSuccessAgeSeconds: 60,
      runningSeconds: 5,
    },
    {
      job: 'new-job',
      lastFailed: false,
      failedSinceSuccess: 0,
      lastSuccessAgeSeconds: null,
      runningSeconds: null,
    },
  ],
});

async function scrape(selfmon: SelfMonSource): Promise<string> {
  const app = await buildApp({}, { selfmon });
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  await app.close();
  expect(res.statusCode).toBe(200);
  return res.body;
}

describe('self-monitoring metrics (M35)', () => {
  afterEach(() => vi.useRealTimers());

  it('reports worker, queue, snapshot and per-job sync health', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const body = await scrape(healthy());
    expect(body).toContain('noc_selfmon_source_up{source="redis"} 1');
    expect(body).toContain('noc_selfmon_source_up{source="db"} 1');
    expect(body).toContain('noc_worker_up 1');
    expect(body).toContain('noc_worker_heartbeat_age_seconds 20');
    expect(body).toContain('noc_queue_jobs{state="delayed"} 4');
    expect(body).toContain('noc_queue_jobs{state="failed"} 2');
    expect(body).toContain('noc_queue_oldest_waiting_seconds 45');
    expect(body).toContain('noc_status_snapshot_age_seconds 12');
    expect(body).toContain('noc_sync_job_last_failed{job="unifi-aps"} 1');
    expect(body).toContain('noc_sync_job_failed_attempts{job="unifi-aps"} 3');
    expect(body).toContain('noc_sync_job_last_success_age_seconds{job="unifi-aps"} 7200');
    expect(body).toContain('noc_sync_job_last_failed{job="registry-stats"} 0');
    expect(body).toContain('noc_sync_job_running_seconds{job="registry-stats"} 5');
    expect(body).toContain('noc_sync_job_running_seconds{job="unifi-aps"} 0');
    // never succeeded in the window: no age sample rather than a fake one
    expect(body).not.toContain('noc_sync_job_last_success_age_seconds{job="new-job"}');
  });

  it('marks the worker down when its heartbeat is missing or old', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    expect(await scrape({ ...healthy(), heartbeat: async () => null })).toContain(
      'noc_worker_up 0',
    );
    const old = await scrape({ ...healthy(), heartbeat: async () => ago(120) });
    expect(old).toContain('noc_worker_up 0');
    expect(old).toContain('noc_worker_heartbeat_age_seconds 120');
  });

  it('still answers when Redis or the database cannot be read', async () => {
    const fail = async (): Promise<never> => {
      throw new Error('down');
    };
    const body = await scrape({ heartbeat: fail, queue: fail, snapshotAt: fail, syncJobs: fail });
    expect(body).toContain('noc_selfmon_source_up{source="redis"} 0');
    expect(body).toContain('noc_selfmon_source_up{source="db"} 0');
    expect(body).toContain('noc_worker_up 0');
    expect(body).not.toContain('noc_sync_job_last_failed{');
  });

  it('drops jobs that are no longer reported', async () => {
    let jobs = await healthy().syncJobs();
    const src = { ...healthy(), syncJobs: async () => jobs };
    const app = await buildApp({}, { selfmon: src });
    const first = await app.inject({ method: 'GET', url: '/metrics' });
    expect(first.body).toContain('job="unifi-aps"');
    jobs = jobs.filter((j) => j.job !== 'unifi-aps');
    const second = await app.inject({ method: 'GET', url: '/metrics' });
    expect(second.body).not.toContain('job="unifi-aps"');
    await app.close();
  });
});
