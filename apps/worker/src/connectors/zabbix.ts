/** Minimal Zabbix 7.0 JSON-RPC client (API token in the Authorization header). Read-only use. */
export interface ZabbixHost {
  hostid: string;
  host: string;
  name: string;
  ips: string[];
}

export interface ZabbixTag {
  tag: string;
  value: string;
}

export interface ZabbixTaggedHost extends ZabbixHost {
  tags: ZabbixTag[];
}

export interface ZabbixClient {
  hosts(): Promise<ZabbixHost[]>;
  /** Hosts with their tags; optionally only those in the named host groups. */
  hostsWithTags(groupNames?: string[]): Promise<ZabbixTaggedHost[]>;
  /** Replaces the full tag list of a host (Zabbix semantics of host.update tags). */
  setHostTags(hostid: string, tags: ZabbixTag[]): Promise<void>;
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
    async hostsWithTags(groupNames) {
      let groupids: string[] | undefined;
      if (groupNames?.length) {
        const groups = await call<{ groupid: string; name: string }[]>('hostgroup.get', {
          output: ['groupid', 'name'],
          filter: { name: groupNames },
        });
        groupids = groups.map((g) => g.groupid);
        if (groupids.length === 0) return [];
      }
      const rows = await call<
        {
          hostid: string;
          host: string;
          name: string;
          interfaces: { ip: string }[];
          tags: ZabbixTag[];
        }[]
      >('host.get', {
        output: ['hostid', 'host', 'name'],
        selectInterfaces: ['ip'],
        selectTags: ['tag', 'value'],
        ...(groupids ? { groupids } : {}),
      });
      return rows.map((h) => ({
        hostid: h.hostid,
        host: h.host,
        name: h.name,
        ips: [...new Set(h.interfaces.map((i) => i.ip).filter(Boolean))],
        tags: h.tags.map((t) => ({ tag: t.tag, value: t.value })),
      }));
    },
    async setHostTags(hostid, tags) {
      await call('host.update', { hostid, tags });
    },
  };
}
