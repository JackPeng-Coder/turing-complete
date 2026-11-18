import type { LevelSpec } from '../spec';
import { CH1_PART1 } from './ch1/part1';
import { CH1_PART2 } from './ch1/part2';
import { CH2_LEVELS } from './ch2/index';
import { CH3_LEVELS } from './ch3/index';
import { CH4_LEVELS } from './ch4/index';

/**
 * 游戏发布的所有关卡，按游玩顺序排列：第 1 章（第 1~13 关）、第 2 章（第 14~39 关）、
 * 第 3 章（第 40~49 关）、第 4 章（第 50~56 关）。
 *
 * 这里是各章之间唯一的汇合点。`levels/index.ts` 把它变成 `LEVELS` / `LEVEL_ORDER`：
 * 应用按这个顺序遍历关卡，`isUnlocked` 以它为解锁依据，`test/levels/` 下的整套测试
 * 也按它遍历。因此，一个章节即使写完了、测试全绿，只要没有追加到这里，玩家就永远
 * 看不到它。第 2 章在组装前就是这个状态：26 关里已有 22 关，却没有一关能玩到；
 * 第 3 章完整重演了同一个错误；第 4 章是第三个例证（七个关卡两次交付都全绿，直到
 * 下面这一行点名才可达）——这就是「章节只有在被本文件列入后才算完成」这条规则的三个证据。
 *
 * 文件归属不再代表顺序，所以这里按 `index` 排序。关卡的 `index` 是它的全局位置，
 * `src/levels/campaign.ts` 是固定这个位置的表格；2.x 改版把一些关卡在批次文件之间
 * 挪动过（例如第 2 章的 `circular-dependency` 和 `delayed-lines` 现在是本章第 4、7 关，
 * 却仍和旧邻居一起放在 `ch2/batch4.ts`），所以各文件的分布只是「哪个任务写了什么」的记录，
 * 不是运行顺序。在这里排序之后，第 n+1 关就是 `LEVEL_ORDER[n+1]`，这是构造出来的不变量，
 * 也正是 `isUnlocked`（只看紧邻的前一关）所依赖的前提；最终结果由
 * `test/levels/campaign-shape.test.ts` 对照 campaign 表校验。
 */
export const ALL_LEVELS: readonly LevelSpec[] = [
  ...CH1_PART1,
  ...CH1_PART2,
  ...CH2_LEVELS,
  ...CH3_LEVELS,
  ...CH4_LEVELS,
].sort((a, b) => a.index - b.index);
