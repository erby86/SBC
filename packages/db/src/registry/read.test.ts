import { describe, expect, it } from 'vitest';
import { toWaypoints } from './read.js';

describe('toWaypoints', () => {
  it('keeps [x, z] pairs and {x, z} objects and drops the rest', () => {
    expect(
      toWaypoints([[1, 2], { x: 3, z: 4 }, [5], { x: 'a', z: 1 }, null, [Infinity, 0]]),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('gives an empty list for anything that is not an array', () => {
    expect(toWaypoints(null)).toEqual([]);
    expect(toWaypoints({ x: 1, z: 2 })).toEqual([]);
  });
});
