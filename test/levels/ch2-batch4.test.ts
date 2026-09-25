// tsconfig lists only `vitest/globals` in `types`, so Node's ambient types are
// deliberately not in this program. The import is real at runtime (vitest runs
// this file in Node) and the assertion below is what proves it; the suppression
// is one line rather than a project-wide `@types/node` dependency.
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import { UnstableCircuitError } from '../../src/core/errors';
import { validateGraph, type Graph } from '../../src/core/graph';
import { Simulation, compile } from '../../src/core/net';
import { DEFAULT_FUZZ_ROUNDS } from '../../src/levels/checks';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import { CH2_BATCH1 } from '../../src/levels/content/ch2/batch1';
import { CH2_BATCH2 } from '../../src/levels/content/ch2/batch2';
import { CH2_BATCH3 } from '../../src/levels/content/ch2/batch3';
import { CH2_BATCH4 } from '../../src/levels/content/ch2/batch4';
import { grade } from '../../src/levels/grader';
import type {
  CheckFailure,
  FuzzCheck,
  FuzzVector,
  LevelSpec,
  ScriptCheck,
  ScriptStep,
  TruthRow,
} from '../../src/levels/spec';
import { build, registry, type Node } from '../fixtures/build';

/**
 * Chapter 2's fourth batch: levels 28-38 -- the storage and timing half of the
 * chapter, and the first chapter-2 levels the `script` checker carries.
 *
 * WHAT THE SOURCE FIXES, AND WHAT IT DOES NOT. As in batches 1-3: the compendium
 * gives each of these levels exactly three things -- its name (English and
 * Chinese), its place in the chapter, and one line of teaching concept. It gives
 * no ports, no widths, no pass conditions, no targets and no rewards. Everything
 * else in the level data is this replica's design, which is why each level
 * carries a data comment split into `SOURCED` and `AUTHORED`; the marker block
 * below checks that those comments exist and that the four notes this batch owes
 * a reader are in them (level 30's periodicity, level 34's change of kind under
 * spec 3.1, level 37's definition of "full", and level 38's achievement).
 *
 * WHAT THIS FILE HAS TO PROVE THAT THE EARLIER BATCHES DID NOT:
 *
 *  * THE `script` CHECKER'S TICK SEMANTICS ARE LOAD-BEARING, and they are not
 *    the obvious reading. `runChecks` walks a script's steps in tick order and
 *    for each step writes the step's inputs and calls `settle()` BEFORE it
 *    advances the clock to that step's `tick` (`levels/checks.ts`, the script
 *    branch: `while (io.sim.tickCount < step.tick) io.tick()`). Two consequences
 *    decide how every level here is authored and asserted:
 *      1. `tick` is an ABSOLUTE target, and the number of edges a step runs is
 *         the difference from the previous step's tick -- so a step at tick 0
 *         runs no edge at all, and its `expect` reads the post-`reset` state.
 *      2. a step's inputs drive the edges that REACH that step's tick, so an
 *         `expect` at tick T reads the value the edge into T just sampled. A
 *         delay line therefore looks exactly like a wire when the input changes
 *         at every step, and the only way a script can show that a value is
 *         HELD is a second step at the SAME tick (no edge, new inputs, old
 *         value) -- which is what levels 28, 29, 35 and 36 do, and what a wire
 *         or an adder chain fails.
 *  * STABILITY IS AN ASSERTION, NOT AN ABSENCE OF ONE. Level 28's reference
 *    really does contain a feedback loop (`validateGraph` reports it as a
 *    warning), it really does settle, and the counterexamples are rings that
 *    really do throw `UnstableCircuitError` -- measured directly against
 *    `Simulation.settle`, not inferred from "the level passed".
 *  * PERIODICITY IS ASSERTED ACROSS MANY TICKS, not at one tick. Level 30's
 *    check walks sixteen consecutive ticks that must alternate and four more
 *    that must hold, and this file measures that shape out of the check data
 *    and grades three circuits against it: one that oscillates only while
 *    enabled (passes), one that never oscillates (fails), one that never stops
 *    (fails).
 *  * "FULL" IS ASSERTED OVER THE WHOLE ADDRESS RANGE. Level 37's check writes
 *    all 256 addresses and then reads all 256 back with a different byte on `d`
 *    and `load` low, so the level cannot be passed by a register that ignores
 *    `addr` or by a wire from `d`.
 *
 * The starter set is imported rather than restated (`STARTER_COMPONENTS` is the
 * same constant `paletteDefsFor` filters with), exactly as the chapter-1 and
 * batch-1/2/3 tests do it.
 */

/** The level with this index, or a loud failure -- indexing returns `undefined`. */
function levelAt(index: number): LevelSpec {
  const level = CH2_BATCH4.find((l) => l.index === index);
  if (!level) throw new Error(`chapter 2 batch 4 has no level with index ${index}`);
  return level;
}

function specOf(id: string): LevelSpec {
  const level = CH2_BATCH4.find((l) => l.id === id);
  if (!level) throw new Error(`chapter 2 batch 4 has no level ${id}`);
  return level;
}

const L28 = levelAt(28);
const L29 = levelAt(29);
const L30 = levelAt(30);
const L31 = levelAt(31);
const L32 = levelAt(32);
const L33 = levelAt(33);
const L34 = levelAt(34);
const L35 = levelAt(35);
const L36 = levelAt(36);
const L37 = levelAt(37);
const L38 = levelAt(38);

/** The batch's four script levels that step a value through storage, in order. */
const STORAGE_SCRIPT_LEVELS: readonly LevelSpec[] = [L28, L29, L35, L36];

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

/** Every script check of a level, in the order its data states them. */
function scriptsOf(level: LevelSpec): readonly ScriptCheck[] {
  return level.checks.filter((entry): entry is ScriptCheck => entry.kind === 'script');
}

