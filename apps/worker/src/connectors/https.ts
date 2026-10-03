// HTTPS for LAN controllers with self-signed certificates (UniFi, Omada): trust is a pinned
// certificate file, or — for a first test only — no verification at all.
import { request as httpsRequest } from 'node:https';

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
    throw new Error('set the pinned certificate file (*_CA_FILE) or *_TLS_INSECURE=true');
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
      req.on('timeout', () => req.destroy(new Error(`request timed out: ${new URL(url).host}`)));
      req.on('error', reject);
      if (init.body) req.write(init.body);
      req.end();
    });
}
