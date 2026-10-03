import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

class SilentWebSocket {
  onmessage = null;
  onclose = null;
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', SilentWebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the system name', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<App />);
    expect(screen.getByRole('heading', { name: 'SBC NOC' })).toBeDefined();
  });

  it('shows the API version when /api/health answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ok', version: '0.2.0' }))),
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByTestId('api-status').at(-1)?.textContent).toContain('v0.2.0');
    });
  });

  it('shows offline when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('down'))),
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByTestId('api-status').at(-1)?.textContent).toContain('ออฟไลน์');
    });
  });
});
