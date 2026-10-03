import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegistryChecks } from './RegistryChecks.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RegistryChecks', () => {
  it('summarises errors and warnings', async () => {
    const report = {
      generatedAt: '2026-10-02T00:00:00.000Z',
      errors: 2,
      warnings: 1,
      checks: [
        {
          check: 'not_in_zabbix',
          severity: 'error',
          title: 'ยังไม่จับคู่ Zabbix',
          count: 2,
          items: [
            { code: 'c2116', name: 'CCR2116', detail: 'core' },
            { code: 'c1036', name: 'CCR1036', detail: 'core' },
          ],
        },
        { check: 'no_room', severity: 'warning', title: 'ไม่มีห้อง', count: 1, items: [] },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(report))),
    );
    render(<RegistryChecks />);
    await waitFor(() => {
      expect(screen.getByTestId('checks-summary').textContent).toContain('ข้อผิดพลาด 2');
    });
    expect(screen.getByText('c2116')).toBeDefined();
  });
});
