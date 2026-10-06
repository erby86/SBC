// M23 login (ADR-0023): the session lives in an HttpOnly cookie the page cannot read; the page
// asks /api/auth/session who is logged in. Viewing never needs this — only /admin and actions.
import { authErrorSchema, sessionResponseSchema, type AuthUser } from '@sbc-noc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const SESSION_KEY = ['session'] as const;

async function post(url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return null;
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = authErrorSchema.safeParse(json);
    throw new Error(e.success ? e.data.message : `HTTP ${res.status}`);
  }
  return json;
}

export function useSession() {
  return useQuery<AuthUser | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      const res = await fetch('/api/auth/session', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`/api/auth/session: HTTP ${res.status}`);
      return sessionResponseSchema.parse(await res.json()).user;
    },
    staleTime: 60_000,
    retry: 1,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { email: string; password: string }) =>
      sessionResponseSchema.parse(await post('/api/auth/login', v)).user,
    onSuccess: (user) => qc.setQueryData(SESSION_KEY, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post('/api/auth/logout'),
    onSettled: () => {
      qc.setQueryData(SESSION_KEY, null);
      qc.removeQueries({
        predicate: (q) => q.queryKey[0] !== 'session' && q.queryKey[0] !== 'health',
      });
    },
  });
}
