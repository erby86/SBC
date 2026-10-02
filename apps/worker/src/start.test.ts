import { describe, expect, it, vi } from 'vitest';
import { start } from './start.js';

describe('worker start', () => {
  it('logs that the worker started', () => {
    const info = vi.fn();
    start({ info });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('worker started'));
  });
});
