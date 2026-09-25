/**
 * Minimal observable state container.
 *
 * This is the app layer's whole state mechanism: no state library, no
 * immutability helper (Phase 0 ships zero runtime dependencies). The concrete
 * application state -- level, graph, camera, selection -- is declared by the UI
 * layer that owns those types, and is passed in here as the type parameter:
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
