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
import { CH2_BATCH2 } from '../../src/levels/content/ch2/batch2';
import { grade } from '../../src/levels/grader';
import type {
  CheckFailure,
  FuzzCheck,
  FuzzVector,
  LevelCheck,
  LevelSpec,
  TruthRow,
} from '../../src/levels/spec';
import { build, registry, type Node } from '../fixtures/build';
import {
  CH2_BATCH2_REFERENCES,
  bits,
  byteNotReference,
  byteOrReference,
  fullAdderReference,
  handWiredAdderReference,
  rippleAdderReference,
} from '../fixtures/ch2-references';

/**
 * Chapter 2's second batch: levels 18-22 -- the byte operators and the adders.
 *
 * The source compendium fixes these levels' names, their order and a one-line
 * concept each, and nothing else -- no ports, no widths, no pass conditions, no
 * targets and no rewards. Every other number in the level data is this replica's
 * design, which is why each level carries a data comment saying which is which;
 * the marker block near the end of this file checks that the comments exist.
 *
 * THREE THINGS THIS FILE CARRIES THAT BATCH 1'S DOES NOT:
 *
 *  * `fuzz` levels (18, 19 and 22). Their checks are not rows, so a wrong
 *    circuit has to be shown failing on a SPECIFIC ROUND WITH A SPECIFIC VECTOR
 *    rather than merely failing -- the `the fuzz levels name the round and the
 *    vector that failed` block replays the kernel's own vector sequence through
 *    the level's own expectation functions and asserts that the round and the
 *    vector in the failure record are the first ones that actually disagree. A
 *    fuzz check that failed "somewhere" would be indistinguishable from a
 *    vacuous one.
 *  * the source's two ACHIEVEMENT notes in this batch (level 21's five
 *    components, level 22's delay), both of which are records about the source
 *    rather than pass conditions -- see the dedicated block at the end, which
 *    measures both on the reference solutions.
 *  * the `full_adder` reward, whose def was missing when this batch was authored
 *    and landed in `523a7b9` (`src/core/defs/index.ts`, 9 NAND equivalents on the
 *    `FULL_ADDER` basis `wide.ts` prices `add8` with): the walk below treats it
 *    as an ordinary unlocked id, and the level comments carry the history and the
 *    two levels that offer it.
 *
 * The starter set is imported rather than restated (`STARTER_COMPONENTS` is the
 * same constant `paletteDefsFor` filters with), exactly as the chapter-1 and
 * batch-1 tests do it.
 */

/** The level with this index, or a loud failure -- indexing returns `undefined`. */
function levelAt(index: number): LevelSpec {
  const level = CH2_BATCH2.find((l) => l.index === index);
  if (!level) throw new Error(`chapter 2 batch 2 has no level with index ${index}`);
  return level;
}

function specOf(id: string): LevelSpec {
  const level = CH2_BATCH2.find((l) => l.id === id);
  if (!level) throw new Error(`chapter 2 batch 2 has no level ${id}`);
  return level;
}

const L18 = levelAt(18);
const L19 = levelAt(19);
const L20 = levelAt(20);
const L21 = levelAt(21);
const L22 = levelAt(22);

/** The batch's three fuzz levels, in order. */
const FUZZ_LEVELS: readonly LevelSpec[] = [L18, L19, L22];

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

/** The level's fuzz check, refusing an absent one. */
function fuzzOf(level: LevelSpec): FuzzCheck {
  const check = level.checks.find((entry) => entry.kind === 'fuzz');
  if (check?.kind !== 'fuzz') throw new Error(`${level.id} has no fuzz check`);
  return check;
}

/** The row whose inputs include every named pin/value pair. */
function rowFor(rows: readonly TruthRow[], inputs: Record<string, number>): TruthRow | undefined {
  return rows.find((row) =>
    Object.entries(inputs).every(([pin, value]) => row.inputs[pin] === value),
  );
}

/** One expectation function of a level's fuzz check, refusing an absent one. */
function expectation(level: LevelSpec, pin: string): (vector: FuzzVector) => number {
  const fn = fuzzOf(level).outputs[pin];
  if (typeof fn !== 'function') throw new Error(`${level.id} expects nothing for pin ${pin}`);
  return fn;
}

/** The whole expected output map for one fuzz vector, from the level's own functions. */
function expectedFor(level: LevelSpec, vector: FuzzVector): Record<string, number> {
  const expected: Record<string, number> = {};
  for (const pin of level.io.outputs) expected[pin.id] = expectation(level, pin.id)(vector);
  return expected;
}

/** A fuzz vector, spelled as the record the kernel builds. */
function vector(parts: Record<string, number>): FuzzVector {
  return parts;
}

