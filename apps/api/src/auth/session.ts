// M23 sessions and login throttling (ADR-0023). The browser holds a random id in an HttpOnly
// cookie; Redis holds only its SHA-256 (a Redis dump does not hand out live sessions).
import { createHash, randomBytes } from 'node:crypto';
import { SESSION_TTL_SECONDS } from '@sbc-noc/shared';
import type { Redis } from 'ioredis';

export const SESSION_COOKIE = 'noc_session';

export interface SessionData {
  userId: string;
  createdAt: string;
}

export interface SessionStore {
  create(userId: string): Promise<string>;
  get(id: string): Promise<SessionData | null>;
  delete(id: string): Promise<void>;
}

/** Failed logins per client IP + email; locked after `max` failures within the window. */
export interface LoginLimiter {
  locked(key: string): Promise<boolean>;
  fail(key: string): Promise<void>;
  reset(key: string): Promise<void>;
}

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

const digest = (id: string) => createHash('sha256').update(id).digest('hex');
const newId = () => randomBytes(32).toString('base64url');

export function redisSessionStore(redis: Redis): SessionStore {
  return {
    async create(userId) {
      const id = newId();
      const data: SessionData = { userId, createdAt: new Date().toISOString() };
      await redis.set(`session:${digest(id)}`, JSON.stringify(data), 'EX', SESSION_TTL_SECONDS);
      return id;
    },
    async get(id) {
      const raw = await redis.get(`session:${digest(id)}`);
      return raw ? (JSON.parse(raw) as SessionData) : null;
    },
    async delete(id) {
      await redis.del(`session:${digest(id)}`);
    },
  };
}

export function redisLoginLimiter(redis: Redis): LoginLimiter {
  const k = (key: string) => `login:fail:${digest(key)}`;
  return {
    async locked(key) {
      return Number((await redis.get(k(key))) ?? 0) >= LOGIN_MAX_FAILURES;
    },
    async fail(key) {
      // the window starts at the first failure and is not extended by later ones
      const n = await redis.incr(k(key));
      if (n === 1) await redis.expire(k(key), LOGIN_WINDOW_SECONDS);
    },
    async reset(key) {
      await redis.del(k(key));
    },
  };
}

/** In-memory versions for tests and local runs without Redis. */
export function memorySessionStore(now: () => number = Date.now): SessionStore {
  const map = new Map<string, SessionData & { exp: number }>();
  return {
    async create(userId) {
      const id = newId();
      map.set(digest(id), {
        userId,
        createdAt: new Date(now()).toISOString(),
        exp: now() + SESSION_TTL_SECONDS * 1000,
      });
      return id;
    },
    async get(id) {
      const s = map.get(digest(id));
      if (!s || s.exp <= now()) return null;
      return { userId: s.userId, createdAt: s.createdAt };
    },
    async delete(id) {
      map.delete(digest(id));
    },
  };
}

export function memoryLoginLimiter(): LoginLimiter {
  const map = new Map<string, number>();
  return {
    locked: async (key) => (map.get(key) ?? 0) >= LOGIN_MAX_FAILURES,
    fail: async (key) => void map.set(key, (map.get(key) ?? 0) + 1),
    reset: async (key) => void map.delete(key),
  };
}

/** Reads one cookie from a Cookie header (no dependency for a single name). */
export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

export function sessionCookie(id: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
