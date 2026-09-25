// tsconfig lists only `vitest/globals` in `types`, so Node's ambient types are
// deliberately not in this program. The import is real at runtime (vitest runs
// this file in Node) and the assertion below is what proves it; the suppression
// is one line rather than a project-wide `@types/node` dependency. It also fails
// loudly if a later task ever does add Node types, at which point the directive
// can simply go.
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import type { Graph } from '../../src/core/graph';
import { DEFAULT_FUZZ_ROUNDS } from '../../src/levels/checks';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import { CH2_BATCH1 } from '../../src/levels/content/ch2/batch1';
import { CH2_LEVELS } from '../../src/levels/content/ch2/index';
import { grade } from '../../src/levels/grader';
import type { LevelCheck, LevelSpec, TruthRow } from '../../src/levels/spec';
import { build, registry } from '../fixtures/build';

/**
 * Chapter 2's first batch: levels 13-17.
 *
 * The source compendium fixes these levels' names, their order and a one-line
 * concept each, and nothing else -- no ports, no widths, no pass conditions, no
 * rewards. Every other number in the level data is this replica's design, which
 * is why each level carries a data comment saying which is which; the last
 * describe block here checks that the comments exist.
 *
 * The starter set is imported rather than restated (`STARTER_COMPONENTS` is the
 * same constant `paletteDefsFor` filters with), exactly as the chapter-1 tests
 * do it.
 */

/** The level with this index, or a loud failure -- indexing returns `undefined`. */
function levelAt(index: number): LevelSpec {
  const level = CH2_BATCH1.find((l) => l.index === index);
  if (!level) throw new Error(`chapter 2 batch 1 has no level with index ${index}`);
  return level;
}

function specOf(id: string): LevelSpec {
  const level = CH2_BATCH1.find((l) => l.id === id);
  if (!level) throw new Error(`chapter 2 batch 1 has no level ${id}`);
  return level;
}

const L13 = levelAt(13);
const L14 = levelAt(14);
const L15 = levelAt(15);
const L16 = levelAt(16);
const L17 = levelAt(17);

/** `id:width` per pin, the shape the task brief fixes for each level. */
function pinsOf(level: LevelSpec): { inputs: string[]; outputs: string[] } {
  return {
    inputs: level.io.inputs.map((pin) => `${pin.id}:${pin.width}`),
    outputs: level.io.outputs.map((pin) => `${pin.id}:${pin.width}`),
  };
}

/** The level's truth-table rows, refusing an absent or empty table. */
function rowsOf(level: LevelSpec): readonly TruthRow[] {
  const check = level.checks.find((entry) => entry.kind === 'truth-table');
  if (check?.kind !== 'truth-table') throw new Error(`${level.id} has no truth-table check`);
  if (!check.rows || check.rows.length === 0) {
    throw new Error(`${level.id} has a truth table with no rows`);
  }
  return check.rows;
}

/** The row whose inputs include every named pin/value pair. */
function rowFor(rows: readonly TruthRow[], inputs: Record<string, number>): TruthRow | undefined {
  return rows.find((row) =>
    Object.entries(inputs).every(([pin, value]) => row.inputs[pin] === value),
  );
}

/** High bits in the low `bits` bits of `value`. */
function onesIn(value: number, bits: number): number {
  let count = 0;
  for (let bit = 0; bit < bits; bit += 1) if ((value >>> bit) & 1) count += 1;
  return count;
}

