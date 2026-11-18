import type { GraphIssue } from './graph';

/**
 * 仿真内核的错误类型层。
 *
 * 这里只有两个错误类：UnstableCircuitError 表示"电路在仿真上限内没有稳定下来"
 * （组合逻辑反馈环），CircuitValidationError 表示"文档本身非法，拒绝编译"。
 * 两者都是普通、可捕获的 Error 子类，而不是让程序挂死：玩家会故意搭出反馈环
 * （"循环依赖"关卡），关卡检查器与判定器必须继续运行并把失败报告出去。
 *
 * 依赖：只从 graph.ts 引入 GraphIssue 类型（仅类型的 import，无运行时依赖）。
 * 使用者：net.ts 的 compile() 与 settle() 抛出；levels/checks.ts 只捕获这两类
 * 错误，并把它们转换成玩家可见的检查结果。
 */

/**
 * 当组合电路没有稳定状态时抛出：结算循环跑满了 SETTLE_LIMIT 次，信号仍在变化。
 *
 * 这是一个真实、可捕获的错误，而不是一个死循环：反馈环是玩家会刻意搭出的东西
 * （项目里的"循环依赖"关卡），关卡检查器与判定器都必须继续运行并把它报告出来。
 */
export class UnstableCircuitError extends Error {
  readonly iterations: number;
  /** 参与编译的实例的"源实例 id"列表，用于在画板上高亮出问题的元件。 */
  readonly blame: readonly string[];

  constructor(iterations: number, blame: readonly string[]) {
    super(
      `circuit did not settle after ${iterations} iterations (combinational feedback loop)`,
    );
    this.name = 'UnstableCircuitError';
    this.iterations = iterations;
    this.blame = blame;
  }
}

/**
 * 当 validateGraph 报告了 error 级问题时，由 compile 抛出。
 *
 * warning 级问题（未接线的输入、反馈环）是允许的：未接线的输入按规则读 0，
 * 而反馈环能否稳定只有仿真器知道，不能在这里一刀切拒绝。
 */
export class CircuitValidationError extends Error {
  readonly issues: readonly GraphIssue[];

  constructor(issues: readonly GraphIssue[]) {
    super(`circuit is invalid: ${issues.map((i) => i.code).join(', ')}`);
    this.name = 'CircuitValidationError';
    this.issues = issues;
  }
}
