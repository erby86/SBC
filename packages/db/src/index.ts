import pg from 'pg';

// Schema and migrations arrive in M03 (sbc-noc-schema-design-v1.2).

export type DbPool = pg.Pool;

export function createDbPool(connectionString: string): DbPool {
  return new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000 });
}

/** Round-trips `SELECT 1`; throws if the database is unreachable. */
export async function pingDatabase(pool: DbPool): Promise<void> {
  await pool.query('SELECT 1');
}