/**
 * Why this level's checks would let a circuit pass unmeasured, in the words of
 * the failure.
 *
 * An empty array means every check compares something. This is the invariant the
 * chapter-1 files carry inline in their `gives every level a check with
 * something to compare` loops (levels 1-6 in `ch1-part1.test.ts`, 7-12 in
 * `ch1-part2.test.ts`); the same five branches live in all three files, and this
 * copy is the one that is itself tested -- see `the vacuity invariant` below,
 * which is what makes the `fuzz`/`custom`/`constraint` branches load-bearing
 * rather than decorative. Hoisting the three copies into `test/fixtures/` would
 * need a file outside this task's declared scope.
 *
 * The previous version of this invariant handled `truth-table`/`script` with no
 * `else`, so a `constraint`, `fuzz` or `custom` check -- and any kind a newer
 * kernel might add -- passed it vacuously. Every branch below states what makes
 * that kind compare nothing:
 *
 *  - `truth-table`: no rows, or a row with no expected output (`missing-rows`);
 *  - `script`: no steps, or no step that expects anything;
 *  - `constraint`: no inputs to sum/count, or an `at-least` count of 0 (every
 *    input vector would satisfy it);
 *  - `fuzz`: `rounds` present but not a positive integer (`missing-vectors`), or
 *    a pin of the level with no function bound to it. An OMITTED `rounds` is
 *    fine -- `levels/checks.ts` defaults it -- so only an explicit bad one is a
 *    problem;
 *  - `custom`: no id to look up in the registry.
 */
function vacuityProblems(level: LevelSpec): string[] {
  const problems: string[] = [];
  if (level.checks.length === 0) problems.push(`${level.id} has no checks`);

  for (const check of level.checks) {
    switch (check.kind) {
      case 'truth-table':
        if (!check.rows || check.rows.length === 0) {
          problems.push(`${level.id} has a truth table with no rows`);
        } else if (check.rows.some((row) => Object.keys(row.outputs).length === 0)) {
          problems.push(`${level.id} has a truth-table row with no expected output`);
        }
        break;
      case 'script':
        if (check.steps.length === 0) {
          problems.push(`${level.id} has an empty script`);
        } else if (check.steps.every((step) => step.expect === undefined)) {
          problems.push(`${level.id} has a script that expects nothing`);
        }
        break;
      case 'constraint':
        if (check.rule.inputs.length === 0) {
          problems.push(`${level.id} has a constraint with no inputs`);
        } else if (check.rule.kind === 'at-least' && check.rule.count < 1) {
          problems.push(`${level.id} has an at-least constraint every vector satisfies`);
        }
        break;
      case 'fuzz': {
        // `rounds` is optional by contract -- omitting it means
        // `DEFAULT_FUZZ_ROUNDS` -- so the invariant is on the EFFECTIVE count,
        // read from the checker's own constant. A check that would run no rounds
        // compares nothing; restating the default here would let the two drift.
        const rounds = check.rounds ?? DEFAULT_FUZZ_ROUNDS;
        if (!Number.isInteger(rounds) || rounds <= 0) {
          problems.push(`${level.id} has a fuzz check with rounds=${String(check.rounds)}`);
        }
        if (level.io.inputs.length === 0 || level.io.outputs.length === 0) {
          problems.push(`${level.id} has a fuzz check on a level with no pins to vary`);
        }
        for (const pin of level.io.inputs) {
          if (typeof check.inputs[pin.id] !== 'function') {
            problems.push(`${level.id} has a fuzz check with no input function for pin ${pin.id}`);
          }
        }
        for (const pin of level.io.outputs) {
          if (typeof check.outputs[pin.id] !== 'function') {
            problems.push(`${level.id} has a fuzz check with no expectation for pin ${pin.id}`);
          }
        }
        break;
      }
      case 'custom':
        if (typeof check.id !== 'string' || check.id === '') {
          problems.push(`${level.id} has a custom check with no id to look up`);
        }
        break;
      default:
        // Level data reaches the kernel untyped, so a kind this kernel does not
        // know is exactly the case that used to fall through the old two-branch
        // loop and pass. It is reported, not skipped.
        problems.push(
          `${level.id} has a check of unknown kind ${String((check as { kind?: unknown }).kind)}`,
        );
    }
  }

  return problems;
}

