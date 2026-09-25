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
import { CH2_BATCH3 } from '../../src/levels/content/ch2/batch3';
import { grade } from '../../src/levels/grader';
import type {
  CheckFailure,
  FuzzCheck,
  FuzzVector,
  LevelSpec,
  TruthRow,
} from '../../src/levels/spec';
import { build, registry, type Node } from '../fixtures/build';
import { CH2_BATCH3_REFERENCES, bits, logicEngine } from '../fixtures/ch2-references';

/**
 * Chapter 2's third batch: levels 23-27 -- two's complement, the decoders and
 * the eight-bit logic engine.
 *
 * The source compendium fixes these levels' names, their order and a one-line
 * concept each, and nothing else -- no ports, no widths, no pass conditions, no
 * targets and no rewards. Every other number in the level data is this replica's
 * design, which is why each level carries a data comment saying which is which;
 * the marker block below checks that the comments exist and that the three
 * notes this batch owes a reader are in them (level 23's change of KIND, level
 * 25's per-width decoder family, and level 27's authored opcode table).
 *
 * TWO THINGS THIS FILE CARRIES THAT THE EARLIER BATCHES' DO NOT:
 *
 *  * a level whose SOURCE FORM IS NOT A CIRCUIT AT ALL -- level 23 is a timed
 *    mini-game in the compendium, so the level data and its comment record the
 *    conversion rather than pretending the source specified a puzzle;
 *  * a level with an AUTHORED INSTRUCTION SET -- level 27's eight opcodes are
 *    not enumerated anywhere in the source, so `the eight opcodes are all
 *    exercised` below is not decoration: it measures which opcodes the level's
 *    own fixed-seed sequence actually drives, proves the expectation function
 *    defines all eight, and breaks the reference one opcode at a time to show
 *    that a circuit wrong on opcode k fails on a round of opcode k.
 *
 * The `fuzz` levels (23, 24 and 27) follow batch 2's pattern for a wrong
 * circuit: the failure record is checked against the level's own expectation
 * functions and the round and vector in it are asserted to be the FIRST ones
 * that actually disagree, so a check that failed "somewhere" could not pass for
 * a check that compares something.
 *
 * The starter set is imported rather than restated (`STARTER_COMPONENTS` is the
 * same constant `paletteDefsFor` filters with), exactly as the chapter-1 and
 * batch-1/2 tests do it.
 */

/** The level with this index, or a loud failure -- indexing returns `undefined`. */
function levelAt(index: number): LevelSpec {
  const level = CH2_BATCH3.find((l) => l.index === index);
  if (!level) throw new Error(`chapter 2 batch 3 has no level with index ${index}`);
  return level;
}

function specOf(id: string): LevelSpec {
  const level = CH2_BATCH3.find((l) => l.id === id);
  if (!level) throw new Error(`chapter 2 batch 3 has no level ${id}`);
  return level;
}

const L23 = levelAt(23);
const L24 = levelAt(24);
const L25 = levelAt(25);
const L26 = levelAt(26);
const L27 = levelAt(27);

/** The batch's three fuzz levels, in order. */
const FUZZ_LEVELS: readonly LevelSpec[] = [L23, L24, L27];

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
 * The same five-branch invariant `ch1-part1.test.ts`, `ch1-part2.test.ts`,
 * `ch2-batch1.test.ts` and `ch2-batch2.test.ts` carry -- batch 1's copy is
 * itself tested against synthetic vacuous checks of every kind, and a fifth
 * copy of that proof would be a fifth thing to keep in step. This copy keeps
 * the part that matters here: `fuzz` reads `check.inputs` / `check.outputs` pin
 * by pin, so a level that renamed a pin and left its expectation behind is
 * reported instead of comparing nothing, and `truth-table` refuses a table with
 * no rows or a row with no expected output.
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

