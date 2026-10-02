// Entry point: node node_modules/@sbc-noc/db/dist/migrate-cli.js  (or `pnpm --filter @sbc-noc/db migrate`)
// ADR-0015: on prod, back up the database before running this.
import { createDbPool } from './index.js';
import { loadMigrations, migrate } from './migrate.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = createDbPool(url);
try {
  const result = await migrate(pool, await loadMigrations(), (msg) => console.info(msg));
  console.info(
    `migrations done: applied ${result.applied.length}, already applied ${result.skipped.length}`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