describe('chapter 2, levels 13-17', () => {
  it('exposes five chapter-2 levels with the briefed indices', () => {
    expect(CH2_BATCH1.map((level) => level.index)).toEqual([13, 14, 15, 16, 17]);
    expect(CH2_BATCH1.map((level) => level.chapter)).toEqual([2, 2, 2, 2, 2]);
  });

  it('uses the ch2-<index>-<slug> id convention', () => {
    expect(CH2_BATCH1.map((level) => level.id)).toEqual([
      'ch2-13-odd-number-of-signals',
      'ch2-14-double-trouble',
      'ch2-15-binary-racer',
      'ch2-16-counting-signals',
      'ch2-17-double-the-number',
    ]);
  });

  it('is what the chapter assembly is built from', () => {
    expect(CH2_LEVELS).toEqual([...CH2_BATCH1]);
  });

  it('shapes every level exactly as the brief fixes it', () => {
    expect(pinsOf(L13)).toEqual({ inputs: ['a:4'], outputs: ['out:1'] });
    expect(pinsOf(L14)).toEqual({
      inputs: ['a:1', 'b:1', 'c:1', 'd:1'],
      outputs: ['out:1'],
    });
    expect(pinsOf(L15)).toEqual({ inputs: ['a:4'], outputs: ['out:3'] });
    expect(pinsOf(L16)).toEqual({
      inputs: ['a:1', 'b:1', 'c:1', 'd:1'],
      outputs: ['out:3'],
    });
    expect(pinsOf(L17)).toEqual({ inputs: ['a:8'], outputs: ['out:8'] });
  });

  it('names each level in both languages', () => {
    expect(CH2_BATCH1.map((level) => level.name.en)).toEqual([
      'ODD Number of Signals',
      'Double Trouble',
      'Binary Racer',
      'Counting Signals',
      'Double the Number',
    ]);
    expect(CH2_BATCH1.map((level) => level.name.zh)).toEqual([
      '奇数个信号',
      '成对的麻烦',
      '二进制速算',
      '信号计数',
      '加倍',
    ]);
    for (const level of CH2_BATCH1) {
      expect(level.brief.zh.length, `${level.id} has an empty zh brief`).toBeGreaterThan(0);
      expect(level.brief.en.length, `${level.id} has an empty en brief`).toBeGreaterThan(0);
      expect(level.hint.zh.length, `${level.id} has an empty zh hint`).toBeGreaterThan(0);
      expect(level.hint.en.length, `${level.id} has an empty en hint`).toBeGreaterThan(0);
    }
  });

  it('gates every part behind a component unlocked at or before it', () => {
    // "At or before": a level may offer the parts its own rewards hand out (the
    // brief says level 13 must list `splitter`/`maker`/`const8`), so the walk
    // adds a level's rewards before testing its own palette and the next level's
    // after it. Chapter 1 is walked first because chapter 2's palettes are built
    // on its rewards.
    const unlocked = new Set<string>(STARTER_COMPONENTS);
    for (const level of [...CH1_PART1, ...CH1_PART2, ...CH2_BATCH1]) {
      for (const def of level.rewards?.components ?? []) unlocked.add(def);
      for (const def of level.allowedComponents) {
        expect(unlocked.has(def), `${level.id} offers locked component ${def}`).toBe(true);
      }
    }
  });

  it('offers nothing from a later level', () => {
    // The same rule stated as the review asks for it: what this batch offers is
    // drawn from chapter 1's rewards, its own rewards, and the starter set --
    // never from level 14+ (here: the wide operators and the storage family).
    const throughCh1 = new Set<string>(STARTER_COMPONENTS);
    for (const level of [...CH1_PART1, ...CH1_PART2]) {
      for (const def of level.rewards?.components ?? []) throughCh1.add(def);
    }
    const owned = new Set(throughCh1);
    for (const level of CH2_BATCH1) {
      for (const def of level.rewards?.components ?? []) owned.add(def);
      for (const def of level.allowedComponents) {
        expect(owned.has(def), `${level.id} offers ${def}, which no level unlocks by then`).toBe(
          true,
        );
      }
    }
    // The parts this batch never hands out belong to the later batches; naming a
    // few keeps the walk above from passing on an empty palette.
    for (const later of ['mux8', 'delay8', 'reg8', 'counter8', 'ram8', 'and8', 'shift_l8']) {
      expect(owned.has(later), `${later} is unlocked inside this batch`).toBe(false);
    }
  });

  it('gives every level a check with something to compare', () => {
    for (const level of CH2_BATCH1) {
      expect(level.checks.length, `${level.id} has no checks`).toBeGreaterThan(0);
      expect(vacuityProblems(level), `${level.id} has a vacuous check`).toEqual([]);
    }
  });

  it('generates the wide truth tables instead of leaving rows out', () => {
    // An empty `rows` array is a hard `missing-rows` failure, not "enumerate
    // everything" -- so a level that publishes a count has to have its rows
    // produced by the kernel's own enumerator.
    expect(rowsOf(L13).length).toBe(16);
    expect(rowsOf(L15).length).toBe(16);
    expect(rowsOf(L16).length).toBe(16);
    expect(rowsOf(L17).length).toBe(256);
  });

  it('enumerates every input combination exactly once', () => {
    for (const level of [L13, L15, L16]) {
      const rows = rowsOf(level);
      const seen = new Set(rows.map((row) => JSON.stringify(row.inputs)));
      expect(seen.size, `${level.id} repeats or skips input combinations`).toBe(16);
    }
    const wide = rowsOf(L17);
    expect(new Set(wide.map((row) => row.inputs.a)).size).toBe(256);
    expect(wide.map((row) => row.inputs.a).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual(
      Array.from({ length: 256 }, (_, n) => n),
    );
  });

  it('states each level the brief describes', () => {
    // Level 13: an odd number of high bits reads high.
    const thirteen = rowsOf(L13);
    expect(rowFor(thirteen, { a: 0 })?.outputs.out).toBe(0);
    expect(rowFor(thirteen, { a: 1 })?.outputs.out).toBe(1);
    // 0b11 is two ones: even, so low. (The first draft of this line said 1 and
    // the level was right; the table is what caught it.)
    expect(rowFor(thirteen, { a: 3 })?.outputs.out).toBe(0);
    expect(rowFor(thirteen, { a: 7 })?.outputs.out).toBe(1);
    expect(rowFor(thirteen, { a: 15 })?.outputs.out).toBe(0);

    // Level 15: the three-bit count of the ones in a.
    const fifteen = rowsOf(L15);
    expect(rowFor(fifteen, { a: 0 })?.outputs.out).toBe(0);
    expect(rowFor(fifteen, { a: 5 })?.outputs.out).toBe(2);
    expect(rowFor(fifteen, { a: 7 })?.outputs.out).toBe(3);
    expect(rowFor(fifteen, { a: 15 })?.outputs.out).toBe(4);

    // Level 16: the same count, from four separate signals.
    const sixteen = rowsOf(L16);
    expect(rowFor(sixteen, { a: 1, b: 1, c: 1, d: 1 })?.outputs.out).toBe(4);
    expect(rowFor(sixteen, { a: 1, b: 0, c: 1, d: 0 })?.outputs.out).toBe(2);
    expect(rowFor(sixteen, { a: 0, b: 0, c: 0, d: 1 })?.outputs.out).toBe(1);

    // Level 17: double, modulo 256.
    const seventeen = rowsOf(L17);
    expect(rowFor(seventeen, { a: 0 })?.outputs.out).toBe(0);
    expect(rowFor(seventeen, { a: 1 })?.outputs.out).toBe(2);
    expect(rowFor(seventeen, { a: 127 })?.outputs.out).toBe(254);
    expect(rowFor(seventeen, { a: 128 })?.outputs.out).toBe(0);
    expect(rowFor(seventeen, { a: 255 })?.outputs.out).toBe(254);
  });

  it('states level 14 as an at-least-2 rule over its four pins', () => {
    const check = L14.checks.find((entry) => entry.kind === 'constraint');
    expect(check).toBeDefined();
    if (check?.kind !== 'constraint') throw new Error('level 14 is not a constraint check');
    expect(check.rule).toEqual({
      kind: 'at-least',
      inputs: ['a', 'b', 'c', 'd'],
      count: 2,
      output: 'out',
    });
  });

  it('hands out the parts the brief assigns to each level', () => {
    expect(L13.rewards?.components).toEqual(['splitter', 'maker', 'const8']);
    expect(L14.rewards?.components ?? []).toEqual([]);
    expect(L15.rewards?.components).toEqual(['less_u']);
    expect(L16.rewards?.components).toEqual(['equal8']);
    expect(L17.rewards?.components).toEqual(['add8', 'mul8']);
  });
});

describe('the vacuity invariant', () => {
  /**
   * A level of the right shape with the one check under test.
   *
   * These synthetic levels are what makes the five branches load-bearing: the
   * old two-branch loop passed every one of them, so each `expect` below fails
   * against it.
   */
  function synthetic(check: LevelCheck): LevelSpec {
    return {
      id: 'ch2-99-synthetic',
      chapter: 2,
      index: 99,
      name: { zh: '合成关', en: 'Synthetic' },
      brief: { zh: '', en: '' },
      hint: { zh: '', en: '' },
      allowedComponents: [],
      io: { inputs: [{ id: 'a', width: 1 }], outputs: [{ id: 'out', width: 1 }] },
      checks: [check],
    };
  }

  const sound: readonly LevelCheck[] = [
    { kind: 'truth-table', rows: [{ inputs: { a: 0 }, outputs: { out: 0 } }] },
    { kind: 'script', steps: [{ tick: 0, expect: { out: 0 } }] },
    {
      kind: 'constraint',
      rule: { kind: 'sum-equals', inputs: ['a'], output: 'out' },
    },
    {
      kind: 'fuzz',
      seed: 1,
      rounds: 4,
      inputs: { a: (sample) => sample.a ?? 0 },
      outputs: { out: (vector) => vector.a ?? 0 },
    },
    { kind: 'custom', id: 'ch2-99-synthetic' },
  ];

  it('accepts a check of every kind that compares something', () => {
    for (const check of sound) {
      expect(vacuityProblems(synthetic(check)), `${check.kind} was reported`).toEqual([]);
    }
  });

  const vacuous: readonly { readonly name: string; readonly check: LevelCheck }[] = [
    { name: 'a truth table with no rows', check: { kind: 'truth-table', rows: [] } },
    {
      name: 'a truth-table row with no expected output',
      check: { kind: 'truth-table', rows: [{ inputs: { a: 1 }, outputs: {} }] },
    },
    { name: 'a script with no steps', check: { kind: 'script', steps: [] } },
    { name: 'a script that expects nothing', check: { kind: 'script', steps: [{ tick: 0 }] } },
    {
      name: 'a constraint with no inputs',
      check: { kind: 'constraint', rule: { kind: 'sum-equals', inputs: [], output: 'out' } },
    },
    {
      name: 'an at-least count every vector satisfies',
      check: { kind: 'constraint', rule: { kind: 'at-least', inputs: ['a'], count: 0, output: 'out' } },
    },
    {
      name: 'a fuzz check with rounds=0',
      check: {
        kind: 'fuzz',
        seed: 1,
        rounds: 0,
        inputs: { a: (sample) => sample.a ?? 0 },
        outputs: { out: (vector) => vector.a ?? 0 },
      },
    },
    {
      name: 'a fuzz check with a fractional round count',
      check: {
        kind: 'fuzz',
        seed: 1,
        rounds: 1.5,
        inputs: { a: (sample) => sample.a ?? 0 },
        outputs: { out: (vector) => vector.a ?? 0 },
      },
    },
    {
      name: 'a fuzz check with no expectation for a pin',
      check: { kind: 'fuzz', seed: 1, rounds: 4, inputs: { a: () => 0 }, outputs: {} },
    },
    { name: 'a custom check with no id', check: { kind: 'custom', id: '' } },
    {
      name: 'a check of a kind this kernel does not know',
      check: { kind: 'from-a-newer-kernel' } as unknown as LevelCheck,
    },
  ];

  for (const { name, check } of vacuous) {
    it(`rejects ${name}`, () => {
      expect(vacuityProblems(synthetic(check)).length).toBeGreaterThan(0);
    });
  }

  it('accepts a fuzz check that leaves `rounds` to the default', () => {
    // `rounds` is optional by contract (`DEFAULT_FUZZ_ROUNDS`), so an omitted
    // one is not the vacuity defect -- an explicit 0 is.
    const check: LevelCheck = {
      kind: 'fuzz',
      seed: 1,
      inputs: { a: (sample) => sample.a ?? 0 },
      outputs: { out: (vector) => vector.a ?? 0 },
    };
    expect(vacuityProblems(synthetic(check))).toEqual([]);
  });
});

describe('every level carries its sourced-vs-authored data comment', () => {
  /**
   * The compendium fixes a name, an order and a one-line concept per level and
   * nothing else, so every port, width, check, target and reward in this file is
   * this replica's design. The data comment on each level has to say which is
   * which, and a reviewer checks it by reading; this checks that the marker
   * block exists at all, so a later batch cannot quietly drop it.
   */
  const source = readFileSync(
    new URL('../../src/levels/content/ch2/batch1.ts', import.meta.url),
    'utf8',
  );

  /** Data comment -> level id, for every doc comment followed by a level literal. */
  const comments = new Map<string, string>();
  for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\/\s*\{\s*id: '([^']+)'/g)) {
    const [, body, id] = match;
    if (body !== undefined && id !== undefined) comments.set(id, body);
  }

  for (const level of CH2_BATCH1) {
    it(level.id, () => {
      const comment = comments.get(level.id) ?? '';
      expect(comment.length, `${level.id} has no data comment`).toBeGreaterThan(0);
      expect(comment, `${level.id} does not record what is sourced`).toContain('SOURCED');
      expect(comment, `${level.id} does not record what is authored`).toContain('AUTHORED');
    });
  }
});