/**
 * Why this level's checks would let a circuit pass unmeasured, in the words of
 * the failure.
 *
 * An empty array means every check compares something. This is the same
 * five-branch invariant `ch1-part1.test.ts`, `ch1-part2.test.ts` and
 * `ch2-batch1.test.ts` carry -- batch 1's copy is itself tested against
 * synthetic vacuous checks of every kind, and a second copy of that proof here
 * would be a second thing to keep in step. What this copy adds for THIS batch is
 * the part that matters most: `fuzz` reads `check.inputs` / `check.outputs` pin
 * by pin, so a level that renamed a pin and left its expectation behind is
 * reported instead of comparing nothing.
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
        // `DEFAULT_FUZZ_ROUNDS`, read from the checker's own constant so the two
        // cannot drift -- and an explicit bad one is `missing-vectors`.
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
        problems.push(
          `${level.id} has a check of unknown kind ${String((check as { kind?: unknown }).kind)}`,
        );
    }
  }

  return problems;
}

describe('chapter 2, levels 18-22', () => {
  it('exposes five chapter-2 levels with the briefed indices', () => {
    expect(CH2_BATCH2.map((level) => level.index)).toEqual([18, 19, 20, 21, 22]);
    expect(CH2_BATCH2.map((level) => level.chapter)).toEqual([2, 2, 2, 2, 2]);
  });

  it('uses the ch2-<index>-<slug> id convention', () => {
    expect(CH2_BATCH2.map((level) => level.id)).toEqual([
      'ch2-18-byte-or',
      'ch2-19-byte-not',
      'ch2-20-half-adder',
      'ch2-21-full-adder',
      'ch2-22-adding-bytes',
    ]);
  });

  it('shapes every level exactly as the brief fixes it', () => {
    expect(pinsOf(L18)).toEqual({ inputs: ['a:8', 'b:8'], outputs: ['out:8'] });
    expect(pinsOf(L19)).toEqual({ inputs: ['a:8'], outputs: ['out:8'] });
    expect(pinsOf(L20)).toEqual({ inputs: ['a:1', 'b:1'], outputs: ['sum:1', 'carry:1'] });
    expect(pinsOf(L21)).toEqual({ inputs: ['a:1', 'b:1', 'cin:1'], outputs: ['sum:1', 'cout:1'] });
    expect(pinsOf(L22)).toEqual({ inputs: ['a:8', 'b:8', 'cin:1'], outputs: ['out:8', 'cout:1'] });
  });

  it('names each level in both languages', () => {
    expect(CH2_BATCH2.map((level) => level.name.en)).toEqual([
      'Byte OR',
      'Byte NOT',
      'Half Adder',
      'Full Adder',
      'Adding Bytes',
    ]);
    expect(CH2_BATCH2.map((level) => level.name.zh)).toEqual([
      '8 位或',
      '8 位非',
      '半加器',
      '全加器',
      '8 位加法器',
    ]);
    for (const level of CH2_BATCH2) {
      expect(level.brief.zh.length, `${level.id} has an empty zh brief`).toBeGreaterThan(0);
      expect(level.brief.en.length, `${level.id} has an empty en brief`).toBeGreaterThan(0);
      expect(level.hint.zh.length, `${level.id} has an empty zh hint`).toBeGreaterThan(0);
      expect(level.hint.en.length, `${level.id} has an empty en hint`).toBeGreaterThan(0);
    }
  });

  it('gates every part behind a component unlocked at or before it', () => {
    // "At or before": a level may offer the parts its own rewards hand out (the
    // brief says level 18 must list the four byte operators it teaches), so the
    // walk adds a level's rewards before testing its own palette. Chapter 1 and
    // batch 1 are walked first because this batch's palettes are built on their
    // rewards -- the splitter and maker this batch's byte levels are wired with
    // arrive at level 13.
    const unlocked = new Set<string>(STARTER_COMPONENTS);
    for (const level of [...CH1_PART1, ...CH1_PART2, ...CH2_BATCH1, ...CH2_BATCH2]) {
      for (const def of level.rewards?.components ?? []) unlocked.add(def);
      for (const def of level.allowedComponents) {
        expect(unlocked.has(def), `${level.id} offers locked component ${def}`).toBe(true);
      }
    }
  });

  it('offers nothing from a later level', () => {
    // The same rule from the other side, and in the same order as the walk above
    // (a level's own rewards first, then its palette -- which is what lets a
    // level offer the parts it teaches): what this batch offers is chapter 1's
    // rewards, batch 1's, its own, and the starter set -- never the parts the
    // batches after it hand out (the storage family, the shifts, the signed
    // comparison, the decoders).
    const owned = new Set<string>(STARTER_COMPONENTS);
    for (const level of [...CH1_PART1, ...CH1_PART2, ...CH2_BATCH1, ...CH2_BATCH2]) {
      for (const def of level.rewards?.components ?? []) owned.add(def);
      for (const def of level.allowedComponents) {
        expect(owned.has(def), `${level.id} offers ${def}, which no level unlocks by then`).toBe(
          true,
        );
      }
    }
    for (const later of [
      'mux8',
      'delay8',
      'reg8',
      'counter8',
      'ram8',
      'less_s',
      'shift_l8',
      'shift_r8',
      'ashr8',
      'rot_l8',
      'div8',
      'decoder1',
      'decoder2',
      'decoder3',
    ]) {
      expect(owned.has(later), `${later} is unlocked inside this batch`).toBe(false);
    }
  });

  it('gives every level a check with something to compare', () => {
    for (const level of CH2_BATCH2) {
      expect(level.checks.length, `${level.id} has no checks`).toBeGreaterThan(0);
      expect(vacuityProblems(level), `${level.id} has a vacuous check`).toEqual([]);
    }
  });

  it('generates the truth tables instead of leaving rows out', () => {
    // An empty `rows` array is a hard `missing-rows` failure, not "enumerate
    // everything" -- so both adder levels build their rows with the kernel's own
    // enumerator, and the two tables are exhaustive over their pins.
    expect(rowsOf(L20).length).toBe(4);
    expect(rowsOf(L21).length).toBe(8);
    for (const level of [L20, L21]) {
      const rows = rowsOf(level);
      const seen = new Set(rows.map((row) => JSON.stringify(row.inputs)));
      expect(seen.size, `${level.id} repeats or skips input combinations`).toBe(rows.length);
      expect(rows.length).toBe(2 ** level.io.inputs.length);
    }
  });

  it('states the half adder the way the sum-and-carry level does', () => {
    const rows = rowsOf(L20);
    expect(rowFor(rows, { a: 0, b: 0 })?.outputs).toEqual({ sum: 0, carry: 0 });
    expect(rowFor(rows, { a: 0, b: 1 })?.outputs).toEqual({ sum: 1, carry: 0 });
    expect(rowFor(rows, { a: 1, b: 0 })?.outputs).toEqual({ sum: 1, carry: 0 });
    // The row that makes it a half adder rather than an OR: two ones are zero
    // and a carry, not one.
    expect(rowFor(rows, { a: 1, b: 1 })?.outputs).toEqual({ sum: 0, carry: 1 });
  });

  it('states the full adder the way the carry-in level does', () => {
    const rows = rowsOf(L21);
    expect(rowFor(rows, { a: 0, b: 0, cin: 0 })?.outputs).toEqual({ sum: 0, cout: 0 });
    expect(rowFor(rows, { a: 0, b: 1, cin: 1 })?.outputs).toEqual({ sum: 0, cout: 1 });
    expect(rowFor(rows, { a: 1, b: 0, cin: 1 })?.outputs).toEqual({ sum: 0, cout: 1 });
    expect(rowFor(rows, { a: 1, b: 1, cin: 0 })?.outputs).toEqual({ sum: 0, cout: 1 });
    expect(rowFor(rows, { a: 1, b: 1, cin: 1 })?.outputs).toEqual({ sum: 1, cout: 1 });
  });

  it('states the three fuzz levels with a fixed seed and 256 rounds', () => {
    // The brief fixes the checker kind, the seed discipline (a literal, never a
    // drawn one) and the round count; the expectation functions are this file's.
    for (const level of FUZZ_LEVELS) {
      const check = fuzzOf(level);
      expect(Number.isInteger(check.seed), `${level.id} has a non-integer seed`).toBe(true);
      expect(check.seed, `${level.id} fuzzes from seed 0`).not.toBe(0);
      expect(check.rounds, `${level.id} does not fuzz 256 rounds`).toBe(256);
    }
    // Distinct seeds, so one level's vector sequence is never another's.
    expect(new Set(FUZZ_LEVELS.map((l) => fuzzOf(l).seed)).size).toBe(FUZZ_LEVELS.length);
  });

  it('names every pin of a fuzz level and nothing else in its pin maps', () => {
    // A missing or unknown name is an `invalid` failure at grading time, and
    // `rounds: 0` is `missing-vectors` -- these are the two authoring mistakes
    // the pin maps can carry, so they are asserted directly as well as through
    // the kernel.
    for (const level of FUZZ_LEVELS) {
      const check = fuzzOf(level);
      const inputs = level.io.inputs.map((pin) => pin.id).sort();
      const outputs = level.io.outputs.map((pin) => pin.id).sort();
      expect(Object.keys(check.inputs).sort(), `${level.id} input map`).toEqual(inputs);
      expect(Object.keys(check.outputs).sort(), `${level.id} output map`).toEqual(outputs);
    }
  });

  it('draws 256 varying, reproducible vectors on every fuzz level', () => {
    // The round count and the seed are the whole of a fuzz level's coverage, so
    // both are measured rather than restated: a correct circuit fills the record
    // with every vector the level will ever drive, and a sequence that did not
    // vary would make "the first disagreeing round" a statement about one
    // repeated vector.
    for (const level of FUZZ_LEVELS) {
      const check = fuzzOf(level);
      const first = level.io.outputs[0]!;

      const capture = (sink: FuzzVector[]): LevelSpec => ({
        ...level,
        checks: [
          {
            ...check,
            outputs: {
              ...check.outputs,
              [first.id]: (v: FuzzVector) => {
                sink.push(v);
                return expectation(level, first.id)(v);
              },
            },
          },
        ],
      });

      const once: FuzzVector[] = [];
      const twice: FuzzVector[] = [];
      const make = solutions[level.id]!;
      expect(grade(make(), registry, capture(once)).passed, `${level.id} reference`).toBe(true);
      expect(grade(make(), registry, capture(twice)).passed, `${level.id} reference`).toBe(true);

      expect(once).toHaveLength(256);
      expect(twice).toEqual(once);
      // 256 draws from an 8-bit space repeat a little (about 160 distinct), from
      // a 16-bit space hardly at all: 100 is a floor that only a degenerate
      // sequence -- the xorshift fixed point, or a constant -- can miss.
      expect(new Set(once.map((v) => JSON.stringify(v))).size).toBeGreaterThan(100);
    }
  });

  it('expects the byte operators the brief names', () => {
    // The expectation functions are the level's specification: a pure function
    // that computes something else is a level that grades the wrong thing, and
    // it would still be "not vacuous". These are the operators' defining values.
    const or = expectation(L18, 'out');
    expect(or(vector({ a: 0x0f, b: 0x30 }))).toBe(0x3f);
    expect(or(vector({ a: 0xaa, b: 0x55 }))).toBe(0xff);
    expect(or(vector({ a: 0xff, b: 0x00 }))).toBe(0xff);
    expect(or(vector({ a: 0x00, b: 0x00 }))).toBe(0x00);

    const not = expectation(L19, 'out');
    expect(not(vector({ a: 0x00 }))).toBe(0xff);
    expect(not(vector({ a: 0xff }))).toBe(0x00);
    expect(not(vector({ a: 0x0f }))).toBe(0xf0);
    expect(not(vector({ a: 0xa5 }))).toBe(0x5a);

    const sum = expectation(L22, 'out');
    const carry = expectation(L22, 'cout');
    /** Both of level 22's pins for one addend triple: they are one addition. */
    const added = (a: number, b: number, cin: number): [number, number] => [
      sum(vector({ a, b, cin })),
      carry(vector({ a, b, cin })),
    ];
    expect(added(1, 1, 0)).toEqual([2, 0]);
    expect(added(0xff, 0x01, 0)).toEqual([0, 1]);
    expect(added(0x80, 0x80, 0)).toEqual([0, 1]);
    // The carry-in is part of the sum on both pins, not decoration.
    expect(added(0x7f, 0x7f, 1)).toEqual([0xff, 0]);
    expect(added(0xff, 0xff, 1)).toEqual([0xff, 1]);
  });

  it('hands out the parts the brief assigns to each level', () => {
    expect(L18.rewards?.components).toEqual(['and8', 'or8', 'nand8', 'nor8']);
    expect(L19.rewards?.components).toEqual(['xor8', 'xnor8', 'not8']);
    expect(L20.rewards?.components).toEqual(['full_adder']);
    expect(L21.rewards?.components).toEqual(['neg8']);
    expect(L22.rewards?.components).toEqual(['switch', 'switch8']);
  });

  it('offers each level the parts its own lesson needs', () => {
    // Not a restatement of the palettes but of the claims their comments make:
    // levels 18/19/22 are wired from the splitter and the maker level 13
    // unlocked; levels 20 and 21 have no pin wider than one bit, so an eight-bit
    // part has nothing to attach to (batch 1's level-14 call); level 22 does not
    // offer the one part that would answer it in one row (`add8`), and does offer
    // `full_adder` -- whose eight-instance cascade is the level's own subject --
    // plus the seven byte operators levels 18 and 19 unlocked.
    for (const level of [L18, L19, L22]) {
      expect(level.allowedComponents, `${level.id} cannot split a byte`).toContain('splitter');
      expect(level.allowedComponents, `${level.id} cannot pack a byte`).toContain('maker');
    }
    const wide = new Set([
      'splitter',
      'maker',
      'const8',
      'and8',
      'or8',
      'nand8',
      'nor8',
      'xor8',
      'xnor8',
      'not8',
      'add8',
      'mul8',
      'neg8',
      'less_u',
      'equal8',
      'switch',
      'switch8',
    ]);
    for (const level of [L20, L21]) {
      expect(
        level.allowedComponents.filter((def) => wide.has(def)),
        `${level.id} offers a wide part on a level whose pins are one bit wide`,
      ).toEqual([]);
    }
    expect(L22.allowedComponents).not.toContain('add8');
    expect(L21.allowedComponents).not.toContain('full_adder');
    // The other side of the same decision: level 22 offers the part, so the
    // cascade can be built from level 20's reward, and the seven byte operators
    // the earlier levels unlocked are not quietly dropped from its shelf.
    expect(L22.allowedComponents).toContain('full_adder');
    for (const def of ['and8', 'or8', 'nand8', 'nor8', 'xor8', 'xnor8', 'not8']) {
      expect(L22.allowedComponents, `level 22 drops ${def}`).toContain(def);
    }
  });

  it('rewards an id the registry actually implements', () => {
    // What the module note used to get wrong at level 20: the reward was an id
    // with no def behind it, which no palette could ever show. The def landed in
    // `523a7b9`, and this holds the note to it -- a reward that stops resolving
    // is invisible content, and the level comments now describe it as live.
    expect(L20.rewards?.components).toEqual(['full_adder']);
    expect(registry.has('full_adder'), 'full_adder is not registered').toBe(true);
  });
});

