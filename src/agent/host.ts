/**
 * What the agent layer asks the app for.
 *
 * AN INTERFACE RATHER THAN AN IMPORT. Everything a tool does -- pushing a command
 * onto the undo stack, driving the clock, running the level's cases, writing a
 * circuit file -- already exists in `main.ts` and in `ui/board/interact.ts`, and
 * the agent must go through those same paths rather than re-implement them. If it
 * built its own commands and mutated its own copy of the graph, an agent edit
 * would not be one press of 撤销 away from gone, the measurement would disagree
 * with the board, and the two would drift apart the first time either changed.
 *
 * THE DIRECTION OF THE DEPENDENCY IS THE POINT. `main.ts` is the composition root
 * and hands the agent layer an implementation; the agent layer never reaches up
 * into the UI. That is what keeps `agent/` a peer of `app/` in the layer order
 * (`AGENTS.md` rule 2) even though it drives the whole application.
 *
 * EVERY METHOD HERE IS THE SAME THING A HAND DOES: `apply` is a board edit,
 * `run`/`stepOnce` are the toolbar's buttons, `test` is 测试, `circuitText` and
 * `loadCircuit` are 导出/导入. There is deliberately no method that does what a
 * hand cannot.
 */
import type { Command } from '../app/commands';
import type { Graph } from '../core/graph';
import type { PinDef } from '../core/registry';

/** One part the palette is offering right now, pins included. */
export interface PartInfo {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly category: string;
  /** Level plumbing is hidden from the palette and must stay hidden from the agent. */
  readonly hidden: boolean;
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
}

export interface PartSnapshot {
  readonly id: string;
  readonly def: string;
  readonly nameZh: string;
  readonly x: number;
  readonly y: number;
  readonly params: Readonly<Record<string, number>>;
}

export interface WireSnapshot {
  readonly id: string;
  readonly from: { readonly inst: string; readonly port: string };
  readonly to: { readonly inst: string; readonly port: string };
}

export interface IssueSnapshot {
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export interface BoardSnapshot {
  /** Where the agent is working: an ordinary level, or the free-build sandbox. */
  readonly mode: 'level' | 'sandbox';
  /** `?dev=1`: every level reachable and every listed part on offer. */
  readonly dev: boolean;
  readonly level: { readonly id: string; readonly nameZh: string; readonly nameEn: string } | null;
  /** The component body open on the board, or `null` for the board itself. */
  readonly editing: string | null;
  readonly parts: readonly PartSnapshot[];
  readonly wires: readonly WireSnapshot[];
  readonly selected: readonly string[];
  readonly running: boolean;
  readonly testing: boolean;
  readonly metrics: { readonly gates: number; readonly delay: number } | null;
  readonly grade: { readonly passed: boolean; readonly summary: string } | null;
  readonly issues: readonly IssueSnapshot[];
  readonly status: { readonly zh: string; readonly en: string } | null;
  /** The level's own description, when it has one, so the agent knows the goal. */
  readonly briefZh: string | null;
}

/** What a test run ended in. `ran: false` means the level had nothing to play. */
export interface TestOutcome {
  readonly ran: boolean;
  readonly passed: boolean | null;
  readonly summary: string;
}

export interface ImportOutcome {
  readonly ok: boolean;
  /** Present when `ok` is false: why the file was refused. */
  readonly error?: string;
  readonly parts?: number;
  readonly wires?: number;
}

/**
 * The application, as the agent sees it.
 *
 * `graph()` returns the LIVE document, not a copy, and every method that changes
 * it must go through `apply` -- reading it directly is how a tool validates its
 * own arguments (does this pin exist? is this input already driven?) without
 * making a second, drifting model of the circuit.
 */
export interface AgentHost {
  /** The live graph on the board. Read it; never mutate it outside a command. */
  graph(): Graph;
  /** What the palette offers, which is what the agent is allowed to place. */
  parts(): readonly PartInfo[];
  /** Everything the model needs to see to plan its next step. */
  snapshot(): BoardSnapshot;
  /** Rounds a coordinate to the board's grid; the theme owns the grid size. */
  snap(x: number, y: number): { x: number; y: number };
  /**
   * Applies one command as ONE VISIBLE STEP.
   *
   * The implementation pushes it onto the same undo stack the player uses,
   * repaints, and -- when `focus` is given -- selects what just changed, so the
   * magenta ring says where to look. Returns after the repaint, so a caller that
   * waits between calls gets a frame per step (requirement A5).
   */
  apply(command: Command, focus?: readonly string[]): void;
  /** 撤销 / 重做, the player's own history. */
  undo(): boolean;
  redo(): boolean;
  /** 运行 / 暂停 / 单步 / 停止并复位. */
  run(): void;
  pause(): void;
  stepOnce(): void;
  reset(): void;
  /**
   * 测试: plays the level's cases and resolves with the verdict.
   *
   * The run is animated, so this resolves when it has finished -- or reports
   * `ran: false` for a screen that has no cases to play (the sandbox) rather
   * than waiting for a verdict that is never coming.
   */
  test(): Promise<TestOutcome>;
  /** 导出电路: the `tc-circuit` text of what is on the board. */
  circuitText(): string;
  /** 导入电路: parses and installs a `tc-circuit` file, or says why not. */
  loadCircuit(text: string): ImportOutcome;
}