/** The level's first script check, refusing an absent one. */
function scriptOf(level: LevelSpec): ScriptCheck {
  const check = scriptsOf(level)[0];
  if (!check) throw new Error(`${level.id} has no script check`);
  return check;
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

/** A fuzz vector, spelled as the record the kernel builds. */
function vector(parts: Record<string, number>): FuzzVector {
  return parts;
}

/** The `expect` value of a step, refusing a step that expects nothing. */
function expectedOut(step: ScriptStep): number {
  const value = step.expect?.out;
  if (value === undefined) throw new Error(`script step at tick ${step.tick} expects no output`);
  return value;
}

/** The driven value of an input pin on a step; an absent pin is driven to 0. */
function driven(step: ScriptStep, pin: string): number {
  return step.inputs?.[pin] ?? 0;
}

/** True when two steps drive every pin to the same value (a missing pin reads 0). */
function sameInputs(a: ScriptStep, b: ScriptStep): boolean {
  const pins = new Set([...Object.keys(a.inputs ?? {}), ...Object.keys(b.inputs ?? {})]);
  for (const pin of pins) if (driven(a, pin) !== driven(b, pin)) return false;
  return true;
}

/** The eight `stem<bit>` ids a byte-wide maker is fed, low bit first. */
function bits(stem: string): string[] {
  return Array.from({ length: 8 }, (_, bit) => `${stem}${bit}`);
}

/**
 * Why this level's checks would let a circuit pass unmeasured, in the words of
 * the failure.
 *
 * The same five-branch invariant `ch1-part1.test.ts`, `ch1-part2.test.ts` and
 * `ch2-batch1/2/3.test.ts` carry -- batch 1's copy is itself tested against
 * synthetic vacuous checks of every kind, so this copy keeps the part that
 * matters here: `script` with no steps at all, or with no step that expects
 * anything, compares nothing however many steps it has.
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
        break;
      case 'fuzz': {
        const rounds = check.rounds ?? DEFAULT_FUZZ_ROUNDS;
        if (!Number.isInteger(rounds) || rounds <= 0) {
          problems.push(`${level.id} has a fuzz check with rounds=${String(check.rounds)}`);
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

/** Grades a graph and insists the failure records say what happened. */
function failuresOf(make: () => Graph, level: LevelSpec): readonly CheckFailure[] {
  const result = grade(make(), registry, level);
  expect(result.passed, `${level.id} passed a circuit it should reject`).toBe(false);
  expect(result.failures.length, `${level.id}: ${JSON.stringify(result.issues)}`).toBeGreaterThan(
    0,
  );
  expect(result.stars, `${level.id} scored stars on a failing circuit`).toBe(0);
  return result.failures;
}

describe('chapter 2, levels 28-38', () => {
  it('exposes eleven chapter-2 levels with the briefed indices', () => {
    expect(CH2_BATCH4.map((level) => level.index)).toEqual([
      28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
    ]);
    expect(CH2_BATCH4.map((level) => level.chapter)).toEqual([
      2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    ]);
  });

  it('uses the ch2-<index>-<slug> id convention', () => {
    expect(CH2_BATCH4.map((level) => level.id)).toEqual([
      'ch2-28-circular-dependency',
      'ch2-29-delayed-lines',
      'ch2-30-odd-ticks',
      'ch2-31-bit-inverter',
      'ch2-32-bit-switch',
      'ch2-33-input-selector',
      'ch2-34-the-bus',
      'ch2-35-saving-gracefully',
      'ch2-36-saving-bytes',
      'ch2-37-little-box',
      'ch2-38-counter',
    ]);
  });

  it('shapes every level exactly as the brief fixes it', () => {
    expect(pinsOf(L28)).toEqual({ inputs: ['set:1', 'value:1'], outputs: ['out:1'] });
    expect(pinsOf(L29)).toEqual({ inputs: ['a:8'], outputs: ['out:8'] });
    expect(pinsOf(L30)).toEqual({ inputs: ['enable:1'], outputs: ['out:1'] });
    expect(pinsOf(L31)).toEqual({ inputs: ['a:1', 'inv:1'], outputs: ['out:1'] });
    expect(pinsOf(L32)).toEqual({ inputs: ['a:1', 'on:1'], outputs: ['out:1'] });
    expect(pinsOf(L33)).toEqual({ inputs: ['a:8', 'b:8', 'sel:1'], outputs: ['out:8'] });
    expect(pinsOf(L34)).toEqual({ inputs: ['a:8', 'b:8', 'sel:1'], outputs: ['out:8'] });
    expect(pinsOf(L35)).toEqual({ inputs: ['d:1', 'load:1'], outputs: ['out:1'] });
    expect(pinsOf(L36)).toEqual({ inputs: ['d:8', 'load:1'], outputs: ['out:8'] });
    expect(pinsOf(L37)).toEqual({ inputs: ['d:8', 'addr:8', 'load:1'], outputs: ['out:8'] });
    expect(pinsOf(L38)).toEqual({ inputs: ['en:1', 'reset:1'], outputs: ['out:8'] });
  });

  it('uses the checker kind the brief fixes for each level', () => {
    // The brief's table is the decision: two truth-table levels with four rows
    // each, one fuzz level, and eight levels carried by scripts (level 28 and
    // level 30 add their stability and periodicity assertions on top of the
    // script, and level 30 has a second script for the held-low case).
    expect(L31.checks.map((check) => check.kind)).toEqual(['truth-table']);
    expect(L32.checks.map((check) => check.kind)).toEqual(['truth-table']);
    expect(L34.checks.map((check) => check.kind)).toEqual(['truth-table']);
    expect(L33.checks.map((check) => check.kind)).toEqual(['fuzz']);
    for (const level of [L28, L29, L35, L36, L37, L38]) {
      expect(level.checks.map((check) => check.kind), level.id).toEqual(['script']);
    }
    expect(L30.checks.map((check) => check.kind)).toEqual(['script', 'script']);
  });

  it('names each level in both languages', () => {
    expect(CH2_BATCH4.map((level) => level.name.en)).toEqual([
      'Circular Dependency',
      'Delayed Lines',
      'Odd Ticks',
      'Bit Inverter',
      'Bit Switch',
      'Input Selector',
      'The bus',
      'Saving Gracefully',
      'Saving Bytes',
      'Little Box',
      'Counter',
    ]);
    expect(CH2_BATCH4.map((level) => level.name.zh)).toEqual([
      '循环依赖',
      '延迟线',
      '奇变偶不变',
      '1 位取反器',
      '1 位开关',
      '数据选择器',
      '总线',
      '优雅存储',
      '存储一字节',
      '小盒子',
      '计数器',
    ]);
    for (const level of CH2_BATCH4) {
      expect(level.brief.zh.length, `${level.id} has an empty zh brief`).toBeGreaterThan(0);
      expect(level.brief.en.length, `${level.id} has an empty en brief`).toBeGreaterThan(0);
      expect(level.hint.zh.length, `${level.id} has an empty zh hint`).toBeGreaterThan(0);
      expect(level.hint.en.length, `${level.id} has an empty en hint`).toBeGreaterThan(0);
      // The briefs and hints are original prose, so they are not the source's
      // one-line concepts copied across: the Chinese concept lines this batch's
      // comments quote must not appear verbatim in the player-facing text.
      for (const line of ['引入反馈回路概念', '刚好装满存储空间的电路设计', '共享数据传输线路的概念']) {
        expect(level.brief.zh.includes(line), `${level.id} copies the source line ${line}`).toBe(
          false,
        );
      }
    }
  });

  it('gates every part behind a component unlocked at or before it', () => {
    // "At or before": a level may offer the parts its own rewards hand out (level
    // 29 offers the `delay8` and `reg8` it teaches), so the walk adds a level's
    // rewards before testing its own palette and the next level's after it.
    const unlocked = new Set<string>(STARTER_COMPONENTS);
    for (const level of [
      ...CH1_PART1,
      ...CH1_PART2,
      ...CH2_BATCH1,
      ...CH2_BATCH2,
      ...CH2_BATCH3,
      ...CH2_BATCH4,
    ]) {
      for (const def of level.rewards?.components ?? []) unlocked.add(def);
      for (const def of level.allowedComponents) {
        expect(unlocked.has(def), `${level.id} offers locked component ${def}`).toBe(true);
      }
    }
  });

  it('offers nothing from a later level', () => {
    // The same rule from the other side: what this batch offers is built from
    // chapter 1's rewards, batches 1-3's, its own, and the starter set. The
    // parts the chapter hands out after this batch (the CPU chapter's own
    // components) are named here so the walk cannot pass on an empty palette.
    const owned = new Set<string>(STARTER_COMPONENTS);
    for (const level of [
      ...CH1_PART1,
      ...CH1_PART2,
      ...CH2_BATCH1,
      ...CH2_BATCH2,
      ...CH2_BATCH3,
      ...CH2_BATCH4,
    ]) {
      for (const def of level.rewards?.components ?? []) owned.add(def);
      for (const def of level.allowedComponents) {
        expect(owned.has(def), `${level.id} offers ${def}, which no level unlocks by then`).toBe(
          true,
        );
      }
    }
  });

  it('gives every level a check with something to compare', () => {
    for (const level of CH2_BATCH4) {
      expect(level.checks.length, `${level.id} has no checks`).toBeGreaterThan(0);
      expect(vacuityProblems(level), `${level.id} has a vacuous check`).toEqual([]);
    }
  });

  it('hands out the parts the brief assigns to each level', () => {
    expect(L28.rewards?.components).toEqual(['ram8']);
    expect(L29.rewards?.components).toEqual(['reg8', 'delay8']);
    expect(L30.rewards?.components ?? []).toEqual([]);
    expect(L31.rewards?.components ?? []).toEqual([]);
    expect(L32.rewards?.components ?? []).toEqual([]);
    expect(L33.rewards?.components).toEqual(['mux8']);
    expect(L34.rewards?.components ?? []).toEqual([]);
    expect(L35.rewards?.components ?? []).toEqual([]);
    expect(L36.rewards?.components).toEqual(['counter8']);
    expect(L37.rewards?.components ?? []).toEqual([]);
    expect(L38.rewards?.components ?? []).toEqual([]);
  });

  it('holds its own rewards back where an eight-bit part cannot attach', () => {
    // Level 28's reward is `ram8`, and every pin on that level is one bit wide:
    // an eight-bit part has nothing to attach to (batch 1's level-14 reason). A
    // reward is data and the unlock walk still hands it out; the level's palette
    // is what stays one bit wide, exactly as chapter 1's capstone rewards `mem1`
    // without listing it.
    expect(L28.allowedComponents).not.toContain('ram8');
    expect(L28.allowedComponents).not.toContain('mem1');
    // The two one-bit levels that are answered by, or teach, the packaged
    // conditional write list it: level 28 is where the loop is BUILT (see its
    // comment), level 35 is where the part is USED.
    expect(L35.allowedComponents).toContain('mem1');
    expect(L30.allowedComponents).toContain('mem1');
  });

  it('offers the parts its own lesson needs', () => {
    // Not a restatement of the palettes but of the claims their comments make.
    for (const def of ['delay_line', 'switch', 'not', 'or']) {
      expect(L28.allowedComponents, `level 28 cannot use ${def}`).toContain(def);
    }
    for (const def of ['delay8', 'reg8', 'splitter', 'maker']) {
      expect(L29.allowedComponents, `level 29 cannot use ${def}`).toContain(def);
    }
    for (const def of ['mem1', 'xor']) {
      expect(L30.allowedComponents, `level 30 cannot use ${def}`).toContain(def);
    }
    for (const def of ['mux8', 'splitter', 'maker', 'nand', 'not']) {
      expect(L33.allowedComponents, `level 33 cannot use ${def}`).toContain(def);
    }
    for (const def of ['ram8', 'reg8', 'mem1']) {
      expect(L37.allowedComponents, `level 37 cannot use ${def}`).toContain(def);
    }
    for (const def of ['reg8', 'splitter', 'maker', 'xor', 'and', 'add8']) {
      expect(L38.allowedComponents, `level 38 cannot use ${def}`).toContain(def);
    }
  });

  it('states the two four-row truth tables the brief fixes', () => {
    // Four rows is the brief's shape for both levels, and both are EXHAUSTIVE
    // over their one-bit inputs: two one-bit pins is four combinations, so the
    // tables are complete rather than sampled.
    for (const level of [L31, L32]) {
      const rows = rowsOf(level);
      expect(rows.length, `${level.id} does not have four rows`).toBe(4);
      expect(new Set(rows.map((row) => JSON.stringify(row.inputs))).size, level.id).toBe(4);
    }
  });

  it('states level 31 as a conditional inversion', () => {
    const rows = rowsOf(L31);
    expect(rowFor(rows, { a: 0, inv: 0 })?.outputs).toEqual({ out: 0 });
    expect(rowFor(rows, { a: 0, inv: 1 })?.outputs).toEqual({ out: 1 });
    expect(rowFor(rows, { a: 1, inv: 0 })?.outputs).toEqual({ out: 1 });
    expect(rowFor(rows, { a: 1, inv: 1 })?.outputs).toEqual({ out: 0 });
  });

  it('states level 32 as a conditional pass', () => {
    const rows = rowsOf(L32);
    expect(rowFor(rows, { a: 0, on: 0 })?.outputs).toEqual({ out: 0 });
    expect(rowFor(rows, { a: 0, on: 1 })?.outputs).toEqual({ out: 0 });
    expect(rowFor(rows, { a: 1, on: 0 })?.outputs).toEqual({ out: 0 });
    expect(rowFor(rows, { a: 1, on: 1 })?.outputs).toEqual({ out: 1 });
  });

  it('states level 34 as a four-row table over whole bytes', () => {
    // Four rows out of 2^17 possible vectors, which is the brief's shape: this
    // level is the "exactly one driver is active" rule stated as a small table,
    // not an exhaustive byte table (that is what level 33's fuzz check covers).
    const rows = rowsOf(L34);
    expect(rows.length).toBe(4);
    // Both select values are exercised, on the same pair of operands, so the
    // table separates "selected" from "always a" and "always b".
    for (const sel of [0, 1]) {
      expect(rowFor(rows, { a: 0x00, b: 0xff, sel })).toBeDefined();
      expect(rowFor(rows, { a: 0x0f, b: 0xf0, sel })).toBeDefined();
    }
    expect(rowFor(rows, { a: 0x00, b: 0xff, sel: 0 })?.outputs).toEqual({ out: 0x00 });
    expect(rowFor(rows, { a: 0x0f, b: 0xf0, sel: 0 })?.outputs).toEqual({ out: 0x0f });
    expect(rowFor(rows, { a: 0x00, b: 0xff, sel: 1 })?.outputs).toEqual({ out: 0xff });
    expect(rowFor(rows, { a: 0x0f, b: 0xf0, sel: 1 })?.outputs).toEqual({ out: 0xf0 });
    for (const row of rows) {
      const want = row.inputs.sel === 1 ? row.inputs.b : row.inputs.a;
      expect(row.outputs.out, JSON.stringify(row)).toBe(want);
    }
  });

  it('states the selector as a fixed seed and 256 rounds', () => {
    const check = fuzzOf(L33);
    expect(Number.isInteger(check.seed), 'the fuzz seed is not an integer').toBe(true);
    expect(check.seed, 'the fuzz seed is the xorshift fixed point').not.toBe(0);
    expect(check.rounds).toBe(256);
    expect(Object.keys(check.inputs).sort()).toEqual(['a', 'b', 'sel']);
    expect(Object.keys(check.outputs).sort()).toEqual(['out']);
  });

  it('tells the player level 34 is a selector because the engine forbids a bus', () => {
    // Spec 3.1: no bus protocol, no multi-driver arbitration -- one input pin is
    // driven by exactly one wire (`validateGraph`'s `multiple-drivers` error).
    // A literal tri-state bus therefore cannot be built here, and the level says
    // so in BOTH languages rather than pretending the source's concept is
    // computable as written.
    expect(L34.brief.zh).toContain('多驱动');
    expect(L34.brief.zh).toContain('仲裁');
    expect(L34.brief.en).toContain('multi-driver');
    expect(L34.brief.en).toContain('arbitration');
    expect(L34.brief.zh).toContain('没有总线协议');
    expect(L34.brief.en).toContain('no bus protocol');
  });

  it('tells the player level 37 means all 256 bytes, and says how', () => {
    // The source gives this level one line ("刚好装满存储空间的电路设计") and
    // defines neither the capacity nor what "full" means, so this replica's
    // definition is the level's contract and the player has to be told it.
    expect(L37.brief.zh).toContain('256');
    expect(L37.brief.zh).toContain('装满');
    expect(L37.brief.zh).toContain('addr');
    expect(L37.brief.en).toContain('256');
    expect(L37.brief.en).toContain('full');
    expect(L37.brief.en).toContain('addr');
  });

  it('gives level 38 a script that walks a whole byte and wraps', () => {
    const steps = scriptOf(L38).steps;
    // One step per tick, plus the final no-edge step that re-reads tick 263: a
    // circuit that counted combinationally would move there.
    expect(steps.length).toBe(265);
    const ticks = steps.map((step) => step.tick);
    expect(ticks).toEqual([...ticks].sort((x, y) => x - y));
    expect(ticks[ticks.length - 1]).toBe(263);

    // The first two steps: reset asserted with en low, then with en HIGH. The
    // second one is the "reset beats en" edge -- a register that let en win
    // would read 1 there.
    expect(steps[0]?.inputs).toEqual({ en: 0, reset: 1 });
    expect(expectedOut(steps[0]!)).toBe(0);
    expect(steps[1]?.inputs).toEqual({ en: 1, reset: 1 });
    expect(expectedOut(steps[1]!)).toBe(0);

    // The 256-edge run: expectations are the count itself, so the walk really
    // does visit every byte and come back to 0 at exactly 256 -- a counter that
    // wrapped at 128 or 200 could not satisfy this.
    const run = steps.slice(2, 258);
    expect(run.length).toBe(256);
    expect(run.map((step) => expectedOut(step))).toEqual(
      Array.from({ length: 256 }, (_, i) => (i + 1) & 0xff),
    );
    expect(run.map((step) => step.tick)).toEqual(Array.from({ length: 256 }, (_, i) => i + 2));
    // The two steps that carry the wrap, named so the assertion is readable.
    expect(expectedOut(run[254]!)).toBe(255);
    expect(expectedOut(run[255]!)).toBe(0);
    for (const step of run) expect(step.inputs).toEqual({ en: 1, reset: 0 });

    // Then two more counts, then the edge where reset and en are both high
    // while the count is 2: reset has to win, so the expectation is 0 and not 3.
    expect(expectedOut(steps[258]!)).toBe(1);
    expect(expectedOut(steps[259]!)).toBe(2);
    expect(steps[260]?.inputs).toEqual({ en: 1, reset: 1 });
    expect(expectedOut(steps[260]!)).toBe(0);
    // en low holds, and the last step re-reads the same tick to prove the count
    // does not move without an edge.
    expect(steps[261]?.inputs).toEqual({ en: 0, reset: 0 });
    expect(expectedOut(steps[261]!)).toBe(0);
    expect(expectedOut(steps[262]!)).toBe(0);
    expect(steps[263]?.inputs).toEqual({ en: 1, reset: 0 });
    expect(expectedOut(steps[263]!)).toBe(1);
    expect(steps[264]?.tick).toBe(263);
    expect(expectedOut(steps[264]!)).toBe(1);
  });

  it('withholds the one drop-in that would answer level 38 in a single part', () => {
    // `counter8` is unlocked by level 36, is not this level's own reward, and has
    // exactly this level's pins (`en` / `reset` -> `out`) -- batch 2's palette
    // rule (level 22's `add8`, level 24's `neg8`). The level is the third use of
    // that subtraction, and its data comment says so.
    expect(L36.rewards?.components).toContain('counter8');
    expect(L38.allowedComponents).not.toContain('counter8');
    expect(L38.allowedComponents).toContain('add8');
  });
});

describe('the script levels hold a value across edges, not just within one', () => {
  /**
   * THE ASSERTION THE TICK SEMANTICS FORCE. `runChecks` writes a step's inputs
   * and settles BEFORE advancing to that step's tick, so a step's `expect`
   * reads the value the edge into that tick just sampled. A script made only of
   * "one step per new input" therefore cannot tell a delay from a wire: the
   * level has to ask a second time at the SAME tick, with no edge in between,
   * and demand the OLD value.
   *
   * These four levels are the ones whose whole lesson is that a value survives
   * an edge, and each of them is asserted here to contain at least one such
   * pair -- a step that expects something, followed immediately by a step at the
   * same tick that drives a DIFFERENT value and still expects the first.
   */
  for (const level of STORAGE_SCRIPT_LEVELS) {
    it(`${level.id} re-reads at a tick it has already reached`, () => {
      const steps = scriptOf(level).steps;
      const pairs = steps.filter((step, index) => {
        const next = steps[index + 1];
        if (!next || next.tick !== step.tick) return false;
        if (step.expect === undefined || next.expect === undefined) return false;
        return !sameInputs(step, next) && expectedOut(next) === expectedOut(step);
      });
      expect(
        pairs.length,
        `${level.id} never re-reads a tick it has already reached, so a wire would pass it`,
      ).toBeGreaterThanOrEqual(1);
    });
  }

  it('gives each of those levels a run of consecutive ticks, not one sampled tick', () => {
    // The same "many ticks" requirement level 30 is held to, one level down: a
    // storage level that sampled a single tick would not test holding either.
    for (const level of STORAGE_SCRIPT_LEVELS) {
      const ticks = scriptOf(level).steps.map((step) => step.tick);
      const distinct = [...new Set(ticks)];
      expect(distinct, `${level.id} drives one tick only`).toEqual(
        Array.from({ length: distinct.length }, (_, i) => i),
      );
      expect(distinct.length, `${level.id} drives too few ticks`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("level 30's periodicity is asserted across many ticks", () => {
  const steps = scriptOf(L30).steps;
  /** Ticks 0-15: the osculating run. */
  const oscillating = steps.filter((step) => step.tick <= 15);
  /** Ticks 16-19: `enable` drops and the output must stay where it was. */
  const held = steps.filter((step) => step.tick >= 16 && step.tick <= 19);
  /** Ticks 20-23: `enable` returns and the beat resumes from the held value. */
  const resumed = steps.filter((step) => step.tick >= 20);

  it('walks sixteen consecutive enabled ticks that alternate on every one', () => {
    // Sixteen ticks is eight whole periods of the 0/1/0/1 beat: "the output has
    // a period" is only measurable across more than one of them, and a single
    // asserted tick would prove nothing at all.
    expect(oscillating.map((step) => step.tick)).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );
    for (const step of oscillating) expect(driven(step, 'enable')).toBe(1);
    const values = oscillating.map((step) => expectedOut(step));
    expect(values).toEqual(Array.from({ length: 16 }, (_, i) => i % 2));
    // Not a constant and not a single transition: the expectation changes on
    // every consecutive tick, eight rising edges and eight falling ones.
    expect(values.filter((value) => value === 1).length).toBe(8);
    expect(values.filter((value) => value === 0).length).toBe(8);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i], `tick ${i} does not alternate`).not.toBe(values[i - 1]);
    }
  });

  it('freezes the output on the four ticks once enable drops', () => {
    // The last enabled tick left the output high, and the four disabled ticks
    // that follow must all read it back: a circuit that kept oscillating would
    // fail the first of them, a circuit that cleared on disable the same.
    expect(held.map((step) => step.tick)).toEqual([16, 17, 18, 19]);
    for (const step of held) expect(driven(step, 'enable')).toBe(0);
    expect(held.map((step) => expectedOut(step))).toEqual([1, 1, 1, 1]);
    // Two of those four ticks sit on the beat the oscillator would have taken:
    // without the hold they would read 0.
    expect(expectedOut(oscillating[15]!)).toBe(1);
    for (const tick of [16, 18]) {
      const step = steps.find((entry) => entry.tick === tick);
      expect(step, `no step at tick ${tick}`).toBeDefined();
      expect(expectedOut(step!)).toBe(1);
    }
  });

  it('resumes the beat from the held value when enable comes back', () => {
    // 1 XOR 1 = 0, so the first enabled tick after the hold is a falling edge:
    // the circuit kept its state and simply starts flipping again.
    expect(resumed.map((step) => step.tick)).toEqual([20, 21, 22, 23]);
    for (const step of resumed) expect(driven(step, 'enable')).toBe(1);
    expect(resumed.map((step) => expectedOut(step))).toEqual([0, 1, 0, 1]);
  });

  it("keeps level 30's second script held low for its whole run", () => {
    // The other half of "the enable gates the clock": a circuit that oscillated
    // whatever `enable` said would fail this one at tick 1.
    const second = scriptsOf(L30)[1];
    expect(second, 'level 30 has no second script').toBeDefined();
    expect(second!.steps.map((step) => step.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const step of second!.steps) {
      expect(driven(step, 'enable')).toBe(0);
      expect(expectedOut(step)).toBe(0);
    }
  });
});

describe("level 37's check covers the whole address range", () => {
  const steps = scriptOf(L37).steps;
  const write = steps.slice(1, 257);
  const read = steps.slice(257);

  it('writes 256 distinct bytes into the 256 addresses, one edge each', () => {
    expect(steps.length).toBe(513);
    expect(write.length).toBe(256);
    expect(read.length).toBe(256);
    // Address 0 is written by the edge into tick 1, and the step at tick 0 runs
    // no edge at all -- which is why the walk starts one tick in.
    expect(steps[0]?.tick).toBe(0);
    expect(expectedOut(steps[0]!)).toBe(0);
    for (const [index, step] of write.entries()) {
      expect(step.tick).toBe(index + 1);
      expect(driven(step, 'addr'), `write step ${index}`).toBe(index);
      expect(driven(step, 'load'), `write step ${index}`).toBe(1);
      // The value written is asserted through the output on the same step, so
      // this step is a write AND a read-back.
      expect(driven(step, 'd')).toBe(expectedOut(step));
    }
    // Every address is written exactly once, with a value nothing else uses:
    // 256 distinct bytes is what makes an address decode that aliases two cells
    // visible at all.
    const written = write.map((step) => driven(step, 'd'));
    expect(new Set(written).size).toBe(256);
    expect(new Set(write.map((step) => driven(step, 'addr'))).size).toBe(256);
  });

  it('reads every address back with load low and a different byte on d', () => {
    // The second pass happens AFTER all 256 writes, so it proves the whole box
    // holds its contents at once, and every read drives `d` with the complement
    // of the stored byte -- so a circuit that passed `d` through to `out`, or
    // that ignored `addr` and kept only the last write, fails the first read
    // rather than the fifty-first.
    for (const [index, step] of read.entries()) {
      expect(step.tick).toBe(257 + index);
      expect(driven(step, 'addr'), `read step ${index}`).toBe(index);
      expect(driven(step, 'load'), `read step ${index}`).toBe(0);
      expect(driven(step, 'd'), `read step ${index}`).toBe(~expectedOut(step) & 0xff);
      expect(driven(step, 'd')).not.toBe(expectedOut(step));
    }
    expect(new Set(read.map((step) => driven(step, 'addr'))).size).toBe(256);
    // Read back what was written, address by address.
    for (let addr = 0; addr < 256; addr += 1) {
      expect(expectedOut(read[addr]!), `address ${addr}`).toBe(driven(write[addr]!, 'd'));
    }
  });
});

describe('every level carries its sourced-vs-authored data comment', () => {
  /**
   * The compendium fixes a name, an order and a one-line concept per level and
   * nothing else, so every port, width, check, target and reward in this file is
   * this replica's design. The data comment on each level has to say which is
   * which, and a reviewer checks the wording by reading; this checks that the
   * marker block exists at all, so a later batch cannot quietly drop it, plus
   * the four notes this batch owes.
   */
  const source = readFileSync(
    new URL('../../src/levels/content/ch2/batch4.ts', import.meta.url),
    'utf8',
  );

  /** Data comment -> level id, for every doc comment followed by a level literal. */
  const comments = new Map<string, string>();
  for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\/\s*\{\s*id: '([^']+)'/g)) {
    const [, body, id] = match;
    if (body !== undefined && id !== undefined) comments.set(id, body);
  }

  for (const level of CH2_BATCH4) {
    it(level.id, () => {
      const comment = comments.get(level.id) ?? '';
      expect(comment.length, `${level.id} has no data comment`).toBeGreaterThan(0);
      expect(comment, `${level.id} does not record what is sourced`).toContain('SOURCED');
      expect(comment, `${level.id} does not record what is authored`).toContain('AUTHORED');
    });
  }

  it('records that level 30 asserts periodicity, and why one tick would not', () => {
    const l30 = comments.get('ch2-30-odd-ticks') ?? '';
    expect(l30).toContain('构建振荡电路（时钟信号发生器）');
    expect(l30).toContain('周期');
    expect(l30).toContain('periodicity');
    // The source gives no period, no duty cycle and no gating rule; the comment
    // has to say that the period and the hold are this replica's design.
    expect(l30).toContain('AUTHORED');
  });

  it("records that level 34 changes the source level's kind, and why", () => {
    // Spec 3.1 forbids a bus protocol (multi-driver arbitration), so the
    // source's concept is NOT computable as written: the comment has to say
    // that, name the spec section, quote the source's own words for the
    // concept, and state what the level teaches instead.
    const l34 = comments.get('ch2-34-the-bus') ?? '';
    expect(l34).toContain('共享数据传输线路的概念');
    expect(l34).toContain('多驱动仲裁');
    expect(l34).toContain('3.1');
    expect(l34).toContain('kind');
    expect(l34).toContain('driver selection');
  });

  it("records level 37's definition of 装满, because the source has none", () => {
    const l37 = comments.get('ch2-37-little-box') ?? '';
    expect(l37).toContain('刚好装满存储空间的电路设计');
    expect(l37).toContain('256');
    expect(l37).toContain('addressable');
    // The definition has to be this replica's and be presented as such.
    expect(l37).toContain('AUTHORED');
    expect(l37).toContain('defines');
  });

  it("records level 38's achievement without turning it into a pass condition", () => {
    // The source's note is 成就：≤ 65 个门 -- a count of basic logic gates, in the
    // source's own metric. This replica's `gate` is NAND equivalents, so the
    // comment records the source's number and says what it is NOT, exactly as
    // batch 2 recorded level 21's five components and level 22's delay of 35.
    const l38 = comments.get('ch2-38-counter') ?? '';
    expect(l38).toContain('成就：≤ 65 个门');
    expect(l38).toContain('achievement, not a pass condition');
    expect(l38).toContain('NAND');
    expect(l38).toContain('threeStar.gate');
  });

  it('records the script tick semantics that decide how these levels are authored', () => {
    // The one thing in this batch a reader cannot guess from the level data: a
    // step's inputs are written and settled BEFORE its tick advances, so an
    // expectation reads the value that edge just sampled, and only a second step
    // at the same tick shows a value being held.
    const module = source.slice(0, source.indexOf('export const CH2_BATCH4'));
    expect(module).toContain('runChecks');
    expect(module).toContain('ABSOLUTE');
    expect(module).toContain('SAME tick');
  });
});

// ---------------------------------------------------------------------------
// Reference solutions
// ---------------------------------------------------------------------------

/**
 * Level 28's reference: the loop, closed through a Delay Line.
 *
 * `next = (set AND value) OR (NOT set AND out)`, with `out` the Delay Line's
 * published state -- deliberately built from two Switches rather than an AND
 * plus a NOT plus an AND, because the Switch is one delay unit while the AND
 * cell is two, and the carry path through `set` is what sets this level's delay
 * (the `switch` is offered on this level).
 *
 * Measured: `not` (1) + two `switch` (2 each) + `or` (3) = 8 NAND equivalents on
 * a path three components deep, with the Delay Line free on both metrics. The
 * graph really does contain a feedback loop -- `validateGraph` reports it as a
 * warning -- which is what makes this reference the one the level's stability
 * assertion is about.
 */
function circularDependencyReference(): Graph {
  return build([
    { kind: 'input', name: 'set' },
    { kind: 'input', name: 'value' },
    { kind: 'part', def: 'not', id: 'nset', from: ['set'] },
    { kind: 'part', def: 'switch', id: 'take', from: ['value', 'set'] },
    { kind: 'part', def: 'switch', id: 'hold', from: ['d', 'nset'] },
    { kind: 'part', def: 'or', id: 'next', from: ['take', 'hold'] },
    { kind: 'part', def: 'delay_line', id: 'd', from: ['next'] },
    { kind: 'output', from: 'd' },
  ]);
}

/** The packaged version of the same latch: `mem1`, whose pins are this level's. */
function mem1Latch(): Graph {
  return build([
    { kind: 'input', name: 'set' },
    { kind: 'input', name: 'value' },
    { kind: 'part', def: 'mem1', id: 'm', from: ['set', 'value'] },
    { kind: 'output', from: 'm' },
  ]);
}

/** Level 29's reference: the 8-bit Delay Line this level hands out. */
function delayedLinesReference(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'delay8', id: 'd', from: ['a'] },
    { kind: 'output', width: 8, from: 'd' },
  ]);
}