const solutions: Record<string, () => Graph> = {
  // splitter + three XORs: one per pair, then the pair results.
  'ch2-13-odd-number-of-signals': () =>
    build([
      { kind: 'input', name: 'a', width: 4 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
      { kind: 'part', def: 'xor', id: 'p01', from: ['sp.b0', 'sp.b1'] },
      { kind: 'part', def: 'xor', id: 'p23', from: ['sp.b2', 'sp.b3'] },
      { kind: 'part', def: 'xor', id: 'parity', from: ['p01', 'p23'] },
      { kind: 'output', from: 'parity' },
    ]),
  // (a&b) | (c&d) | ((a|b)&(c|d)): the six pairs, in three terms.
  'ch2-14-double-trouble': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'input', name: 'd' },
      { kind: 'part', def: 'and', id: 'ab', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'cd', from: ['c', 'd'] },
      { kind: 'part', def: 'or', id: 'a_or_b', from: ['a', 'b'] },
      { kind: 'part', def: 'or', id: 'c_or_d', from: ['c', 'd'] },
      { kind: 'part', def: 'and', id: 'cross', from: ['a_or_b', 'c_or_d'] },
      { kind: 'part', def: 'or3', id: 'at_least_two', from: ['ab', 'cd', 'cross'] },
      { kind: 'output', from: 'at_least_two' },
    ]),
  // Two half adders, then the two partial sums added the same way.
  'ch2-15-binary-racer': () =>
    build([
      { kind: 'input', name: 'a', width: 4 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
      { kind: 'part', def: 'xor', id: 's01', from: ['sp.b0', 'sp.b1'] },
      { kind: 'part', def: 'and', id: 'c01', from: ['sp.b0', 'sp.b1'] },
      { kind: 'part', def: 'xor', id: 's23', from: ['sp.b2', 'sp.b3'] },
      { kind: 'part', def: 'and', id: 'c23', from: ['sp.b2', 'sp.b3'] },
      { kind: 'part', def: 'xor', id: 'bit0', from: ['s01', 's23'] },
      { kind: 'part', def: 'and', id: 'carry', from: ['s01', 's23'] },
      { kind: 'part', def: 'xor', id: 'carries', from: ['c01', 'c23'] },
      { kind: 'part', def: 'xor', id: 'bit1', from: ['carries', 'carry'] },
      { kind: 'part', def: 'and', id: 'bit2', from: ['c01', 'c23'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mk',
        from: ['bit0', 'bit1', 'bit2', 'z', 'z', 'z', 'z', 'z'],
      },
      { kind: 'output', width: 3, from: 'mk' },
    ]),
  // The same tree, on four separate pins.
  'ch2-16-counting-signals': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'input', name: 'd' },
      { kind: 'part', def: 'xor', id: 's01', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'c01', from: ['a', 'b'] },
      { kind: 'part', def: 'xor', id: 's23', from: ['c', 'd'] },
      { kind: 'part', def: 'and', id: 'c23', from: ['c', 'd'] },
      { kind: 'part', def: 'xor', id: 'bit0', from: ['s01', 's23'] },
      { kind: 'part', def: 'and', id: 'carry', from: ['s01', 's23'] },
      { kind: 'part', def: 'xor', id: 'carries', from: ['c01', 'c23'] },
      { kind: 'part', def: 'xor', id: 'bit1', from: ['carries', 'carry'] },
      { kind: 'part', def: 'and', id: 'bit2', from: ['c01', 'c23'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mk',
        from: ['bit0', 'bit1', 'bit2', 'z', 'z', 'z', 'z', 'z'],
      },
      { kind: 'output', width: 3, from: 'mk' },
    ]),
  // A left shift is wiring: every bit of a moves up one slot, bit 0 is 0.
  'ch2-17-double-the-number': () =>
    build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mk',
        from: ['z', 'sp.b0', 'sp.b1', 'sp.b2', 'sp.b3', 'sp.b4', 'sp.b5', 'sp.b6'],
      },
      { kind: 'output', width: 8, from: 'mk' },
    ]),
};

