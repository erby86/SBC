import type { DbPool } from '@sbc-noc/db';

export interface SyncIssue {
  kind: string; // unmatched_host, ip_conflict, loc_conflict, missing_uplink, ... (schema v1.1 sync.issues)
  message: string;
  externalId?: string;
  entityTable?: string;
  entityId?: string;
}

export interface JobContext {
  db: DbPool;
  /** 1-based attempt number (BullMQ retries). */
  attempt: number;
  /** Opens a row in sync.issues linked to this run. */
  issue(issue: SyncIssue): Promise<void>;
}

export interface JobResult {
  created?: number;
  updated?: number;
  errors?: number;
  detail?: Record<string, unknown>;
}

export interface JobDefinition {
  /** Queue job name, also stored in sync.runs.job. */
  name: string;
  /** core.source_systems.code this job syncs with (noc for internal jobs). */
  systemCode: string;
  /** Repeat schedule: fixed interval in ms or a cron pattern (Asia/Bangkok). */
  schedule: { every: number } | { pattern: string };
  attempts: number;
  run(ctx: JobContext): Promise<JobResult>;
}
