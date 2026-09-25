import type { Graph } from '../core/graph';

/**
 * One reversible edit to a graph.
 *
 * `do` must be repeatable: it runs once when the command is pushed and again on
 * every redo, so it has to establish the edit from whatever state the graph is
 * in rather than assume it starts empty (ids are allocated by the caller, not
 * generated inside `do`).
 */
export interface Command {
  readonly label: string;
  do(graph: Graph): void;
  undo(graph: Graph): void;
}

/**
 * Undo/redo history for one graph.
 *
 * The stack owns no copy of the graph: `graph` is passed in on every call, so
 * the same history can be replayed against the live document and the commands
 * stay pure with respect to it. (`core/graph.ts` mixes push-in and
 * reassign-the-array mutations, so nothing here may key off array identity.)
 */
export class CommandStack {
  readonly #limit: number;
  #undo: Command[] = [];
  #redo: Command[] = [];

  /** `limit` is the number of undoable steps; the oldest is dropped beyond it. */
  constructor(limit = 200) {
    this.#limit = limit;
  }

  /** Undoable steps currently held. */
  get depth(): number {
    return this.#undo.length;
  }

  canUndo(): boolean {
    return this.#undo.length > 0;
  }

  canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /**
   * Applies `command` and records it: pushing is the edit.
   *
   * A new command invalidates the redo branch -- the history is a line, not a
   * tree, so the abandoned future is dropped rather than kept for a branch
   * picker that does not exist. If `do` throws, nothing is recorded and the
   * redo branch survives, because the graph was not changed by a command we
   * could reverse.
   */
  push(command: Command, graph: Graph): void {
    command.do(graph);
    this.#undo.push(command);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo = [];
  }

  /** Reverses the newest command; false when there is nothing to undo. */
  undo(graph: Graph): boolean {
    const command = this.#undo.pop();
    if (!command) return false;
    command.undo(graph);
    this.#redo.push(command);
    return true;
  }

  /** Re-applies the newest undone command; false when there is nothing to redo. */
  redo(graph: Graph): boolean {
    const command = this.#redo.pop();
    if (!command) return false;
    command.do(graph);
    this.#undo.push(command);
    return true;
  }

  /** Forgets both branches, e.g. when the editor loads a different level. */
  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}
