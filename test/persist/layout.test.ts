import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAYOUT_DEFAULT,
  LAYOUT_KEY,
  LAYOUT_LIMITS,
  loadLayout,
  normalizeLayout,
  saveLayout,
} from '../../src/persist/layout';

/** A `localStorage` that only exists while a test asks for one. */
function stubStorage(initial: Record<string, string> = {}): void {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a layout read back from storage', () => {
  it('accepts a well-formed payload', () => {
    expect(
      normalizeLayout({ version: 1, ...LAYOUT_DEFAULT, primaryW: 300, panelCollapsed: true }),
    ).toEqual({ ...LAYOUT_DEFAULT, primaryW: 300, panelCollapsed: true });
  });

  it('clamps measurements that would leave no board', () => {
    const layout = normalizeLayout({ version: 1, primaryW: 4000, secondaryW: 10, panelH: 9999 });
    expect(layout.primaryW).toBe(LAYOUT_LIMITS.primaryW.max);
    expect(layout.secondaryW).toBe(LAYOUT_LIMITS.secondaryW.min);
    expect(layout.panelH).toBe(LAYOUT_LIMITS.panelH.max);
  });

  it('fills in a missing field field-by-field rather than rejecting the payload', () => {
    const layout = normalizeLayout({ version: 1, primaryW: 300, primaryCollapsed: true });
    expect(layout.primaryW).toBe(300);
    expect(layout.primaryCollapsed).toBe(true);
    expect(layout.secondaryW).toBe(LAYOUT_DEFAULT.secondaryW);
    expect(layout.secondaryCollapsed).toBe(LAYOUT_DEFAULT.secondaryCollapsed);
  });

  it('refuses another version, a non-object, and non-numeric measurements', () => {
    expect(normalizeLayout({ version: 2, primaryW: 300 })).toEqual(LAYOUT_DEFAULT);
    expect(normalizeLayout('nope')).toEqual(LAYOUT_DEFAULT);
    expect(normalizeLayout([1, 2])).toEqual(LAYOUT_DEFAULT);
    expect(normalizeLayout({ version: 1, primaryW: 'wide', panelH: Number.NaN }).primaryW).toBe(
      LAYOUT_DEFAULT.primaryW,
    );
  });
});

describe('storing the layout', () => {
  it('round-trips under its own key', () => {
    stubStorage();
    const layout = { ...LAYOUT_DEFAULT, primaryW: 300, secondaryCollapsed: false, panelH: 220 };
    saveLayout(layout);
    expect(loadLayout()).toEqual(layout);
    expect(globalThis.localStorage.getItem(LAYOUT_KEY)).toContain('"version":1');
  });

  it('reads nothing, and a corrupt payload, as the defaults', () => {
    stubStorage({ [LAYOUT_KEY]: '{not json' });
    expect(loadLayout()).toEqual(LAYOUT_DEFAULT);
    stubStorage();
    expect(loadLayout()).toEqual(LAYOUT_DEFAULT);
  });

  it('survives a hostile store and no store at all', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadLayout()).toEqual(LAYOUT_DEFAULT);
    expect(() => saveLayout(LAYOUT_DEFAULT)).not.toThrow();

    vi.stubGlobal('localStorage', undefined);
    expect(loadLayout()).toEqual(LAYOUT_DEFAULT);
    expect(() => saveLayout(LAYOUT_DEFAULT)).not.toThrow();
  });
});