describe('every level carries its sourced-vs-authored data comment', () => {
  /**
   * The compendium fixes a name, an order, a one-line concept and -- for two
   * levels in this batch -- an achievement note, and nothing else. So every
   * port, width, check, target and reward in this file is this replica's design.
   * The data comment on each level has to say which is which, and a reviewer
   * checks the wording by reading; this checks that the marker block exists at
   * all, so a later batch cannot quietly drop it.
   */
  const source = readFileSync(
    new URL('../../src/levels/content/ch2/batch2.ts', import.meta.url),
    'utf8',
  );

  /** Data comment -> level id, for every doc comment followed by a level literal. */
  const comments = new Map<string, string>();
  for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\/\s*\{\s*id: '([^']+)'/g)) {
    const [, body, id] = match;
    if (body !== undefined && id !== undefined) comments.set(id, body);
  }

  for (const level of CH2_BATCH2) {
    it(level.id, () => {
      const comment = comments.get(level.id) ?? '';
      expect(comment.length, `${level.id} has no data comment`).toBeGreaterThan(0);
      expect(comment, `${level.id} does not record what is sourced`).toContain('SOURCED');
      expect(comment, `${level.id} does not record what is authored`).toContain('AUTHORED');
    });
  }

  it('records the two source achievements the batch has to honour', () => {
    // Level 21's note is "仅用 5 个蓝色元件" and level 22's is "延迟 ≤ 35". Both are
    // achievement notes, not pass conditions, and both are mapped deliberately:
    // 21 to a measured gate threshold, 22 to nothing at all beyond a recorded
    // reference value. The comments have to say so, and they have to quote the
    // source's own numbers so a reader can see what was and was not adopted.
    const l21 = comments.get('ch2-21-full-adder') ?? '';
    expect(l21).toContain('5 个蓝色元件');
    const l22 = comments.get('ch2-22-adding-bytes') ?? '';
    expect(l22).toContain('延迟 ≤ 35');
  });
});

