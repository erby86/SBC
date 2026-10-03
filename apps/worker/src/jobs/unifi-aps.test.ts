import { describe, expect, it } from 'vitest';
import { createUnifiClient, type HttpRequest } from '../connectors/unifi.js';
import { apCode, parseApName } from './unifi-aps.js';

describe('parseApName', () => {
  it('reads building, floor and number from the names used in UniFi (2026-10-03)', () => {
    expect(parseApName('8SFL2-1')).toEqual({ building: 's8', floor: 2, no: '1' });
    expect(parseApName('8SFL8-4')).toEqual({ building: 's8', floor: 8, no: '4' });
    expect(parseApName('A6-2')).toEqual({ building: 'ba', floor: 6, no: '2' });
    expect(parseApName('AF2-1201')).toEqual({ building: 'ba', floor: 2, no: '1201' });
    expect(parseApName('BFL3-5')).toEqual({ building: 'bb', floor: 3, no: '5' });
    expect(parseApName('BF5-2')).toEqual({ building: 'bb', floor: 5, no: '2' });
    expect(apCode({ building: 's8', floor: 2, no: '1' })).toBe('ap-s8-2-1');
  });

  it('gives no place for default or free-form names', () => {
    for (const n of [
      'AC LR',
      'AC Mesh',
      'Canteen AC LR',
      'ITB AC LRA',
      'UAP-AC-7AP1F',
      'UAP-AC-LRA12',
      '',
    ]) {
      expect(parseApName(n)).toBeNull();
    }
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
