// Minimal UniFi OS (Network application) client, read-only: log in with a local View Only user
// and list devices of one site. The controller uses a self-signed certificate, so TLS trust is
// configured explicitly: pin the controller certificate (`ca`) or, for a first test only, `insecure`.
import { request as httpsRequest } from 'node:https';

export interface UnifiDevice {
  mac: string;
  name: string;
  model: string;
  type: string; // uap = access point, usw = switch, ugw/udm = gateway
  ip: string | null;
  version: string | null;
  /** 1 = connected; anything else is offline/adopting/upgrading. */
  state: number;
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

export interface HttpResponse {
  status: number;
  setCookie: string[];
  body: string;
}

export type HttpRequest = (
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export function httpsTransport(tls: { ca?: string; insecure?: boolean }): HttpRequest {
  if (!tls.ca && !tls.insecure) {
    throw new Error('unifi: set UNIFI_CA_FILE (pinned certificate) or UNIFI_TLS_INSECURE=true');
  }
  return (url, init) =>
    new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: init.method,
          headers: init.headers,
          timeout: 15_000,
          ...(tls.ca
            ? // The self-signed certificate is issued for the controller's own name, not the IP we
              // dial. Trust is the pinned `ca`; skip only the hostname comparison.
              { ca: tls.ca, allowPartialTrustChain: true, checkServerIdentity: () => undefined }
            : { rejectUnauthorized: false }),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              setCookie: res.headers['set-cookie'] ?? [],
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('unifi: request timed out')));
      req.on('error', reject);
      if (init.body) req.write(init.body);
      req.end();
    });
}

interface RawDevice {
  mac?: string;
  name?: string;
  model?: string;
  type?: string;
  ip?: string;
  version?: string;
  state?: number;
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
        }));
    },
  };
}
