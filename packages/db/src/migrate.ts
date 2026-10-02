import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';

type DbPool = pg.Pool;

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/** Migrations shipped with this package (packages/db/migrations, also in the deployed package). */
export const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Arbitrary constant so only one migrator runs at a time (api, worker and CI may start together).
const LOCK_ID = 73_190_301;

export async function loadMigrations(dir: URL = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match?.[1] || !match[2]) throw new Error(`Bad migration file name: ${file}`);
    const sql = await readFile(new URL(file, dir), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    migrations.push({ version: match[1], name: match[2], sql, checksum });
  }
  const versions = migrations.map((m) => m.version);
  if (new Set(versions).size !== versions.length) throw new Error('Duplicate migration version');
  return migrations;
}

/**
 * Applies pending migrations in order, each in its own transaction.
 * Refuses to run if an already-applied file was edited (checksum mismatch) —
 * released migrations are immutable; add a new file instead.
 */
export async function migrate(
  pool: DbPool,
  migrations: Migration[],
  log: (message: string) => void = () => undefined,
): Promise<MigrateResult> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM public.schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));

    const result: MigrateResult = { applied: [], skipped: [] };
    for (const m of migrations) {
      const existing = applied.get(m.version);
      if (existing !== undefined) {
        if (existing !== m.checksum) {
          throw new Error(`Migration ${m.version}_${m.name} was modified after it was applied`);
        }
        result.skipped.push(m.version);
        continue;
      }
      log(`applying ${m.version}_${m.name}`);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [m.version, m.name, m.checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${m.version}_${m.name} failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      result.applied.push(m.version);
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
