import { cloneGraph, type CustomComponentDef, type Graph } from '../core/graph';
import type { BlueprintLibrary } from '../levels/blueprints';

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
  /**
   * The component library this command leaves behind, or `undefined` for a
   * command that only moves the circuit.
   *
   * WHY A COMMAND MAY CARRY IT. Wrapping a selection into a component is ONE
   * action that changes two things (the circuit loses the selection and gains an
   * instance of the component; the library gains the definition), and an undo
   * that put the circuit back while leaving the component behind would be a
   * half-undone state the player cannot name. The library travels with the
   * command so both halves move together -- see `CommandStack.push`.
   *
   * A whole library rather than a delta: a library holds graphs, so `cloneGraph`
   * is what makes it a snapshot, and a delta would need its own inverse. Wrapping
   * is a deliberate, occasional action; the clone is not on any hot path.
   */
  readonly blueprints?: BlueprintLibrary;
  /**
   * The library to restore on UNDO, when the command carries one.
   *
   * Read only by the stack, never by `do`: a command states the library it
   * leaves behind, and separately the library it replaced -- which the stack
   * needs so that undo returns the document to exactly where it was rather than
   * to "the previous command's library", a value that no longer exists after a
   * redo has overwritten the branch.
   */
  readonly blueprintsBefore?: BlueprintLibrary;
}

/** A library copied deeply enough that mutating one side cannot touch the other. */
export function cloneLibrary(library: BlueprintLibrary): BlueprintLibrary {
  const copy: Record<string, { name: { zh: string; en: string }; def: CustomComponentDef }> = {};
  for (const [id, entry] of Object.entries(library)) {
    copy[id] = {
      name: { ...entry.name },
      def: {
        ...entry.def,
        name: { ...entry.def.name },
        inputs: entry.def.inputs.map((pin) => ({ ...pin })),
        outputs: entry.def.outputs.map((pin) => ({ ...pin })),
        binds: {
          inputs: copyEnds(entry.def.binds.inputs),
          outputs: copyEnds(entry.def.binds.outputs),
        },
        body: cloneGraph(entry.def.body),
      },
    };
  }
  return copy;
}

function copyEnds(
  ends: Readonly<Record<string, { inst: string; port: string }>>,
): Record<string, { inst: string; port: string }> {
  const copy: Record<string, { inst: string; port: string }> = {};
  for (const [pin, end] of Object.entries(ends)) copy[pin] = { ...end };
  return copy;
}

/**
 * Undo/redo history for one graph, and for the component library beside it.
 *
 * The stack owns no copy of the graph: `graph` is passed in on every call, so
 * the same history can be replayed against the live document and the commands
 * stay pure with respect to it. (`core/graph.ts` mixes push-in and
 * reassign-the-array mutations, so nothing here may key off array identity.)
 *
 * THE LIBRARY IS DIFFERENT: a command that carries one REPLACES it, because a
 * component is a value (its body is a graph) rather than a mutation of the shared
 * document. `current()` is what the app subscribes to -- it is the library the
 * last command left, which `main.ts` copies into the store and into the save.
 */
export class CommandStack {
  readonly #limit: number;
  #undo: Command[] = [];
  #redo: Command[] = [];
  /** The library as the history leaves it, or `undefined` if none has set one. */
  #blueprints: BlueprintLibrary | undefined;

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

  /** The library this history leaves in place, or `undefined` for "unchanged". */
  current(): BlueprintLibrary | undefined {
    return this.#blueprints;
  }

  /**
   * Applies `command` and records it: pushing is the edit.
   *
   * A new command invalidates the redo branch -- the history is a line, not a
   * tree, so the abandoned future is dropped rather than kept for a branch
   * picker that does not exist. If `do` throws, nothing is recorded and the
   * redo branch survives, because the graph was not changed by a command we
   * could reverse.
   *
   * A command that carries a library installs it as part of the same step, so
   * `current()` answers what the document holds after this push.
   */
  push(command: Command, graph: Graph): void {
    command.do(graph);
    if (command.blueprints !== undefined) this.#blueprints = command.blueprints;
    this.#undo.push(command);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo = [];
  }

  /** Reverses the newest command; false when there is nothing to undo. */
  undo(graph: Graph): boolean {
    const command = this.#undo.pop();
    if (!command) return false;
    command.undo(graph);
    if (command.blueprints !== undefined) {
      // Going back means going back to what the command REPLACED, which is why
      // the inverse edit carries its own "before" library.
      this.#blueprints = command.blueprintsBefore ?? this.#blueprints;
    }
    this.#redo.push(command);
    return true;
  }

  /** Re-applies the newest undone command; false when there is nothing to redo. */
  redo(graph: Graph): boolean {
    const command = this.#redo.pop();
    if (!command) return false;
    command.do(graph);
    if (command.blueprints !== undefined) this.#blueprints = command.blueprints;
    this.#undo.push(command);
    return true;
  }

  /** Forgets both branches, e.g. when the editor loads a different level. */
  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}
