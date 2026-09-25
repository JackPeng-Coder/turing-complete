import type { GraphIssue } from './graph';

/**
 * Raised when a combinational circuit has no stable state: the settle loop ran
 * `SETTLE_LIMIT` times and the signals were still changing.
 *
 * This is a real, catchable error rather than a hang, because a feedback loop is
 * something a player does on purpose (the "循环依赖" level) and both the level
 * checker and the grader have to keep running and report it.
 */
export class UnstableCircuitError extends Error {
  readonly iterations: number;
  /** Origin instance ids of the compiled circuit, for highlighting the culprit. */
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
 * Raised by `compile` when `validateGraph` reported error-severity issues.
 *
 * Warnings (an unwired input, a feedback loop) are accepted: an unwired input
 * legally reads 0, and only the simulator can tell whether a loop settles.
 */
export class CircuitValidationError extends Error {
  readonly issues: readonly GraphIssue[];

  constructor(issues: readonly GraphIssue[]) {
    super(`circuit is invalid: ${issues.map((i) => i.code).join(', ')}`);
    this.name = 'CircuitValidationError';
    this.issues = issues;
  }
}
