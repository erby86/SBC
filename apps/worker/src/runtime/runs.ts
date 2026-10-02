import type { DbPool } from '@sbc-noc/db';
import type { JobDefinition, JobResult, SyncIssue } from '../jobs/types.js';

/**
 * Runs one attempt of a job and records it in sync.runs (one row per attempt), with any
 * issues the job reports in sync.issues. Re-throws the job's error so the queue can retry.
 */
export async function recordRun(
  db: DbPool,
  job: JobDefinition,
  attempt: number,
): Promise<JobResult> {
  const started = await db.query<{ id: string }>(
    `INSERT INTO sync.runs (system_code, job, detail) VALUES ($1, $2, $3) RETURNING id`,
    [job.systemCode, job.name, { attempt }],
  );
  const runId = started.rows[0]?.id;
  let issues = 0;
  const issue = async (i: SyncIssue): Promise<void> => {
    issues += 1;
    await db.query(
      `INSERT INTO sync.issues (run_id, system_code, kind, external_id, entity_table, entity_id, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        runId,
        job.systemCode,
        i.kind,
        i.externalId ?? null,
        i.entityTable ?? null,
        i.entityId ?? null,
        i.message,
      ],
    );
  };

  try {
    const result = await job.run({ db, attempt, issue });
    await db.query(
      `UPDATE sync.runs SET finished_at = now(), status = 'success', created_n = $2, updated_n = $3,
         error_n = $4, detail = $5 WHERE id = $1`,
      [
        runId,
        result.created ?? 0,
        result.updated ?? 0,
        result.errors ?? 0,
        { attempt, issues, ...(result.detail ?? {}) },
      ],
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE sync.runs SET finished_at = now(), status = 'failed', error_n = error_n + 1, detail = $2
       WHERE id = $1`,
      [runId, { attempt, issues, error: message }],
    );
    throw err;
  }
}
