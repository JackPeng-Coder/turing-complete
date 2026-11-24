// 第 3 章关卡的拼装入口：把三个批次文件按顺序接成一份关卡表。
// 依赖下层 `spec`（关卡数据类型）与同级的 batch1~batch3；本文件不包含任何关卡数据，
// 只负责"排列顺序"这一件事。`content/index.ts` 引用本文件的 `CH3_LEVELS`，
// 因此这里的数组顺序就是玩家看到的关卡顺序，且必须与战役表（campaign.ts）一致。

import type { LevelSpec } from '../../spec';
import { CH3_BATCH1 } from './batch1';
import { CH3_BATCH2 } from './batch2';
import { CH3_BATCH3 } from './batch3';

/**
 * 第 3 章全部关卡，由三个批次拼接而成。
 *
 * 写作时本章分成三批完成（39-41、42-44、45-47），每位作者各自拥有一个自包含文件；
 * 这里是它们唯一的汇合点，除此之外任何模块都不应直接 import 某个批次——
 * 例外只有批次自己的测试文件，因为它只拿该批次与自己的数据对账。
 *
 * 下面的顺序就是本章的顺序：`content/index.ts` 把这个数组追加在第 1、2 章之后，
 * 于是三个批次正好落在全局第 39..47 关，中间没有别的关卡。
 * 这一事实由 `test/levels/unlock-chain.test.ts` 用数字钉住：9 关、下标 39-47、连续且不重复。
 *
 * 提醒后来者：这次"拼接"曾经是整章缺失的最后一环，而它的缺失是隐形的。
 * 三个批次都已存在、能编译、能通过各自的测试，玩家却一关也到不了——
 * `content/index.ts` 是章节之间唯一的连接点，在它写下这个数组之前，
 * 这里的每一关都是"写好了但不可达"。批次测试抓不到这个问题：批次测试按路径 import 自己的批次，
 * 无论本章是否被追加进总表都会通过；只有遍历 `ALL_LEVELS` 的
 * `unlock-chain.test.ts` 才抓得到，所以它断言的是章节边界的下标，而不只是关卡数量。
 *
 */
export const CH3_LEVELS: readonly LevelSpec[] = [
  ...CH3_BATCH1,
  ...CH3_BATCH2,
  ...CH3_BATCH3,
];
