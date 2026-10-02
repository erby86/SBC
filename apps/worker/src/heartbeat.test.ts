import { describe, expect, it, vi } from 'vitest';
import { beat, HEARTBEAT_KEY } from './heartbeat.js';

describe('beat', () => {
  it('writes the heartbeat key with a TTL', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    await beat({ set }, 90, new Date('2026-10-02T00:00:00Z'));
    expect(set).toHaveBeenCalledWith(HEARTBEAT_KEY, '2026-10-02T00:00:00.000Z', 'EX', 90);
  });
});
