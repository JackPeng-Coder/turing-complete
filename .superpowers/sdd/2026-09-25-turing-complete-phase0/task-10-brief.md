## Task 10: 应用状态、撤销栈与进度（app/）

**Files:**
- Create: `src/app/store.ts`, `src/app/commands.ts`, `src/app/progress.ts`, `src/persist/storage.ts`
- Test: `test/app/progress.test.ts`, `test/persist/storage.test.ts`

**Interfaces:**
- Consumes: `Graph`、`LevelSpec`、`GradeResult`
- Produces:
  - `src/app/commands.ts`：`interface Command { readonly label: string; do(g: Graph): void; undo(g: Graph): void }`、`class CommandStack { push(c: Command, g: Graph): void; undo(g: Graph): boolean; redo(g: Graph): boolean; canUndo(): boolean; canRedo(): boolean; clear(): void; readonly depth: number }`
  - `src/app/progress.ts`：`interface LevelRecord { passed: boolean; best: Metrics | null; stars: 0 | 1 | 3 }`、`interface Progress { version: 1; levels: Record<string, LevelRecord> }`、`const STARTER_COMPONENTS = ['level_input', 'level_output'] as const`、`const SCORE_WEIGHTS = { delay: 4, tick: 8 } as const`、`function emptyProgress(): Progress`、`function isUnlocked(p: Progress, levelId: string, order: readonly string[]): boolean`、`function resumePointOf(p: Progress, order: readonly string[]): string`、`function unlockedComponents(p: Progress, levels: readonly LevelSpec[]): Set<string>`、`function paletteDefsFor(p: Progress, levels: readonly LevelSpec[], level: LevelSpec): string[]`、`function applyGrade(p: Progress, level: LevelSpec, result: GradeResult): Progress`（纯函数，返回新对象）
  - `src/persist/storage.ts`：`const STORAGE_KEY = 'tc.progress.v1'`、`function loadProgress(initialComponents: readonly string[]): Progress`、`function saveProgress(p: Progress): void`、`function exportProgress(p: Progress): string`、`function importProgress(json: string): Progress`、`function migrate(raw: unknown): Progress`

- [ ] **Step 1: 写失败测试 `test/app/progress.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  applyGrade,
  emptyProgress,
  isUnlocked,
  paletteDefsFor,
  resumePointOf,
  unlockedComponents,
} from '../../src/app/progress';
import type { GradeResult } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';

const level: LevelSpec = {
  id: 'ch1-02-nand-gate',
  chapter: 1,
  index: 2,
  name: { zh: '与非门', en: 'NAND' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['nand', 'level_input', 'level_output'],
  io: { inputs: [], outputs: [{ id: 'out', width: 1 }] },
  checks: [],
  rewards: { components: ['not'] },
};

const other: LevelSpec = { ...level, id: 'ch1-03-not-gate', index: 3, allowedComponents: ['nand', 'not'] };
const levels = [level, other];

const pass: GradeResult = {
  passed: true,
  metrics: { gate: 2, delay: 2, tick: 0 },
  score: 10,
  stars: 3,
  failures: [],
  issues: [],
};

describe('isUnlocked', () => {
  const order = ['a', 'b', 'c'];
  it('unlocks the first level from the start', () => {
    expect(isUnlocked(emptyProgress(), 'a', order)).toBe(true);
  });
  it('locks later levels until the previous one passes', () => {
    expect(isUnlocked(emptyProgress(), 'b', order)).toBe(false);
  });
  it('unlocks the next level once the previous one passes', () => {
    const p = applyGrade(emptyProgress(), { ...level, id: 'a' }, pass);
    expect(isUnlocked(p, 'b', order)).toBe(true);
    expect(isUnlocked(p, 'c', order)).toBe(false);
  });
  it('throws for ids outside the order', () => {
    expect(() => isUnlocked(emptyProgress(), 'zzz', order)).toThrow(/unknown level/i);
  });
});

describe('resumePointOf', () => {
  const order = ['a', 'b', 'c'];
  const pass: GradeResult = {
    passed: true,
    metrics: { gate: 1, delay: 1, tick: 0 },
    score: 5,
    stars: 3,
    failures: [],
    issues: [],
  };

  it('starts at the first level', () => {
    expect(resumePointOf(emptyProgress(), order)).toBe('a');
  });

  it('advances past a passed level', () => {
    const p = applyGrade(emptyProgress(), { ...level, id: 'a' }, pass);
    expect(resumePointOf(p, order)).toBe('b');
  });

  it('stays at the newest level when everything is passed', () => {
    const p1 = applyGrade(emptyProgress(), { ...level, id: 'a' }, pass);
    const p2 = applyGrade(p1, { ...level, id: 'b' }, pass);
    const p3 = applyGrade(p2, { ...level, id: 'c' }, pass);
    expect(resumePointOf(p3, order)).toBe('c');
  });
});

describe('unlockedComponents', () => {
  it('always offers the starter components so a level is never unbuildable', () => {
    const unlocked = unlockedComponents(emptyProgress(), levels);
    expect(unlocked.has('level_input')).toBe(true);
    expect(unlocked.has('level_output')).toBe(true);
    expect(unlocked.has('nand')).toBe(false);
  });

  it('adds a reward only after its level is passed', () => {
    const p = applyGrade(emptyProgress(), level, pass);
    expect(unlockedComponents(p, levels).has('not')).toBe(true);
  });

  it('paletteDefsFor filters the level list down to what is unlocked', () => {
    expect(paletteDefsFor(emptyProgress(), levels, other)).toEqual([
      'level_input',
      'level_output',
    ]);
    const p = applyGrade(emptyProgress(), level, pass);
    expect(paletteDefsFor(p, levels, other)).toEqual(['nand', 'not', 'level_input', 'level_output']);
  });
});

describe('applyGrade', () => {
  it('does not mutate the input progress', () => {
    const before = emptyProgress();
    const after = applyGrade(before, level, pass);
    expect(before.levels[level.id]).toBeUndefined();
    expect(after.levels[level.id]?.passed).toBe(true);
  });

  it('keeps the best score only when it improves', () => {
    const better: GradeResult = { ...pass, metrics: { gate: 1, delay: 1, tick: 0 }, score: 5, stars: 3 };
    const worse: GradeResult = { ...pass, metrics: { gate: 9, delay: 9, tick: 9 }, score: 99, stars: 1 };
    const a = applyGrade(emptyProgress(), level, pass);
    const b = applyGrade(a, level, better);
    expect(b.levels[level.id]?.best).toEqual({ gate: 1, delay: 1, tick: 0 });
    const c = applyGrade(b, level, worse);
    expect(c.levels[level.id]?.best).toEqual({ gate: 1, delay: 1, tick: 0 });
    expect(c.levels[level.id]?.stars).toBe(3);
  });

  it('ignores a failed attempt', () => {
    const failed: GradeResult = { ...pass, passed: false, stars: 0, score: 0 };
    const p = applyGrade(emptyProgress(), level, failed);
    expect(p.levels[level.id]).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/app/progress.test.ts`
