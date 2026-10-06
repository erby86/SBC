// M23 local accounts on PostgreSQL 16. Own database; runs only with TEST_DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccountError,
  createAccount,
  findLoginCandidate,
  getActiveUser,
  listAccounts,
  logUserAction,
  markLogin,
  setAccountActive,
  setAccountPassword,
  setAccountRoles,
} from './auth.js';
import { createDbPool, type DbPool } from './index.js';
import { loadMigrations, migrate } from './migrate.js';

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('M23 local accounts', () => {
  const dbName = `sbc_noc_auth_${Date.now()}`;
  let admin: DbPool;
  let pool: DbPool;

  beforeAll(async () => {
    admin = createDbPool(url ?? '');
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    const target = new URL(url ?? '');
    target.pathname = `/${dbName}`;
    pool = createDbPool(target.toString());
    await migrate(pool, await loadMigrations());
    await pool.query(`INSERT INTO core.staff (staff_code, full_name) VALUES ('STF-01', 'ผู้ดูแล')`);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  it('creates an account with roles and finds it case-insensitively', async () => {
    await createAccount(
      pool,
      {
        email: 'A.Admin@SB-School.ac.th',
        roles: ['admin'],
        staffCode: 'STF-01',
        passwordHash: 'h1',
      },
      'cli:test',
    );
    const c = await findLoginCandidate(pool, ' a.admin@sb-school.ac.th ');
    expect(c).toMatchObject({
      email: 'a.admin@sb-school.ac.th',
      label: 'STF-01',
      roles: ['admin'],
      active: true,
      passwordHash: 'h1',
    });
    expect(await findLoginCandidate(pool, 'nobody@sb-school.ac.th')).toBeNull();
    await expect(
      createAccount(
        pool,
        { email: 'a.admin@sb-school.ac.th', roles: [], passwordHash: 'x' },
        'cli',
      ),
    ).rejects.toThrow(AccountError);
    await expect(
      createAccount(
        pool,
        { email: 'b@sb-school.ac.th', roles: [], staffCode: 'STF-99', passwordHash: 'x' },
        'cli',
      ),
    ).rejects.toThrow('no staff STF-99');
  });

  it('changes password, roles and active state, and logs each change', async () => {
    await createAccount(
      pool,
      { email: 'op@sb-school.ac.th', roles: ['operator'], passwordHash: 'h2' },
      'cli:test',
    );
    const op = await findLoginCandidate(pool, 'op@sb-school.ac.th');
    expect(op?.label).toBe('op@sb-school.ac.th');

    await setAccountPassword(pool, 'op@sb-school.ac.th', 'h3', 'cli:test');
    await setAccountRoles(pool, 'op@sb-school.ac.th', ['operator', 'admin'], 'cli:test');
    expect(await findLoginCandidate(pool, 'op@sb-school.ac.th')).toMatchObject({
      passwordHash: 'h3',
      roles: ['admin', 'operator'],
    });

    expect(await getActiveUser(pool, op?.id ?? '')).not.toBeNull();
    await setAccountActive(pool, 'op@sb-school.ac.th', false, 'cli:test');
    expect(await getActiveUser(pool, op?.id ?? '')).toBeNull();

    const { rows } = await pool.query<{ action: string; target: string; by: string }>(
      `SELECT action, target, detail->>'by' AS by FROM audit.user_actions
       WHERE target = 'op@sb-school.ac.th' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      'account_create',
      'account_password',
      'account_roles',
      'account_disable',
    ]);
    expect(rows.every((r) => r.by === 'cli:test')).toBe(true);
    await expect(setAccountActive(pool, 'ghost@sb-school.ac.th', true, 'cli')).rejects.toThrow(
      'no account',
    );
  });

  it('records logins without copying the password hash into the change log', async () => {
    const a = await findLoginCandidate(pool, 'a.admin@sb-school.ac.th');
    await markLogin(pool, a?.id ?? '');
    await logUserAction(pool, { userId: a?.id ?? null, action: 'login', ip: '192.168.1.50' });

    const list = await listAccounts(pool);
    const row = list.find((r) => r.email === 'a.admin@sb-school.ac.th');
    expect(row).toMatchObject({ hasPassword: true, active: true });
    expect(row?.lastLoginAt).not.toBeNull();

    const leaked = await pool.query(
      `SELECT 1 FROM audit.change_log WHERE before::text LIKE '%password_hash%'
          OR after::text LIKE '%password_hash%'`,
    );
    expect(leaked.rowCount).toBe(0);
    const ip = await pool.query<{ source_ip: string }>(
      `SELECT host(source_ip) AS source_ip FROM audit.user_actions WHERE action = 'login'`,
    );
    expect(ip.rows[0]?.source_ip).toBe('192.168.1.50');
  });

  it('refuses an upper-case email written past the api', async () => {
    await expect(
      pool.query(`INSERT INTO auth.users (email) VALUES ('Upper@sb-school.ac.th')`),
    ).rejects.toThrow('users_email_lower');
  });
});