/** Circuits a player would plausibly build and that must be rejected. */
const wrong: Record<string, () => Graph> = {
  // "a is an odd number" instead of "an odd number of bits is high": the low bit
  // of the value, not the parity of its bits.
  'ch2-13-odd-number-of-signals': () =>
    build([
      { kind: 'input', name: 'a', width: 4 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
      { kind: 'output', from: 'sp.b0' },
    ]),
  // The pairs only: (a&b)|(c&d) misses every cross pair.
  'ch2-14-double-trouble': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'input', name: 'd' },
      { kind: 'part', def: 'and', id: 'ab', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'cd', from: ['c', 'd'] },
      { kind: 'part', def: 'or', id: 'pairs', from: ['ab', 'cd'] },
      { kind: 'output', from: 'pairs' },
    ]),
  // Truncation instead of a count: a & 7.
  'ch2-15-binary-racer': () =>
    build([
      { kind: 'input', name: 'a', width: 4 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mk',
        from: ['sp.b0', 'sp.b1', 'sp.b2', 'z', 'z', 'z', 'z', 'z'],
      },
      { kind: 'output', width: 3, from: 'mk' },
    ]),
  // Two half adders, but the second bit ORs the carries instead of adding the
  // cross term: right for two ones in one pair, wrong for a split pair.
  'ch2-16-counting-signals': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'input', name: 'd' },
      { kind: 'part', def: 'xor', id: 's01', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'c01', from: ['a', 'b'] },
      { kind: 'part', def: 'xor', id: 's23', from: ['c', 'd'] },
      { kind: 'part', def: 'and', id: 'c23', from: ['c', 'd'] },
      { kind: 'part', def: 'xor', id: 'bit0', from: ['s01', 's23'] },
      { kind: 'part', def: 'or', id: 'bit1', from: ['c01', 'c23'] },
      { kind: 'part', def: 'and', id: 'bit2', from: ['c01', 'c23'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mk',
        from: ['bit0', 'bit1', 'bit2', 'z', 'z', 'z', 'z', 'z'],
      },
      { kind: 'output', width: 3, from: 'mk' },
    ]),
  // The shift in the wrong direction: a >> 1 halves instead of doubling.
  'ch2-17-double-the-number': () =>
    build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mk',
        from: ['sp.b1', 'sp.b2', 'sp.b3', 'sp.b4', 'sp.b5', 'sp.b6', 'sp.b7', 'z'],
      },
      { kind: 'output', width: 8, from: 'mk' },
    ]),
};