Expected: FAIL — 无法解析 `../../src/app/progress`

- [ ] **Step 3: 实现 `src/app/progress.ts`**

```ts
import type { GradeResult, Metrics } from '../levels/grader';
import type { LevelSpec } from '../levels/spec';

export interface LevelRecord {
  passed: boolean;
  best: Metrics | null;
  stars: 0 | 1 | 3;
}

export interface Progress {
  version: 1;
  levels: Record<string, LevelRecord>;
}

/**
 * Always available, whatever the player has unlocked.
 *
 * This is NOT just the level I/O STARTER_COMPONENTS. Level 1 offers `const_on` and its
 * reference solution IS `const_on -> level_output`, so the constants have to be
 * available from the very first level -- they cannot come from an earlier
 * reward, because there is no earlier level. Keeping them out of this set makes
 * level 1's palette empty of anything that can drive an output, which is the
 * "level 1 is unplayable" defect this derivation exists to prevent.
 *
 * Task 8's chapter-1 gating test seeds its own walk with the same set; keep the
 * two in sync.
 */
export const STARTER_COMPONENTS = [
  'level_input',
  'level_output',
  'const_on',
  'const_off',
] as const;

/** Must match SCORE_WEIGHTS in levels/grader.ts. */
const SCORE_WEIGHTS = { delay: 4, tick: 8 } as const;

export function emptyProgress(): Progress {
  return { version: 1, levels: {} };
}

export function isUnlocked(
  progress: Progress,
  levelId: string,
  order: readonly string[],
): boolean {
  const index = order.indexOf(levelId);
  if (index < 0) throw new Error(`unknown level: ${levelId}`);
  if (index === 0) return true;
  const previous = order[index - 1]!;
  return progress.levels[previous]?.passed === true;
}

/** First reachable level that has not been passed; the last level if all are. */
export function resumePointOf(progress: Progress, order: readonly string[]): string {
  for (const id of order) {
    if (isUnlocked(progress, id, order) && progress.levels[id]?.passed !== true) return id;
  }
  return order[order.length - 1]!;
}

/**
 * The unlocked component set is *derived*, not stored: every reward from a
 * passed level, plus the starter components (level IO and the constants). Storing them
 * two drift apart after an import from an older save.
 */
export function unlockedComponents(
  progress: Progress,
  levels: readonly LevelSpec[],
): Set<string> {
  const unlocked = new Set<string>(STARTER_COMPONENTS);
  for (const level of levels) {
    if (progress.levels[level.id]?.passed !== true) continue;
    for (const component of level.rewards?.components ?? []) unlocked.add(component);
  }
  return unlocked;
}

/** Parts offered by this level that the player has actually unlocked. */
export function paletteDefsFor(
  progress: Progress,
  levels: readonly LevelSpec[],
  level: LevelSpec,
): string[] {
  const unlocked = unlockedComponents(progress, levels);
  return level.allowedComponents.filter((def) => unlocked.has(def));
}

/** Records a pass: keeps the best score and the best star rating. Pure. */
export function applyGrade(
  progress: Progress,
  level: LevelSpec,
  result: GradeResult,
): Progress {
  if (!result.passed) return progress;

  const next: Progress = { version: 1, levels: { ...progress.levels } };
  const previous = progress.levels[level.id];
  const best = previous?.best ?? null;
  const improved =
    best === null ||
    result.score <
      best.gate + best.delay * SCORE_WEIGHTS.delay + best.tick * SCORE_WEIGHTS.tick;

  next.levels[level.id] = {
    passed: true,
    best: improved ? { ...result.metrics } : best,
    stars: Math.max(previous?.stars ?? 0, result.stars) as 0 | 1 | 3,
  };
  return next;
}
```

