/**
 * 画板数据到电路文档的转换：把关卡自带的起始电路读成可编辑的 `Graph`。
 *
 * 依赖下层 `core/graph`（建实例、连线、命名规则）与同层 `spec.ts` 的
 * `BoardInit` 类型；被 `main.ts` 打开关卡的路径与测试夹具使用。
 *
 * 关键不变量：实例 id 由图决定，而不是由关卡数据写死；导线按元件下标
 * 解析，指向不存在元件的导线在这里就被拒绝，不会留到图校验阶段才暴露。
 */

import { addInstance, connect, emptyGraph, type Graph } from '../core/graph';
import type { BoardInit } from './spec';

/**
 * 把关卡自带的起始电路读成一张可编辑的图（Graph）。
 *
 * 画板是关卡数据，而 Graph 是文档，所以这里是两者之间的接缝，也是全项目
 * 唯一让画板里的“元件下标”有意义的地方。有两件事特意放在这里决定，而不是
 * 写进关卡数据：
 *
 *  * 没有指定 id 的元件，用内核自己的命名规则（`nextId`，经由 `addInstance`）
 *    命名，于是画板上的元件依次叫 i1、i2……——正是玩家亲手放置时编辑器会给
 *    出的名字。关卡数据无法直接写出这些 id，因为在图存在之前它们根本不存在；
 *    唯一的例外是已经自带 `id` 的元件，这只有关卡的接插件需要，因为
 *    `levels/checks.ts` 是按实例 id 把关卡引脚绑成 IN_<pin> / OUT 的。
 *  * 导线通过元件列表解析，而不是通过图解析，所以画板完全按数组下标接线。
 *    一条导线指向画板上不存在的元件，说明关卡数据写错了，而不是电路写错了：
 *    这里直接拒绝，并把出错的下标写进报错信息；否则它会变成一条接到
 *    undefined 的导线，最后被 `validateGraph` 报成“缺少实例”，却完全看不出
 *    是哪份元件列表写错了。
 *
 * 其余一概不检查：def 与引脚是否存在、同一个输入端是否被驱动两次、结果到底
 * 是不是一张合法电路，都是 `validateGraph` 的职责，而它是判定这些事情
 * 的唯一地方（源码在 `core/graph.ts`）。
 *
 * @param level 关卡 id，写进图的 level 字段，用于错误信息与进度归属。
 * @param board 关卡的起始电路数据（纯数据，不引用任何图对象）。
 * @returns 一张新的图：实例 id 已按内核规则生成，导线已经连好。
 */
export function graphFromBoard(level: string, board: BoardInit): Graph {
  const g = emptyGraph(level);
  for (const part of board.parts) {
    const inst = addInstance(g, part.def, part.x, part.y, part.id);
    // 只有画板明确要求位宽时才写入：`params.width` 不存在，与
    // `params.width` 恰好等于 `undefined`，是两种不同的文档，而后者不是
    // 合法的关卡数据。
    if (part.width !== undefined) inst.params.width = part.width;
  }

  const idAt = (part: number): string => {
    const inst = g.instances[part];
    if (!inst) {
      throw new Error(`board wire names part ${part}, which the board does not have`);
    }
    return inst.id;
  };

  for (const wire of board.wires) {
    connect(
      g,
      { inst: idAt(wire.from.part), port: wire.from.port },
      { inst: idAt(wire.to.part), port: wire.to.port },
    );
  }
  return g;
}
