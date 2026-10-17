import { describe, expect, it } from 'vitest';
import {
  formatCacheHitPercent,
  formatDuration,
  formatExactTokens,
  formatSpeed,
  formatTokens,
  summariseRun,
} from '../../src/agent/format';

describe('token counts', () => {
  it('is exact under a thousand and compact over it', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_000)).toBe('1k');
    expect(formatTokens(1_200)).toBe('1.2k');
    expect(formatTokens(12_345)).toBe('12.3k');
    expect(formatTokens(100_000)).toBe('100k');
    expect(formatTokens(1_100_000)).toBe('1.1M');
  });

  it('keeps an exact rendering for tooltips', () => {
    expect(formatExactTokens(1_234)).toBe('1,234');
    expect(formatExactTokens(1_234_567)).toBe('1,234,567');
  });
});

describe('durations', () => {
  it('is one decimal under a minute and whole seconds over it', () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(800)).toBe('0.8s');
    expect(formatDuration(2_400)).toBe('2.4s');
    expect(formatDuration(60_000)).toBe('1m0s');
    expect(formatDuration(162_000)).toBe('2m42s');
  });
});

describe('speed', () => {
  it('divides output tokens by the decode window', () => {
    expect(formatSpeed(40, 2_000)).toBe('20 tok/s');
    expect(formatSpeed(1, 100_000)).toBe('1 tok/s');
  });

  it('says nothing when there is no window or no tokens', () => {
    expect(formatSpeed(0, 2_000)).toBeNull();
    expect(formatSpeed(40, 0)).toBeNull();
  });
});

describe('cache-hit share', () => {
  it('is an integer percentage, and exactly 100 only for a full hit', () => {
    expect(formatCacheHitPercent(1_000, 1_200)).toBe('83');
    expect(formatCacheHitPercent(1_200, 1_200)).toBe('100');
    expect(formatCacheHitPercent(0, 1_200)).toBe('0');
  });

  it('keeps a decimal when integer rounding would read as a full hit', () => {
    expect(formatCacheHitPercent(999, 1_000)).toBe('99.9');
  });

  it('is unknown without a cache figure or without billed input', () => {
    expect(formatCacheHitPercent(null, 1_200)).toBeNull();
    expect(formatCacheHitPercent(100, 0)).toBeNull();
  });
});

describe('a run’s one-line reading', () => {
  it('joins the four readings in the order the panel shows them', () => {
    expect(
      summariseRun({
        llmMs: 2_400,
        decodeMs: 2_000,
        decodeTokens: 40,
        usage: { input: 1_200, output: 40, total: 1_240, cacheRead: 1_000 },
      }),
    ).toBe('2.4s · 1.2k tok · 20 tok/s · 缓存 83%');
  });

  it('leaves out whatever was not measured', () => {
    expect(
      summariseRun({ llmMs: 1_200, decodeMs: 0, decodeTokens: 0, usage: null }),
    ).toBe('1.2s');
  });
});
