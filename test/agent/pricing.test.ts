import { describe, expect, it } from 'vitest';
import { costOf, IDLE_FACTOR, isPeakHour, priceFor } from '../../src/agent/pricing';

/**
 * Beijing wall-clock fixtures, written in UTC.
 *
 * 2026-10-19 is a Monday; 2026-10-17 a Saturday. Beijing is UTC+8 all year, so
 * 02:00Z is 10:00 there.
 */
const MONDAY_10 = new Date('2026-10-19T02:00:00Z');
const MONDAY_08 = new Date('2026-10-19T00:00:00Z');
const MONDAY_18 = new Date('2026-10-19T10:00:00Z');
const SATURDAY_10 = new Date('2026-10-17T02:00:00Z');

describe('peak hours', () => {
  it('are the two weekday windows, Beijing time', () => {
    expect(isPeakHour(MONDAY_10)).toBe(true);
    expect(isPeakHour(MONDAY_08)).toBe(false);
    expect(isPeakHour(MONDAY_18)).toBe(false);
  });

  it('are never the weekend', () => {
    expect(isPeakHour(SATURDAY_10)).toBe(false);
  });
});

describe('the price table', () => {
  it('reads DeepSeek’s published peak prices', () => {
    expect(priceFor('deepseek-flash', MONDAY_10)).toEqual({ cacheHit: 0.04, cacheMiss: 2, output: 8 });
    expect(priceFor('deepseek-v4-pro', MONDAY_10)).toEqual({ cacheHit: 0.3, cacheMiss: 9, output: 27 });
  });

  it('halves every bucket in an idle window', () => {
    expect(priceFor('deepseek-flash', MONDAY_08)).toEqual({
      cacheHit: 0.04 * IDLE_FACTOR,
      cacheMiss: 2 * IDLE_FACTOR,
      output: 8 * IDLE_FACTOR,
    });
  });

  it('is unknown for a model that is not published', () => {
    expect(priceFor('some-other-model', MONDAY_10)).toBeNull();
  });
});

describe('the cost of a usage record', () => {
  const usage = { input: 1_200, output: 40, total: 1_240, cacheRead: 1_000 };

  it('bills the three buckets separately: cache hits, misses, output', () => {
    // 1000 * 0.04 + 200 * 2 + 40 * 8 = 760 per million CNY.
    expect(costOf('deepseek-flash', usage, MONDAY_10)).toBeCloseTo(0.00076, 10);
  });

  it('uses the idle price outside the windows', () => {
    expect(costOf('deepseek-flash', usage, MONDAY_08)).toBeCloseTo(0.00038, 10);
  });

  it('treats an absent cache figure as a miss, which is what the invoice would say', () => {
    const noCache = { input: 1_200, output: 40, total: 1_240, cacheRead: null };
    // 1200 * 2 + 40 * 8 = 2720 per million CNY.
    expect(costOf('deepseek-flash', noCache, MONDAY_10)).toBeCloseTo(0.00272, 10);
  });

  it('is unknown for a model with no published prices', () => {
    expect(costOf('some-other-model', usage, MONDAY_10)).toBeNull();
  });
});
