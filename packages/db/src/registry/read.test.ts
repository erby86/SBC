import { describe, expect, it } from 'vitest';
import { toWaypoints } from './read.js';

describe('toWaypoints', () => {
  it('keeps [x, z], [x, y, z] and {x, y?, z} and drops the rest', () => {
    expect(
      toWaypoints([
        [1, 2],
        [1, 0.5, 2],
        { x: 3, z: 4 },
        { x: 3, y: 0.6, z: 4 },
        [5],
        { x: 'a', z: 1 },
        null,
        [Infinity, 0],
      ]),
    ).toEqual([
      [1, 2],
      [1, 0.5, 2],
      [3, 4],
      [3, 0.6, 4],
    ]);
  });

  it('gives an empty list for anything that is not an array', () => {
    expect(toWaypoints(null)).toEqual([]);
    expect(toWaypoints({ x: 1, z: 2 })).toEqual([]);
  });
});
