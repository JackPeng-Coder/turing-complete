/**
 * 关卡注册表的唯一入口：把 content/ 下各章节的关卡汇总成线性列表、id 顺序
 * 与 id 索引，对外提供查询。
 *
 * 依赖下层 `content/index.ts`（各章节关卡汇总）与 `spec.ts`（关卡规格类型）；
 * 被 `main.ts`、`persist/`、智能体与测试共同使用。凡是“当前关卡是什么”
 * “下一关是哪一关”“第 N 章有哪些关”的问题都应走这里，而不是自己拼数组。
 *
 * 关键不变量：`LEVELS` 的顺序就是战役顺序，`LEVEL_ORDER` 是它的 id 投影，
 * 两者发布后只读；顺序本身由 `campaign.ts` 的表格与测试保证。
 */

import { ALL_LEVELS } from './content/index';
import type { LevelSpec } from './spec';

/**
 * 全部已发布关卡，按战役顺序排列（章节内按关卡序号递增）。
 *
 * 这份数组是“战役包含哪些关”的运行时权威：章节地图、解锁链、恢复存档
 * 都从它出发。它是只读的，调用方不得就地排序或修改。
 */
export const LEVELS: readonly LevelSpec[] = ALL_LEVELS;
/**
 * 关卡 id 的线性顺序，用来回答“下一关是谁”“当前是第几关”。
 *
 * 它由 `LEVELS` 投影而来，因此两者永远保持一致；测试按下标比较它来验证
 * 战役顺序。
 */
export const LEVEL_ORDER: readonly string[] = LEVELS.map((l) => l.id);

/** id 到关卡规格的索引，在模块加载时一次性建好，避免每次查询都线性扫描。 */
const byId = new Map(LEVELS.map((l) => [l.id, l]));

/**
 * 按 id 取关卡规格。
 *
 * 未知 id 直接抛错而不是返回 undefined：打开关卡、判定、恢复存档的调用方
 * 都默认“关卡存在”，静默的 undefined 只会把错误推迟到更难定位的地方。
 *
 * @param id 关卡 id（形如 `ch2-14-binary-racer`，与 `campaign.ts` 一致）。
 * @returns 对应的关卡规格对象（各关卡共享同一份，调用方不要修改它）。
 * @throws 当 id 不匹配任何已发布关卡时抛出 Error。
 */
export function getLevel(id: string): LevelSpec {
  const level = byId.get(id);
  if (!level) throw new Error(`unknown level: ${id}`);
  return level;
}

/**
 * 取某一章的全部关卡，保持战役顺序。
 *
 * 参数是章节号（从 1 开始），不是全局 index；沙盒的 chapter 为 0，但它不在
 * `LEVELS` 里，所以这里永远取不到它。
 *
 * @param chapter 章节号。
 * @returns 该章的关卡列表；章节不存在时是空数组。
 */
export function levelsOfChapter(chapter: number): readonly LevelSpec[] {
  return LEVELS.filter((l) => l.chapter === chapter);
}

/** 再导出关卡规格类型，让只关心类型的调用方不必写 `./spec` 的深路径。 */
export type { LevelSpec };
