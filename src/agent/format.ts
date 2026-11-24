/**
 * 智能体面板上显示的各类读数，按「仪表」该有的方式格式化。
 *
 * 集中在一处，是因为两份格式迟早会走样：
 * 每次请求的一行和整场会话的合计要显示同样四个读数——耗时、token 数、
 * 每秒 token 数、缓存命中率；如果再各写一份「1.2k 怎么打」，
 * 面板就会在一行里显示 1200、下一行显示 1.2k。
 *
 * 这里的函数不抛异常、也不编造数字：
 * 缺一项就返回 null，由调用方整段省略，
 * 而不是为对方从未上报过的量打印一个 0。
 */
import type { TokenUsage } from './client';

/** 999、1.2k、12.3k、1.1M——紧凑；一千以内保持精确。 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) {
    const thousands = value / 1_000;
    return `${thousands >= 100 ? String(Math.round(thousands)) : trimZero(thousands.toFixed(1))}k`;
  }
  return `${trimZero((value / 1_000_000).toFixed(1))}M`;
}

/** 1,234——给悬浮提示和明细用，那里要的就是精确。 */
export function formatExactTokens(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** 0.8s、12.3s、2m42s——不足一分钟保留一位小数，超过一分钟就写整秒。 */
export function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${trimZero(seconds.toFixed(1))}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/**
 * 「运行中」下面那只看实时走动的钟：固定一位小数，而且宽度固定。
 *
 * 已经停下的耗时可以省掉 .0 尾巴（如 3s），因为它不再重绘；
 * 实时这只不行：2.9 秒时行里写 2.9s，一眨眼变成 3s，
 * 少了一个字符，后面每个子句都跟着左移一格，每跳一次就抖一次。
 * 所以实时时钟保留 .0；超过一分钟时把秒数补成两位，理由相同。
 */
export function formatElapsed(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, '0')}s`;
}

/**
 * 20 tok/s；还没有可除的时间窗口时返回 null。
 *
 * 短于 50 毫秒的窗口不算一次测量。
 * 有些服务商（以及任何带缓冲的代理）会把整个答案一次性吐完，
 * 解码窗口缩到几毫秒，一除就报出每秒几万个 token，
 * 而模型根本没有产生过这个速度。低于下限就整段省略，
 * 不打印一个由传输方式造成的假数字。
 */
export function formatSpeed(tokens: number, ms: number): string | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(ms) || tokens <= 0 || ms < 50) return null;
  return `${Math.max(1, Math.round(tokens / (ms / 1_000)))} tok/s`;
}

/**
 * 提示词一侧的缓存命中率，按同类工具显示的口径写成百分比文本。
 *
 * 完全命中是 100；任何「会被四舍五入成 100、但实际不是 100」的值
 * 保留一位小数——写 99.6，而不是写一个看起来像完美命中的谎报。
 * 没有计费输入（或对方没给缓存数字）时是 null，不是 0。
 */
export function formatCacheHitPercent(cacheRead: number | null, input: number): string | null {
  if (cacheRead === null || !Number.isFinite(cacheRead) || cacheRead < 0) return null;
  if (!Number.isFinite(input) || input <= 0) return null;
  const percent = (Math.min(cacheRead, input) / input) * 100;
  if (percent >= 100) return '100';
  const rounded = Math.round(percent);
  return rounded < 100 ? String(rounded) : percent.toFixed(1);
}

/** 把一次请求写成一行读数：2.4s · 1.2k tok · 21 tok/s · 缓存 87% · ¥0.0004。 */
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
 * ¥0.0004、¥1.23——人民币，小数位多到能看见一次便宜的请求。
 *
 * 一元以下保留四位小数，因为一块小电路只花零点几元的一小部分；
 * 低于 ¥0.0001 时直接写「小于」，而不是打印一排 0。
 * 算不出费用（未知模型，或对方没报用量）返回 null，这一项从行里省略。
 */
export function formatCost(cny: number | null): string | null {
  if (cny === null || !Number.isFinite(cny) || cny <= 0) return null;
  if (cny < 0.0001) return '<¥0.0001';
  if (cny < 1) return `¥${cny.toFixed(4)}`;
  return `¥${cny.toFixed(2)}`;
}

/** 999、1.2k，不带 .0 尾巴；1.0k 看起来像一个其实并不存在的「约值」。 */
function trimZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}
