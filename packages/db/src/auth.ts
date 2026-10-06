// M23 local accounts (ADR-0023). The api checks passwords and keeps sessions in Redis; this module
// only reads and writes auth.users / auth.user_roles and records account events in
// audit.user_actions. Hashing lives in the api (node:crypto argon2id), never here.
import type pg from 'pg';

/** Roles in use (ADR-0023). Other rows seeded by migration 0001 stay unused. */
export const USER_ROLES = ['operator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AccountUser {
  id: string;
  email: string;
  /** Shown in the audit trail and the back office: staff code when linked, else the email. */
  label: string;
  roles: UserRole[];
}

export interface LoginCandidate extends AccountUser {
  active: boolean;
  passwordHash: string | null;
}

export interface AccountRow extends AccountUser {
  active: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
}

export class AccountError extends Error {}

const normalize = (email: string) => email.trim().toLowerCase();

const SELECT_USER = `
  SELECT u.id, u.email, u.active, u.password_hash, u.last_login_at,
         coalesce(s.staff_code, u.email) AS label,
         coalesce(array_agg(r.role_code ORDER BY r.role_code)
                  FILTER (WHERE r.role_code IN ('operator', 'admin')), '{}') AS roles
  FROM auth.users u
  LEFT JOIN core.staff s ON s.id = u.staff_id
  LEFT JOIN auth.user_roles r ON r.user_id = u.id`;

interface Row {
  id: string;
  email: string;
  active: boolean;
  password_hash: string | null;
  last_login_at: Date | null;
  label: string;
  roles: UserRole[];
}

const toUser = (r: Row): AccountUser => ({
  id: r.id,
  email: r.email,
  label: r.label,
  roles: r.roles,
});

/** The account for a login attempt, or null when the email is unknown. */
export async function findLoginCandidate(
  pool: pg.Pool,
  email: string,
): Promise<LoginCandidate | null> {
  const { rows } = await pool.query<Row>(`${SELECT_USER} WHERE u.email = $1 GROUP BY u.id, s.id`, [
    normalize(email),
  ]);
  const r = rows[0];
  return r ? { ...toUser(r), active: r.active, passwordHash: r.password_hash } : null;
}

/** An active account by id (each request with a session re-reads it, so a disable is immediate). */
export async function getActiveUser(pool: pg.Pool, id: string): Promise<AccountUser | null> {
  const { rows } = await pool.query<Row>(
    `${SELECT_USER} WHERE u.id = $1 AND u.active GROUP BY u.id, s.id`,
    [id],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function markLogin(pool: pg.Pool, id: string): Promise<void> {
  await pool.query('UPDATE auth.users SET last_login_at = now() WHERE id = $1', [id]);
}

export interface UserAction {
  userId: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/** Appends to audit.user_actions (the app role may insert only). */
export async function logUserAction(pool: pg.Pool, a: UserAction): Promise<void> {
  await pool.query(
    `INSERT INTO audit.user_actions (user_id, action, target, detail, source_ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [a.userId, a.action, a.target ?? null, JSON.stringify(a.detail ?? {}), a.ip ?? null],
  );
}

// ---- account management (user-cli on the server; no web page for it) ----

export async function listAccounts(pool: pg.Pool): Promise<AccountRow[]> {
  const { rows } = await pool.query<Row>(`${SELECT_USER} GROUP BY u.id, s.id ORDER BY u.email`);
  return rows.map((r) => ({
    ...toUser(r),
    active: r.active,
    hasPassword: r.password_hash !== null,
    lastLoginAt: r.last_login_at?.toISOString() ?? null,
  }));
}

async function idOf(c: pg.PoolClient, email: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>('SELECT id FROM auth.users WHERE email = $1', [
    normalize(email),
  ]);
  if (!rows[0]) throw new AccountError(`no account ${normalize(email)}`);
  return rows[0].id;
}

async function inTx<T>(
  pool: pg.Pool,
  actor: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // auth.user_roles has an audit trigger; it records this actor
    await c.query(`SELECT set_config('app.actor', $1, true)`, [actor]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

// Done from the server CLI, not by a logged-in user: user_id stays empty, `by` names the operator.
const action = (c: pg.PoolClient, email: string, name: string, detail: object, actor: string) =>
  c.query(`INSERT INTO audit.user_actions (action, target, detail) VALUES ($1, $2, $3)`, [
    name,
    email,
    JSON.stringify({ ...detail, by: actor }),
  ]);

export interface AccountInput {
  email: string;
  roles: UserRole[];
  /** Staff code (core.staff) to show instead of the email; must exist. */
  staffCode?: string | null;
  passwordHash: string;
}

export async function createAccount(
  pool: pg.Pool,
  input: AccountInput,
  actor: string,
): Promise<void> {
  const email = normalize(input.email);
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new AccountError(`not an email: ${email}`);
  await inTx(pool, actor, async (c) => {
    let staffId: string | null = null;
    if (input.staffCode) {
      const s = await c.query<{ id: string }>('SELECT id FROM core.staff WHERE staff_code = $1', [
        input.staffCode,
      ]);
      if (!s.rows[0]) throw new AccountError(`no staff ${input.staffCode} in core.staff`);
      staffId = s.rows[0].id;
    }
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO auth.users (email, staff_id, password_hash, password_changed_at)
       VALUES ($1, $2, $3, now()) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, staffId, input.passwordHash],
    );
    if (!rows[0]) throw new AccountError(`account ${email} exists`);
    for (const role of input.roles) {
      await c.query('INSERT INTO auth.user_roles (user_id, role_code) VALUES ($1, $2)', [
        rows[0].id,
        role,
      ]);
    }
    await action(c, email, 'account_create', { roles: input.roles }, actor);
  });
}

export async function setAccountPassword(
  pool: pg.Pool,
  email: string,
  passwordHash: string,
  actor: string,
): Promise<void> {
  await inTx(pool, actor, async (c) => {
    const id = await idOf(c, email);
    await c.query(
      'UPDATE auth.users SET password_hash = $2, password_changed_at = now() WHERE id = $1',
      [id, passwordHash],
    );
    await action(c, normalize(email), 'account_password', {}, actor);
  });
}

export async function setAccountActive(
  pool: pg.Pool,
  email: string,
  active: boolean,
  actor: string,
): Promise<void> {
  await inTx(pool, actor, async (c) => {
    const id = await idOf(c, email);
    await c.query('UPDATE auth.users SET active = $2 WHERE id = $1', [id, active]);
    await action(c, normalize(email), active ? 'account_enable' : 'account_disable', {}, actor);
  });
}

export async function setAccountRoles(
  pool: pg.Pool,
  email: string,
  roles: UserRole[],
  actor: string,
): Promise<void> {
  await inTx(pool, actor, async (c) => {
    const id = await idOf(c, email);
    await c.query('DELETE FROM auth.user_roles WHERE user_id = $1', [id]);
    for (const role of roles) {
      await c.query('INSERT INTO auth.user_roles (user_id, role_code) VALUES ($1, $2)', [id, role]);
    }
    await action(c, normalize(email), 'account_roles', { roles }, actor);
  });
}
