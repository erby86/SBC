import pg from 'pg';

// Schema lives in ../migrations (schema v1.1, design v1.2); applied by migrate-cli.

export type DbPool = pg.Pool;

export function createDbPool(connectionString: string): DbPool {
  return new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000 });
}

/** Round-trips `SELECT 1`; throws if the database is unreachable. */
export async function pingDatabase(pool: DbPool): Promise<void> {
  await pool.query('SELECT 1');
}

export { loadMigrations, migrate, MIGRATIONS_DIR } from './migrate.js';
export type { Migration, MigrateResult } from './migrate.js';
export { CHECKS, runRegistryChecks } from './checks.js';
export { importSeed } from './seed/import.js';
export { readSeedFiles } from './seed/files.js';
export { parseCsv } from './seed/csv.js';
export {
  getBuilding,
  getDevice,
  getLayout,
  getLocation,
  listAreas,
  listBuildings,
  listCables,
  listDevices,
  listLinks,
  listLocations,
  search,
} from './registry/read.js';
export type { DeviceFilter, LocationFilter } from './registry/read.js';
export {
  createDevice,
  createLocation,
  deleteDevice,
  getDeviceEdit,
  getEditOptions,
  getHistory,
  getLocationEdit,
  listUnplacedAps,
  placeUnplacedAp,
  RegistryEditError,
  updateDevice,
  updateLocation,
} from './registry/write.js';