/**
 * This batch's reference circuits, from the shared fixture.
 *
 * They were defined here until chapter 2 was assembled and the whole-set walk
 * (`test/levels/level-buildability.test.ts`) needed all 26 chapter-2 circuits at
 * once: the definitions moved to `test/fixtures/ch2-references.ts` and each batch
 * test imports its own slice back. Nothing this file asserts changed -- the three
 * blocks below still grade every circuit against the level it is filed under, so
 * a circuit that stops passing its own level still fails here, loudly.
 */
const solutions: Record<string, () => Graph> = CH2_BATCH2_REFERENCES;

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

// ---------------------------------------------------------------------------
// Counterexamples
// ---------------------------------------------------------------------------

/** `a & b` on the OR level: the byte operator next door. */
function byteAndInsteadOfOr(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'part', def: 'and8', id: 'and', from: ['a', 'b'] },
    { kind: 'output', from: 'and', width: 8 },
  ]);
}

/** The byte passed straight through: the NOT that was never applied. */
function bytePassThrough(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'output', from: 'a', width: 8 },
  ]);
}

/**
 * Eight half adders in a row -- `sum_i = a_i XOR b_i`, with no carry chain.
 *
 * The plausible mistake this level's fuzz exists to catch: it is right whenever
 * no carry propagates and wrong as soon as one does, which on random bytes is
 * most of the time (and on a hand-written table it would be invisible: the
 * level's input space is 2^17 rows).
 */
