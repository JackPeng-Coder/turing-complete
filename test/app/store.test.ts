import { describe, expect, it } from 'vitest';
import { createStore } from '../../src/app/store';

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
