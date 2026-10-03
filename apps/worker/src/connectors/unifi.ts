// Minimal UniFi OS (Network application) client, read-only: log in with a local View Only user
// and list devices of one site. The controller uses a self-signed certificate, so TLS trust is
// configured explicitly: pin the controller certificate (`ca`) or, for a first test only, `insecure`.
import { httpsTransport, type HttpRequest } from './https.js';

export type { HttpRequest, HttpResponse } from './https.js';

export interface UnifiDevice {
  mac: string;
  name: string;
  model: string;
  type: string; // uap = access point, usw = switch, ugw/udm = gateway
  ip: string | null;
  version: string | null;
  /** 1 = connected; anything else is offline/adopting/upgrading. */
  state: number;
  /** Device this one hangs off (switch port, or the parent AP for mesh). */
  uplinkMac: string | null;
  uplinkPort: number | null;
}

export interface UnifiClient {
  devices(): Promise<UnifiDevice[]>;
}

export interface UnifiOptions {
  url: string; // https://172.16.0.30:11443
  username: string;
  password: string;
  site: string; // internal site name, e.g. 02gt1bcf (not the description)
  /** PEM of the controller certificate (chain). Hostname is not checked, the certificate is. */
  ca?: string;
  /** Skip certificate verification entirely. Dev diagnostics only. */
  insecure?: boolean;
}

interface RawDevice {
  mac?: string;
  name?: string;
  model?: string;
  type?: string;
  ip?: string;
  version?: string;
  state?: number;
  uplink?: { uplink_mac?: string; uplink_remote_port?: number };
}

export function createUnifiClient(opts: UnifiOptions, http?: HttpRequest): UnifiClient {
  const send = http ?? httpsTransport(opts);
  const base = opts.url.replace(/\/+$/, '');

  async function login(): Promise<string> {
    const res = await send(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: opts.username, password: opts.password }),
    });
    if (res.status !== 200) throw new Error(`unifi login: HTTP ${res.status}`);
    const token = res.setCookie
      .map((c) => c.split(';')[0] ?? '')
      .find((c) => c.startsWith('TOKEN='));
    if (!token) throw new Error('unifi login: no TOKEN cookie');
    return token;
  }

  return {
    async devices() {
      const cookie = await login();
      const res = await send(
        `${base}/proxy/network/api/s/${encodeURIComponent(opts.site)}/stat/device`,
        { method: 'GET', headers: { Cookie: cookie, Accept: 'application/json' } },
      );
      if (res.status !== 200) throw new Error(`unifi stat/device: HTTP ${res.status}`);
      const body = JSON.parse(res.body) as {
        meta?: { rc?: string; msg?: string };
        data?: RawDevice[];
      };
      if (body.meta?.rc !== 'ok')
        throw new Error(`unifi stat/device: ${body.meta?.msg ?? 'not ok'}`);
      return (body.data ?? [])
        .filter((d) => d.mac)
        .map((d) => ({
          mac: (d.mac as string).toLowerCase(),
          name: d.name?.trim() ?? '',
          model: d.model ?? '',
          type: d.type ?? '',
          ip: d.ip || null,
          version: d.version || null,
          state: d.state ?? 0,
          uplinkMac: d.uplink?.uplink_mac?.toLowerCase() || null,
          uplinkPort: d.uplink?.uplink_remote_port ?? null,
        }));
    },
  };
}
