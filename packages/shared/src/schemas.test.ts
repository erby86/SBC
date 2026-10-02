import { describe, expect, it } from 'vitest';
import {
  BUILDING_CODES,
  cableCodeSchema,
  healthResponseSchema,
  locCodeSchema,
  outletCodeSchema,
  rackCodeSchema,
} from './index.js';

describe('BUILDING_CODES', () => {
  it('lists the 8 campus buildings', () => {
    expect(BUILDING_CODES).toEqual(['sp', 'i2', 'i1', 'b1', 'b2', 's8', 'ba', 'bb']);
  });
});

describe('label formats (ADR-0006)', () => {
  it('accepts the examples from design v1.2', () => {
    expect(outletCodeSchema.parse('B2-3-2310-05')).toBe('B2-3-2310-05');
    expect(rackCodeSchema.parse('RK-B2-SRV-01')).toBe('RK-B2-SRV-01');
    expect(cableCodeSchema.parse('FO-B2-BA-01')).toBe('FO-B2-BA-01');
    expect(cableCodeSchema.parse('CU-B1-B2-01')).toBe('CU-B1-B2-01');
    expect(locCodeSchema.parse('LOC-187')).toBe('LOC-187');
  });

  it('rejects unknown buildings and malformed labels', () => {
    expect(outletCodeSchema.safeParse('ZZ-3-2310-05').success).toBe(false);
    expect(outletCodeSchema.safeParse('b2-3-2310-05').success).toBe(false);
    expect(rackCodeSchema.safeParse('RK-ZZ-SRV-01').success).toBe(false);
    expect(cableCodeSchema.safeParse('XX-B2-BA-01').success).toBe(false);
    expect(locCodeSchema.safeParse('LOC-7').success).toBe(false);
  });
});

describe('healthResponseSchema', () => {
  it('requires status ok and a version', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok', version: '0.1.0' }).success).toBe(true);
    expect(healthResponseSchema.safeParse({ status: 'down', version: '0.1.0' }).success).toBe(
      false,
    );
  });
});
