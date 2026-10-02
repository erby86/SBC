import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMigrations, MIGRATIONS_DIR } from './migrate.js';

async function dirWith(files: Record<string, string>): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), 'mig-'));
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
  return pathToFileURL(dir + '/');
}

describe('loadMigrations', () => {
  it('loads files in version order with checksums', async () => {
    const dir = await dirWith({ '0002_b.sql': 'SELECT 2;', '0001_a.sql': 'SELECT 1;' });
    const migrations = await loadMigrations(dir);
    expect(migrations.map((m) => m.version)).toEqual(['0001', '0002']);
    expect(migrations[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects badly named files', async () => {
    const dir = await dirWith({ 'init.sql': 'SELECT 1;' });
    await expect(loadMigrations(dir)).rejects.toThrow('Bad migration file name');
  });

  it('rejects duplicate versions', async () => {
    const dir = await dirWith({ '0001_a.sql': 'SELECT 1;', '0001_b.sql': 'SELECT 2;' });
    await expect(loadMigrations(dir)).rejects.toThrow('Duplicate');
  });

  it('ships schema v1.1 as the first migration', async () => {
    const migrations = await loadMigrations(MIGRATIONS_DIR);
    expect(migrations[0]?.name).toBe('schema_v1_1');
    expect(migrations[0]?.sql).toContain('CREATE SEQUENCE core.loc_code_seq START WITH 188');
  });
});