/** The same one-tick delay built from eight 1-bit delay lines. */
function eightOneBitDelays(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
  ];
  for (let bit = 0; bit < 8; bit += 1) {
    nodes.push({ kind: 'part', def: 'delay_line', id: `d${bit}`, from: [`sp.b${bit}`] });
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('d') });
  nodes.push({ kind: 'output', width: 8, from: 'mk' });
  return build(nodes);
}

/** The same one-tick delay spelled with the register this level hands out. */
function reg8AsDelay(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'const_on', id: 'one', from: [] },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'reg8', id: 'r', from: ['a', 'one', 'z'] },
    { kind: 'output', width: 8, from: 'r' },
  ]);
}

/**
 * Level 30's reference: the clock source.
 *
 * `next = out XOR enable` fed back into a 1-Bit Memory whose `set` is tied high,
 * so every edge samples it. XOR with 1 is "invert", XOR with 0 is "keep", so the
 * same gate is both the oscillation and the gate -- which is why the level costs
 * one XOR (4 NAND equivalents, one delay unit deep) and nothing else.
 */
function oddTicksReference(): Graph {
  return build([
    { kind: 'input', name: 'enable' },
    { kind: 'part', def: 'const_on', id: 'one', from: [] },
    { kind: 'part', def: 'mem1', id: 'm', from: ['one', 'next'] },
    { kind: 'part', def: 'xor', id: 'next', from: ['m', 'enable'] },
    { kind: 'output', from: 'm' },
  ]);
}