function halfAdderRow(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'input', name: 'cin' },
    { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
    { kind: 'part', def: 'splitter', id: 'sb', from: ['b'] },
  ];
  for (let bit = 0; bit < 8; bit += 1) {
    nodes.push({
      kind: 'part',
      def: 'xor',
      id: `s${bit}`,
      from: [`sa.b${bit}`, `sb.b${bit}`],
    });
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('s') });
  nodes.push({ kind: 'part', def: 'and', id: 'top', from: ['sa.b7', 'sb.b7'] });
  nodes.push({ kind: 'output', name: 'OUT_out', from: 'mk', width: 8 });
  nodes.push({ kind: 'output', name: 'OUT_cout', from: 'top', width: 1 });
  return build(nodes);
}

/** Circuits a player would plausibly build and that must be rejected. */
const wrong: Record<string, () => Graph> = {
  'ch2-18-byte-or': byteAndInsteadOfOr,
  'ch2-19-byte-not': bytePassThrough,
  // The sum taken from an OR instead of an XOR: the classic half-adder mistake,
  // and the one the (1, 1) row exists to catch.
  'ch2-20-half-adder': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'or', id: 'sum', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'carry', from: ['a', 'b'] },
      { kind: 'output', name: 'OUT_sum', from: 'sum' },
      { kind: 'output', name: 'OUT_carry', from: 'carry' },
    ]),
  // The half adder again, on the level that has a carry in: the pin exists in
  // the circuit and nothing reads it.
  'ch2-21-full-adder': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'cin' },
      { kind: 'part', def: 'xor', id: 'sum', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'cout', from: ['a', 'b'] },
      { kind: 'output', name: 'OUT_sum', from: 'sum' },
      { kind: 'output', name: 'OUT_cout', from: 'cout' },
    ]),
  'ch2-22-adding-bytes': halfAdderRow,
};

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

  it('fails the half adder on the row that distinguishes it from an OR', () => {
    const result = grade(wrong['ch2-20-half-adder']!(), registry, specOf('ch2-20-half-adder'));
    expect(result.failures[0]?.inputs).toEqual({ a: 1, b: 1 });
    expect(result.failures[0]?.expected).toEqual({ sum: 0, carry: 1 });
    expect(result.failures[0]?.actual).toEqual({ sum: 1, carry: 1 });
  });

  it('fails the full adder on the first row that needs the carry in', () => {
    // The rows are enumerated with `a` as bit 0, so the first combination this
    // circuit gets wrong is (a=0, b=0, cin=1): the sum should be 1 and it drives
    // 0, while the carry it does drive happens to be right.
    const result = grade(wrong['ch2-21-full-adder']!(), registry, specOf('ch2-21-full-adder'));
    expect(result.failures[0]?.inputs).toEqual({ a: 0, b: 0, cin: 1 });
    expect(result.failures[0]?.expected).toEqual({ sum: 1, cout: 0 });
    expect(result.failures[0]?.actual).toEqual({ sum: 0, cout: 0 });
  });
});

