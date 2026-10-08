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
import { LEGACY_LEVEL_IDS, RETIRED_LEVEL_IDS } from '../../src/levels/id-map';
import { LEVEL_ORDER } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';
import type { Progress } from '../../src/app/progress';

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
    expect(migrated).toEqual({ version: 1, levels: {}, programs: {} });
  });

  it('throws for unknown shapes', () => {
    expect(() => migrate(null)).toThrow(/progress/i);
    expect(() => migrate({ version: 'one' })).toThrow(/progress/i);
  });
});

/**
 * The player's programs, per level.
 *
 * A program is the whole of the player's work on a programming level: the board
 * is given, so losing the text on refresh would lose the level. That is why it
 * lives in the save at all, and why `migrate` treats it exactly as strictly as it
 * treats `levels` -- only strings survive, and the keys go through the same id
 * translation, so a program cannot be attached to a level that no longer exists.
 */
describe('migrate / programs', () => {
  it('keeps the programs and translates their level ids', () => {
    const migrated = migrate({
      version: 1,
      levels: {},
      programs: {
        'ch2-13-odd-number-of-signals': 'move|inp|out',
        'ch1-01-humble-beginnings': '# the echo program\nmove|inp|out',
      },
    });
    expect(migrated.programs).toEqual({
      'ch2-16-odd-number-of-signals': 'move|inp|out',
      'ch1-01-humble-beginnings': '# the echo program\nmove|inp|out',
    });
  });

  it('drops a program whose value is not a string', () => {
    // Level ids are player data as much as program text is: a hand-edited or
    // truncated save must not put a number where the IDE will call `.split()`.
    const migrated = migrate({
      version: 1,
      levels: {},
      programs: {
        'ch1-01-humble-beginnings': 'move|inp|out',
        'ch1-02-nand-gate': 42,
        'ch1-03-not-gate': null,
        'ch1-04-and-gate': { text: 'move|inp|out' },
      },
    });
    expect(migrated.programs).toEqual({ 'ch1-01-humble-beginnings': 'move|inp|out' });
  });

  it('drops the program of a retired level, keeping the ones that still exist', () => {
    const migrated = migrate({
      version: 1,
      levels: {},
      programs: {
        'ch2-27-logic-engine': 'move|inp|out',
        'ch1-02-nand-gate': 'move|inp|out',
      },
    });
    expect(Object.keys(migrated.programs)).toEqual(['ch1-02-nand-gate']);
  });

  it('reads a save written before programs existed as having none', () => {
    // The shape the previous build wrote: `version` and `levels` only. It has to
    // load, with an empty program table, or every existing player's stars would
    // be thrown away by an upgrade.
    const migrated = migrate({ version: 1, levels: {} });
    expect(migrated.programs).toEqual({});
    expect(migrated).toEqual(emptyProgress());
  });

  it('survives the export / import round trip with the rest of the save', () => {
    const p: Progress = {
      ...emptyProgress(),
      programs: { 'ch1-01-humble-beginnings': 'move|inp|out' },
    };
    expect(importProgress(exportProgress(p))).toEqual(p);
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

/**
 * The 2.x realignment renamed 37 level ids and removed three. A save is keyed by
 * id, so without the translation in `migrate` a player's stars would end up
 * attached to levels that no longer exist -- silently, because every lookup
 * would simply miss.
 */
describe('carrying a save across the level-id realignment', () => {
  const record = { passed: true, stars: 3, best: { gate: 4, delay: 2, tick: 0 } };

  it('moves a record from its legacy id to the current one', () => {
    const migrated = migrate({
      version: 1,
      levels: { 'ch2-13-odd-number-of-signals': record },
    });
    expect(Object.keys(migrated.levels)).toEqual(['ch2-16-odd-number-of-signals']);
    expect(migrated.levels['ch2-16-odd-number-of-signals']).toEqual(record);
  });

  it('keeps the records of levels that did not move, and drops retired ones', () => {
    const migrated = migrate({
      version: 1,
      levels: {
        'ch2-27-logic-engine': record,
        'ch1-02-nand-gate': record,
      },
    });
    expect(Object.keys(migrated.levels)).toEqual(['ch1-02-nand-gate']);
  });

  it('is idempotent: running it on an already-migrated save changes nothing', () => {
    const payload = {
      version: 1,
      levels: {
        'ch1-01-humble-beginnings': record,
        'ch2-16-odd-number-of-signals': record,
      },
    };
    const once = migrate(payload);
    expect(once.levels).toEqual(payload.levels);
    expect(migrate(once).levels).toEqual(payload.levels);
  });

  it('never maps an id that is already a current one', () => {
    const current = new Set(LEVEL_ORDER);
    expect(Object.keys(LEGACY_LEVEL_IDS).filter((id) => current.has(id))).toEqual([]);
    expect(Object.values(LEGACY_LEVEL_IDS).filter((id) => !current.has(id))).toEqual([]);
    expect(RETIRED_LEVEL_IDS.filter((id) => current.has(id))).toEqual([]);
  });
});