/** Level 31's reference: one XOR is conditional inversion. */
function bitInverterReference(): Graph {
  return build([
    { kind: 'input', name: 'a' },
    { kind: 'input', name: 'inv' },
    { kind: 'part', def: 'xor', id: 'x', from: ['a', 'inv'] },
    { kind: 'output', from: 'x' },
  ]);
}

/**
 * The same function spelled as a sum of products: `(a AND NOT inv) OR (NOT a AND
 * inv)`.
 *
 * Measured: three gates in the path (NOT -> AND -> OR: 1 + 2 + 3 = 9 NAND
 * equivalents), which is correct and one star. This is the honest "correct but
 * more expensive" alternative for this level: `xnor(a, inv)` is NOT one, because
 * XNOR is the complement of the function the level asks for.
 */
function sumOfProductsInverter(): Graph {
  return build([
    { kind: 'input', name: 'a' },
    { kind: 'input', name: 'inv' },
    { kind: 'part', def: 'not', id: 'na', from: ['a'] },
    { kind: 'part', def: 'not', id: 'ninv', from: ['inv'] },
    { kind: 'part', def: 'and', id: 'keep', from: ['a', 'ninv'] },
    { kind: 'part', def: 'and', id: 'flip', from: ['na', 'inv'] },
    { kind: 'part', def: 'or', id: 'out', from: ['keep', 'flip'] },
    { kind: 'output', from: 'out' },
  ]);
}

