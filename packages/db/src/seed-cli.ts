// M04 entry point: node node_modules/@sbc-noc/db/dist/seed-cli.js <seed-dir>
// Imports infra/seed into the database (run migrations first). Safe to re-run.
import { createDbPool } from './index.js';
import { importSeed } from './seed/import.js';
import { readSeedFiles } from './seed/files.js';

const dir = process.argv[2];
const url = process.env['DATABASE_URL'];
if (!dir || !url) {
  console.error('usage: DATABASE_URL=... seed-cli <seed-dir>');
  process.exit(1);
}

const pool = createDbPool(url);
try {
  const report = await importSeed(pool, await readSeedFiles(dir));
  let ok = true;
  for (const [table, expected] of Object.entries(report.expected)) {
    const actual = report.actual[table];
    const mark = actual === expected ? 'ok' : 'MISMATCH';
    if (actual !== expected) ok = false;
    console.info(
      `${table.padEnd(16)} expected ${String(expected).padStart(4)}  actual ${String(actual).padStart(4)}  ${mark}`,
    );
  }
  console.info(`rows written this run: ${report.written}`);
  if (!ok) {
    console.error('seed counts do not match the source files');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
