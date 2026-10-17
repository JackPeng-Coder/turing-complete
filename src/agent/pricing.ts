/**
 * What a request costs, from DeepSeek's published price list.
 *
 * SOURCE: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ (read
 * 2026-10-17). Prices are CNY per MILLION tokens and are separated into the
 * three buckets the provider bills: cache-hit prompt tokens, cache-miss prompt
 * tokens, and output tokens.
 *
 * PEAK AND IDLE, AND WHAT THIS FILE CANNOT KNOW. The page says idle hours cost
 * half of peak, and that Beijing time Monday-Friday outside 09:00-12:00 and
 * 14:00-18:00 is idle -- with Chinese public holidays counting as idle all day.
 * The weekday and the hours are implemented; the holiday calendar is not, because
 * a hand-written calendar is wrong the moment the State Council publishes the next
 * year's. A holiday weekday inside those hours is therefore priced at peak here:
 * this is a readout, not an invoice, and over-charging in the estimate is the
 * safer error of the two.
 *
 * UNKNOWN MODELS HAVE NO COST. A model outside the table returns `null` and the
 * panel leaves the cost clause out: a guessed price is worse than no price.
 */
import type { TokenUsage } from './client';

/** CNY per million tokens, at peak hours. */
export interface TokenPrice {
  /** Prompt tokens the provider served from its cache. */
  readonly cacheHit: number;
  /** Prompt tokens it did not. */
  readonly cacheMiss: number;
  /** Tokens the model wrote. */
  readonly output: number;
}

/** Peak-hour prices, CNY per million tokens. Idle is half (see `isPeakHour`). */
export const PEAK_PRICES: Readonly<Record<string, TokenPrice>> = {
  'deepseek-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
  // The page says the old Flash names still route to the Flash model and bill at
  // its price, so they read the same three numbers.
  'deepseek-v4-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  'deepseek-v4-flash-vision-exp': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
};

/** What an idle hour multiplies every bucket by. */
export const IDLE_FACTOR = 0.5;

/**
 * Whether the given instant falls in a DeepSeek peak window (Beijing time).
 *
 * Beijing is UTC+8 all year, so the shift can be done arithmetically without a
 * time-zone library; `getUTCDay`/`getUTCHours` on the shifted instant are the
 * wall-clock day and hour in Beijing.
 */
export function isPeakHour(at: Date): boolean {
  const beijing = new Date(at.getTime() + 8 * 60 * 60 * 1_000);
  const day = beijing.getUTCDay(); // 0 = Sunday
  const hour = beijing.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
}

/** The table row for a model at an instant, or `null` when it is not published. */
export function priceFor(model: string, at: Date): TokenPrice | null {
  const peak = PEAK_PRICES[model.trim().toLowerCase()];
  if (peak === undefined) return null;
  if (isPeakHour(at)) return peak;
  return {
    cacheHit: peak.cacheHit * IDLE_FACTOR,
    cacheMiss: peak.cacheMiss * IDLE_FACTOR,
    output: peak.output * IDLE_FACTOR,
  };
}

/**
 * The three-bucket cost of one usage record, in CNY, or `null` when unknown.
 *
 * A provider that reports no cache figure is billed as if every prompt token
 * missed the cache: that is what the invoice would say, and it keeps the estimate
 * from claiming a discount nobody saw.
 */
export function costOf(model: string, usage: TokenUsage, at: Date): number | null {
  const price = priceFor(model, at);
  if (price === null) return null;
  const cached = Math.min(Math.max(usage.cacheRead ?? 0, 0), Math.max(usage.input, 0));
  const uncached = Math.max(0, usage.input - cached);
  return (
    (cached * price.cacheHit + uncached * price.cacheMiss + Math.max(usage.output, 0) * price.output) /
    1_000_000
  );
}