/** Level 32's reference: one AND is the conditional pass. */
function bitSwitchReference(): Graph {
  return build([
    { kind: 'input', name: 'a' },
    { kind: 'input', name: 'on' },
    { kind: 'part', def: 'and', id: 'g', from: ['a', 'on'] },
    { kind: 'output', from: 'g' },
  ]);
}

/** The chapter's own part for the same circuit: the 1-bit Switch. */
function switchPart(): Graph {
  return build([
    { kind: 'input', name: 'a' },
    { kind: 'input', name: 'on' },
    { kind: 'part', def: 'switch', id: 's', from: ['a', 'on'] },
    { kind: 'output', from: 's' },
  ]);
}

/** Level 33's and level 34's reference: the 8-Bit Multiplexer. */
function selectorReference(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'input', name: 'sel' },
    { kind: 'part', def: 'mux8', id: 'm', from: ['a', 'b', 'sel'] },
    { kind: 'output', width: 8, from: 'm' },
  ]);
}

/**
 * The same selection built from gates: three NANDs per bit, plus the ONE
 * inverter of `sel` they all share.
 *
 * Measured: 8 x 3 NANDs + 1 NOT = 25 NAND equivalents on a path three components
 * deep. A NAND is one NAND equivalent, so a shared inverter really is shared --
 * which makes this CHEAPER on gates than the `mux8` part's own documented cell
 * (32, which prices an inverter per bit) and still one star, because the part is
 * one node and this is three. The measurement is asserted in `the targets
 * separate the constructions they were measured against`.
 */
function gateBuiltSelector(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'input', name: 'sel' },
    { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
    { kind: 'part', def: 'splitter', id: 'sb', from: ['b'] },
    { kind: 'part', def: 'not', id: 'nsel', from: ['sel'] },
  ];
  for (let bit = 0; bit < 8; bit += 1) {
    nodes.push({ kind: 'part', def: 'nand', id: `na${bit}`, from: [`sa.b${bit}`, 'nsel'] });
    nodes.push({ kind: 'part', def: 'nand', id: `nb${bit}`, from: [`sb.b${bit}`, 'sel'] });
    nodes.push({ kind: 'part', def: 'nand', id: `o${bit}`, from: [`na${bit}`, `nb${bit}`] });
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('o') });
  nodes.push({ kind: 'output', width: 8, from: 'mk' });
  return build(nodes);
}