describe('chapter 2, levels 23-27', () => {
  it('exposes five chapter-2 levels with the briefed indices', () => {
    expect(CH2_BATCH3.map((level) => level.index)).toEqual([23, 24, 25, 26, 27]);
    expect(CH2_BATCH3.map((level) => level.chapter)).toEqual([2, 2, 2, 2, 2]);
  });

  it('uses the ch2-<index>-<slug> id convention', () => {
    expect(CH2_BATCH3.map((level) => level.id)).toEqual([
      'ch2-23-negative-numbers',
      'ch2-24-signed-negator',
      'ch2-25-1-bit-decoder',
      'ch2-26-3-bit-decoder',
      'ch2-27-logic-engine',
    ]);
  });

  it('shapes every level exactly as the brief fixes it', () => {
    expect(pinsOf(L23)).toEqual({ inputs: ['a:8'], outputs: ['out:8'] });
    expect(pinsOf(L24)).toEqual({ inputs: ['a:8'], outputs: ['out:8'] });
    expect(pinsOf(L25)).toEqual({ inputs: ['sel:1'], outputs: ['out:2'] });
    expect(pinsOf(L26)).toEqual({ inputs: ['sel:3'], outputs: ['out:8'] });
    expect(pinsOf(L27)).toEqual({ inputs: ['a:8', 'b:8', 'op:8'], outputs: ['out:8'] });
  });

  it('names each level in both languages', () => {
    expect(CH2_BATCH3.map((level) => level.name.en)).toEqual([
      'Negative Numbers',
      'Signed Negator',
      '1 Bit Decoder',
      '3 Bit Decoder',
      'Logic Engine',
    ]);
    expect(CH2_BATCH3.map((level) => level.name.zh)).toEqual([
      '负数',
      '相反数',
      '1 位解码器',
      '3 位解码器',
      '逻辑引擎',
    ]);
    for (const level of CH2_BATCH3) {
      expect(level.brief.zh.length, `${level.id} has an empty zh brief`).toBeGreaterThan(0);
      expect(level.brief.en.length, `${level.id} has an empty en brief`).toBeGreaterThan(0);
      expect(level.hint.zh.length, `${level.id} has an empty zh hint`).toBeGreaterThan(0);
      expect(level.hint.en.length, `${level.id} has an empty en hint`).toBeGreaterThan(0);
    }
  });

  it('gates every part behind a component unlocked at or before it', () => {
    // "At or before": a level may offer the parts its own rewards hand out (level
    // 25 offers the `decoder1` it teaches), so the walk adds a level's rewards
    // before testing its own palette. Everything before this batch is walked
    // first, because these palettes are built on it -- `neg8` arrives at level
    // 21, `switch8` at 22, and the splitter and maker this batch wires bytes
    // with arrive at 13.
    const unlocked = new Set<string>(STARTER_COMPONENTS);
    for (const level of [...CH1_PART1, ...CH1_PART2, ...CH2_BATCH1, ...CH2_BATCH2, ...CH2_BATCH3]) {
      for (const def of level.rewards?.components ?? []) unlocked.add(def);
      for (const def of level.allowedComponents) {
        expect(unlocked.has(def), `${level.id} offers locked component ${def}`).toBe(true);
      }
    }
  });

  it('offers nothing from a later level', () => {
    // The same rule from the other side: what this batch offers is chapter 1's
    // rewards, batches 1-2's, its own, and the starter set -- never the parts
    // the batches after it hand out (the storage family: the byte mux, delay,
    // register, counter and RAM).
    const owned = new Set<string>(STARTER_COMPONENTS);
    for (const level of [...CH1_PART1, ...CH1_PART2, ...CH2_BATCH1, ...CH2_BATCH2, ...CH2_BATCH3]) {
      for (const def of level.rewards?.components ?? []) owned.add(def);
      for (const def of level.allowedComponents) {
        expect(owned.has(def), `${level.id} offers ${def}, which no level unlocks by then`).toBe(
          true,
        );
      }
    }
    for (const later of ['mux8', 'delay8', 'reg8', 'counter8', 'ram8']) {
      expect(owned.has(later), `${later} is unlocked inside this batch`).toBe(false);
    }
  });

  it('gives every level a check with something to compare', () => {
    for (const level of CH2_BATCH3) {
      expect(level.checks.length, `${level.id} has no checks`).toBeGreaterThan(0);
      expect(vacuityProblems(level), `${level.id} has a vacuous check`).toEqual([]);
    }
  });

  it('builds the decoder tables instead of leaving rows out', () => {
    // An empty `rows` array is a hard `missing-rows` failure, not "enumerate
    // everything" -- so both decoder levels build their rows with the kernel's
    // own `truthTable`, and each table is exhaustive over its select pin: two
    // rows for one select bit, eight for three.
    expect(rowsOf(L25).length).toBe(2);
    expect(rowsOf(L26).length).toBe(8);
    for (const level of [L25, L26]) {
      const rows = rowsOf(level);
      const seen = new Set(rows.map((row) => JSON.stringify(row.inputs)));
      expect(seen.size, `${level.id} repeats or skips input combinations`).toBe(rows.length);
    }
  });

  it('states the one-bit decoder as a two-line one-hot table', () => {
    const rows = rowsOf(L25);
    expect(rowFor(rows, { sel: 0 })?.outputs).toEqual({ out: 1 });
    expect(rowFor(rows, { sel: 1 })?.outputs).toEqual({ out: 2 });
  });

  it('states the three-bit decoder as an eight-line one-hot table', () => {
    const rows = rowsOf(L26);
    for (let sel = 0; sel < 8; sel += 1) {
      expect(rowFor(rows, { sel })?.outputs, `sel=${sel}`).toEqual({ out: 1 << sel });
    }
  });

  it('states the three fuzz levels with a fixed seed and 256 rounds', () => {
    // The brief fixes the checker kind, the seed discipline (a literal, never a
    // drawn one, never 0 -- the xorshift fixed point) and the round count; the
    // expectation functions are this batch's.
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

  it('expects the two two\'s-complement levels the brief names', () => {
    // The expectation functions are the level's specification: a pure function
    // that computes something else is a level that grades the wrong thing, and
    // it would still be "not vacuous". These are the defining values, taken from
    // both sides of the sign bit.
    const abs = expectation(L23, 'out');
    expect(abs(vector({ a: 0x00 }))).toBe(0x00);
    expect(abs(vector({ a: 0x01 }))).toBe(0x01);
    expect(abs(vector({ a: 0x7f }))).toBe(0x7f);
    // The sign bit is the reading, not the bit itself: 0x80 is the most negative
    // byte and 0xff is minus one.
    expect(abs(vector({ a: 0x80 }))).toBe(0x80);
    expect(abs(vector({ a: 0xff }))).toBe(0x01);
    expect(abs(vector({ a: 0xfe }))).toBe(0x02);

    const negate = expectation(L24, 'out');
    expect(negate(vector({ a: 0x00 }))).toBe(0x00);
    expect(negate(vector({ a: 0x01 }))).toBe(0xff);
    expect(negate(vector({ a: 0x02 }))).toBe(0xfe);
    expect(negate(vector({ a: 0x7f }))).toBe(0x81);
    // The one pattern that is its own negation: 0x80 is -128, and -(-128) does
    // not fit a signed byte -- the low eight bits are 0x80.
    expect(negate(vector({ a: 0x80 }))).toBe(0x80);
    expect(negate(vector({ a: 0xff }))).toBe(0x01);
  });

  it('expects the eight opcodes the logic engine states, in the brief', () => {
    // The opcode table is this replica's design (the source says only "build the
    // complete set of logical operations"), so the level's own expectation
    // function IS the specification of what each opcode computes -- and the
    // BRIEF has to state all eight to the player. One hand-picked vector per
    // opcode, plus the three ways an eight-bit op can surprise a reader: the
    // discarded carry, the shift amount read from b's LOW THREE BITS, and the
    // arithmetic shift's sign fill.
    const out = expectation(L27, 'out');
    expect(out(vector({ a: 0xf0, b: 0x3c, op: 0 }))).toBe(0x30); // and
    expect(out(vector({ a: 0xf0, b: 0x3c, op: 1 }))).toBe(0xfc); // or
    expect(out(vector({ a: 0xf0, b: 0x3c, op: 2 }))).toBe(0xcc); // xor
    expect(out(vector({ a: 0xf0, b: 0x3c, op: 3 }))).toBe(0x0f); // not a
    expect(out(vector({ a: 0xf0, b: 0x3c, op: 4 }))).toBe(0x2c); // add: 0x12c -> 0x2c
    expect(out(vector({ a: 0x3c, b: 0xf0, op: 5 }))).toBe(0x4c); // sub: -0xb4 -> 0x4c
    expect(out(vector({ a: 0x81, b: 0x03, op: 6 }))).toBe(0x08); // shift_l by 3
    expect(out(vector({ a: 0x81, b: 0x03, op: 7 }))).toBe(0xf0); // ashr by 3: sign fills
    // b's low three bits are the amount, so 0x0b is a shift by 3 and not by 11.
    expect(out(vector({ a: 0x81, b: 0x0b, op: 6 }))).toBe(0x08);
    expect(out(vector({ a: 0x81, b: 0x0b, op: 7 }))).toBe(0xf0);
    // 0xff shifted arithmetically right by 7 is -1, not 1.
    expect(out(vector({ a: 0xff, b: 0x07, op: 7 }))).toBe(0xff);
    expect(out(vector({ a: 0xff, b: 0x07, op: 6 }))).toBe(0x80);
    // The top five bits of op change nothing: op is masked to its low three.
    for (let high = 0; high < 32; high += 1) {
      expect(out(vector({ a: 0x81, b: 0x03, op: (high << 3) | 7 }))).toBe(0xf0);
      expect(out(vector({ a: 0x81, b: 0x03, op: (high << 3) | 6 }))).toBe(0x08);
    }
  });

  it('lists every opcode in the brief, in both languages', () => {
    // The brief is the only place a player learns the instruction set, so all
    // eight numbered mnemonics have to be in it -- in both languages, as
    // identifiers with localized prose around them. The paired form (`0=and`)
    // rather than the bare mnemonic, because `or` alone is a substring of half
    // the English language and would prove nothing.
    const opcodes = ['0=and', '1=or', '2=xor', '3=not a', '4=add', '5=sub', '6=shift_l', '7=ashr'];
    for (const opcode of opcodes) {
      expect(L27.brief.en, `the en brief omits ${opcode}`).toContain(opcode);
      expect(L27.brief.zh, `the zh brief omits ${opcode}`).toContain(opcode);
    }
  });

  it('tells the player the decoder comes in widths, and names the parts', () => {
    // The family is GENERATED PER WIDTH -- `createDecoderDef(w)` in `wide.ts`,
    // registered as `decoder1` / `decoder2` / `decoder3` -- and the instance
    // width knob cannot stand in for that: `params.width` resolves as
    // `inst.params.width ?? pin.width` for EVERY pin of an instance
    // (`net.ts`, `effectiveWidth`), while a decoder's pins must differ (`sel` is
    // `w` bits, `out` is `2 ** w`). So the brief has to do what the engine does:
    // name the parts. `decoder1` is the 1-to-2 form this level asks for, and
    // `decoder2` is the 2-to-4 form a later circuit drops in.
    for (const brief of [L25.brief.en, L25.brief.zh]) {
      expect(brief).toContain('decoder1');
      expect(brief).toContain('decoder2');
    }
    // Each form is stated as the width it decodes, in both languages, and the
    // catalog's own name for the wider one is kept -- it is the name the source
    // gives the part no level introduces.
    expect(L25.brief.en).toContain('1-to-2');
    expect(L25.brief.en).toContain('2-to-4');
    expect(L25.brief.en).toContain('2-bit decoder');
    expect(L25.brief.zh).toContain('2 路输出');
    expect(L25.brief.zh).toContain('4 路输出');
    expect(L25.brief.zh).toContain('2 位解码器');
    // And the mechanism the engine cannot honour is GONE from the brief, not
    // merely joined by the right one: a level that offered `params.width = 2` as
    // a way to a 4-output decoder would be teaching a knob this kernel does not
    // have. This is the assertion that fails if the old wording comes back.
    expect(L25.brief.en).not.toContain('params.width');
    expect(L25.brief.zh).not.toContain('params.width');
  });

  it('hands out the parts the brief assigns to each level', () => {
    expect(L23.rewards?.components).toEqual(['div8']);
    expect(L24.rewards?.components).toEqual(['less_s', 'shift_l8', 'shift_r8']);
    expect(L25.rewards?.components).toEqual(['decoder1']);
    expect(L26.rewards?.components).toEqual(['decoder3']);
    expect(L27.rewards?.components).toEqual(['ashr8', 'rot_l8', 'rot_r8']);
  });

  it('offers each level the parts its own lesson needs', () => {
    // Not a restatement of the palettes but of the claims their comments make.
    for (const def of ['splitter', 'maker', 'add8', 'xor8']) {
      expect(L23.allowedComponents, `level 23 cannot use ${def}`).toContain(def);
    }
    for (const def of ['not8', 'add8']) {
      expect(L24.allowedComponents, `level 24 cannot use ${def}`).toContain(def);
    }
    expect(L25.allowedComponents).toContain('maker');
    expect(L26.allowedComponents).toContain('maker');
    for (const def of ['shift_l8', 'ashr8', 'and8', 'or8', 'nand', 'not']) {
      expect(L27.allowedComponents, `level 27 cannot use ${def}`).toContain(def);
    }
    // Level 24 withholds the one drop-in that answers it: `neg8` is not this
    // level's own reward and has exactly this level's I/O shape, so offering it
    // would let one component tie the level's two-component lesson on gates and
    // beat it on delay. Batch 2's level 22 states the rule; this is its second
    // use, and level 23 (where `neg8` does NOT answer the level) offers it.
    expect(L24.allowedComponents).not.toContain('neg8');
    expect(L23.allowedComponents).toContain('neg8');
  });
});

describe('every level carries its sourced-vs-authored data comment', () => {
  /**
   * The compendium fixes a name, an order and a one-line concept per level --
   * and for level 23 it fixes neither a circuit nor a pass condition, because
   * its source form is a timed mini-game. So every port, width, check, target
   * and reward in this file is this replica's design. The data comment on each
   * level has to say which is which, and a reviewer checks the wording by
   * reading; this checks that the marker block exists at all, so a later batch
   * cannot quietly drop it, plus the three specific notes this batch owes.
   */
  const source = readFileSync(
    new URL('../../src/levels/content/ch2/batch3.ts', import.meta.url),
    'utf8',
  );

  /** Data comment -> level id, for every doc comment followed by a level literal. */
  const comments = new Map<string, string>();
  for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\/\s*\{\s*id: '([^']+)'/g)) {
    const [, body, id] = match;
    if (body !== undefined && id !== undefined) comments.set(id, body);
  }

  for (const level of CH2_BATCH3) {
    it(level.id, () => {
      const comment = comments.get(level.id) ?? '';
      expect(comment.length, `${level.id} has no data comment`).toBeGreaterThan(0);
      expect(comment, `${level.id} does not record what is sourced`).toContain('SOURCED');
      expect(comment, `${level.id} does not record what is authored`).toContain('AUTHORED');
    });
  }

  it("records that level 23 changes the source level's kind", () => {
    // The source's level of this name is a timed mini-game with no circuit spec
    // at all, so this level's KIND changes: a mini-game becomes a two's-
    // complement arithmetic circuit. The comment has to say so, quote the
    // source's own label for what it was, and say that it is a conversion rather
    // than the source's puzzle.
    const l23 = comments.get('ch2-23-negative-numbers') ?? '';
    expect(l23).toContain('限时小游戏');
    expect(l23).toContain('补码');
    expect(l23).toContain('kind');
  });

  it('records the per-width decoder family and why a width parameter cannot do it', () => {
    // The family is generated per width, and the kernel's rule for a width
    // override is one line in `net.ts` -- so the comment has to name
    // `params.width` and record that ONE override covers EVERY pin of the
    // instance, which is what makes the rejected mechanism impossible rather
    // than merely unfashionable. It also has to name the resolution: the
    // registered family, and `decoder2` as the catalog's 2-Bit Decoder.
    const l25 = comments.get('ch2-25-1-bit-decoder') ?? '';
    expect(l25).toContain('params.width');
    expect(l25).toContain('decoder2');
    expect(l25).toContain('2-Bit Decoder');
  });

  it("records that level 27's opcode table is this replica's own", () => {
    // The source gives this level one line -- build the complete set of logical
    // operations -- and enumerates no opcodes, so the table is authored. The
    // comment has to say that, and has to list the eight values, because the
    // brief teaches the player from them.
    const l27 = comments.get('ch2-27-logic-engine') ?? '';
    expect(l27).toContain('用或门和非门构建完整逻辑运算集');
    for (const opcode of ['and', 'or', 'xor', 'add', 'sub', 'shift_l', 'ashr']) {
      expect(l27, `the comment omits ${opcode}`).toContain(opcode);
    }
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
const solutions: Record<string, () => Graph> = CH2_BATCH3_REFERENCES;

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

/** Always negate: the sign is read but the magnitude is never recovered. */
function alwaysNegate(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'neg8', id: 'neg', from: ['a'] },
    { kind: 'output', from: 'neg', width: 8 },
  ]);
}

/** Invert without the plus one: every byte is one short of its negation. */
function invertOnly(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'not8', id: 'flip', from: ['a'] },
    { kind: 'output', from: 'flip', width: 8 },
  ]);
}

