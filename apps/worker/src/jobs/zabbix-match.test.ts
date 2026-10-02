import { describe, expect, it, vi } from 'vitest';
import { createZabbixClient } from '../connectors/zabbix.js';
import { matchHosts, type RegistryDevice } from './zabbix-match.js';

const dev = (
  code: string,
  mgmtIp: string | null,
  hostname: string | null = null,
): RegistryDevice => ({
  id: `id-${code}`,
  code,
  mgmtIp,
  hostname,
});
const host = (hostid: string, name: string, ips: string[]) => ({ hostid, host: name, name, ips });

describe('matchHosts', () => {
  it('matches by IP first, then by hostname (case-insensitive)', () => {
    const r = matchHosts(
      [dev('c2116', '192.168.1.1'), dev('m-b1', null, 'Tp-link-SG3428-Core-Bldg1')],
      [
        host('1', 'MikroTik-CCR2116-MainRouter', ['192.168.1.1']),
        host('2', 'tp-link-sg3428-core-bldg1', ['192.168.1.157']),
      ],
    );
    expect(r.matches.map((m) => [m.device.code, m.host.hostid, m.by])).toEqual([
      ['c2116', '1', 'ip'],
      ['m-b1', '2', 'hostname'],
    ]);
    expect(r.unmatchedHosts).toEqual([]);
  });

  it('reports hosts with no registry device', () => {
    const r = matchHosts([dev('c2116', '192.168.1.1')], [host('9', 'Unknown', ['10.0.0.9'])]);
    expect(r.unmatchedHosts.map((h) => h.hostid)).toEqual(['9']);
  });

  it('flags an IP shared by two devices and a device claimed by two hosts', () => {
    const r = matchHosts(
      [dev('a', '10.0.0.1'), dev('b', '10.0.0.1'), dev('c', '10.0.0.3')],
      [host('1', 'h1', ['10.0.0.1']), host('3', 'h3', ['10.0.0.3']), host('4', 'h4', ['10.0.0.3'])],
    );
    expect(r.matches.map((m) => m.host.hostid)).toEqual(['3']);
    expect(r.conflicts.map((c) => c.host.hostid)).toEqual(['1', '4']);
  });
});

describe('createZabbixClient', () => {
  it('sends the token as Bearer and flattens interfaces', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: [
              {
                hostid: '1',
                host: 'h',
                name: 'H',
                interfaces: [{ ip: '10.0.0.1' }, { ip: '10.0.0.1' }],
              },
            ],
          }),
        ),
    );
    const client = createZabbixClient(
      'http://z/api_jsonrpc.php',
      'tok',
      fetchMock as unknown as typeof fetch,
    );
    expect(await client.hosts()).toEqual([
      { hostid: '1', host: 'h', name: 'H', ips: ['10.0.0.1'] },
    ]);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toMatchObject({ method: 'host.get' });
  });

  it('surfaces API errors', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'No permissions', data: 'host.update' } })),
    );
    const client = createZabbixClient('http://z', 't', fetchMock as unknown as typeof fetch);
    await expect(client.hosts()).rejects.toThrow('No permissions');
  });
});