/** Level 35's reference: the 1-Bit Memory, whose `set` is the load enable. */
function savingGracefullyReference(): Graph {
  return build([
    { kind: 'input', name: 'd' },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'mem1', id: 'm', from: ['load', 'd'] },
    { kind: 'output', from: 'm' },
  ]);
}

/**
 * Level 35's hand-built alternative: the same loop level 28's reference builds,
 * wired to this level's pin names (`d` / `load`).
 *
 * Correct, and one star: this level offers the packaged 1-Bit Memory, whose own
 * metrics (0/0) are the target, so the loop costs its own gates. That is the
 * chapter's storage ruling, measured rather than asserted.
 */
function savingGracefullyByLoop(): Graph {
  return build([
    { kind: 'input', name: 'd' },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'not', id: 'nload', from: ['load'] },
    { kind: 'part', def: 'switch', id: 'take', from: ['d', 'load'] },
    { kind: 'part', def: 'switch', id: 'hold', from: ['dl', 'nload'] },
    { kind: 'part', def: 'or', id: 'next', from: ['take', 'hold'] },
    { kind: 'part', def: 'delay_line', id: 'dl', from: ['next'] },
    { kind: 'output', from: 'dl' },
  ]);
}

/** Level 36's reference: the 8-Bit Register this level's reward list introduces. */
function savingBytesReference(): Graph {
  return build([
    { kind: 'input', name: 'd', width: 8 },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'reg8', id: 'r', from: ['d', 'load', 'z'] },
    { kind: 'output', width: 8, from: 'r' },
  ]);
}

/** The same byte-wide conditional write, one 1-Bit Memory per bit. */
function eightOneBitMemories(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'd', width: 8 },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'splitter', id: 'sp', from: ['d'] },
  ];
  for (let bit = 0; bit < 8; bit += 1) {
    nodes.push({ kind: 'part', def: 'mem1', id: `m${bit}`, from: ['load', `sp.b${bit}`] });
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('m') });
  nodes.push({ kind: 'output', width: 8, from: 'mk' });
  return build(nodes);
}

/** Level 37's reference: the 256-byte RAM, which is the whole little box. */
function littleBoxReference(): Graph {
  return build([
    { kind: 'input', name: 'd', width: 8 },
    { kind: 'input', name: 'addr', width: 8 },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'ram8', id: 'm', from: ['d', 'addr', 'load'] },
    { kind: 'output', width: 8, from: 'm' },
  ]);
}

/**
 * Level 38's reference: the register plus a hand-built incrementer.
 *
 * `bit0 = NOT x0`, `bit_i = x_i XOR c_i`, `c_(i+1) = x_i AND c_i` with `c_1 = x0`;
 * the last carry is never needed because there is no carry-out pin. That is one
 * NOT, seven XORs and six ANDs -- measured 41 NAND equivalents on a path seven
 * components deep -- wired into the register's `d`, with `en` on `load` and the
 * level's `reset` on `reset` (so `reset` beats `en` by the register's own rule,
 * with no extra gate).
 */
function counterReference(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'en' },
    { kind: 'input', name: 'reset' },
    { kind: 'part', def: 'reg8', id: 'r', from: ['mk', 'en', 'reset'] },
    { kind: 'part', def: 'splitter', id: 'sp', from: ['r'] },
    { kind: 'part', def: 'not', id: 'b0', from: ['sp.b0'] },
  ];
  const outBits = ['b0'];
  let carry = 'sp.b0';
  for (let bit = 1; bit < 8; bit += 1) {
    nodes.push({ kind: 'part', def: 'xor', id: `b${bit}`, from: [`sp.b${bit}`, carry] });
    outBits.push(`b${bit}`);
    if (bit < 7) {
      nodes.push({ kind: 'part', def: 'and', id: `c${bit}`, from: [`sp.b${bit}`, carry] });
      carry = `c${bit}`;
    }
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: outBits });
  nodes.push({ kind: 'output', width: 8, from: 'r' });
  return build(nodes);
}

/** The same counter with the byte adder doing the increment: 72 gates, one deep. */
function adderCounter(): Graph {
  return build([
    { kind: 'input', name: 'en' },
    { kind: 'input', name: 'reset' },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'const_on', id: 'one', from: [] },
    { kind: 'part', def: 'add8', id: 'inc', from: ['r', 'z', 'one'] },
    { kind: 'part', def: 'reg8', id: 'r', from: ['inc', 'en', 'reset'] },
    { kind: 'output', width: 8, from: 'r' },
  ]);
}

/** The packaged counter, which level 38's palette withholds (measured, not offered). */
function counterPart(): Graph {
  return build([
    { kind: 'input', name: 'en' },
    { kind: 'input', name: 'reset' },
    { kind: 'part', def: 'counter8', id: 'c', from: ['en', 'reset'] },
    { kind: 'output', width: 8, from: 'c' },
  ]);
}

const solutions: Record<string, () => Graph> = {
  'ch2-28-circular-dependency': circularDependencyReference,
  'ch2-29-delayed-lines': delayedLinesReference,
  'ch2-30-odd-ticks': oddTicksReference,
  'ch2-31-bit-inverter': bitInverterReference,
  'ch2-32-bit-switch': bitSwitchReference,
  'ch2-33-input-selector': selectorReference,
  'ch2-34-the-bus': selectorReference,
  'ch2-35-saving-gracefully': savingGracefullyReference,
  'ch2-36-saving-bytes': savingBytesReference,
  'ch2-37-little-box': littleBoxReference,
  'ch2-38-counter': counterReference,
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
  // its own reference does not score exactly, in either direction. For this
  // batch that is also the only check on the `tick` column, which every level
  // here scores as the last tick its own script drives.
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
// Stability: level 28
// ---------------------------------------------------------------------------

/** The textbook latch with no storage element in it: a purely combinational ring. */
function crossCoupledNorLatch(): Graph {
  return build([
    { kind: 'input', name: 'set' },
    { kind: 'input', name: 'value' },
    { kind: 'part', def: 'not', id: 'nvalue', from: ['value'] },
    { kind: 'part', def: 'and', id: 's', from: ['set', 'value'] },
    { kind: 'part', def: 'and', id: 'r', from: ['set', 'nvalue'] },
    { kind: 'part', def: 'nor', id: 'q', from: ['r', 'qb'] },
    { kind: 'part', def: 'nor', id: 'qb', from: ['s', 'q'] },
    { kind: 'output', from: 'q' },
  ]);
}

/** The smallest ring there is: one NOT feeding itself. */
function notRing(): Graph {
  return build([
    { kind: 'input', name: 'set' },
    { kind: 'input', name: 'value' },
    { kind: 'part', def: 'not', id: 'n', from: ['n'] },
    { kind: 'output', from: 'n' },
  ]);
}

/** A ring of two NOTs, the other shape a player reaches for first. */
function doubleNotRing(): Graph {
  return build([
    { kind: 'input', name: 'set' },
    { kind: 'input', name: 'value' },
    { kind: 'part', def: 'not', id: 'n1', from: ['n2'] },
    { kind: 'part', def: 'not', id: 'n2', from: ['n1'] },
    { kind: 'output', from: 'n2' },
  ]);
}

describe('level 28 asserts both sides of the loop', () => {
  it('settles its reference, which really does contain a feedback loop', () => {
    // The settling side. The reference is not a packaged part sitting outside
    // the loop: `validateGraph` sees the cycle, and `reset()` -- which runs the
    // settle loop -- completes without throwing.
    const graph = circularDependencyReference();
    const issues = validateGraph(graph, registry);
    expect(
      issues.some((issue) => issue.code === 'feedback-loop'),
      'the reference has no feedback loop, so this level asserts nothing about loops',
    ).toBe(true);
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);

    const sim = new Simulation(compile(graph, registry), registry);
    expect(() => sim.reset()).not.toThrow();
    expect(() => sim.settle()).not.toThrow();
    expect(grade(graph, registry, specOf('ch2-28-circular-dependency')).passed).toBe(true);
  });

  for (const [name, make] of [
    ['a cross-coupled NOR latch with no storage in it', crossCoupledNorLatch],
    ['a NOT feeding itself', notRing],
    ['two NOTs in a ring', doubleNotRing],
  ] as const) {
    it(`throws UnstableCircuitError on ${name}`, () => {
      // The other side, and the one a level like this exists to teach: the
      // kernel's own error, raised by `settle`, not a check failure that could
      // be produced some other way.
      const graph = make();
      expect(validateGraph(graph, registry).filter((i) => i.severity === 'error')).toEqual([]);
      const sim = new Simulation(compile(graph, registry), registry);
      expect(() => sim.reset()).toThrow(UnstableCircuitError);

      // And the level records it as a failed check with the `unstable` reason,
      // rather than letting the throw escape the grading path.
      const failures = failuresOf(make, specOf('ch2-28-circular-dependency'));
      expect(failures.some((failure) => failure.reason === 'unstable')).toBe(true);
    });
  }

  it('accepts the packaged latch the palette withholds, and says it is cheaper', () => {
    // `mem1`'s pins ARE this level's pins, so it passes -- measured here rather
    // than left as a claim, and the level's palette does not list it (see the
    // level's comment): this board is where the loop is built, level 35 is where
    // the part is used.
    const result = grade(mem1Latch(), registry, specOf('ch2-28-circular-dependency'));
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.stars).toBe(3);
    expect(result.metrics).toEqual({ gate: 0, delay: 0, tick: 4 });
    expect(specOf('ch2-28-circular-dependency').allowedComponents).not.toContain('mem1');
  });
});

