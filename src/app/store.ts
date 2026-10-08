/**
 * Minimal observable state container.
 *
 * This is the app layer's whole state mechanism: no state library, no
 * immutability helper (Phase 0 ships zero runtime dependencies). The container
 * stays generic; the one concrete state this app has, `AppState`, is declared
 * below and passed in here as the type parameter:
 *
 * ```ts
 * const store = createStore<AppState>(appState);
 * ```
 *
 * State is replaced, never edited: `set` builds a new top-level object. Nested
 * values are the caller's business -- `core/graph.ts` edits `g.instances` and
 * `g.wires` in place through `addInstance` / `connect`, and reassigns them
 * through `removeInstance` / `disconnect`, so notification is UNCONDITIONAL.
 * Suppressing it on an unchanged reference would silently swallow the re-render
 * for an in-place edit; one redundant render is the cheaper mistake.
 */
import type { Graph } from '../core/graph';
import type { Registry } from '../core/registry';
import type { GradeResult, Metrics } from '../levels/grader';
import type { LevelSpec } from '../levels/spec';
import type { Progress } from './progress';
import type { Camera, Point } from './viewport';

/** What the pointer is currently doing on the board. */
export type DragState =
  | { kind: 'instance'; ids: string[]; offsetX: number; offsetY: number }
  /**
   * A wire being pulled out of an output pin.
   *
   * `to` is where the pointer is, in world units, or `null` before it has moved.
   * It lives here rather than in the input module because the board PAINTS it:
   * a wire that appears only once you let go gives no feedback about what you
   * are about to connect, which is the whole of dragging one.
   */
  | { kind: 'wire'; fromInst: string; fromPort: string; to: Point | null }
  | { kind: 'pan'; lastX: number; lastY: number }
  /**
   * The band being dragged across the board with Ctrl held.
   *
   * It lives here because the board PAINTS it: a selection rectangle that only
   * appeared once you let go would give no feedback about what you are about to
   * select, which is the whole of dragging one.
   */
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number };

/** The application's whole observable state. */
export interface AppState {
  level: LevelSpec;
  graph: Graph;
  registry: Registry;
  progress: Progress;
  camera: Camera;
  selected: string[];
  dragging: DragState | null;
  /**
   * Whether `?dev=1` asked for developer mode: every level reachable and every
   * part a level lists offered by its palette. It never writes progress.
   * `app/dev.ts` owns the rule; the two gates are in `app/progress.ts`.
   */
  dev: boolean;
  /**
   * The part armed in the palette, waiting to be dropped, or `null`.
   *
   * APPLICATION STATE, not a flag on the canvas: arming changes what a click on
   * the board does, it lights the part's slot in the palette, and it puts a
   * translucent copy of the part under the pointer. It used to live in
   * `canvas.dataset.pendingDef`, which only the board could read -- so the
   * palette had no way to show which of its buttons was live.
   */
  armed: string | null;
  /**
   * The player's program text, keyed by level id. `''` for a level never typed
   * into.
   *
   * APP STATE AND NOT A FIELD ON THE GRAPH, because a program is not part of the
   * circuit: it is what the player is writing, it survives every board edit, and
   * it is saved per level (`Progress.programs`) so reopening a level restores it.
   * It is read HERE rather than passed around at the call sites because two
   * different paths grade a circuit -- the test run (`finishTest`) and the
   * measurement after every edit (`measure`) -- and both have to hand the program
   * channel the same text, or a level would pass one and fail the other.
   *
   * A `Record` with `''` for the untyped case rather than an optional entry: the
   * checker already reads an empty text as `missing-program`, so "never typed
   * here" needs no separate representation -- and one text per level id means the
   * map cannot disagree with itself.
   */
  programs: Record<string, string>;
  /**
   * What the circuit on the board costs, measured as it is edited.
   *
   * A MEASUREMENT, NOT A VERDICT, and it is a separate field from `lastGrade`
   * for exactly that reason. The top bar has always shown the gate count and the
   * delay while a player builds -- that is the original's own readout and it is
   * what makes a three-star target something to aim at rather than a surprise --
   * but a level that announced "未通过" after every wire was judging a circuit
   * that was still being drawn. Measuring is continuous; judging waits for the
   * test run.
   */
  metrics: Metrics | null;
  /**
   * The result of the last TEST RUN, or `null` until the player asks for one.
   *
   * Cleared by every edit, because a verdict reached before the last wire was
   * moved describes a circuit that is no longer on the board.
   */
  lastGrade: GradeResult | null;
  status: { zh: string; en: string } | null;
}

export interface Store<S extends object> {
  /** Current state; treat it as read-only. */
  get(): S;
  /** Shallow-merges `patch` and notifies. */
  set(patch: Partial<S>): void;
  /** Replaces the state with `fn`'s result and notifies. */
  update(fn: (state: S) => S): void;
  /** Returns an idempotent unsubscribe. */
  subscribe(listener: (state: S) => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<(state: S) => void>();

  /**
   * Synchronous, in subscription order. Iterating a snapshot with a live
   * membership check means a listener may unsubscribe itself or another
   * listener from inside the notification without skewing the round.
   */
  const emit = (): void => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener(state);
    }
  };

  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      emit();
    },
    update(fn) {
      state = fn(state);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
