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

/** An open problem (problem.get) with the hosts of its trigger. */
export interface ZabbixProblem {
  eventid: string;
  name: string;
  /** 0 not classified … 5 disaster. */
  severity: number;
  /** Unix seconds when the problem started. */
  clock: number;
  hostids: string[];
  acknowledged: boolean;
  /** Latest acknowledge with a message, if any. */
  ack: { userid: string; clock: number; message: string } | null;
}

export interface ZabbixClient {
  hosts(): Promise<ZabbixHost[]>;
  /** Hosts with their tags; optionally only those in the named host groups. */
  hostsWithTags(groupNames?: string[]): Promise<ZabbixTaggedHost[]>;
  /** Replaces the full tag list of a host (Zabbix semantics of host.update tags). */
  setHostTags(hostid: string, tags: ZabbixTag[]): Promise<void>;
  /** Open problems on monitored hosts (M15). */
  problems(): Promise<ZabbixProblem[]>;
  /** Host ids currently in a maintenance period, with the maintenance name when readable. */
  hostsInMaintenance(): Promise<{ hostid: string; name: string }[]>;
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
    async problems() {
      const rows = await call<
        {
          eventid: string;
          objectid: string;
          name: string;
          severity: string;
          clock: string;
          acknowledged: string;
          acknowledges?: { userid: string; clock: string; message: string; action: string }[];
        }[]
      >('problem.get', {
        output: ['eventid', 'objectid', 'name', 'severity', 'clock', 'acknowledged'],
        source: 0,
        object: 0,
        suppressed: false,
        selectAcknowledges: ['userid', 'clock', 'message', 'action'],
      });
      if (rows.length === 0) return [];
      const triggers = await call<{ triggerid: string; hosts: { hostid: string }[] }[]>(
        'trigger.get',
        {
          output: ['triggerid'],
          triggerids: [...new Set(rows.map((r) => r.objectid))],
          selectHosts: ['hostid'],
          monitored: true,
        },
      );
      const hostsOf = new Map(triggers.map((t) => [t.triggerid, t.hosts.map((h) => h.hostid)]));
      return rows
        .filter((r) => hostsOf.has(r.objectid))
        .map((r) => {
          const withMessage = (r.acknowledges ?? []).find((a) => a.message.trim() !== '');
          return {
            eventid: r.eventid,
            name: r.name,
            severity: Number(r.severity),
            clock: Number(r.clock),
            hostids: hostsOf.get(r.objectid) ?? [],
            acknowledged: r.acknowledged === '1',
            ack: withMessage
              ? {
                  userid: withMessage.userid,
                  clock: Number(withMessage.clock),
                  message: withMessage.message,
                }
              : null,
          };
        });
    },
    async hostsInMaintenance() {
      const rows = await call<{ hostid: string; maintenanceid: string }[]>('host.get', {
        output: ['hostid', 'maintenanceid'],
        filter: { maintenance_status: 1 },
      });
      if (rows.length === 0) return [];
      // Reading maintenance names needs extra rights; fall back to a generic label.
      const names = new Map<string, string>();
      try {
        const m = await call<{ maintenanceid: string; name: string }[]>('maintenance.get', {
          output: ['maintenanceid', 'name'],
          maintenanceids: [...new Set(rows.map((r) => r.maintenanceid))],
        });
        for (const x of m) names.set(x.maintenanceid, x.name);
      } catch {
        // keep the generic label
      }
      return rows.map((r) => ({
        hostid: r.hostid,
        name: names.get(r.maintenanceid) ?? 'Zabbix maintenance',
      }));
    },
  };
}