/** The two decode bits the wrong way round: an anti-decoder. */
function swappedDecoderBits(): Graph {
  return build([
    { kind: 'input', name: 'sel' },
    { kind: 'part', def: 'not', id: 'n', from: ['sel'] },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'maker', id: 'mk', from: ['sel', 'n', 'z'] },
    { kind: 'output', from: 'mk', width: 2 },
  ]);
}

/** The select value passed straight through: a binary value is not one-hot. */
function decoderPassThrough(): Graph {
  return build([
    { kind: 'input', name: 'sel', width: 3 },
    { kind: 'output', from: 'sel', width: 8 },
  ]);
}

/** Circuits a player would plausibly build and that must be rejected. */
const wrong: Record<string, () => Graph> = {
  'ch2-23-negative-numbers': alwaysNegate,
  'ch2-24-signed-negator': invertOnly,
  'ch2-25-1-bit-decoder': swappedDecoderBits,
  'ch2-26-3-bit-decoder': decoderPassThrough,
  // The engine with a logical right shift where the spec asks for an arithmetic
  // one: correct on every opcode but the seventh.
  'ch2-27-logic-engine': () => logicEngine({ op7: 'logical' }),
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

  it('fails the anti-decoder on the row the swap changes', () => {
    const result = grade(wrong['ch2-25-1-bit-decoder']!(), registry, specOf('ch2-25-1-bit-decoder'));
    expect(result.failures[0]?.inputs).toEqual({ sel: 0 });
    expect(result.failures[0]?.expected).toEqual({ out: 1 });
    expect(result.failures[0]?.actual).toEqual({ out: 2 });
  });

  it('fails the pass-through decoder on the first row that is not its own one-hot code', () => {
    // The rows are enumerated with `sel` as the whole input, so the first
    // combination is `sel = 0`: its one-hot form is 1 and the pass-through
    // drives 0. A decoder that published its input as a binary value would be
    // right on no row at all except the trivial one.
    const result = grade(wrong['ch2-26-3-bit-decoder']!(), registry, specOf('ch2-26-3-bit-decoder'));
    expect(result.failures[0]?.inputs).toEqual({ sel: 0 });
    expect(result.failures[0]?.expected).toEqual({ out: 1 });
    expect(result.failures[0]?.actual).toEqual({ out: 0 });
  });
});