describe('reference solutions pass with three stars', () => {
  for (const [id, make] of Object.entries(solutions)) {
    it(id, () => {
      const result = grade(make(), registry, specOf(id));
      expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.stars, `metrics=${JSON.stringify(result.metrics)}`).toBe(3);
    });
  }
});

describe('three-star targets are the reference solutions own metrics', () => {
  // The target is measured, not guessed: this fails if a level states a number
  // its own reference does not score exactly, in either direction.
  for (const [id, make] of Object.entries(solutions)) {
    it(id, () => {
      const level = specOf(id);
      const { metrics } = grade(make(), registry, level);
      expect(level.threeStar, `measured metrics=${JSON.stringify(metrics)}`).toEqual(metrics);
    });
  }
});

describe('reference solutions are buildable from the palette they are graded against', () => {
  for (const [id, make] of Object.entries(solutions)) {
    it(id, () => {
      const offered = new Set(specOf(id).allowedComponents);
      for (const inst of make().instances) {
        expect(offered.has(inst.def), `${id} uses ${inst.def}, which its palette omits`).toBe(true);
      }
    });
  }
});

describe('plausible wrong circuits fail', () => {
  for (const [id, make] of Object.entries(wrong)) {
    it(id, () => {
      const result = grade(make(), registry, specOf(id));
      expect(result.passed).toBe(false);
      // A graded-but-wrong circuit, not a refused graph: a malformed circuit
      // also fails, with no failure records at all.
      expect(result.failures.length, JSON.stringify(result.issues)).toBeGreaterThan(0);
      expect(result.stars).toBe(0);
    });
  }
});

