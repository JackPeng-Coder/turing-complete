/**
 * 一次请求要花多少钱，依据 DeepSeek 公布的价格表。
 *
 * 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/（读取于 2026-10-17）。
 * 价格单位是「元 / 百万 token」，按对方实际计费的三个桶分开：
 * 命中缓存的提示词 token、未命中缓存的提示词 token、模型输出的 token。
 *
 * 高峰与空闲，以及本文件无法知道的事。价格页说空闲时段是高峰的一半，
 * 北京时间周一至周五 09:00-12:00、14:00-18:00 之外算空闲，
 * 中国法定节假日整天都算空闲。星期和钟点在这里实现了，
 * 节假日日历没有实现——手写的日历在国务院公布下一年安排的那一刻就会出错。
 * 于是高峰时段内的法定节假日工作日，这里按高峰计价：
 * 这只是读数不是账单，估算时多算一点是两种错误里更安全的那个。
 *
 * 未知模型不算钱。不在价格表里的模型返回 null，面板会把费用那段省略：
 * 猜出来的价格比没有价格更糟。
 */
import type { TokenUsage } from './client';

/** 高峰时段的价格：元 / 百万 token。 */
export interface TokenPrice {
  /** 对方从自己的缓存里提供的那部分提示词 token。 */
  readonly cacheHit: number;
  /** 没有命中缓存的提示词 token。 */
  readonly cacheMiss: number;
  /** 模型写出的 token。 */
  readonly output: number;
}

/** 高峰价，元 / 百万 token。空闲时段减半，见 isPeakHour。 */
export const PEAK_PRICES: Readonly<Record<string, TokenPrice>> = {
  'deepseek-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
  // 价格页说旧的 Flash 名字仍然路由到 Flash 模型并按它的价格计费，
  // 所以这三个数字相同。
  'deepseek-v4-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  'deepseek-v4-flash-vision-exp': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
};

/** 空闲时段对每一个价格桶乘的系数。 */
export const IDLE_FACTOR = 0.5;

/**
 * 给定时刻是否落在 DeepSeek 的高峰时段内（北京时间）。
 *
 * 北京全年都是 UTC+8，所以不用时区库，直接做算术平移即可；
 * 对平移后的时间调用 getUTCDay/getUTCHours，
 * 得到的就是北京时间的「星期几」和「几点」。
 */
export function isPeakHour(at: Date): boolean {
  const beijing = new Date(at.getTime() + 8 * 60 * 60 * 1_000);
  const day = beijing.getUTCDay(); // 0 表示星期日
  const hour = beijing.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
}

/** 某个模型在某个时刻对应的价格行；价格未公布时返回 null。 */
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
 * 一条 usage 记录按三个桶算出的费用（元）；未知模型返回 null。
 *
 * 如果对方没有报缓存数字，就当作所有提示词 token 都没命中缓存：
 * 账单本来就会这样算，也免得估算凭空声称一个谁也没见过的折扣。
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
