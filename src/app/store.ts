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
import type { GradeResult } from '../levels/grader';
import type { LevelSpec } from '../levels/spec';
import type { Progress } from './progress';
import type { Camera, Point } from '../ui/board/view';

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
