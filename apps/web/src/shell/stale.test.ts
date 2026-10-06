import { describe, expect, it } from 'vitest';
import { STALE_TEXT, sinceText, staleCause } from './stale.js';

describe('staleCause', () => {
  it('is null when the browser is online, the server answers and Zabbix is fresh', () => {
    expect(staleCause({ online: true, link: 'ok', stale: false })).toBeNull();
    expect(staleCause({ online: true, link: 'ok', stale: undefined })).toBeNull();
  });

  it('blames the nearest broken hop first: this computer, then the server, then Zabbix', () => {
    expect(staleCause({ online: false, link: 'down', stale: true })).toBe('offline');
    expect(staleCause({ online: true, link: 'down', stale: true })).toBe('server');
    expect(staleCause({ online: true, link: 'ok', stale: true })).toBe('zabbix');
  });
});

describe('STALE_TEXT', () => {
  it('counts retries only once there has been one', () => {
    expect(STALE_TEXT.server.detail(0)).not.toContain('ครั้งที่');
    expect(STALE_TEXT.server.detail(3)).toContain('ครั้งที่ 3');
  });
});

describe('sinceText', () => {
  const now = Date.parse('2026-10-06T10:00:00+07:00');
  it('reads in minutes, then hours', () => {
    expect(sinceText(undefined, now)).toBe('ยังไม่เคยได้ข้อมูล');
    expect(sinceText('2026-10-06T09:59:30+07:00', now)).toBe('ไม่ถึง 1 นาทีที่แล้ว');
    expect(sinceText('2026-10-06T09:56:00+07:00', now)).toBe('4 นาทีที่แล้ว');
    expect(sinceText('2026-10-06T07:00:00+07:00', now)).toBe('3 ชั่วโมงที่แล้ว');
  });
});
