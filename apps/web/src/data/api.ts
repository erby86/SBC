// Data access of the web client (M18): TanStack Query over the api, parsed with the shared
// zod schemas so a wrong payload fails loudly instead of drawing nonsense.
import { healthResponseSchema, layoutSchema, type Layout } from '@sbc-noc/shared';
import { useQuery } from '@tanstack/react-query';

async function getJson<T>(url: string, parse: (v: unknown) => T): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parse(await res.json());
}

/** The whole 3D layout (M14); revalidated with ETag every 5 minutes. */
export function useLayout() {
  return useQuery<Layout>({
    queryKey: ['layout'],
    queryFn: () => getJson('/api/registry/layout', (v) => layoutSchema.parse(v)),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => getJson('/api/health', (v) => healthResponseSchema.parse(v)),
    staleTime: 60_000,
  });
}
