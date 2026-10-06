// Test helper (not shipped behaviour): in-memory accounts, sessions and limiter for buildApp.
import type { UserRole } from '@sbc-noc/shared';
import type { AuthDeps, SessionUser } from '../routes/auth.js';
import { hashPassword } from './password.js';
import { memoryLoginLimiter, memorySessionStore } from './session.js';

export const PASSWORD = 'correct horse battery';

interface FakeAccount extends SessionUser {
  active: boolean;
  passwordHash: string | null;
}

export async function fakeAuth(
  users: { email: string; label?: string; roles: UserRole[]; active?: boolean }[],
  secure = false,
) {
  const hash = await hashPassword(PASSWORD);
  const accounts: FakeAccount[] = users.map((u, i) => ({
    id: `u${i}`,
    email: u.email,
    label: u.label ?? u.email,
    roles: u.roles,
    active: u.active ?? true,
    passwordHash: hash,
  }));
  const log: { userId: string | null; action: string; ip: string; detail?: object }[] = [];
  const deps: AuthDeps = {
    secure,
    sessions: memorySessionStore(),
    limiter: memoryLoginLimiter(),
    accounts: {
      findLogin: async (email) => accounts.find((a) => a.email === email) ?? null,
      byId: async (id) => {
        const a = accounts.find((x) => x.id === id && x.active);
        return a ? { id: a.id, email: a.email, label: a.label, roles: a.roles } : null;
      },
      markLogin: async () => undefined,
      log: async (a) => void log.push(a),
    },
  };
  return { deps, accounts, log };
}

/** Logs in through the api and returns the Cookie header value for later requests. */
export async function loginCookie(
  app: { inject: (o: object) => Promise<{ statusCode: number; headers: Record<string, unknown> }> },
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'x-forwarded-proto': 'https' },
    payload: { email, password: PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login ${email}: ${res.statusCode}`);
  return String(res.headers['set-cookie']).split(';')[0] ?? '';
}
