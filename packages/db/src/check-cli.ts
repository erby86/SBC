// M07 entry point: node node_modules/@sbc-noc/db/dist/check-cli.js — prints the registry report,
// exits 1 while any error remains (G1 close condition).
import { runRegistryChecks } from './checks.js';
import { createDbPool } from './index.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = createDbPool(url);
try {
  const report = await runRegistryChecks(pool);
  for (const c of report.checks) {
    const mark = c.count === 0 ? 'ok   ' : c.severity === 'error' ? 'ERROR' : 'warn ';
    console.info(`${mark} ${String(c.count).padStart(4)}  ${c.check.padEnd(15)} ${c.title}`);
    for (const i of c.items.slice(0, 10))
      console.info(`             - ${i.code} ${i.name}${i.detail ? ` (${i.detail})` : ''}`);
    if (c.items.length > 10) console.info(`             … อีก ${c.items.length - 10} รายการ`);
  }
  console.info(`\nerrors ${report.errors}, warnings ${report.warnings}`);
  if (report.errors > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
