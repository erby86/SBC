// Drizzle is used for typed queries only. The schema source of truth is the SQL in migrations/
// (ADR-0018); src/schema/ is regenerated from a migrated database with `pnpm db:pull`.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle-pull',
  schemaFilter: ['core', 'catalog', 'asset', 'net', 'viz', 'auth', 'ops', 'sync', 'audit', 'api'],
  dbCredentials: { url: process.env['DATABASE_URL'] ?? '' },
});