describe('the fuzz levels name the round and the vector that failed', () => {
  /**
   * What the wrong circuit actually drives, as a pure function of the vector.
   *
   * A fuzz check that reported "failed" without the round and the vector would
   * be indistinguishable from one that compares nothing -- on an 8-bit level
   * there is no readable table to point at instead. So each counterexample is
   * replayed here against the level's OWN expectation functions, and the first
   * round that disagrees is what the failure record has to name.
   */
  const behaviour: Record<string, (v: FuzzVector) => Record<string, number>> = {
    'ch2-18-byte-or': (v) => ({ out: (v.a ?? 0) & (v.b ?? 0) }),
    'ch2-19-byte-not': (v) => ({ out: v.a ?? 0 }),
    'ch2-22-adding-bytes': (v) => ({
      out: (v.a ?? 0) ^ (v.b ?? 0),
      cout: ((v.a ?? 0) & (v.b ?? 0)) >> 7,
    }),
  };

  for (const [id, actual] of Object.entries(behaviour)) {
    it(`${id}: the first disagreeing round, with its vector`, () => {
      const level = specOf(id);
      const check = fuzzOf(level);
      // The kernel calls one function per output pin per round and reports the
      // round it stopped in, so wrapping the FIRST pin records exactly one
      // vector per round and the last one recorded is the failing one's.
      const first = level.io.outputs[0]!;
      const seen: FuzzVector[] = [];
      const capture: LevelSpec = {
        ...level,
        checks: [
          {
            ...check,
            outputs: {
              ...check.outputs,
              [first.id]: (v: FuzzVector) => {
                seen.push(v);
                return expectation(level, first.id)(v);
              },
            },
          },
        ],
      };

      const result = grade(wrong[id]!(), registry, capture);
      expect(result.passed).toBe(false);
      // One record: the kernel stops at the first failing round rather than
      // reporting 256 of them.
      expect(result.failures).toHaveLength(1);
      const failure: CheckFailure = result.failures[0]!;

      const firstBad = seen.findIndex((v) => {
        const want = expectedFor(level, v);
        const got = actual(v);
        return level.io.outputs.some((pin) => want[pin.id] !== got[pin.id]);
      });
      expect(firstBad, `${id}: the wrong circuit never disagreed`).toBeGreaterThanOrEqual(0);

      expect(failure.reason).toBe('mismatch');
      expect(failure.round).toBe(firstBad);
      expect(failure.inputs).toEqual(seen[firstBad]);
      expect(failure.expected).toEqual(expectedFor(level, seen[firstBad]!));
      expect(failure.actual).toEqual(actual(seen[firstBad]!));
      expect(failure.detail).toContain(`round ${firstBad}`);
      // The wrapper recorded one vector per round the kernel ran, so the record
      // is the last one it saw: the round in the failure is where the kernel
      // stopped, not a number it worked out afterwards.
      expect(seen).toHaveLength(firstBad + 1);
    });
  }
});

