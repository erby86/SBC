import { describe, expect, it } from 'vitest';
import { BUILDING_CODES, healthResponseSchema, lanPointLabelSchema } from './index.js';

describe('BUILDING_CODES', () => {
  it('lists the 8 campus buildings', () => {
    expect(BUILDING_CODES).toEqual(['sp', 'i2', 'i1', 'b1', 'b2', 's8', 'ba', 'bb']);
  });
});

describe('lanPointLabelSchema', () => {
  it('accepts a valid label', () => {
    expect(lanPointLabelSchema.parse('b1-2-205-01')).toBe('b1-2-205-01');
  });

  it('rejects an unknown building', () => {
    expect(lanPointLabelSchema.safeParse('zz-2-205-01').success).toBe(false);
  });

  it('rejects a malformed label', () => {
    expect(lanPointLabelSchema.safeParse('b1-205-1').success).toBe(false);
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
