import { describe, expect, it } from 'vitest';
import type { HttpRequest } from './https.js';
import { createOmadaClient } from './omada.js';

const ok = (result: unknown) => ({
  status: 200,
  setCookie: [],
  body: JSON.stringify({ errorCode: 0, msg: 'Success.', result }),
});

describe('createOmadaClient', () => {
  it('gets a token with client credentials and lists devices of the chosen site', async () => {
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const http: HttpRequest = async (url, init) => {
      calls.push({ url, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
      if (url.includes('/authorize/token')) return ok({ accessToken: 'AT-1', expiresIn: 7200 });
      if (url.includes('/devices')) {
        return ok({
          totalRows: 1,
          data: [
            {
              mac: 'EC-75-0C-18-50-5A',
              name: '1AP1',
              model: 'EAP615-Wall(US) v1.0',
              type: 'ap',
              ip: '192.168.1.111',
              status: 1,
              firmwareVersion: '1.2.3',
            },
          ],
        });
      }
      return ok({
        totalRows: 2,
        data: [
          { siteId: 's1', name: 'SBC_Main' },
          { siteId: 's2', name: 'Other' },
        ],
      });
    };
    const client = createOmadaClient(
      { url: 'https://o/', omadacId: 'cid', clientId: 'id', clientSecret: 'sec', site: 'SBC_Main' },
      http,
    );
    expect(await client.devices()).toEqual([
      {
        mac: 'ec:75:0c:18:50:5a',
        name: '1AP1',
        model: 'EAP615-Wall(US) v1.0',
        type: 'ap',
        ip: '192.168.1.111',
        version: '1.2.3',
        status: 1,
        uplinkMac: null,
        uplinkPort: null,
      },
    ]);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      omadacId: 'cid',
      client_id: 'id',
      client_secret: 'sec',
    });
    expect(calls[2]?.url).toBe('https://o/openapi/v1/cid/sites/s1/devices?page=1&pageSize=1000');
    expect(calls[2]?.headers['Authorization']).toBe('AccessToken=AT-1');
    expect(calls).toHaveLength(3); // site "Other" skipped
  });

  it('reports Omada error codes', async () => {
    const http: HttpRequest = async () => ({
      status: 200,
      setCookie: [],
      body: JSON.stringify({
        errorCode: -44106,
        msg: 'The client id or client secret is invalid.',
      }),
    });
    const client = createOmadaClient(
      { url: 'https://o', omadacId: 'c', clientId: 'i', clientSecret: 's' },
      http,
    );
    await expect(client.devices()).rejects.toThrow(
      '-44106 The client id or client secret is invalid.',
    );
  });
});