describe('an empty circuit fails every level instead of throwing', () => {
  for (const level of CH2_BATCH3) {
    it(level.id, () => {
      const result = grade(build([]), registry, level);
      expect(result.passed).toBe(false);
      expect(result.stars).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// The fuzz levels: the round, the vector, and what the circuit actually drove
// ---------------------------------------------------------------------------

/**
 * Grades `make()` against `level` with its first output function wrapped to
 * record every vector the kernel drives, in round order.
 *
 * `runChecks` stops at the first disagreeing round, so a failing circuit leaves
 * exactly `firstBad + 1` vectors in `seen` -- the last one being the vector the
 * failure record has to name. That is what makes "the check failed" a statement
 * about a specific round rather than about `fuzz` in general.
 */
function captureRound(
  level: LevelSpec,
  make: () => Graph,
): { failures: readonly CheckFailure[]; seen: FuzzVector[] } {
  const check = fuzzOf(level);
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
  const result = grade(make(), registry, capture);
  return { failures: result.failures, seen };
}

describe('the fuzz levels name the round and the vector that failed', () => {
  /**
   * What each wrong circuit actually drives, as a pure function of the vector.
   *
   * A fuzz check that reported "failed" without the round and the vector would
   * be indistinguishable from one that compares nothing -- on an 8-bit level
   * there is no readable table to point at instead. So each counterexample is
   * replayed here against the level's OWN expectation functions, and the first
   * round that disagrees is what the failure record has to name.
   */
  const behaviour: Record<string, (v: FuzzVector) => Record<string, number>> = {
    // Always negate: `-a` for every byte, sign or no sign.
    'ch2-23-negative-numbers': (v) => ({ out: (0x100 - (v.a ?? 0)) & 0xff }),
    // Invert only: `~a`, which is `-a - 1`.
    'ch2-24-signed-negator': (v) => ({ out: ~(v.a ?? 0) & 0xff }),
    // The engine with the logical right shift in opcode 7's slot.
    'ch2-27-logic-engine': (v) => ({ out: engineValue(v, { op7: 'logical' }) }),
  };

  for (const [id, actual] of Object.entries(behaviour)) {
    it(`${id}: the first disagreeing round, with its vector`, () => {
      const level = specOf(id);
      const { failures, seen } = captureRound(level, wrong[id]!);
      expect(failures).toHaveLength(1);
      const failure = failures[0]!;

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

describe('the fuzz levels drive varying, reproducible vectors', () => {
  it('draws 256 different vectors on every run, from the level data alone', () => {
    // The round count and the seed are the whole of a fuzz level's coverage, so
    // both are measured rather than restated: a correct circuit fills the record
    // with every vector the level will ever drive, and a sequence that did not
    // vary would make "the first disagreeing round" a statement about one
    // repeated vector.
    for (const level of FUZZ_LEVELS) {
      const once = captureRound(level, solutions[level.id]!).seen;
      const twice = captureRound(level, solutions[level.id]!).seen;
      expect(once, `${level.id} reference`).toHaveLength(256);
      expect(twice).toEqual(once);
      // 256 draws from an 8-bit space repeat a little; from the 24-bit space
      // level 27 drives they hardly ever do. 100 is a floor only a degenerate
      // sequence -- the xorshift fixed point, or a constant -- can miss.
      expect(new Set(once.map((v) => JSON.stringify(v))).size).toBeGreaterThan(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Level 27's eight opcodes, one at a time
// ---------------------------------------------------------------------------

/**
 * What the engine computes for one vector, as the level's spec states it.
 *
 * The TARGET of this modelling, never its source: the level's own expectation
 * function is what grades, and `expects the eight opcodes...` above compares the
 * two on hand-picked vectors. What this copy is for is predicting what a BROKEN
 * engine drives, which the level data cannot answer.
 */
function engineValue(
  v: FuzzVector,
  options: { readonly amount?: 'low3' | 'byte'; readonly op7?: 'ashr' | 'logical' } = {},
): number {
  const a = (v.a ?? 0) & 0xff;
  const b = (v.b ?? 0) & 0xff;
  const op = (v.op ?? 0) & 7;
  const amount = options.amount === 'byte' ? b : b & 7;
  switch (op) {
    case 0:
      return a & b;
    case 1:
      return a | b;
    case 2:
      return a ^ b;
    case 3:
      return ~a & 0xff;
    case 4:
      return (a + b) & 0xff;
    case 5:
      return (a - b) & 0xff;
    case 6:
      // The logical shifts give 0 for an amount of eight or more.
      return amount >= 8 ? 0 : (a << amount) & 0xff;
    case 7:
      if (options.op7 === 'logical') return amount >= 8 ? 0 : (a >>> amount) & 0xff;
      return arithmeticRight(a, amount);
    default:
      return 0;
  }
}

/** `a` shifted arithmetically right: the sign fills, and an amount of 8+ is all sign. */
function arithmeticRight(a: number, amount: number): number {
  const signed = (a << 24) >> 24;
  if (amount >= 8) return signed < 0 ? 0xff : 0x00;
  return (signed >> amount) & 0xff;
}

describe("level 27's eight opcodes are all exercised", () => {
  it('drives every opcode at least once in the level\'s own 256-round sequence', () => {
    // The proof this block exists for. A fuzz check that happened to draw only
    // opcodes 0-3 would leave half the instruction set ungraded while still
    // "passing a correct circuit", so coverage is measured against the level's
    // own fixed seed rather than asserted. The seed is a literal in the level
    // data, so this is a fact about the level and not about the run.
    const seen = captureRound(L27, solutions['ch2-27-logic-engine']!).seen;
    expect(seen).toHaveLength(256);
    const counts = new Map<number, number>();
    for (const v of seen) {
      const op = (v.op ?? 0) & 7;
      counts.set(op, (counts.get(op) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Not a bare "at least once" that one lucky draw could satisfy: every opcode
    // is drawn many times over, and the counts are printed by a failure here.
    for (const op of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(counts.get(op) ?? 0, `opcode ${op} appears ${counts.get(op) ?? 0} times`).toBeGreaterThan(
        3,
      );
    }
  });

  it('grades every opcode against a circuit broken on exactly that opcode', () => {
    // Coverage is necessary but not sufficient: an opcode that appears in the
    // sequence and is never COMPARED would still be ungraded. Each of the eight
    // variants wires one opcode's mux input to its neighbour's result, so it is
    // wrong on exactly one opcode and right on the other seven -- and the round
    // it fails on has to be a round of that opcode.
    for (let op = 0; op < 8; op += 1) {
      const { failures, seen } = captureRound(L27, () => logicEngine({ breakOp: op }));
      expect(failures, `opcode ${op} was never graded`).toHaveLength(1);
      const failure = failures[0]!;
      const round = failure.round ?? -1;
      const failing = seen[round];
      expect(failing, `opcode ${op}: no vector recorded for round ${round}`).toBeDefined();
      expect(
        (failing!.op ?? 0) & 7,
        `opcode ${op} failed on a round of opcode ${(failing!.op ?? 0) & 7}`,
      ).toBe(op);
      // And the disagreement is the one this variant introduces, not an
      // expectation the level got wrong: `results[op]` was wired to
      // `results[(op + 1) % 8]`, so the circuit drove the neighbouring opcode's
      // value while the level expected this one's.
      const expected = engineValue(failing!);
      const neighbour = engineValue({ ...failing!, op: (op + 1) % 8 });
      expect(failure.expected).toEqual({ out: expected });
      expect(failure.actual).toEqual({ out: neighbour });
      // Sanity: the two opcodes really do differ on this vector, so this is a
      // round the break could be seen in at all.
      expect(neighbour, `opcodes ${op} and ${(op + 1) % 8} agree on this vector`).not.toBe(
        expected,
      );
    }
  });

  it('grades the shift amount as the low three bits of b', () => {
    // The other authored rule in the opcode table: `shift_l`/`ashr` read b's low
    // three bits, so the engine that feeds a whole byte to the barrel shifter is
    // wrong on exactly the shift opcodes -- and on a round whose b is eight or
    // more, which is what makes the round it fails on a meaningful one.
    const { failures, seen } = captureRound(L27, () => logicEngine({ amount: 'byte' }));
    expect(failures).toHaveLength(1);
    const failing = seen[failures[0]!.round ?? -1]!;
    expect([6, 7]).toContain((failing.op ?? 0) & 7);
    expect((failing.b ?? 0) & 0xf8, 'the failing vector shifts by less than eight').not.toBe(0);
  });

  it('separates the eight opcodes on vectors a player would try by hand', () => {
    // The same eight cases the level's own expectation function is checked on,
    // stated here as arithmetic rather than as level data: this is the table the
    // brief teaches, and the counterexample above is only meaningful against it.
    expect(engineValue(vector({ a: 0xf0, b: 0x3c, op: 0 }))).toBe(0x30);
    expect(engineValue(vector({ a: 0xf0, b: 0x3c, op: 1 }))).toBe(0xfc);
    expect(engineValue(vector({ a: 0xf0, b: 0x3c, op: 2 }))).toBe(0xcc);
    expect(engineValue(vector({ a: 0xf0, b: 0x3c, op: 3 }))).toBe(0x0f);
    expect(engineValue(vector({ a: 0xf0, b: 0x3c, op: 4 }))).toBe(0x2c);
    expect(engineValue(vector({ a: 0x3c, b: 0xf0, op: 5 }))).toBe(0x4c);
    expect(engineValue(vector({ a: 0x81, b: 0x03, op: 6 }))).toBe(0x08);
    expect(engineValue(vector({ a: 0x81, b: 0x03, op: 7 }))).toBe(0xf0);
  });
});

// ---------------------------------------------------------------------------
// What the targets separate
// ---------------------------------------------------------------------------

describe('the targets separate the constructions they measure', () => {
  /**
   * The bit-serial spelling of both two's-complement functions: one flip per
   * bit, then a carry ripple with no adder in it at all.
   *
   * `flipOf(bit)` names the already-built node holding that bit's flipped value
   * and `cin` the carry the ripple starts from, so the same eight-gate skeleton
   * serves level 24 (`~a + 1`, carry-in high) and level 23 (`(a XOR m) + m`,
   * carry-in the sign bit). It is the construction a player reaches for after
   * building the half adder: smaller than a byte adder, and one AND deep per bit.
   */
  function bitSerial(
    flipOf: (bit: number) => string,
    cin: string,
    flipNodes: readonly Node[],
  ): Graph {
    const nodes: Node[] = [
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
      ...flipNodes,
    ];
    let carry = cin;
    for (let bit = 0; bit < 8; bit += 1) {
      nodes.push({ kind: 'part', def: 'xor', id: `s${bit}`, from: [flipOf(bit), carry] });
      if (bit < 7) {
        nodes.push({ kind: 'part', def: 'and', id: `c${bit + 1}`, from: [flipOf(bit), carry] });
        carry = `c${bit + 1}`;
      }
    }
    nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('s') });
    nodes.push({ kind: 'output', from: 'mk', width: 8 });
    return build(nodes);
  }

  it('level 24: the bit-serial incrementer is smaller and much deeper, and one star', () => {
    // `~a + 1` without the byte adder: eight NOTs, then a carry ripple of seven
    // ANDs and eight XORs. Measured rather than described, because the level's
    // comment claims the target DENIES three stars to a 54-gate circuit -- which
    // is true, and is the whole of what "delay 2" buys. (The number here is the
    // one the measurement below reads, and the one the level's comment states;
    // this comment used to quote it as 48, which the level comment never said.)
    const graph = bitSerial(
      (bit) => `n${bit}`,
      'one',
      [
        { kind: 'part', def: 'const_on', id: 'one', from: [] },
        ...Array.from({ length: 8 }, (_, bit): Node => ({
          kind: 'part',
          def: 'not',
          id: `n${bit}`,
          from: [`sa.b${bit}`],
        })),
      ],
    );
    const level = specOf('ch2-24-signed-negator');
    const result = grade(graph, registry, level);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 54, delay: 9, tick: 0 });
    expect(result.stars, 'the reference is two gates deep and this is nine').toBe(1);
  });

  it('level 23: the bit-serial magnitude is smaller and much deeper, and one star', () => {
    // The same skeleton with the sign bit as the carry-in: eight XORs spread the
    // sign over the byte, then the ripple adds it. 78 gates against the
    // reference's 104, nine gates deep against its two.
    const graph = bitSerial(
      (bit) => `x${bit}`,
      'sa.b7',
      Array.from({ length: 8 }, (_, bit): Node => ({
        kind: 'part',
        def: 'xor',
        id: `x${bit}`,
        from: [`sa.b${bit}`, 'sa.b7'],
      })),
    );
    const level = specOf('ch2-23-negative-numbers');
    const result = grade(graph, registry, level);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 78, delay: 9, tick: 0 });
    expect(result.stars, 'the reference is two gates deep and this is nine').toBe(1);
  });

  it('level 26: the flat eight-AND3 decode is correct and one star', () => {
    // The level's data comment names this alternative, so it is measured rather
    // than described: eight 3-input ANDs, one per output, each taking all three
    // literals directly. It is the same function on a path one gate shallower
    // (35 gates, 2 delay) and it costs more gates than the tree, which is what
    // the target says a decoder should not do.
    const nodes: Node[] = [
      { kind: 'input', name: 'sel', width: 3 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['sel'] },
      { kind: 'part', def: 'not', id: 'n0', from: ['sp.b0'] },
      { kind: 'part', def: 'not', id: 'n1', from: ['sp.b1'] },
      { kind: 'part', def: 'not', id: 'n2', from: ['sp.b2'] },
    ];
    for (let out = 0; out < 8; out += 1) {
      nodes.push({
        kind: 'part',
        def: 'and3',
        id: `o${out}`,
        from: [out & 1 ? 'sp.b0' : 'n0', out & 2 ? 'sp.b1' : 'n1', out & 4 ? 'sp.b2' : 'n2'],
      });
    }
    nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('o') });
    nodes.push({ kind: 'output', from: 'mk', width: 8 });

    const level = specOf('ch2-26-3-bit-decoder');
    const result = grade(build(nodes), registry, level);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 35, delay: 2, tick: 0 });
    expect(result.stars, 'the tree is cheaper in gates, so the flat decode is one star').toBe(1);
  });

  it('level 23: the textbook (a XOR m) - m is correct and one star', () => {
    // The level's data comment names this form too: `(a XOR m) - m`, spelled as
    // "NOT the mask, add it, carry-in high" instead of the level's "add the
    // mask's own low bit as the carry-in". For a non-negative byte the mask is 0
    // and the borrowed 255 is cancelled by the carry-in; for a negative one the
    // NOT mask is 0 and the carry-in is the +1. Same function, 112 gates against
    // the reference's 104, so it is one star -- which is the difference the extra
    // `not8` makes.
    const graph = build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mask',
        from: Array.from({ length: 8 }, () => 'sa.b7'),
      },
      { kind: 'part', def: 'xor8', id: 'flip', from: ['a', 'mask'] },
      { kind: 'part', def: 'not8', id: 'nmask', from: ['mask'] },
      { kind: 'part', def: 'const_on', id: 'one', from: [] },
      { kind: 'part', def: 'add8', id: 'plus', from: ['flip', 'nmask', 'one'] },
      { kind: 'output', from: 'plus', width: 8 },
    ]);
    const level = specOf('ch2-23-negative-numbers');
    const result = grade(graph, registry, level);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 112, delay: 2, tick: 0 });
    expect(result.stars).toBe(1);
  });

  it('level 24: inverting with a byte XOR is correct and one star', () => {
    // The same one's complement, spelled `xor8(a, 0xff)` -- the `const8` the
    // palette offers is all ones, so this is the other way a player might invert
    // a byte. 32 gates where the `not8` costs 8, for the same function and the
    // same delay: one star.
    const graph = build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'part', def: 'const8', id: 'ones', from: [] },
      { kind: 'part', def: 'xor8', id: 'flip', from: ['a', 'ones'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      { kind: 'part', def: 'const_on', id: 'one', from: [] },
      { kind: 'part', def: 'add8', id: 'plus', from: ['flip', 'z', 'one'] },
      { kind: 'output', from: 'plus', width: 8 },
    ]);
    const level = specOf('ch2-24-signed-negator');
    const result = grade(graph, registry, level);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 104, delay: 2, tick: 0 });
    expect(result.stars).toBe(1);
  });
});

describe('the decoder rewards are generated per width, and no reference drops one in', () => {
  it('wires both decoder levels from gates, not from a decoder drop-in', () => {
    // `decoder1` and `decoder3` are the ids levels 25 and 26 hand out, and the
    // family they belong to is registered now (`DECODER_DEF_IDS`, one part per
    // width, generated in `src/core/defs/wide.ts`). What this asserts is what
    // the data comments describe, and it is a fact about this batch rather than
    // about the registry: neither decoder level's reference solution depends on
    // the drop-in -- both are wired from gates -- so no target here was measured
    // from a part a player would have to own before the level that hands it out.
    for (const id of ['decoder1', 'decoder2', 'decoder3']) {
      for (const [levelId, make] of Object.entries(solutions)) {
        const uses = make().instances.filter((inst) => inst.def === id);
        expect(uses, `${levelId} instantiates ${id}`).toEqual([]);
      }
    }
    // And they stay out of the palettes that have no pins for them.
    for (const level of [L23, L24, L27]) {
      expect(level.allowedComponents, `${level.id} offers a decoder`).not.toContain('decoder1');
      expect(level.allowedComponents).not.toContain('decoder3');
    }
    // Level 25 names `decoder2` to the player and deliberately does not offer
    // it: no level unlocks it, and wired to this level's one-bit select it would
    // answer the level's own two-row table by itself (the level's data comment
    // records both reasons). Pinned here so the decision has to be made again
    // rather than drifted out of.
    expect(L25.brief.en).toContain('decoder2');
    expect(L25.allowedComponents).not.toContain('decoder2');
  });

  it("lets level 25's own reward score the target, which is the own-reward rule", () => {
    // The level's comment states this measurement, so it is taken here rather
    // than described. `decoder1` is the level's OWN reward and `paletteDefsFor`
    // offers a level its own rewards before it is passed (batch 2's rule, the
    // same case as level 13's `splitter` and level 20's `full_adder`), so a
    // player can drop the part in and score exactly what the NOT-and-Maker
    // reference scores: one NAND equivalent, one unit of delay, three stars.
    // That is why the reward is listed and `decoder2` -- not this level's reward
    // at all -- is not; the distinction is the rule's, not an inconsistency.
    expect(L25.rewards?.components).toContain('decoder1');
    expect(L25.allowedComponents).toContain('decoder1');
    const graph = build([
      { kind: 'input', name: 'sel' },
      { kind: 'part', def: 'decoder1', id: 'dec', from: ['sel'] },
      { kind: 'output', from: 'dec', width: 2 },
    ]);
    const result = grade(graph, registry, L25);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual(L25.threeStar);
    expect(result.stars).toBe(3);
  });

  it("lets level 26's own reward score the target, and it beats the target's depth", () => {
    // The second case of the same rule, one width up, and the one the module
    // header used to miss: `decoder3` is level 26's OWN reward, so
    // `paletteDefsFor` offers it before the level is passed, and one instance
    // wired straight from `sel` to the level's output answers the whole
    // three-to-eight table. Measured rather than described, because the level's
    // comment states these numbers: 27 gate equivalents -- the same 27 the
    // reference's shared minterm tree costs, since the registered part's
    // `gateCost` IS that tree -- on a path ONE gate deep, against the level's
    // 27-and-3 target. It therefore ties the gate count and beats the depth, and
    // scores three stars: the price of the own-reward rule, recorded in the
    // comment rather than withdrawn from the palette.
    expect(L26.rewards?.components).toContain('decoder3');
    expect(L26.allowedComponents).toContain('decoder3');
    expect(L26.threeStar).toEqual({ gate: 27, delay: 3, tick: 0 });

    const graph = build([
      { kind: 'input', name: 'sel', width: 3 },
      { kind: 'part', def: 'decoder3', id: 'dec', from: ['sel'] },
      { kind: 'output', from: 'dec', width: 8 },
    ]);
    const result = grade(graph, registry, L26);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 27, delay: 1, tick: 0 });
    expect(result.stars).toBe(3);

    // And the reference is still the thing the target measures: the drop-in
    // ties it on gates and is shallower, which is what the comment says.
    const built = grade(solutions['ch2-26-3-bit-decoder']!(), registry, L26);
    expect(L26.threeStar).toEqual(built.metrics);
    expect(result.metrics.gate).toBe(built.metrics.gate);
    expect(result.metrics.delay).toBeLessThan(built.metrics.delay);
  });
});
