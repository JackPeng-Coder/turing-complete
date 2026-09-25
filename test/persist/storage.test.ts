import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyGrade, emptyProgress } from '../../src/app/progress';
import {
  STORAGE_KEY,
  exportProgress,
  importProgress,
  loadProgress,
  migrate,
  saveProgress,
} from '../../src/persist/storage';
import type { GradeResult } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';

const level: LevelSpec = {
  id: 'ch1-01',
  chapter: 1,
  index: 1,
  name: { zh: '', en: '' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: [],
  io: { inputs: [], outputs: [{ id: 'out', width: 1 }] },
  checks: [],
  rewards: { components: ['nand'] },
};

const pass: GradeResult = {
  passed: true,
  metrics: { gate: 1, delay: 1, tick: 0 },
  score: 5,
  stars: 3,
  failures: [],
  issues: [],
};

describe('export / import round trip', () => {
  it('preserves progress exactly through a round trip', () => {
    const p = applyGrade(emptyProgress(), level, pass);
    const restored = importProgress(exportProgress(p));
    expect(restored).toEqual(p);
  });

  it('rejects malformed json', () => {
    expect(() => importProgress('{not json')).toThrow();
  });

  it('rejects a payload from a future version', () => {
    expect(() =>
      importProgress(JSON.stringify({ version: 99, levels: {} })),
    ).toThrow(/version/i);
  });
});

describe('migrate', () => {
  it('accepts a v1 payload unchanged', () => {
    const p = emptyProgress();
    expect(migrate(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('repairs a v1 payload with a missing levels map', () => {
    expect(migrate({ version: 1 }).levels).toEqual({});
  });

  it('drops a stale top-level unlockedComponents field', () => {
    // the unlocked set is derived now; an old save must not resurrect it
    const migrated = migrate({ version: 1, levels: {}, unlockedComponents: ['nand'] });
    expect(migrated).toEqual({ version: 1, levels: {} });
  });

  it('throws for unknown shapes', () => {
    expect(() => migrate(null)).toThrow(/progress/i);
    expect(() => migrate({ version: 'one' })).toThrow(/progress/i);
  });
});

/**
 * Beyond the brief's test list, to pin the degradation requirement: the unit
 * tests run in node (no DOM), and a browser in private mode can refuse writes.
 * Neither `loadProgress` nor `saveProgress` may throw because of that.
 */
describe('loadProgress / saveProgress', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let map: Map<string, string>;

  const install = (value: unknown): void => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: value as Storage,
    });
  };

  beforeEach(() => {
    map = new Map();
    install({
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('round-trips through storage under the documented key', () => {
    const p = applyGrade(emptyProgress(), level, pass);
    saveProgress(p);
    expect(map.has(STORAGE_KEY)).toBe(true);
    expect(loadProgress()).toEqual(p);
  });

  it('reads an absent save as a fresh one', () => {
    expect(loadProgress()).toEqual(emptyProgress());
  });

  it('reads a corrupt save as a fresh one instead of throwing', () => {
    map.set(STORAGE_KEY, '{not json');
    expect(loadProgress()).toEqual(emptyProgress());
  });

  it('degrades to memory when storage throws on every access', () => {
    install({
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    });
    const p = applyGrade(emptyProgress(), level, pass);
    expect(() => saveProgress(p)).not.toThrow();
    expect(loadProgress()).toEqual(emptyProgress());
  });

  it('degrades to memory when there is no storage at all', () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    const p = applyGrade(emptyProgress(), level, pass);
    expect(() => saveProgress(p)).not.toThrow();
    expect(loadProgress()).toEqual(emptyProgress());
  });
});
