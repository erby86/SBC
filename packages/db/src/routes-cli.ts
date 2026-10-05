// M19 entry point: node node_modules/@sbc-noc/db/dist/routes-cli.js <seed-dir>
// Writes the prototype device positions and cable bends (prototype-routes.json) where none are
// set yet. Touches only viz.device_placements and viz.link_routes. Safe to re-run.
import { createDbPool } from './index.js';
import { readPrototypeRoutes } from './seed/files.js';
import { applyPrototypeRoutes } from './seed/routes.js';

const dir = process.argv[2];
const url = process.env['DATABASE_URL'];
if (!dir || !url) {
  console.error('usage: DATABASE_URL=... routes-cli <seed-dir>');
  process.exit(1);
}

const pool = createDbPool(url);
const c = await pool.connect();
try {
  const data = await readPrototypeRoutes(dir);
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.actor', 'seed:M19', true)`);
  const r = await applyPrototypeRoutes(c, data);
  await c.query('COMMIT');
  console.info(`placements written ${r.placements} of ${data.placements.length}`);
  console.info(`routes written     ${r.routes} of ${data.routes.length}`);
  if (r.missing.length) console.info(`not in the registry: ${r.missing.join(', ')}`);
} catch (err) {
  await c.query('ROLLBACK').catch(() => undefined);
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