// ---------------------------------------------------------------------------
// The fuzz level: level 33
// ---------------------------------------------------------------------------

/**
 * Grades `make()` against `level` with its output function wrapped to record
 * every vector the kernel drives, in round order (batch 3's helper, used here
 * for the one fuzz level in this batch).
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

describe("level 33's 256 rounds exercise both select values", () => {
  it('draws both sel values many times over, in the same sequence every run', () => {
    const once = captureRound(L33, solutions['ch2-33-input-selector']!).seen;
    const twice = captureRound(L33, solutions['ch2-33-input-selector']!).seen;
    expect(once).toHaveLength(256);
    expect(twice).toEqual(once);
    const lows = once.filter((v) => (v.sel ?? 0) === 0).length;
    const highs = once.filter((v) => (v.sel ?? 0) === 1).length;
    // Both branches of the mux are exercised well beyond a lucky draw, which is
    // what makes the level's check a test of `sel` and not just of the operands.
    expect(lows, `sel=0 appears ${lows} times`).toBeGreaterThan(50);
    expect(highs, `sel=1 appears ${highs} times`).toBeGreaterThan(50);
    expect(lows + highs).toBe(256);
    expect(new Set(once.map((v) => JSON.stringify(v))).size).toBeGreaterThan(100);
  });

  it('grades the expectation function the brief states, on hand-picked vectors', () => {
    const out = expectation(L33, 'out');
    expect(out(vector({ a: 0x12, b: 0x34, sel: 0 }))).toBe(0x12);
    expect(out(vector({ a: 0x12, b: 0x34, sel: 1 }))).toBe(0x34);
    // Nothing is OR-ed or AND-ed together: the unselected line does not leak a
    // single 1 through.
    expect(out(vector({ a: 0xff, b: 0x00, sel: 1 }))).toBe(0x00);
    expect(out(vector({ a: 0x00, b: 0xff, sel: 0 }))).toBe(0x00);
  });

  it('names the round and the vector the unselected line fails on', () => {
    // `out <- a` is the plausible wrong circuit: right whenever `sel` is low.
    const alwaysA = (): Graph =>
      build([
        { kind: 'input', name: 'a', width: 8 },
        { kind: 'input', name: 'b', width: 8 },
        { kind: 'input', name: 'sel' },
        { kind: 'output', width: 8, from: 'a' },
      ]);
    const { failures, seen } = captureRound(L33, alwaysA);
    expect(failures).toHaveLength(1);
    const failure = failures[0]!;
    const firstBad = seen.findIndex((v) => (v.sel ?? 0) === 1);
    expect(firstBad).toBeGreaterThanOrEqual(0);
    expect(failure.reason).toBe('mismatch');
    expect(failure.round).toBe(firstBad);
    expect(failure.inputs).toEqual(seen[firstBad]);
    expect(failure.expected).toEqual({ out: seen[firstBad]?.b ?? 0 });
    expect(failure.actual).toEqual({ out: seen[firstBad]?.a ?? 0 });
    expect(failure.detail).toContain(`round ${firstBad}`);
  });
});

// ---------------------------------------------------------------------------
// Counterexamples
// ---------------------------------------------------------------------------

/** Two ticks of delay where the level asks for one. */
function twoTicksOfDelay(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'delay8', id: 'd1', from: ['a'] },
    { kind: 'part', def: 'delay8', id: 'd2', from: ['d1'] },
    { kind: 'output', width: 8, from: 'd2' },
  ]);
}

/** The oscillator with no gate on it: it flips whatever `enable` says. */
function freeRunningOscillator(): Graph {
  return build([
    { kind: 'input', name: 'enable' },
    { kind: 'part', def: 'const_on', id: 'one', from: [] },
    { kind: 'part', def: 'mem1', id: 'm', from: ['one', 'next'] },
    { kind: 'part', def: 'not', id: 'next', from: ['m'] },
    { kind: 'output', from: 'm' },
  ]);
}

/** The clock source that never ticks at all. */
function stuckLowOscillator(): Graph {
  return build([
    { kind: 'input', name: 'enable' },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'output', from: 'z' },
  ]);
}

/** OR where the level asks for the conditional inversion. */
function orInsteadOfXor(): Graph {
  return build([
    { kind: 'input', name: 'a' },
    { kind: 'input', name: 'inv' },
    { kind: 'part', def: 'or', id: 'g', from: ['a', 'inv'] },
    { kind: 'output', from: 'g' },
  ]);
}

/** OR where the level asks for the conditional pass. */
function orInsteadOfAnd(): Graph {
  return build([
    { kind: 'input', name: 'a' },
    { kind: 'input', name: 'on' },
    { kind: 'part', def: 'or', id: 'g', from: ['a', 'on'] },
    { kind: 'output', from: 'g' },
  ]);
}

/** The bus always driven by the second line, whatever `sel` says. */
function alwaysB(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'input', name: 'sel' },
    { kind: 'output', width: 8, from: 'b' },
  ]);
}

/** A latch that samples every edge: `load` is not consulted. */
function alwaysLoading(): Graph {
  return build([
    { kind: 'input', name: 'd' },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'const_on', id: 'one', from: [] },
    { kind: 'part', def: 'mem1', id: 'm', from: ['one', 'd'] },
    { kind: 'output', from: 'm' },
  ]);
}

/** A wire where the level asks for a store. */
function bareWire(): Graph {
  return build([
    { kind: 'input', name: 'd', width: 8 },
    { kind: 'input', name: 'load' },
    { kind: 'output', width: 8, from: 'd' },
  ]);
}

/** One byte of storage instead of 256: the address is ignored. */
function registerIgnoringAddr(): Graph {
  return build([
    { kind: 'input', name: 'd', width: 8 },
    { kind: 'input', name: 'addr', width: 8 },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'reg8', id: 'r', from: ['d', 'load', 'z'] },
    { kind: 'output', width: 8, from: 'r' },
  ]);
}

/** A counter that cannot be cleared: the level's `reset` is not wired. */
function counterWithoutReset(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'en' },
    { kind: 'input', name: 'reset' },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'reg8', id: 'r', from: ['mk', 'en', 'z'] },
    { kind: 'part', def: 'splitter', id: 'sp', from: ['r'] },
    { kind: 'part', def: 'not', id: 'b0', from: ['sp.b0'] },
  ];
  const outBits = ['b0'];
  let carry = 'sp.b0';
  for (let bit = 1; bit < 8; bit += 1) {
    nodes.push({ kind: 'part', def: 'xor', id: `b${bit}`, from: [`sp.b${bit}`, carry] });
    outBits.push(`b${bit}`);
    if (bit < 7) {
      nodes.push({ kind: 'part', def: 'and', id: `c${bit}`, from: [`sp.b${bit}`, carry] });
      carry = `c${bit}`;
    }
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: outBits });
  nodes.push({ kind: 'output', width: 8, from: 'r' });
  return build(nodes);
}

/** Circuits a player would plausibly build and that must be rejected. */
const wrong: Record<string, () => Graph> = {
  // A ring with no storage in it: the engine cannot settle it at all.
  'ch2-28-circular-dependency': crossCoupledNorLatch,
  'ch2-29-delayed-lines': twoTicksOfDelay,
  'ch2-30-odd-ticks': freeRunningOscillator,
  'ch2-31-bit-inverter': orInsteadOfXor,
  'ch2-32-bit-switch': orInsteadOfAnd,
  'ch2-33-input-selector': () =>
    build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'input', name: 'b', width: 8 },
      { kind: 'input', name: 'sel' },
      { kind: 'output', width: 8, from: 'a' },
    ]),
  'ch2-34-the-bus': alwaysB,
  'ch2-35-saving-gracefully': alwaysLoading,
  'ch2-36-saving-bytes': bareWire,
  'ch2-37-little-box': registerIgnoringAddr,
  'ch2-38-counter': counterWithoutReset,
};