describe('an empty circuit fails every level instead of throwing', () => {
  for (const level of CH2_BATCH2) {
    it(level.id, () => {
      const result = grade(build([]), registry, level);
      expect(result.passed).toBe(false);
      expect(result.stars).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// The two source achievements, measured
// ---------------------------------------------------------------------------

describe("level 21's five-component construction is the reference it names", () => {
  it('is five components and measures the gate target the achievement maps to', () => {
    // The source's note for this level is the achievement "仅用 5 个蓝色元件" --
    // five blue components. This replica has no blue-component system (those are
    // custom/blueprint parts, a later phase), so the achievement is mapped to
    // the measured gate target of the circuit it describes. Measured here rather
    // than asserted in prose: five components, 15 NAND equivalents, depth 3.
    const graph = fullAdderReference();
    const parts = graph.instances.filter((inst) => !inst.def.startsWith('level_'));
    expect(parts.map((inst) => inst.def)).toEqual(['xor', 'and', 'xor', 'and', 'or']);
    const result = grade(graph, registry, specOf('ch2-21-full-adder'));
    expect(result.passed).toBe(true);
    expect(result.metrics).toEqual({ gate: 15, delay: 3, tick: 0 });
    expect(result.stars).toBe(3);
  });

  it('records why the registered drop-in is withheld: it scores the target in one drop', () => {
    // The amended ruling's reason, measured instead of argued. `full_adder` is
    // level 20's reward and this level's exact I/O, so one instance answers the
    // whole eight-row table; at the registered 9-NAND cell it measures 9 gates
    // and 1 delay, which is inside the 15-and-3 target -- three stars for a part
    // the player never builds. That is why the palette withholds it here and
    // offers it at 20 and 22, and the level's comment says so.
    const level = specOf('ch2-21-full-adder');
    expect(level.allowedComponents).not.toContain('full_adder');
    const dropped = grade(
      build([
        { kind: 'input', name: 'a' },
        { kind: 'input', name: 'b' },
        { kind: 'input', name: 'cin' },
        { kind: 'part', def: 'full_adder', id: 'fa', from: ['a', 'b', 'cin'] },
        { kind: 'output', name: 'OUT_sum', from: 'fa.sum' },
        { kind: 'output', name: 'OUT_cout', from: 'fa.cout' },
      ]),
      registry,
      level,
    );
    expect(dropped.failures, JSON.stringify(dropped.failures)).toEqual([]);
    expect(dropped.metrics).toEqual({ gate: 9, delay: 1, tick: 0 });
    expect(dropped.stars).toBe(3);
  });
});

describe("level 22's target is the cascade's own measurement, and the source's 35 is not it", () => {
  it("measures the shipped reference well inside the source's reference value", () => {
    // The source's note is the achievement "延迟 ≤ 35", which the level's data
    // comment records as a reference value and which nothing here treats as a
    // pass condition: `threeStar` is the reference solution's measured metrics.
    // The measurement has to be taken, not chosen -- so this test states the
    // relation (the measured delay is inside the source's number) separately
    // from the equality `threeStar === metrics` the block above asserts.
    const result = grade(rippleAdderReference(), registry, specOf('ch2-22-adding-bytes'));
    expect(result.metrics.delay).toBeLessThanOrEqual(35);
    expect(result.metrics).toEqual({ gate: 72, delay: 8, tick: 0 });
  });
});

describe("level 22's reference is the `full_adder` cascade, and the hand-wired chain is the alternative", () => {
  it('files eight instances of the part as the reference, measured at 72 and 8', () => {
    // The reference IS the cascade level 20's reward makes possible: eight
    // instances of the registered 9-NAND part, one per bit, with the carry chain
    // between them. Counted here rather than described, because the whole point
    // of the re-measurement is that this circuit is what `threeStar` came from,
    // and the target is its own measurement rather than a number chosen for it.
    const level = specOf('ch2-22-adding-bytes');
    expect(level.allowedComponents).toContain('full_adder');
    const reference = rippleAdderReference();
    expect(reference.instances.filter((inst) => inst.def === 'full_adder')).toHaveLength(8);
    const built = grade(reference, registry, level);
    expect(built.failures, JSON.stringify(built.failures)).toEqual([]);
    expect(built.metrics).toEqual({ gate: 72, delay: 8, tick: 0 });
    expect(built.stars).toBe(3);
    expect(level.threeStar).toEqual(built.metrics);
  });

  it('grades the hand-wired chain it replaced at 120 and 17 -- correct, and one star', () => {
    // The alternative the level used to file as its reference is still a correct
    // eight-bit adder, so it still passes. It is no longer the reference and no
    // longer three stars, which is the measurement behind the level comment's
    // "documented alternative" paragraph: the target now separates the two
    // constructions -- 120 > 72 and 17 > 8 -- instead of being a number the
    // cheaper cascade already satisfied.
    const level = specOf('ch2-22-adding-bytes');
    const reference = grade(rippleAdderReference(), registry, level);
    const alternative = grade(handWiredAdderReference(), registry, level);
    expect(alternative.failures, JSON.stringify(alternative.failures)).toEqual([]);
    expect(alternative.passed).toBe(true);
    expect(alternative.metrics).toEqual({ gate: 120, delay: 17, tick: 0 });
    expect(alternative.stars).toBe(1);
    // The separation stated as stars and as both measured metrics, so it does not
    // rest on the optional target's fields being readable: the reference is three
    // stars, the chain it replaced is one, and the chain is bigger on both.
    expect(reference.stars).toBe(3);
    expect(alternative.metrics.gate).toBeGreaterThan(reference.metrics.gate);
    expect(alternative.metrics.delay).toBeGreaterThan(reference.metrics.delay);
  });

  it('measures the one drop-in that would beat the reference, and shows the palette withholds it', () => {
    // The level comment's claim about what makes the shipped reference the best
    // circuit the level can actually build: `add8` (level 17's reward) has exactly
    // this level's I/O -- `a:8 b:8 cin:1 -> out:8 cout:1` -- and one instance
    // measures 72 gates and 1 delay, tying the target's gates and beating its
    // delay. So it is not "worse": it is WITHHELD, and both halves are measured
    // here rather than argued. The star count is the "answers the level in a
    // single drop" half; the palette check is the "and is therefore not legal on
    // this level" half.
    const level = specOf('ch2-22-adding-bytes');
    expect(level.allowedComponents).not.toContain('add8');
    const dropped = grade(
      build([
        { kind: 'input', name: 'a', width: 8 },
        { kind: 'input', name: 'b', width: 8 },
        { kind: 'input', name: 'cin' },
        { kind: 'part', def: 'add8', id: 'add', from: ['a', 'b', 'cin'] },
        { kind: 'output', name: 'OUT_out', from: 'add', width: 8 },
        { kind: 'output', name: 'OUT_cout', from: 'add.cout', width: 1 },
      ]),
      registry,
      level,
    );
    expect(dropped.failures, JSON.stringify(dropped.failures)).toEqual([]);
    expect(dropped.metrics).toEqual({ gate: 72, delay: 1, tick: 0 });
    expect(dropped.stars).toBe(3);
  });
});

describe('the byte operators tie the circuits the levels ask for', () => {
  it('level 18: the or8 the level hands out scores exactly what eight ORs do', () => {
    // The level's own reward is offered in its own palette, so this is the
    // alternative the target must not privilege: if the two ever stop tying, the
    // data comment's claim about which construction justifies the target is
    // wrong.
    const packaged = build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'input', name: 'b', width: 8 },
      { kind: 'part', def: 'or8', id: 'or', from: ['a', 'b'] },
      { kind: 'output', from: 'or', width: 8 },
    ]);
    const level = specOf('ch2-18-byte-or');
    const built = grade(byteOrReference(), registry, level);
    const dropped = grade(packaged, registry, level);
    expect(dropped.failures, JSON.stringify(dropped.failures)).toEqual([]);
    expect(dropped.metrics).toEqual(built.metrics);
    expect(dropped.stars).toBe(3);
  });

  it('level 19: not8 and nand8(a, a) tie the eight NOTs, nor8(a, a) does not', () => {
    const level = specOf('ch2-19-byte-not');
    const built = grade(byteNotReference(), registry, level);
    const dropped = grade(
      build([
        { kind: 'input', name: 'a', width: 8 },
        { kind: 'part', def: 'not8', id: 'not', from: ['a'] },
        { kind: 'output', from: 'not', width: 8 },
      ]),
      registry,
      level,
    );
    expect(dropped.failures, JSON.stringify(dropped.failures)).toEqual([]);
    expect(dropped.metrics).toEqual(built.metrics);
    expect(dropped.stars).toBe(3);

    // The byte NOT is also `nand8(a, a)`, which level 18's reward makes
    // available -- and on the documented all-NAND basis one NAND per bit is the
    // SAME 8 gates as one NOT per bit, so it ties the reference rather than
    // trailing it. That is worth stating where a reader would expect a
    // difference: the three spellings are the same circuit on this metric.
    const nanded = grade(
      build([
        { kind: 'input', name: 'a', width: 8 },
        { kind: 'part', def: 'nand8', id: 'nand', from: ['a', 'a'] },
        { kind: 'output', from: 'nand', width: 8 },
      ]),
      registry,
      level,
    );
    expect(nanded.failures, JSON.stringify(nanded.failures)).toEqual([]);
    expect(nanded.metrics).toEqual({ gate: 8, delay: 1, tick: 0 });
    expect(nanded.stars).toBe(3);

    // What the target DOES separate: the same function built from a four-NAND
    // per bit cell -- `nor8(a, a)` is `~(a | a)`, a byte NOT for 32 gates. Still
    // correct, still one delay, and one star, so the target is a target.
    const norred = grade(
      build([
        { kind: 'input', name: 'a', width: 8 },
        { kind: 'part', def: 'nor8', id: 'nor', from: ['a', 'a'] },
        { kind: 'output', from: 'nor', width: 8 },
      ]),
      registry,
      level,
    );
    expect(norred.failures, JSON.stringify(norred.failures)).toEqual([]);
    expect(norred.metrics).toEqual({ gate: 32, delay: 1, tick: 0 });
    expect(norred.stars).toBe(1);
  });
});
