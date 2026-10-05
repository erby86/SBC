import { describe, expect, it, vi } from 'vitest';
import { beat, HEARTBEAT_KEY, writeQueueState, type QueueProbe } from './heartbeat.js';

describe('beat', () => {
  it('writes the heartbeat key with a TTL', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    await beat({ set }, 90, new Date('2026-10-02T00:00:00Z'));
    expect(set).toHaveBeenCalledWith(HEARTBEAT_KEY, '2026-10-02T00:00:00.000Z', 'EX', 90);
  });
});

describe('writeQueueState', () => {
  const now = new Date('2026-10-05T00:00:00Z');

  it('stores counts and the enqueue time of the oldest waiting job', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({ wait: 2, active: 1, delayed: 0, failed: 3 }),
      getJobs: vi.fn().mockResolvedValue([{ timestamp: Date.parse('2026-10-04T23:58:00Z') }]),
    };
    const state = await writeQueueState({ set }, queue as unknown as QueueProbe, 90, now);
    expect(queue.getJobs).toHaveBeenCalledWith(['wait', 'prioritized'], 0, 0, true);
    expect(state).toEqual({
      at: '2026-10-05T00:00:00.000Z',
      counts: { wait: 2, active: 1, delayed: 0, failed: 3 },
      oldestWaitingAt: '2026-10-04T23:58:00.000Z',
    });
    expect(set).toHaveBeenCalledWith('worker:queue', JSON.stringify(state), 'EX', 90);
  });

  it('has no oldest job when nothing waits', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({}),
      getJobs: vi.fn().mockResolvedValue([]),
    };
    expect(
      (await writeQueueState({ set }, queue as unknown as QueueProbe, 90, now)).oldestWaitingAt,
    ).toBeNull();
  });
});
