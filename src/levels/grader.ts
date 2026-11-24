/**
 * 关卡判定器：把“电路 + 关卡规格”变成一次可解释的评分结果。
 *
 * 流程分两步：先用 `validateGraph` 检查电路本身是否合法（有致命错误就
 * 直接 0 分返回，不再跑测试用例），再用 `runChecks` 逐条跑本关的检查；
 * 最后测量门数、延迟与节拍三个指标，算出分数与星级。
 *
 * 依赖下层 `core/`（图校验、指标测量、编译）与同层的 `checks.ts`；被
 * `app/progress.ts`（记录成绩）、`main.ts`（判定按钮）与测试使用。
 *
 * 关键口径：三个指标都在“整个电路（含自定义元件、宽位元件）展开成
 * NAND 等价门”之后测量；用例全部通过才可能拿到星，三星还要求三个指标
 * 都不超过本关声明的三星目标。
 */

import type { Graph, GraphIssue } from '../core/graph';
import { validateGraph } from '../core/graph';
import { delayOf, gateCostOf } from '../core/net';
import type { Registry } from '../core/registry';
import { runChecks, type PlayerProgram } from './checks';
import type { CheckFailure, LevelSpec } from './spec';

/**
 * 一次判定测出的三个指标，也是顶栏读数与进度记录的内容。
 *
 * `gate`：NAND 等价门总数（宽位元件展开后计数）。
 * `delay`：电路关键路径的深度，以“一个节点的延迟算 1 单位”计。
 * `tick`：跑完本关全部测试用例用掉的时钟节拍数（取各用例的最大值）。
 */
export interface Metrics {
  readonly gate: number;
  readonly delay: number;
  readonly tick: number;
}

/**
 * 一次判定的完整结果：结论、指标、分数、星级，以及失败与电路问题清单。
 *
 * `failures` 是测试用例层面的失败（哪组输入、期望什么、实际什么），
 * `issues` 是电路结构层面的问题（由 `validateGraph` 给出）。两者分开，
 * 面板才能分别告诉玩家“电路接错了”还是“答案算错了”。
 */
export interface GradeResult {
  readonly passed: boolean;
  readonly metrics: Metrics;
  readonly score: number;
  readonly stars: 0 | 1 | 3;
  readonly failures: readonly CheckFailure[];
  readonly issues: readonly GraphIssue[];
}

/**
 * 三个指标折算成分数时的权重：门数 1、延迟 4、节拍 8。
 *
 * 权重递增是有意的激励：省门数当然好，但缩短关键路径（延迟）和减少节拍
 * 更值钱，于是玩家会先优化“深”再优化“多”。分数越小越好。
 */
export const SCORE_WEIGHTS = { gate: 1, delay: 4, tick: 8 } as const;

/**
 * 把三个指标线性加权成总分。权重见 `SCORE_WEIGHTS`。
 *
 * 分数只用于横向比较（进度页、智能体建议），不单独充当通过条件；
 * 通过与否只由测试用例决定。
 *
 * @param m 一次判定测出的三个指标。
 * @returns 加权总分（三项都是整数，故结果也是整数）。
 */
export function scoreOf(m: Metrics): number {
  return m.gate * SCORE_WEIGHTS.gate + m.delay * SCORE_WEIGHTS.delay + m.tick * SCORE_WEIGHTS.tick;
}

/**
 * 电路的 NAND 等价门总数，也就是 GATE 指标（成本口径：“电路 + 自定义
 * 组件 + 宽位组件全部展开后，NAND 等价门的总数”）。
 *
 * 这里只是对 `core/net.ts` 转调一层，真正的遍历在那里。实现放在那边
 * 而不是这里，是因为 `compile` 与 `delayOf` 需要同一套展开，三个指标也
 * 必须对“这份文档里到底有什么”达成一致：若这里再抄一份“展开元件”的
 * 逻辑，两份会漂移，而一旦漂移，判定给出的目标就再也无法用编译器自己的
 * 视角复现。
 *
 * 它数的是 `def.gateCost`，不是 `def.cost`。两个字段是刻意分开的两个
 * 指标：`cost` 是 `delayOf` 收取的“单个节点的延迟单位”，一个宽位元件
 * 故意只算 1 单位延迟（延迟口径），但它展开后是很多个 NAND 等价门——
 * 例如 `add8` 的延迟是 1，门数是 72。
 *
 * @param graph 要测量的电路文档（元件未被展开的状态）。
 * @param registry 元件定义表，用来把每个实例展开成门。
 * @returns NAND 等价门总数。
 */
export function gateCost(graph: Graph, registry: Registry): number {
  return gateCostOf(graph, registry);
}

/**
 * 由“是否通过”和三星目标算出星级：0、1 或 3。
 *
 * 未通过一律 0 星；通过且关卡没有声明三星目标时给 1 星；声明了目标，
 * 则要求每一项已声明的指标都“不超过”目标值（未声明的指标不参与比较），
 * 全部满足才给 3 星。本项目没有 2 星这一档。
 *
 * 注意比较方向：指标越小越好，所以是 `m.gate <= target.gate` 而不是相等。
 *
 * @param m 本次测得的指标。
 * @param spec 关卡规格（其中 `threeStar` 可选）。
 * @param passed 测试用例是否全部通过。
 * @returns 0 表示未通过，1 表示通过，3 表示达成三星目标。
 */
export function starsOf(m: Metrics, spec: LevelSpec, passed: boolean): 0 | 1 | 3 {
  if (!passed) return 0;
  const target = spec.threeStar;
  if (!target) return 1;
  const ok =
    (target.gate === undefined || m.gate <= target.gate) &&
    (target.delay === undefined || m.delay <= target.delay) &&
    (target.tick === undefined || m.tick <= target.tick);
  return ok ? 3 : 1;
}

/**
 * 用一关的规格判定一张电路。
 *
 * `player` 是玩家写的程序文本，只对读取它的 `program` 检查
 * （`from: 'player'`）有意义，并原样转发给检查器：判定器只负责测量与
 * 计分，“什么算一段程序”是检查器的事。当一关的全部检查都读取关卡自带
 * 的程序时，调用方什么也不传，行为与从前完全一致。
 *
 * 电路有致命错误时提前返回：`issues` 照常带出，但指标记为全 0、分数 0、
 * 0 星，也不运行任何测试用例——因为编译必然失败，跑用例只会产生噪声。
 *
 * @param graph 玩家当前的电路。
 * @param registry 元件定义表（可能包含玩家自定义的元件）。
 * @param spec 关卡规格。
 * @param player 玩家的程序文本（可选，见上）。
 * @returns 判定结果：是否通过、指标、分数、星级、失败清单与电路问题。
 */
export function grade(
  graph: Graph,
  registry: Registry,
  spec: LevelSpec,
  player?: PlayerProgram,
): GradeResult {
  const issues = validateGraph(graph, registry);
  const fatal = issues.filter((i) => i.severity === 'error');
  if (fatal.length > 0) {
    const metrics: Metrics = { gate: 0, delay: 0, tick: 0 };
    return {
      passed: false,
      metrics,
      score: 0,
      stars: 0,
      failures: [],
      issues,
    };
  }

  const outcome = runChecks(graph, registry, spec, player);
  const metrics: Metrics = {
    gate: gateCost(graph, registry),
    delay: delayOf(graph, registry),
    tick: outcome.ticksUsed,
  };
  return {
    passed: outcome.passed,
    metrics,
    score: scoreOf(metrics),
    stars: starsOf(metrics, spec, outcome.passed),
    failures: outcome.failures,
    issues,
  };
}
