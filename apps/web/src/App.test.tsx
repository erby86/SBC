import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('App', () => {
  it('shows the system name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'SBC NOC' })).toBeDefined();
  });
});
