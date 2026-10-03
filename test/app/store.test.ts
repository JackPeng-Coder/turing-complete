import { describe, expect, it } from 'vitest';
import { createStore } from '../../src/app/store';
import type { AppState, DragState } from '../../src/app/store';
import { emptyProgress } from '../../src/app/progress';
import { BASE_DEFS } from '../../src/core/defs';
import { emptyGraph } from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { getLevel } from '../../src/levels/index';
import type { Camera } from '../../src/ui/board/view';

interface Demo {
  count: number;
  label: string;
  nested: { items: string[] };
}

const initial = (): Demo => ({ count: 0, label: 'idle', nested: { items: [] } });

describe('createStore', () => {
  it('reads back the initial state', () => {
    const state = initial();
    const store = createStore(state);
    expect(store.get()).toBe(state);
  });

  it('set shallow-merges a patch and notifies once with the new state', () => {
    const store = createStore(initial());
    const seen: Array<{ count: number; label: string }> = [];
    store.subscribe((s) => seen.push({ count: s.count, label: s.label }));

    store.set({ count: 2 });

    expect(store.get().count).toBe(2);
    expect(store.get().label).toBe('idle');
    expect(seen).toEqual([{ count: 2, label: 'idle' }]);
  });

  it('update replaces the state with the transform result', () => {
    const store = createStore(initial());
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.count));

    store.update((s) => ({ ...s, count: s.count + 5 }));

    expect(store.get().count).toBe(5);
    expect(seen).toEqual([5]);
  });

  it('unsubscribing stops further notifications', () => {
    const store = createStore(initial());
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.set({ count: 1 });
    unsubscribe();
    store.set({ count: 2 });
    unsubscribe(); // idempotent

    expect(calls).toBe(1);
    expect(store.get().count).toBe(2);
  });

  it('a listener may unsubscribe another listener mid-notification', () => {
    const store = createStore(initial());
    const calls: string[] = [];
    let unsubscribeSecond = (): void => {};
    store.subscribe(() => {
      calls.push('first');
      unsubscribeSecond();
    });
    unsubscribeSecond = store.subscribe(() => calls.push('second'));

    store.set({ count: 1 });
    expect(calls).toEqual(['first']);
  });

  it('notifies on every set, because in-place edits are invisible to identity checks', () => {
    // `core/graph.ts` pushes into `g.instances` / `g.wires` in place, so a
    // caller can legitimately hand back the same nested reference after a real
    // change. Suppressing that notification would silently drop a re-render.
    const store = createStore(initial());
    const lengths: number[] = [];
    store.subscribe((s) => lengths.push(s.nested.items.length));

    store.get().nested.items.push('a');
    store.set({ nested: store.get().nested });

    expect(lengths).toEqual([1]);
  });

  it('notifies in subscription order', () => {
    const store = createStore(initial());
    const calls: string[] = [];
    store.subscribe(() => calls.push('a'));
    store.subscribe(() => calls.push('b'));

    store.set({ count: 1 });

    expect(calls).toEqual(['a', 'b']);
  });
});

/**
 * `AppState` / `DragState` now live in `src/app/store.ts` (see the Task 10
 * follow-up fix), so the concrete state is driven through the generic container
 * here as well: the declarations are exercised, not merely present. The generic
 * behaviours themselves are covered above.
 */
describe('AppState through createStore', () => {
  const appState = (): AppState => ({
    level: getLevel('ch1-01-humble-beginnings'),
    graph: emptyGraph(),
    registry: createRegistry(BASE_DEFS),
    progress: emptyProgress(),
    camera: { x: 0, y: 0, zoom: 1 },
    selected: [],
    dragging: null,
    armed: null,
    dev: false,
    metrics: null,
    lastGrade: null,
    status: null,
  });

  it('reads back the initial AppState', () => {
    const state = appState();
    const store = createStore<AppState>(state);

    expect(store.get()).toBe(state);
  });

  it('set of selected and camera notifies subscribers and is visible through get()', () => {
    const store = createStore<AppState>(appState());
    const seen: Array<{ selected: string[]; camera: Camera }> = [];
    store.subscribe((s) => seen.push({ selected: s.selected, camera: s.camera }));

    store.set({ selected: ['i1', 'i2'] });
    store.set({ camera: { x: 40, y: -10, zoom: 2 } });

    expect(store.get().selected).toEqual(['i1', 'i2']);
    expect(store.get().camera).toEqual({ x: 40, y: -10, zoom: 2 });
    expect(seen).toEqual([
      { selected: ['i1', 'i2'], camera: { x: 0, y: 0, zoom: 1 } },
      { selected: ['i1', 'i2'], camera: { x: 40, y: -10, zoom: 2 } },
    ]);
  });

  it('the unsubscribe returned by subscribe stops delivery', () => {
    const store = createStore<AppState>(appState());
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.set({ selected: ['i1'] });
    unsubscribe();
    store.set({ selected: [] });

    expect(calls).toBe(1);
    expect(store.get().selected).toEqual([]);
  });

  it('carries every DragState variant through a set', () => {
    const store = createStore<AppState>(appState());
    const drags: DragState[] = [
      { kind: 'instance', ids: ['i1'], offsetX: 4, offsetY: -2 },
      // A wire drag starts with no pointer position and gains one on the first
      // move; both states have to survive a `set`, because the board paints the
      // second and the pin highlight needs the first.
      { kind: 'wire', fromInst: 'i1', fromPort: 'out', to: null },
      { kind: 'wire', fromInst: 'i1', fromPort: 'out', to: { x: 8, y: 12 } },
      { kind: 'pan', lastX: 10, lastY: 20 },
    ];

    for (const dragging of drags) {
      store.set({ dragging });
      expect(store.get().dragging).toBe(dragging);
    }
  });
});