describe('plausible wrong circuits fail', () => {
  for (const [id, make] of Object.entries(wrong)) {
    it(id, () => {
      failuresOf(make, specOf(id));
    });
  }

  it('fails the ring on `unstable` and names no tick, because nothing settled', () => {
    const failures = failuresOf(notRing, specOf('ch2-28-circular-dependency'));
    expect(failures.map((failure) => failure.reason)).toContain('unstable');
  });

  it('fails the free-running oscillator on the first held tick, not on one beat', () => {
    // Sixteen ticks of alternating output are not evidence of a gated clock: the
    // ungated one satisfies them too. The failure has to land on tick 16, the
    // first tick `enable` is low.
    const failures = failuresOf(freeRunningOscillator, specOf('ch2-30-odd-ticks'));
    const first = failures.find((failure) => failure.tick >= 16);
    expect(first, 'the ungated oscillator was never caught on a held tick').toBeDefined();
    expect(first?.tick).toBe(16);
    expect(first?.expected).toEqual({ out: 1 });
    expect(first?.actual).toEqual({ out: 0 });
  });

  it('fails the clock that never ticks on the very first beat', () => {
    const failures = failuresOf(stuckLowOscillator, specOf('ch2-30-odd-ticks'));
    expect(failures[0]?.tick).toBe(1);
    expect(failures[0]?.expected).toEqual({ out: 1 });
    expect(failures[0]?.actual).toEqual({ out: 0 });
  });

  it('fails the wrong delay on the tick it is one edge short at', () => {
    const failures = failuresOf(twoTicksOfDelay, specOf('ch2-29-delayed-lines'));
    expect(failures[0]?.tick).toBe(1);
    expect(failures[0]?.expected).toEqual({ out: 0x5a });
    expect(failures[0]?.actual).toEqual({ out: 0x00 });
  });

  it('fails the register that ignores the address on the first read-back', () => {
    // The counterexample that makes "full" mean something: one register holds one
    // byte, so the first read of the second pass cannot return what address 0 was
    // written with.
    const failures = failuresOf(registerIgnoringAddr, specOf('ch2-37-little-box'));
    const first = failures[0];
    expect(first?.tick).toBe(257);
    expect(first?.inputs.addr).toBe(0);
    // The read pass drives the complement of the stored byte, so the value the
    // level expects at address 0 is recoverable from `d` -- and the register
    // can only offer the byte address 255 was written with.
    expect(first?.expected).toEqual({ out: ~driven(scriptOf(L37).steps[257]!, 'd') & 0xff });
    expect(first?.actual.out).not.toBe(first?.expected.out);
  });

  it('fails the wire from d at the same step, although every write step passes it', () => {
    // The other shape "full" has to decline, and the one the complement on `d`
    // exists for: `out <- d` satisfies all 256 WRITE steps (the level asserts the
    // byte it just wrote), and cannot satisfy a single read step.
    const passThrough = (): Graph =>
      build([
        { kind: 'input', name: 'd', width: 8 },
        { kind: 'input', name: 'addr', width: 8 },
        { kind: 'input', name: 'load' },
        { kind: 'output', width: 8, from: 'd' },
      ]);
    const failures = failuresOf(passThrough, specOf('ch2-37-little-box'));
    const first = failures[0];
    expect(first?.tick).toBe(257);
    expect(first?.actual.out).toBe(driven(scriptOf(L37).steps[257]!, 'd'));
    expect(first?.expected.out).not.toBe(first?.actual.out);
  });

  it('fails the counter with no reset on the first edge the level resets on', () => {
    const failures = failuresOf(counterWithoutReset, specOf('ch2-38-counter'));
    expect(failures[0]?.tick).toBe(1);
    expect(failures[0]?.inputs).toEqual({ en: 1, reset: 1 });
    expect(failures[0]?.expected).toEqual({ out: 0 });
    expect(failures[0]?.actual).toEqual({ out: 1 });
  });

  it('fails the always-loading latch on the first edge load is low on', () => {
    const failures = failuresOf(alwaysLoading, specOf('ch2-35-saving-gracefully'));
    expect(failures[0]?.tick).toBe(1);
    expect(failures[0]?.expected).toEqual({ out: 0 });
    expect(failures[0]?.actual).toEqual({ out: 1 });
  });
});

describe('an empty circuit fails every level instead of throwing', () => {
  for (const level of CH2_BATCH4) {
    it(level.id, () => {
      const result = grade(build([]), registry, level);
      expect(result.passed).toBe(false);
      expect(result.stars).toBe(0);
      expect(result.failures.length, level.id).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// What each target separates
// ---------------------------------------------------------------------------

describe('what each level accepts, and what that answer costs', () => {
  it('level 29 accepts the register and the eight delay lines at the same price', () => {
    // One 8-bit Delay Line, eight 1-bit ones and a Register with `load` tied high
    // are the same circuit on both metrics -- which is what makes "one tick of
    // delay" the level's lesson rather than a particular part's.
    const level = specOf('ch2-29-delayed-lines');
    for (const [name, make] of [
      ['delay8', delayedLinesReference],
      ['eight delay lines', eightOneBitDelays],
      ['a register with load high', reg8AsDelay],
    ] as const) {
      const result = grade(make(), registry, level);
      expect(result.failures, `${name}: ${JSON.stringify(result.failures)}`).toEqual([]);
      expect(result.metrics, name).toEqual({ gate: 0, delay: 0, tick: 4 });
      expect(result.stars, name).toBe(3);
    }
  });

  it('level 36 accepts eight 1-bit memories for the byte register', () => {
    const level = specOf('ch2-36-saving-bytes');
    const result = grade(eightOneBitMemories(), registry, level);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 0, delay: 0, tick: 6 });
    expect(result.stars).toBe(3);
  });

  it('level 35 accepts the hand-built loop, for one star', () => {
    // The same loop level 28's reference builds, wired to this level's pin names.
    // Correct, and one star, because this level OFFERS the packaged 1-Bit Memory
    // whose own 0/0 is the target: the chapter's ruling is that the unlocked
    // storage part is cheaper than rebuilding it from gates, and this is the
    // measurement that makes the claim a number.
    const result = grade(savingGracefullyByLoop(), registry, specOf('ch2-35-saving-gracefully'));
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 8, delay: 3, tick: 5 });
    expect(result.stars).toBe(1);
  });

  it('level 32 accepts the Switch part it is named after, at the AND price', () => {
    // The chapter's own part for this lesson is a 2-NAND cell, exactly the AND
    // it is built from -- so the level can offer it without loosening anything.
    const level = specOf('ch2-32-bit-switch');
    const withPart = grade(switchPart(), registry, level);
    expect(withPart.failures, JSON.stringify(withPart.failures)).toEqual([]);
    expect(withPart.metrics).toEqual({ gate: 2, delay: 1, tick: 0 });
    expect(withPart.stars).toBe(3);
  });

  it('level 38 measures the packaged counter the palette withholds', () => {
    // Offered, `counter8` would answer this level in one component for 0 gates --
    // which is exactly why it is not offered, and why the level's comment calls
    // the source's "≤ 65 gates" achievement vacuous under a drop-in.
    const level = specOf('ch2-38-counter');
    const result = grade(counterPart(), registry, level);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 0, delay: 0, tick: 263 });
    expect(result.stars).toBe(3);
    expect(level.allowedComponents).not.toContain('counter8');
  });
});

describe('the targets separate the constructions they were measured against', () => {
  it('level 31: the sum-of-products spelling is correct and five gates over', () => {
    // Same function, 9 NAND equivalents against the XOR's 4, on a path three
    // components deep instead of one, so it is a correct answer worth one star. A
    // target every correct answer met would not be measuring the level's own
    // lesson ("an XOR is the cheap conditional inversion").
    const level = specOf('ch2-31-bit-inverter');
    const result = grade(sumOfProductsInverter(), registry, level);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 9, delay: 3, tick: 0 });
    expect(result.stars).toBe(1);
  });

  it('level 33 and 34: the hand-built selector is cheaper on gates and three deep', () => {
    // The measurement worth writing down, because it is not the one a reader
    // expects: a NAND is ONE NAND equivalent, so one shared inverter of `sel`
    // really does cover all eight bits, and three NANDs per bit is 25 gates --
    // fewer than the `mux8` part's own documented 32, which prices an inverter
    // per bit. It still scores one star, and the delay column is what declines
    // it: the part is one node and this is three. The part also wins on score
    // (32 + 4 = 36 against 25 + 12 = 37), so nothing here is denied a
    // construction that meets both bounds.
    for (const id of ['ch2-33-input-selector', 'ch2-34-the-bus']) {
      const result = grade(gateBuiltSelector(), registry, specOf(id));
      expect(result.failures, `${id}: ${JSON.stringify(result.failures)}`).toEqual([]);
      expect(result.metrics, id).toEqual({ gate: 25, delay: 3, tick: 0 });
      expect(result.stars, id).toBe(1);
    }
  });

  it('level 38: the byte adder counts too, for 72 gates and one unit of delay', () => {
    // `add8(x, 0, 1)` is an incrementer, and it is the alternative the level's
    // own `add8` palette entry makes possible: correct, and one star, because the
    // hand-built carry chain is 41 gates. It is DEEPER in gates and SHALLOWER in
    // delay, which is why the level's target states both numbers.
    const result = grade(adderCounter(), registry, specOf('ch2-38-counter'));
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.metrics).toEqual({ gate: 72, delay: 1, tick: 263 });
    expect(result.stars).toBe(1);
  });
});
