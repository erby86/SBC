import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { fakeAuth, loginCookie, PASSWORD } from '../auth/fake-auth.test-helper.js';
import { LOGIN_MAX_FAILURES } from '../auth/session.js';

const https = { 'x-forwarded-proto': 'https', 'x-forwarded-for': '192.168.1.50, 172.20.0.5' };

describe('login (M23, ADR-0023)', () => {
  it('logs in, reports the session and logs out', async () => {
    const auth = await fakeAuth([{ email: 'a@sb.ac.th', label: 'STF-01', roles: ['admin'] }], true);
    const app = await buildApp({}, { auth: auth.deps });

    const anon = await app.inject({ method: 'GET', url: '/auth/session' });
    expect(anon.json()).toEqual({ user: null });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: https,
      payload: { email: ' A@SB.ac.th ', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: { email: 'a@sb.ac.th', label: 'STF-01', roles: ['admin'] },
    });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(
      /^noc_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/,
    );
    const cookie = setCookie.split(';')[0] ?? '';

    const me = await app.inject({ method: 'GET', url: '/auth/session', headers: { cookie } });
    expect(me.json()).toMatchObject({ user: { label: 'STF-01' } });

    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    const after = await app.inject({ method: 'GET', url: '/auth/session', headers: { cookie } });
    expect(after.json()).toEqual({ user: null });

    expect(auth.log.map((l) => [l.action, l.ip])).toEqual([
      ['login', '192.168.1.50'],
      ['logout', '127.0.0.1'],
    ]);
    await app.close();
  });

  it('refuses login over plain http when secure', async () => {
    const auth = await fakeAuth([{ email: 'a@sb.ac.th', roles: ['admin'] }], true);
    const app = await buildApp({}, { auth: auth.deps });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'x-forwarded-proto': 'http' },
      payload: { email: 'a@sb.ac.th', password: PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('https');
    await app.close();
  });

  it('gives the same answer for a wrong password, unknown email and disabled account', async () => {
    const auth = await fakeAuth([
      { email: 'a@sb.ac.th', roles: ['admin'] },
      { email: 'off@sb.ac.th', roles: ['admin'], active: false },
    ]);
    const app = await buildApp({}, { auth: auth.deps });
    const login = (email: string, password: string) =>
      app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    for (const [email, pw] of [
      ['a@sb.ac.th', 'wrong-password'],
      ['nobody@sb.ac.th', PASSWORD],
      ['off@sb.ac.th', PASSWORD],
    ] as const) {
      const res = await login(email, pw);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(auth.log.map((l) => l.action)).toEqual(['login_fail', 'login_fail', 'login_fail']);
    await app.close();
  });

  it(`locks an IP + email after ${LOGIN_MAX_FAILURES} failures`, async () => {
    const auth = await fakeAuth([{ email: 'a@sb.ac.th', roles: ['admin'] }]);
    const app = await buildApp({}, { auth: auth.deps });
    const login = (password: string, ip = '192.168.1.50') =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: { email: 'a@sb.ac.th', password },
      });
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login('nope')).statusCode).toBe(401);
    expect((await login(PASSWORD)).statusCode).toBe(429); // right password, still locked
    expect((await login(PASSWORD, '192.168.1.51')).statusCode).toBe(200); // other client
    await app.close();
  });

  it('refuses cross-site login and logout', async () => {
    const auth = await fakeAuth([{ email: 'a@sb.ac.th', roles: ['admin'] }]);
    const app = await buildApp({}, { auth: auth.deps });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'noc.sbc.lan', origin: 'http://evil.example' },
      payload: { email: 'a@sb.ac.th', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(out.statusCode).toBe(403);
    const same = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'noc.sbc.lan', origin: 'https://noc.sbc.lan' },
      payload: { email: 'a@sb.ac.th', password: PASSWORD },
    });
    expect(same.statusCode).toBe(200);
    await app.close();
  });

  it('ends the session when the account is disabled', async () => {
    const auth = await fakeAuth([{ email: 'a@sb.ac.th', roles: ['admin'] }]);
    const app = await buildApp({}, { auth: auth.deps });
    const cookie = await loginCookie(app, 'a@sb.ac.th');
    const account = auth.accounts[0];
    if (account) account.active = false;
    const me = await app.inject({ method: 'GET', url: '/auth/session', headers: { cookie } });
    expect(me.json()).toEqual({ user: null });
    await app.close();
  });
});
