/**
 * The numbers the agent panel shows, formatted the way a readout wants them.
 *
 * ONE PLACE, BECAUSE TWO FORMATS DRIFT. The per-request line and the session
 * totals draw the same four readings -- duration, tokens, tokens per second and
 * the cache-hit share -- and a second copy of "how do we write 1.2k" is how a
 * panel ends up saying `1200` in one row and `1.2k` in the next.
 *
 * NOTHING HERE THROWS OR INVENTS: a missing figure returns `null`, and the
 * caller leaves that clause out rather than printing `0` for something the
 * provider never reported.
 */
import type { TokenUsage } from './client';

/** `999`, `1.2k`, `12.3k`, `1.1M` -- compact, and exact below a thousand. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) {
    const thousands = value / 1_000;
    return `${thousands >= 100 ? String(Math.round(thousands)) : trimZero(thousands.toFixed(1))}k`;
  }
  return `${trimZero((value / 1_000_000).toFixed(1))}M`;
}

/** `1,234` -- for the tooltip and the details, where exactness is the point. */
export function formatExactTokens(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** `0.8s`, `12.3s`, `2m42s` -- one decimal under a minute, whole seconds over. */
export function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${trimZero(seconds.toFixed(1))}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/**
 * The running clock under 运行中: ALWAYS one decimal, and always one width.
 *
 * A settled duration can drop a zero tail (`3s`) because nothing redraws it. The
 * live one cannot: at 2.9s the row says `2.9s` and a moment later `3s`, which is a
 * character shorter and shifts every clause after it by one glyph on every tick.
 * So the live clock keeps `.0`, and pads the seconds past a minute for the same
 * reason.
 */
export function formatElapsed(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, '0')}s`;
}

/**
 * `20 tok/s`, or `null` while there is no window to divide by.
 *
 * A WINDOW SHORTER THAN 50 ms IS NOT A MEASUREMENT. Some providers (and any
 * buffering proxy) hand the whole answer over in one burst, so the decode window
 * collapses to a few milliseconds and the division reports tens of thousands of
 * tokens a second that the model never produced. Below the floor the clause is
 * left out rather than printing a number that is an artefact of the transport.
 */
export function formatSpeed(tokens: number, ms: number): string | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(ms) || tokens <= 0 || ms < 50) return null;
  return `${Math.max(1, Math.round(tokens / (ms / 1_000)))} tok/s`;
}

/**
 * Cache-hit share of the prompt side, as the percentage text DSH shows.
 *
 * A FULL HIT IS `100`, and anything that would round to 100 without being one
 * keeps a decimal instead -- `99.6` rather than a lie that reads as a perfect
 * hit. No billed input (or no cache figure) is `null`, not `0`.
 */
export function formatCacheHitPercent(cacheRead: number | null, input: number): string | null {
  if (cacheRead === null || !Number.isFinite(cacheRead) || cacheRead < 0) return null;
  if (!Number.isFinite(input) || input <= 0) return null;
  const percent = (Math.min(cacheRead, input) / input) * 100;
  if (percent >= 100) return '100';
  const rounded = Math.round(percent);
  return rounded < 100 ? String(rounded) : percent.toFixed(1);
}

/** The one-line reading of a request: `2.4s · 1.2k tok · 21 tok/s · 缓存 87% · ¥0.0004`. */
export function summariseRun(stats: {
  readonly llmMs: number;
  readonly decodeMs: number;
  readonly decodeTokens: number;
  readonly usage: TokenUsage | null;
  readonly costCny?: number | null;
}): string {
  const parts: string[] = [];
  const duration = formatDuration(stats.llmMs);
  if (duration !== null) parts.push(duration);
  if (stats.usage !== null) parts.push(`${formatTokens(stats.usage.total)} tok`);
  const speed = formatSpeed(stats.decodeTokens, stats.decodeMs);
  if (speed !== null) parts.push(speed);
  if (stats.usage !== null) {
    const cache = formatCacheHitPercent(stats.usage.cacheRead, stats.usage.input);
    if (cache !== null) parts.push(`缓存 ${cache}%`);
  }
  const cost = formatCost(stats.costCny ?? null);
  if (cost !== null) parts.push(cost);
  return parts.join(' · ');
}

/**
 * `¥0.0004`, `¥1.23` -- CNY, with enough places to see a cheap request.
 *
 * Four decimals below a yuan because a small circuit costs a fraction of one;
 * below ¥0.0001 the text says so rather than printing a row of zeroes. A missing
 * cost (unknown model, or no usage reported) is `null` and is left out of the row.
 */
export function formatCost(cny: number | null): string | null {
  if (cny === null || !Number.isFinite(cny) || cny <= 0) return null;
  if (cny < 0.0001) return '<¥0.0001';
  if (cny < 1) return `¥${cny.toFixed(4)}`;
  return `¥${cny.toFixed(2)}`;
}

/** `999`, `1.2k` with no zero tail -- `1.0k` reads as a rounded value it is not. */
function trimZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}