- [ ] **Step 4: 写失败测试 `test/persist/storage.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyGrade, emptyProgress } from '../../src/app/progress';
import { exportProgress, importProgress, migrate } from '../../src/persist/storage';
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
```

- [ ] **Step 5: 实现 `src/persist/storage.ts`**

```ts
import type { Progress } from '../app/progress';
import { emptyProgress } from '../app/progress';

export const STORAGE_KEY = 'tc.progress.v1';

export function migrate(raw: unknown): Progress {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('not a progress payload');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`unsupported progress version: ${String(obj.version)}`);
  }
  const levels =
    obj.levels !== null && typeof obj.levels === 'object'
      ? (obj.levels as Progress['levels'])
      : {};
  return { version: 1, levels };
}

export function loadProgress(): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: Progress): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* storage unavailable (private mode, tests): progress stays in memory */
  }
}

export function exportProgress(progress: Progress): string {
  return JSON.stringify(progress, null, 2);
}

export function importProgress(json: string): Progress {
  return migrate(JSON.parse(json));
}
```

- [ ] **Step 6: 写失败测试 `test/app/commands.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addInstance, emptyGraph, removeInstance } from '../../src/core/graph';
import { CommandStack } from '../../src/app/commands';

describe('CommandStack', () => {
  it('undoes and redoes an add', () => {
    const g = emptyGraph();
    const stack = new CommandStack();
    const inst = addInstance(g, 'nand', 10, 10);
    stack.push(
      {
        label: 'add nand',
        do: (graph) => void graph.instances.push(inst),
        undo: (graph) => removeInstance(graph, inst.id),
      },
      g,
    );
    expect(g.instances).toHaveLength(1);
    expect(stack.undo(g)).toBe(true);
    expect(g.instances).toHaveLength(0);
    expect(stack.redo(g)).toBe(true);
    expect(g.instances).toHaveLength(1);
  });

  it('reports when there is nothing to undo', () => {
    const stack = new CommandStack();
    expect(stack.undo(emptyGraph())).toBe(false);
    expect(stack.canUndo()).toBe(false);
  });

  it('drops the redo branch after a new command', () => {
    const g = emptyGraph();
    const stack = new CommandStack();
    const a = addInstance(g, 'nand', 0, 0);
    stack.push({ label: 'a', do: () => {}, undo: () => removeInstance(g, a.id) }, g);
    stack.undo(g);
    expect(stack.canRedo()).toBe(true);
    stack.push({ label: 'b', do: () => {}, undo: () => {} }, g);
    expect(stack.canRedo()).toBe(false);
  });

  it('caps history depth', () => {
    const g = emptyGraph();
    const stack = new CommandStack(3);
    for (let i = 0; i < 10; i += 1) {
      stack.push({ label: `c${i}`, do: () => {}, undo: () => {} }, g);
    }
    expect(stack.depth).toBe(3);
  });
});
```

- [ ] **Step 7: 实现 `src/app/commands.ts`**

```ts
import type { Graph } from '../core/graph';

export interface Command {
  readonly label: string;
  do(graph: Graph): void;
  undo(graph: Graph): void;
}

export class CommandStack {
  readonly #limit: number;
  #undo: Command[] = [];
  #redo: Command[] = [];

  constructor(limit = 200) {
    this.#limit = limit;
  }

  get depth(): number {
    return this.#undo.length;
  }

  canUndo(): boolean {
    return this.#undo.length > 0;
  }

  canRedo(): boolean {
    return this.#redo.length > 0;
  }

  push(command: Command, graph: Graph): void {
    command.do(graph);
    this.#undo.push(command);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo = [];
  }

  undo(graph: Graph): boolean {
    const command = this.#undo.pop();
    if (!command) return false;
    command.undo(graph);
    this.#redo.push(command);
    return true;
  }

  redo(graph: Graph): boolean {
    const command = this.#redo.pop();
    if (!command) return false;
    command.do(graph);
    this.#undo.push(command);
    return true;
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `pnpm test test/app test/persist`
Expected: PASS — 全部通过

- [ ] **Step 9: 提交**

```bash
git add src/app src/persist test/app test/persist
git commit -m "feat(app): add progress model, command stack and local storage"
```

---