describe('an empty circuit fails every level instead of throwing', () => {
  for (const level of CH2_BATCH1) {
    it(level.id, () => {
      const result = grade(build([]), registry, level);
      expect(result.passed).toBe(false);
      expect(result.stars).toBe(0);
    });
  }
});

describe('level 17 is solvable by arithmetic too, for fewer stars', () => {
  it('doubles with add8(a, a) and scores one star', () => {
    // The level's data comment claims this alternative: an adder doubles as
    // well as a shift does, and costs gates. Measured here rather than asserted
    // in prose -- `const_off` ties `cin` low, because `build` reuses the last
    // source for any input it is not given. Level 17 rewards `add8`, so a
    // first-time player only sees it after passing, which is why the wiring
    // reference is the one the target is measured from.
    const graph = build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'part', def: 'add8', id: 'sum', from: ['a', 'a', 'z'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      { kind: 'output', width: 8, from: 'sum' },
    ]);
    const result = grade(graph, registry, specOf('ch2-17-double-the-number'));
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.metrics).toEqual({ gate: 72, delay: 1, tick: 0 });
    expect(result.stars, 'the gate target is the floor, so an adder is one star').toBe(1);
  });
});

describe('the level-13 unlock seam', () => {
  it('offers exactly its own rewards as parts no earlier level unlocks', () => {
    // NOT an assertion that this is fine -- it is the one seam this batch hands
    // to Task 7 (chapter assembly and unlock-chain validation). Level 13 is the
    // first level whose puzzle needs a wide part, so `splitter`/`maker`/`const8`
    // are its own rewards, and `paletteDefsFor` offers the rewards of PASSED
    // levels only: a first-time player's palette for level 13 lacks the splitter
    // its parity puzzle cannot be built without. See the data comment on level
    // 13 and task-8-report.md. If the fix moves those rewards to an earlier
    // level, this test fails and should be deleted with them.
    const unlockedBefore = new Set<string>(STARTER_COMPONENTS);
    for (const level of [...CH1_PART1, ...CH1_PART2]) {
      for (const def of level.rewards?.components ?? []) unlockedBefore.add(def);
    }
    const notUnlockedYet = L13.allowedComponents.filter((def) => !unlockedBefore.has(def));
    expect(notUnlockedYet).toEqual(['splitter', 'maker', 'const8']);
    expect(L13.rewards?.components).toEqual(notUnlockedYet);
  });
});
