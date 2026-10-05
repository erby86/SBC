import type pg from 'pg';

/** Health of one scheduled job from sync.runs (M35, ADR-0010). Ages are in seconds. */
export interface SyncJobHealth {
  job: string;
  /** The latest finished attempt failed (interrupted runs are ignored). */
  lastFailed: boolean;
  /** Failed attempts since the last success (retries count one each). */
  failedSinceSuccess: number;
  /** null when no success in the window. */
  lastSuccessAgeSeconds: number | null;
  /** Age of the oldest attempt still marked running; null when none runs. */
  runningSeconds: number | null;
}

/** Jobs seen in the last 7 days; older jobs drop out (renamed or removed jobs stop alerting). */
export async function readSyncHealth(pool: pg.Pool): Promise<SyncJobHealth[]> {
  const { rows } = await pool.query<{
    job: string;
    last_status: string | null;
    failed_since_success: number;
    last_success_age: number | null;
    running_age: number | null;
  }>(
    `WITH recent AS (
       SELECT job, status, started_at, finished_at FROM sync.runs
        WHERE started_at > now() - interval '7 days'
     ), last_ok AS (
       SELECT job, max(started_at) AS at FROM recent WHERE status = 'success' GROUP BY job
     )
     SELECT r.job,
            (array_agg(r.status ORDER BY r.started_at DESC)
               FILTER (WHERE r.status IN ('success', 'failed')))[1] AS last_status,
            (count(*) FILTER (WHERE r.status = 'failed'
               AND r.started_at > coalesce(l.at, '-infinity')))::int AS failed_since_success,
            extract(epoch FROM now() - max(r.finished_at) FILTER (WHERE r.status = 'success'))::float8
              AS last_success_age,
            extract(epoch FROM now() - min(r.started_at) FILTER (WHERE r.status = 'running'))::float8
              AS running_age
       FROM recent r LEFT JOIN last_ok l USING (job)
      GROUP BY r.job, l.at
      ORDER BY r.job`,
  );
  return rows.map((r) => ({
    job: r.job,
    lastFailed: r.last_status === 'failed',
    failedSinceSuccess: r.failed_since_success,
    lastSuccessAgeSeconds: r.last_success_age,
    runningSeconds: r.running_age,
  }));
}
