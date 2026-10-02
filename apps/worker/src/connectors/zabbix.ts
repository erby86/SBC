/** Minimal Zabbix 7.0 JSON-RPC client (API token in the Authorization header). Read-only use. */
export interface ZabbixHost {
  hostid: string;
  host: string;
  name: string;
  ips: string[];
}

export interface ZabbixClient {
  hosts(): Promise<ZabbixHost[]>;
}

export function createZabbixClient(
  url: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): ZabbixClient {
  let id = 0;
  async function call<T>(method: string, params: unknown): Promise<T> {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json-rpc', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: ++id }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`zabbix ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string; data?: string } };
    if (body.error)
      throw new Error(`zabbix ${method}: ${body.error.message} ${body.error.data ?? ''}`.trim());
    return body.result as T;
  }

  return {
    async hosts() {
      const rows = await call<
        { hostid: string; host: string; name: string; interfaces: { ip: string }[] }[]
      >('host.get', { output: ['hostid', 'host', 'name'], selectInterfaces: ['ip'] });
      return rows.map((h) => ({
        hostid: h.hostid,
        host: h.host,
        name: h.name,
        ips: [...new Set(h.interfaces.map((i) => i.ip).filter(Boolean))],
      }));
    },
  };
}
