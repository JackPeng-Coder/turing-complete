import type { LevelSpec } from '../../spec';
import { CH2_BATCH1 } from './batch1';
import { CH2_BATCH2 } from './batch2';
import { CH2_BATCH3 } from './batch3';
import { CH2_BATCH4 } from './batch4';

/**
 * 第 2 章：由四个批次拼成。
 *
 * 本章按四个批次写成（第 13~17、18~22、23~27、28~38 关），让每位作者拥有一个
 * 自包含的文件；这里是它们唯一的汇合点，其他文件都不应直接 import 某个批次——
 * 只有批次自己的测试会直接 import 它以按该文件评分。
 *
 * 下面的顺序就是本章的顺序：`content/index.ts` 把这个数组接在第 1 章两半之后，
 * 于是四个批次以第 13..38 关的身份进入游戏，中间没有别的关卡。
 * `test/levels/unlock-chain.test.ts` 用数字钉住这一点：26 关，index 13~38，
 * 连续且唯一。
 *
 * `CH2_LEVELS` 曾经只是批次 1 的汇合点，`test/levels/ch2-batch1.test.ts` 也曾断言
 * 本章恰好是那一段。现在两者都不在了：本章是全部四个批次，批次自己的测试只检查
 * 它的那一段排在前面（见该文件的「is the first slice of the assembled chapter」）。
 */
/**
 * 第 2 章完整的 26 关，按批次顺序拼接；最终顺序由 `content/index.ts` 按 `index` 排序确定。
 */
export const CH2_LEVELS: readonly LevelSpec[] = [
  ...CH2_BATCH1,
  ...CH2_BATCH2,
  ...CH2_BATCH3,
  ...CH2_BATCH4,
];
