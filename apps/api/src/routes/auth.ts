// M23 login with local accounts (ADR-0023). Viewing needs no login; actions (registry editing now,
// acknowledge/changes later) need a session with the right role. Session cookie: HttpOnly,
// SameSite=Strict, Secure unless SESSION_COOKIE_SECURE=false (dev over http only).
import {
  authErrorSchema,
  hasRole,
  loginRequestSchema,
  sessionResponseSchema,
  type AuthUser,
  type UserRole,
} from '@sbc-noc/shared';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { dummyHash, verifyPassword } from '../auth/password.js';
import {
  clearSessionCookie,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  type LoginLimiter,
  type SessionStore,
} from '../auth/session.js';

export interface SessionUser extends AuthUser {
  id: string;
}

export interface AccountSource {
  findLogin(
    email: string,
  ): Promise<(SessionUser & { active: boolean; passwordHash: string | null }) | null>;
  byId(id: string): Promise<SessionUser | null>;
  markLogin(id: string): Promise<void>;
  log(a: {
    userId: string | null;
    action: string;
    detail?: Record<string, unknown>;
    ip: string;
  }): Promise<void>;
}

export interface AuthDeps {
  accounts: AccountSource;
  sessions: SessionStore;
  limiter: LoginLimiter;
  /** Secure cookie and login only over https (X-Forwarded-Proto from NPM). Off on dev over http. */
  secure: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth guard on protected routes. */
    user: SessionUser | null;
  }
}

/** Client address: first X-Forwarded-For entry (NPM → web nginx → api), else the socket. */
export function clientIp(req: FastifyRequest): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    ?.trim();
  return forwarded || req.ip;
}

const publicUser = (u: SessionUser): AuthUser => ({
  email: u.email,
  label: u.label,
  roles: u.roles,
});

/** Writes from another site are refused even if a cookie came along (besides SameSite=Strict). */
function crossSite(req: FastifyRequest): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

const tags = ['auth'];

export function authRoutes(app: FastifyInstance, deps: AuthDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  app.decorateRequest('user', null);

  async function currentUser(req: FastifyRequest): Promise<SessionUser | null> {
    const id = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!id) return null;
    const session = await deps.sessions.get(id);
    return session ? deps.accounts.byId(session.userId) : null;
  }

  /** preHandler: 401 without a valid session, 403 without the role or for a cross-site write. */
  function requireRole(role: UserRole): preHandlerAsyncHookHandler {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (req.method !== 'GET' && req.method !== 'HEAD' && crossSite(req)) {
        return reply.code(403).send({ message: 'คำขอจากเว็บอื่น' });
      }
      const user = await currentUser(req);
      if (!user) return reply.code(401).send({ message: 'เข้าสู่ระบบก่อน' });
      if (!hasRole(user, role)) {
        return reply.code(403).send({ message: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้' });
      }
      req.user = user;
    };
  }

  r.get(
    '/auth/session',
    {
      schema: {
        tags,
        summary: 'ผู้ใช้ที่เข้าสู่ระบบอยู่ (null = ยังไม่เข้าสู่ระบบ)',
        response: { 200: sessionResponseSchema },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const user = await currentUser(req);
      return { user: user ? publicUser(user) : null };
    },
  );

  r.post(
    '/auth/login',
    {
      schema: {
        tags,
        summary: 'เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน',
        body: loginRequestSchema,
        response: {
          200: sessionResponseSchema,
          400: authErrorSchema,
          401: authErrorSchema,
          403: authErrorSchema,
          429: authErrorSchema,
        },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (crossSite(req)) return reply.code(403).send({ message: 'คำขอจากเว็บอื่น' });
      if (deps.secure && req.headers['x-forwarded-proto'] !== 'https') {
        return reply.code(400).send({ message: 'เข้าสู่ระบบได้เฉพาะทาง https' });
      }
      const ip = clientIp(req);
      const email = req.body.email.toLowerCase();
      const key = `${ip}|${email}`;
      if (await deps.limiter.locked(key)) {
        return reply.code(429).send({ message: 'ใส่รหัสผิดหลายครั้ง รอ 15 นาทีแล้วลองใหม่' });
      }

      const found = await deps.accounts.findLogin(email);
      const usable = found?.active && found.passwordHash ? found.passwordHash : null;
      // verify even for an unknown email so the answer time does not reveal which emails exist
      const ok = await verifyPassword(req.body.password, usable ?? (await dummyHash));
      if (!ok || !usable || !found) {
        await deps.limiter.fail(key);
        await deps.accounts.log({
          userId: found?.id ?? null,
          action: 'login_fail',
          detail: { email },
          ip,
        });
        return reply.code(401).send({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
      }

      await deps.limiter.reset(key);
      const previous = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (previous) await deps.sessions.delete(previous);
      const sid = await deps.sessions.create(found.id);
      await deps.accounts.markLogin(found.id);
      await deps.accounts.log({ userId: found.id, action: 'login', ip });
      reply.header('Set-Cookie', sessionCookie(sid, deps.secure));
      return { user: publicUser(found) };
    },
  );

  r.post(
    '/auth/logout',
    {
      schema: {
        tags,
        summary: 'ออกจากระบบ',
        response: { 204: z.null(), 403: authErrorSchema },
      },
    },
    async (req, reply) => {
      if (crossSite(req)) return reply.code(403).send({ message: 'คำขอจากเว็บอื่น' });
      const sid = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (sid) {
        const session = await deps.sessions.get(sid);
        await deps.sessions.delete(sid);
        if (session) {
          await deps.accounts.log({ userId: session.userId, action: 'logout', ip: clientIp(req) });
        }
      }
      reply.header('Set-Cookie', clearSessionCookie(deps.secure));
      return reply.code(204).send(null);
    },
  );

  return { requireRole };
}
