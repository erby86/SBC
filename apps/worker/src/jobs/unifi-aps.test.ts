import { describe, expect, it } from 'vitest';
import { createUnifiClient, type HttpRequest } from '../connectors/unifi.js';
import { apCode, parseApName, placeAp } from './unifi-aps.js';

describe('parseApName', () => {
  it('reads building, floor and number from the names used in UniFi (2026-10-03)', () => {
    const at = (building: string, floor: number, no: string) => ({
      building,
      floor,
      no,
      from: 'name',
    });
    expect(parseApName('8SFL2-1')).toEqual(at('s8', 2, '1'));
    expect(parseApName('8SFL8-4')).toEqual(at('s8', 8, '4'));
    expect(parseApName('A6-2')).toEqual(at('ba', 6, '2'));
    expect(parseApName('AF2-1201')).toEqual(at('ba', 2, '1201'));
    expect(parseApName('BFL3-5')).toEqual(at('bb', 3, '5'));
    expect(parseApName('BF5-2')).toEqual(at('bb', 5, '2'));
    expect(parseApName('UAP-AC-7AP4F')).toEqual(at('ba', 4, '1'));
    expect(parseApName('SP-3-1 Canteen')).toEqual(at('sp', 3, '1'));
    expect(parseApName('bb-1-1 ITB')).toEqual(at('bb', 1, '1'));
    expect(parseApName('I1-2-3')).toEqual(at('i1', 2, '3'));
    expect(apCode({ building: 's8', floor: 2, no: '1' })).toBe('ap-s8-2-1');
  });

  it('gives no place for default or free-form names', () => {
    for (const n of [
      'AC LR',
      'AC Mesh',
      'AC LR Canteen',
      'AC LR ITB',
      'XX-1-1',
      'UAP-AC-LRA12',
      '',
    ]) {
      expect(parseApName(n)).toBeNull();
    }
  });
});

describe('placeAp', () => {
  const names = new Map([
    ['aa:00:00:00:00:04', 'US16BFL-4'],
    ['aa:00:00:00:00:a4', 'US24AFL-4'],
  ]);
  it('falls back to the floor switch the AP is cabled to (number = port)', () => {
    expect(
      placeAp({ name: 'AC LR', uplinkMac: 'aa:00:00:00:00:04', uplinkPort: 5 }, names),
    ).toEqual({
      building: 'bb',
      floor: 4,
      no: 'p5',
      from: 'uplink',
    });
  });
  it('does not use building main switches or unknown uplinks', () => {
    expect(
      placeAp({ name: 'UAP-AC-LRA9', uplinkMac: 'aa:00:00:00:00:a4', uplinkPort: 7 }, names),
    ).toBeNull();
    expect(
      placeAp({ name: 'AC Mesh', uplinkMac: 'bb:00:00:00:00:01', uplinkPort: 1 }, names),
    ).toBeNull();
    expect(placeAp({ name: 'AC Mesh', uplinkMac: null, uplinkPort: null }, names)).toBeNull();
  });
  it('prefers the name over the switch', () => {
    expect(
      placeAp({ name: 'BFL3-1', uplinkMac: 'aa:00:00:00:00:04', uplinkPort: 1 }, names)?.floor,
    ).toBe(3);
  });
});

describe('createUnifiClient', () => {
  it('logs in, sends the TOKEN cookie and normalises devices', async () => {
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const http: HttpRequest = async (url, init) => {
      calls.push({ url, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
      if (url.endsWith('/api/auth/login')) {
        return { status: 200, setCookie: ['TOKEN=abc; Path=/; HttpOnly'], body: '{}' };
      }
      return {
        status: 200,
        setCookie: [],
        body: JSON.stringify({
          meta: { rc: 'ok' },
          data: [
            {
              mac: 'FC:EC:DA:34:B1:24',
              name: '8SFL2-1',
              model: 'U7LR',
              type: 'uap',
              ip: '172.16.0.72',
              state: 1,
              uplink: { uplink_mac: 'AA:00:00:00:00:04', uplink_remote_port: 4 },
            },
            { name: 'no mac' },
          ],
        }),
      };
    };
    const client = createUnifiClient(
      { url: 'https://c:11443/', username: 'u', password: 'p', site: '02gt1bcf' },
      http,
    );
    expect(await client.devices()).toEqual([
      {
        mac: 'fc:ec:da:34:b1:24',
        name: '8SFL2-1',
        model: 'U7LR',
        type: 'uap',
        ip: '172.16.0.72',
        version: null,
        state: 1,
        uplinkMac: 'aa:00:00:00:00:04',
        uplinkPort: 4,
      },
    ]);
    expect(calls[1]?.url).toBe('https://c:11443/proxy/network/api/s/02gt1bcf/stat/device');
    expect(calls[1]?.headers['Cookie']).toBe('TOKEN=abc');
  });

  it('fails clearly on a rejected login', async () => {
    const http: HttpRequest = async () => ({ status: 401, setCookie: [], body: '' });
    const client = createUnifiClient(
      { url: 'https://c', username: 'u', password: 'p', site: 's' },
      http,
    );
    await expect(client.devices()).rejects.toThrow('unifi login: HTTP 401');
  });
});
