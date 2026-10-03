import { describe, expect, it } from 'vitest';
import { desiredTags, type DeviceTags } from './zabbix-tags.js';

const device: DeviceTags = {
  id: '1',
  code: 'm-i2',
  hostname: null,
  mgmtIp: '192.168.1.21',
  building: 'i2',
  floor: 1,
  loc: null,
  role: 'main',
  uplink: 'c1036',
};

describe('desiredTags', () => {
  it('sets managed tags from the registry and omits empty ones', () => {
    expect(desiredTags([], device)).toEqual([
      { tag: 'building', value: 'i2' },
      { tag: 'floor', value: '1' },
      { tag: 'role', value: 'main' },
      { tag: 'uplink', value: 'c1036' },
    ]);
  });

  it('keeps tags it does not manage and replaces stale managed ones', () => {
    const current = [
      { tag: 'vendor', value: 'LINK' },
      { tag: 'building', value: 'old' },
      { tag: 'loc', value: 'LOC-999' },
    ];
    const tags = desiredTags(current, { ...device, loc: 'LOC-187' });
    expect(tags).toContainEqual({ tag: 'vendor', value: 'LINK' });
    expect(tags).toContainEqual({ tag: 'building', value: 'i2' });
    expect(tags).toContainEqual({ tag: 'loc', value: 'LOC-187' });
    expect(tags.filter((t) => t.tag === 'building')).toHaveLength(1);
  });
});
