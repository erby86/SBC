import { describe, expect, it } from 'vitest';
import { plainMessage } from './messages.js';

describe('plainMessage', () => {
  it('translates common Zabbix problems and keeps the extra-problem count', () => {
    expect(plainMessage('TP-LINK: Unavailable by ping (+1 ปัญหา)')).toBe(
      'ติดต่ออุปกรณ์ไม่ได้ (ไม่ตอบ ping) (+1 ปัญหา)',
    );
    expect(plainMessage('TP-LINK: No SNMP data collection')).toBe('ไม่ได้รับข้อมูลสถิติ (SNMP)');
    expect(plainMessage('TP-LINK: Interface Gi1/0/24(): Link down')).toBe('พอร์ตเชื่อมต่อหลุด');
    expect(plainMessage('High ICMP ping loss')).toBe('สัญญาณขาดหายบางส่วน (packet loss)');
    expect(plainMessage('packet loss 4%')).toBe('สัญญาณขาดหายบางส่วน (packet loss) 4%');
  });

  it('leaves Thai and unknown messages as they are', () => {
    expect(plainMessage('ไม่ตอบ ping')).toBe('ไม่ตอบ ping');
    expect(plainMessage('ไฟเบอร์ latency 38 ms (ปกติต่ำกว่า 2 ms)')).toBe(
      'ไฟเบอร์ latency 38 ms (ปกติต่ำกว่า 2 ms)',
    );
    expect(plainMessage('Something unusual happened')).toBe('Something unusual happened');
  });
});
