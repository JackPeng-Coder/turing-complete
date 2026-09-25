import { describe, expect, it } from 'vitest';
import { LEVEL_ORDER } from '../../src/levels/index';

describe('sanity', () => {
  it('exposes the level order list', () => {
    expect(Array.isArray(LEVEL_ORDER)).toBe(true);
  });
});
