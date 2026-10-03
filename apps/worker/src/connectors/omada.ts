// Omada Open API client (controller 5.9+, here 6.3): an app in Client mode with the Viewer role
// gets an access token with client credentials — no user password (M06).
// Errors come back as HTTP 200 with errorCode ≠ 0.
import { httpsTransport, type HttpRequest } from './https.js';

export interface OmadaDevice {
  mac: string; // normalised to aa:bb:cc:dd:ee:ff (Omada sends EC-75-0C-18-50-5A)
  name: string;
  model: string;
  type: string; // ap, switch, gateway
  ip: string | null;
  version: string | null;
  /** Omada status 1 = connected. */
  status: number;
  uplinkMac: string | null;
  uplinkPort: number | null;
}

export interface OmadaClient {
  devices(): Promise<OmadaDevice[]>;
}

export interface OmadaOptions {
  url: string; // https://192.168.1.118
  omadacId: string; // from GET /api/info
  clientId: string;
  clientSecret: string;
  /** Site name (e.g. SBC_Main); empty = all sites the app can see. */
  site?: string;
  ca?: string;
  insecure?: boolean;
}

interface Envelope<T> {
  errorCode: number;
  msg?: string;
  result?: T;
}

interface RawDevice {
  mac?: string;
  name?: string;
  model?: string;
  type?: string;
  ip?: string;
  firmwareVersion?: string;
  version?: string;
  status?: number;
  uplinkDeviceMac?: string;
  uplinkDevicePort?: number | string;
}

const normMac = (m: string) => m.toLowerCase().replace(/-/g, ':');

export function createOmadaClient(opts: OmadaOptions, http?: HttpRequest): OmadaClient {
  const send = http ?? httpsTransport(opts);
  const base = opts.url.replace(/\/+$/, '');

  async function call<T>(path: string, init: Parameters<HttpRequest>[1]): Promise<T> {
    const res = await send(`${base}${path}`, init);
    if (res.status !== 200) throw new Error(`omada ${path.split('?')[0]}: HTTP ${res.status}`);
    const body = JSON.parse(res.body) as Envelope<T>;
    if (body.errorCode !== 0) {
      throw new Error(`omada ${path.split('?')[0]}: ${body.errorCode} ${body.msg ?? ''}`.trim());
    }
    return body.result as T;
  }

  async function paged<T>(path: string, token: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page < 100; page++) {
      const r = await call<{ totalRows: number; data: T[] }>(
        `${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=1000`,
        {
          method: 'GET',
          headers: { Authorization: `AccessToken=${token}`, Accept: 'application/json' },
        },
      );
      out.push(...r.data);
      if (out.length >= r.totalRows || r.data.length === 0) break;
    }
    return out;
  }

  return {
    async devices() {
      const { accessToken } = await call<{ accessToken: string }>(
        '/openapi/authorize/token?grant_type=client_credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            omadacId: opts.omadacId,
            client_id: opts.clientId,
            client_secret: opts.clientSecret,
          }),
        },
      );
      const id = encodeURIComponent(opts.omadacId);
      const sites = (
        await paged<{ siteId: string; name: string }>(`/openapi/v1/${id}/sites`, accessToken)
      ).filter((s) => !opts.site || s.name === opts.site);
      if (opts.site && sites.length === 0) throw new Error(`omada: site "${opts.site}" not found`);

      const devices: OmadaDevice[] = [];
      for (const s of sites) {
        const rows = await paged<RawDevice>(
          `/openapi/v1/${id}/sites/${encodeURIComponent(s.siteId)}/devices`,
          accessToken,
        );
        for (const d of rows) {
          if (!d.mac) continue;
          const port = Number(d.uplinkDevicePort);
          devices.push({
            mac: normMac(d.mac),
            name: d.name?.trim() ?? '',
            model: d.model ?? '',
            type: d.type ?? '',
            ip: d.ip || null,
            version: d.firmwareVersion || d.version || null,
            status: d.status ?? 0,
            uplinkMac: d.uplinkDeviceMac ? normMac(d.uplinkDeviceMac) : null,
            uplinkPort: Number.isFinite(port) && port > 0 ? port : null,
          });
        }
      }
      return devices;
    },
  };
}
