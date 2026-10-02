import type { JobDefinition } from './types.js';

/**
 * Example job for M09: snapshots registry counts into sync.runs.detail every 5 minutes.
 * Real sync jobs (M05 SBC ASSET, M06 controllers, M08 Zabbix tags) follow the same shape.
 */
export const registryStats: JobDefinition = {
  name: 'registry-stats',
  systemCode: 'noc',
  schedule: { every: 5 * 60_000 },
  attempts: 3,
  async run({ db }) {
    const { rows } = await db.query<{ locations: number; devices: number; unplaced: number }>(
      `SELECT (SELECT count(*) FROM core.locations WHERE deleted_at IS NULL)::int AS locations,
              (SELECT count(*) FROM net.devices WHERE deleted_at IS NULL)::int AS devices,
              (SELECT count(*) FROM net.devices WHERE deleted_at IS NULL
                 AND location_id IS NULL AND floor_id IS NULL AND role_code NOT IN ('wan','controller'))::int AS unplaced`,
    );
    return { detail: { ...rows[0] } };
  },
};

export const jobs: JobDefinition[] = [registryStats];
