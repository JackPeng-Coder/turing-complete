// tsconfig lists only `vitest/globals` in `types`, so Node's ambient types are
// deliberately not in this program. The import is real at runtime (vitest runs
// this file in Node) and the marker assertion below is what reads the batch
// source; the suppression is one line rather than a project-wide `@types/node`
// dependency, exactly as chapter 2's and chapter 4's first batch tests spell it.
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OVERTURE_ISA, assemble } from '../../src/asm/index';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import { levelExpectsProgram, runChecks } from '../../src/levels/checks';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import { CH2_LEVELS } from '../../src/levels/content/ch2/index';
import { CH3_LEVELS } from '../../src/levels/content/ch3/index';
import { CH4_BATCH1 } from '../../src/levels/content/ch4/batch1';
import { CH4_BATCH2 } from '../../src/levels/content/ch4/batch2';
// THE REGISTRATION LINES. `custom/index.ts` is populated by import and
// `levels/checks.ts` deliberately does NOT import the checkers -- it only looks
// ids up -- so the level set that uses one names the import. These two are that
// naming for this batch, and without them every `custom` check below would be a
// `missing-check` failure against a registry nothing had filled.
import '../../src/levels/custom/lock';
import '../../src/levels/custom/maze';
import { grade } from '../../src/levels/grader';
import type { CustomCheck, LevelSpec, ProgramCheck, ProgramStep } from '../../src/levels/spec';
import { registry } from '../fixtures/build';
import { CH4_REFERENCES } from '../fixtures/ch4-references';

/**
 * Chapter 4, levels 53-56 -- the closing four: the loop, the code lock, the mask
 * and the maze.
 *
 * THE BATCH IS TWO SHAPES IN ONE FILE, and the split is the chapter's own. Levels
 * 53 and 55 are STRAIGHT-LINE PROGRAM levels: the level's board is the chapter-3
 * machine, the player's text is read by a `program` check (`from: 'player'`), and
 * the answer is one byte published on `out` on a tick the walk names. Levels 54
 * and 56 are CLOSED-LOOP CUSTOM levels: the player's program is handed to a
 * registered checker (`lock`, `maze`) which resets the board, loads the text
 * itself, drives the level's pins and decides its own verdict and tick count. So
 * this file has two helper families -- `programsOf`/`walksOf`/`lastAssertedTick`
 * for the first, `customOf` for the second -- and every assertion below says
 * which one it is about.
 *
 * WHAT IS THE SAME AS BATCH 1. The board is the level's (`overtureBoard(...)`),
 * the reference programs live in `test/fixtures/ch4-references.ts` and NEVER in
 * the level data (ruling 2: no `source`), grading runs through the real kernel
 * (`runChecks`/`grade`), and `threeStar` is the reference's MEASURED metric
 * rather than an aspiration. The two program levels carry TWO walks on two
 * different vectors (ruling R9), so a program that ignores its input and
 * hard-codes one walk's byte at that walk's tick is still rejected -- the batch
 * test's constant spoofs are that proof, and they are written here as a
 * program `out = byte` from tick T onwards, built by `constantAtTick`.
 *
 * WHAT IS NEW. `halt: false` on the two closed-loop boards (the brief's ruling:
 * the default halt freezes the counter on the first `out`, so a searching or
 * walking program stops on its first guess and both levels become unsolvable);
 * a real maze whose grid is pinned three ways (the level's `params`, the level's
 * brief in both languages, and this file's literal), so changing the pattern
 * without changing the story is red; and the two `custom` counterexamples --
 * a strided search that steps over the secret on 54, and the "always forward"
 * program on 56, which the maze's own R3 ruling requires to fail.
 *
 * THE TWO KNOWN LIMITS, STATED RATHER THAN GLOSSED. On 54 the CPU's `out` is
 * combinational and only published while the instruction writing it is decoded,
 * while `match` is sampled by a DIFFERENT instruction -- so the byte a program
 * samples on `match` is always 0, and the level grades "the secret byte went out
 * within the budget", not "the CPU reacted to `match`". On both custom levels the
 * checker sees a move/guess code only on the tick the CPU is executing the
 * instruction that writes `out`; every other tick reads 0 (stay). Those are facts
 * about the chapter-3 machine, and both levels' briefs say so.
 */

/** The level with this id, or a loud failure rather than an `undefined` cascade. */
function level(id: string): LevelSpec {
  const found = CH4_BATCH2.find((l) => l.id === id);
  if (!found) throw new Error(`no such level in this batch: ${id}`);
  return found;
}

/** The two levels whose every check is a `program` check on the player's text. */
function programLevels(): readonly LevelSpec[] {
  return CH4_BATCH2.filter((spec) => spec.checks.every((check) => check.kind === 'program'));
}

/** The two levels whose every check is one closed-loop `custom` check. */
function customLevels(): readonly LevelSpec[] {
  return CH4_BATCH2.filter((spec) => spec.checks.every((check) => check.kind === 'custom'));
}

/**
 * A program level's program checks or a loud failure. PLURAL: one `program` check
 * is one execution of the player's text, so every program level carries two, on
 * different input vectors (ruling R9).
 */
function programsOf(spec: LevelSpec): readonly ProgramCheck[] {
  const programs = spec.checks.filter((check): check is ProgramCheck => check.kind === 'program');
  if (programs.length === 0 || programs.length !== spec.checks.length) {
    throw new Error(`${spec.id} is not a program level`);
  }
  return programs;
}

/**
 * A custom level's single closed-loop check or a loud failure.
 *
 * ONE, not two: a `custom` check runs the whole puzzle on a `Simulation` of its
 * own and returns one verdict, so two of them would be two games -- and the level
 * data carries exactly one per level here.
 */
function customOf(spec: LevelSpec): CustomCheck {
  const customs = spec.checks.filter((check): check is CustomCheck => check.kind === 'custom');
  if (customs.length !== 1 || customs.length !== spec.checks.length) {
    throw new Error(`${spec.id} is not a one-check custom level`);
  }
  return customs[0]!;
}

/**
 * The reference program filed for a level, or a loud failure.
 *
 * Chapter 4's references are TEXTS -- the board comes from the level itself -- so
 * this is the fixture's `{ program, format }` pair and not a circuit. The pair is
 * handed to `runChecks`/`grade` wrapped as a `PlayerProgram`, exactly as the app
 * wraps the player's buffer.
 */
function referenceOf(spec: LevelSpec): { readonly program: string; readonly format: 'asm' | 'bytes' } {
  const entry = CH4_REFERENCES[spec.id];
  if (entry === undefined) throw new Error(`${spec.id} has no reference program`);
  return entry;
}

/** The level's own starting board, read into a graph, or a loud failure. */
function boardOf(spec: LevelSpec) {
  if (spec.board === undefined) throw new Error(`${spec.id} ships no board`);
  return graphFromBoard(spec.id, spec.board);
}

/** The reference program run against the board its own level ships. */
function runReference(spec: LevelSpec) {
  return runChecks(boardOf(spec), registry, spec, { text: referenceOf(spec).program });
}

/**
 * A program that publishes `byte` on `out` from tick `tick` onwards and reads no
 * input at all: `loadi|byte`, then `move|s0|d1` as many times as it takes to push
 * the `out` instruction to index `tick`, then `move|s0|out`.
 *
 * THE SPOOF IN ONE LINE OF CODE, which is ruling R9's whole argument: with one
 * walk per level a constant built like this answers that walk exactly -- right
 * byte, right tick, held afterwards -- and nothing in the check can tell it from
 * a program that computed the byte. The sibling walk is what refuses it, and the
 * `move|s0|d1` fillers are why the spoof publishes no earlier.
 */
function constantAtTick(byte: number, tick: number): string {
  return [
    `loadi|${byte}`,
    ...Array.from({ length: tick - 1 }, () => 'move|s0|d1'),
    'move|s0|out',
  ].join('\n');
}

/**
 * The tick of every walk's last assertion -- the program levels'
 * `threeStar.tick`, which merges the walks as `Math.max` (ruling 3).
 */
function lastAssertedTick(spec: LevelSpec): number {
  let last = 0;
  for (const check of programsOf(spec)) {
    const asserted = check.steps.filter((step: ProgramStep) => step.expect !== undefined);
    if (asserted.length === 0) throw new Error(`${spec.id} asserts nothing`);
    last = Math.max(last, ...asserted.map((step) => step.tick));
  }
  return last;
}

/** Every walk's `out` bytes: one array per check, in check and step order. */
function walksOf(spec: LevelSpec): readonly (readonly (number | undefined)[])[] {
  return programsOf(spec).map((check) => check.steps.map((step) => step.expect?.out));
}

/**
 * The input byte every step of every walk drives -- one row per walk. The rows
 * are `driveSteps`' contract, not a style rule: a step that omitted `inputs`
 * would clear the very byte the program is supposed to read.
 */
function drivenOf(spec: LevelSpec): readonly (readonly number[])[] {
  return programsOf(spec).map((check) =>
    check.steps.map((step) => {
      const values = Object.values(step.inputs ?? {});
      const value = values[0];
      if (values.length !== 1 || typeof value !== 'number') {
        throw new Error(`${spec.id} step ${step.tick} does not drive exactly one byte`);
      }
      return value;
    }),
  );
}

/** The answer the walk at `index` demands once the program has published it. */
function answerOfWalk(spec: LevelSpec, index: number): number {
  const walk = walksOf(spec)[index] ?? [];
  const answer = walk.find((value) => value !== undefined && value !== 0);
  if (answer === undefined) throw new Error(`${spec.id} walk ${index} never demands an answer`);
  return answer;
}

/** The answer the first walk demands once the program has published it. */
function answerOf(spec: LevelSpec): number {
  return answerOfWalk(spec, 0);
}

/** A custom level's `params` as a record of untrusted data. */
function paramsOf(spec: LevelSpec): Readonly<Record<string, unknown>> {
  const params = customOf(spec).params;
  if (params === undefined) throw new Error(`${spec.id}'s custom check declares no params`);
  return params;
}

/**
 * THE MAZE, as this file pins it. It is a hand-designed 8x7 grid, and it must
 * satisfy the brief's ruling 3 on its own terms:
 *
 *  * single-cell-wide and enclosed -- the whole border is wall and there is no
 *    2x2 block of open cells anywhere, so a corridor is one cell across;
 *  * exactly one `S` and one `G`, on different cells, with a route between them
 *    (the reachability assertion below is the "solvable", not an eyeball);
 *  * the LEFT-hand wall follower -- the reference program's own rule, "left open
 *    then turn left, else ahead open then forward, else turn right" -- reaches
 *    the goal well inside the budget;
 *  * "always forward" does NOT, which is ruling 3(c) and the counterexample the
 *    teeth section drives through a real CPU.
 *
 * THE SHAPE IS A MIRROR, AND THAT IS HOW IT WAS CHOSEN. `custom-maze.test.ts`
 * solves one grid with the RIGHT-hand rule; flipping that grid top to bottom
 * turns a right-hand maze into a left-hand one (a reflection swaps left for
 * right and clockwise for anticlockwise while leaving east and west alone), so
 * the reference program here walks its mirror image of the same route. The
 * arrival is therefore the mirrored ten moves: five east along the top corridor,
 * a right turn at the wall, then four south onto `G`.
 */
const MAZE_GRID: readonly string[] = [
  '########',
  '#S.....#',
  '#.#.##.#',
  '#.#..#.#',
  '#.##.#.#',
  '#....#G#',
  '########',
];

describe('chapter 4 batch 2 - reference programs', () => {
  it('files a reference program for every level in the batch', () => {
    for (const spec of CH4_BATCH2) {
      const reference = referenceOf(spec);
      expect(reference.program.trim(), `${spec.id} reference is empty`).not.toBe('');
      expect(reference.format, `${spec.id} reference is filed under the wrong reader`).toBe('asm');
      if (spec.checks.every((check) => check.kind === 'program')) {
        // A program level's reference is read by the reader its checks declare:
        // a reference written for the other one would not parse the way the
        // player's buffer is graded.
        for (const check of programsOf(spec)) {
          expect(reference.format, `${spec.id} reference is filed under the wrong reader`).toBe(
            check.format ?? 'asm',
          );
        }
      } else {
        // Both closed-loop checkers read the player's buffer as assembly
        // (`loadProgramImage(io, text, 'asm', 'player')`), and `playerProgramFormat`
        // answers 'asm' for a level whose channel is a custom checker. There is
        // no `format` field on the level to disagree with them -- the reader is
        // the checker's -- so the fixture has to carry the matching one.
        expect(spec.checks.map((check) => check.kind), `${spec.id} is not a closed loop`).toEqual([
          'custom',
        ]);
      }
    }
  });

  it('runs every filed reference against the board its level ships', () => {
    for (const spec of CH4_BATCH2) {
      const outcome = runReference(spec);
      expect(
        outcome.passed,
        `${spec.id}: ${outcome.failures.map((f) => f.detail ?? JSON.stringify(f)).join(' | ')}`,
      ).toBe(true);
    }
  });

  it('grades every reference at three stars', () => {
    for (const spec of CH4_BATCH2) {
      const result = grade(boardOf(spec), registry, spec, { text: referenceOf(spec).program });
      expect(result.passed, `${spec.id} did not pass`).toBe(true);
      expect(result.stars, `${spec.id} did not earn three stars`).toBe(3);
    }
  });

  it('pins every three-star target to its reference solution own metrics', () => {
    // A target is the reference's measured score, never a hand-written
    // aspiration. All four levels ship one of the two board shapes the brief
    // measures -- `overtureBoard({ inputId })` and the same board with
    // `halt: false`, which is a 0-cost part either way -- so they state one gate
    // and one delay, 675 and 6, and the tick is the run's own high-water mark:
    // the program levels' last asserted tick, and the custom levels' reported
    // `ticksUsed` (the tick the checker found the secret / the robot stood on
    // `G`).
    for (const spec of CH4_BATCH2) {
      const result = grade(boardOf(spec), registry, spec, { text: referenceOf(spec).program });
      const m = result.metrics;
      expect(m.gate, `${spec.id} gate metric moved off the brief's 675`).toBe(675);
      expect(m.delay, `${spec.id} delay metric moved off the brief's 6`).toBe(6);
      if (spec.checks.every((check) => check.kind === 'program')) {
        expect(m.tick, `${spec.id} tick metric is not its walks' last assertion`).toBe(
          lastAssertedTick(spec),
        );
      }
      expect(spec.threeStar, `${spec.id} states no target`).toBeDefined();
      expect(spec.threeStar, `${spec.id} target is not its reference's metrics`).toEqual({
        gate: m.gate,
        delay: m.delay,
        tick: m.tick,
      });
    }
    // The measured ticks, stated as numbers rather than assumed -- 135 is the
    // long walk's last assertion (n = 10), 590 is the code lock's search
    // reaching 42, 10 is the mask's short walk and 168 is the robot standing on
    // `G`. `grade` above has already proved each equals its level's own metric.
    expect(CH4_BATCH2.map((spec) => spec.threeStar?.tick)).toEqual([135, 590, 10, 168]);
  });

  it('states the answer each program level computes, and where it appears', () => {
    // The walks, read out of the level data: 0 while the machine is still
    // working, the answer on the edge that reveals the `move|sX|out`
    // instruction, and the same byte held afterwards. TWO walks per program
    // level, on two different vectors (ruling R9) -- one walk is one execution
    // and a constant program could imitate it.
    //
    // THE TICKS ARE THE PROGRAM'S OWN SHAPE. Level 53's loop is thirteen
    // instructions long and its exit pass is eleven, so n iterations put the
    // `out` instruction at its index -- 14 -- on tick 13n - 1: 129 for n = 10 and
    // 12 for n = 1. Level 55's program is level 50's five instructions with `and`
    // in place of `add`, so its answer appears on tick 4 like every other
    // five-instruction walk in this chapter.
    expect(walksOf(level('ch4-53-conditional-jumps'))).toEqual([
      [0, 0, 55, 55],
      [0, 0, 1, 1],
    ]);
    expect(walksOf(level('ch4-55-mod-4'))).toEqual([
      [0, 0, 2, 2],
      [0, 0, 3, 3],
    ]);
    // The vectors themselves, repeated at every step of their own walk.
    expect(drivenOf(level('ch4-53-conditional-jumps'))).toEqual([
      [10, 10, 10, 10],
      [1, 1, 1, 1],
    ]);
    expect(drivenOf(level('ch4-55-mod-4'))).toEqual([
      [42, 42, 42, 42],
      [255, 255, 255, 255],
    ]);
    // The semantics the chapter-4 table fixes, recomputed from the vectors the
    // level data itself drives -- the sum 1..n, and the low two bits of the byte
    // -- so moving a walk's input without moving its answer is a red test rather
    // than a comparison of two literals.
    const sumWalks = drivenOf(level('ch4-53-conditional-jumps'));
    sumWalks.forEach((row, index) => {
      const n = row[0]!;
      expect(answerOfWalk(level('ch4-53-conditional-jumps'), index)).toBe(
        ((n * (n + 1)) / 2) & 0xff,
      );
    });
    const maskWalks = drivenOf(level('ch4-55-mod-4'));
    maskWalks.forEach((row, index) => {
      expect(answerOfWalk(level('ch4-55-mod-4'), index)).toBe(row[0]! & 3);
    });
    // And the ticks, read off the same walks rather than trusted: 53's are the
    // long loop and the shortest one, 55's are its five-instruction shape.
    expect(lastAssertedTick(level('ch4-53-conditional-jumps'))).toBe(135);
    expect(lastAssertedTick(level('ch4-55-mod-4'))).toBe(10);
    expect(programsOf(level('ch4-53-conditional-jumps'))[0]?.steps.map((s) => s.tick)).toEqual([
      0, 128, 129, 135,
    ]);
    expect(programsOf(level('ch4-53-conditional-jumps'))[1]?.steps.map((s) => s.tick)).toEqual([
      0, 11, 12, 18,
    ]);
  });

  it('never lets a walk assert one constant', () => {
    // The teeth rule from chapter 3, one channel over: a walk that demanded the
    // same byte at every tick would pass a program that did nothing but hold a
    // constant. Each walk disagrees with itself -- 0 before the answer, the
    // answer after -- so the program has to actually get there.
    for (const spec of programLevels()) {
      for (const walk of walksOf(spec)) {
        const expected = walk.filter((v): v is number => v !== undefined);
        expect(new Set(expected).size, `${spec.id} asserts one constant`).toBeGreaterThan(1);
      }
    }
  });

  it('reads each reference into the bytes the ISA table fixes', () => {
    // Hand-encoded from `asm/isa.ts`'s table (mode in bits [7:6]): `move|inp|dN`
    // is 10_110_NNN, `move|sN|dM` is 10_NNN_MMM, `loadi|K` is 00_KKKKKK, a calc
    // is 01_OOO_000 (add 0, sub 1, and 2, or 3) and a jump is 11_CCC_000 (j 0,
    // jz 1, jnz 2). So an encoding change cannot pass by moving the fixture and
    // the assembler together.
    //
    // LEVEL 53'S LOOP, instruction by instruction: r5 = n; then r1 = r5,
    // r2 = r4, add, r4 = r3 (accumulate), r1 = r5, r0 = 1, r2 = 1, sub,
    // r5 = r3 (count down), r0 = 14, jz (leave when the count reached 0),
    // r0 = 1, j (loop), and finally out = r4.
    const conditionalJumps = assemble(referenceOf(level('ch4-53-conditional-jumps')).program, OVERTURE_ISA);
    expect(conditionalJumps.errors).toEqual([]);
    expect(conditionalJumps.bytes).toEqual([
      0xb5, 0xa9, 0xa2, 0x40, 0x9c, 0xa9, 0x01, 0x82, 0x48, 0x9d, 0x0e, 0xc8, 0x01, 0xc0, 0xa7,
    ]);
    // LEVEL 55'S MASK is level 51's five instructions with `and` (01_010_000)
    // where `add` was: r1 = in, r0 = 3, r2 = 3, r3 = r1 & r2, out = r3.
    const mod4 = assemble(referenceOf(level('ch4-55-mod-4')).program, OVERTURE_ISA);
    expect(mod4.errors).toEqual([]);
    expect(mod4.bytes).toEqual([0xb1, 0x03, 0x82, 0x50, 0x9f]);
    // LEVEL 54'S SEARCH: r5 = 0; loop -- out = r5 (publish the candidate), read
    // `match` into r1, fold it into r3, jump out when it is not zero, otherwise
    // count r5 up by one and loop. The two `loadi|16` at the top of the exit stub
    // are the self-spin the machine's combinational `out` makes unreachable; the
    // bytes are kept because the program is the controller's pre-verified text.
    const codeBreaker = assemble(referenceOf(level('ch4-54-code-breaker')).program, OVERTURE_ISA);
    expect(codeBreaker.errors).toEqual([]);
    expect(codeBreaker.bytes).toEqual([
      0x00, 0x85, 0xaf, 0xb1, 0x00, 0x82, 0x40, 0x10, 0xd0, 0xa9, 0x01, 0x82, 0x40, 0x9d, 0x02,
      0xc0, 0x10, 0xc0,
    ]);
    // LEVEL 56'S WALL FOLLOWER: read the sensors into r4 and, on every pass,
    // jump back to that read (address 0) -- the three `loadi|0` before those
    // `j`s are the T4b correction, and without them the CPU would keep deciding
    // from the first tick's byte. Left open masks 2 and turns left (19), ahead
    // open masks 1 and walks (23), otherwise turn right (13).
    const maze = assemble(referenceOf(level('ch4-56-the-maze')).program, OVERTURE_ISA);
    expect(maze.errors).toEqual([]);
    expect(maze.bytes).toEqual([
      0xb4, 0xa1, 0x02, 0x82, 0x50, 0x13, 0xc8, 0xa1, 0x01, 0x82, 0x50, 0x17, 0xc8, 0x03, 0x87,
      0x00, 0xc0, 0x00, 0xc0, 0x02, 0x87, 0x00, 0xc0, 0x01, 0x87, 0x00, 0xc0,
    ]);
  });

  it('offers every part its own reference board needs', () => {
    for (const spec of CH4_BATCH2) {
      for (const inst of boardOf(spec).instances) {
        expect(
          spec.allowedComponents,
          `${spec.id} reference uses ${inst.def}, which its palette does not offer`,
        ).toContain(inst.def);
      }
    }
  });

  it('names exactly the parts its shipped board needs, and nothing more', () => {
    // The chapter hands out no new parts, so the palette is the board's own
    // parts and not "everything earned": a palette that reached past the
    // machine would be a level inviting parts its reference never names.
    for (const spec of CH4_BATCH2) {
      const boardDefs = [...new Set(boardOf(spec).instances.map((inst) => inst.def))].sort();
      expect([...spec.allowedComponents].sort(), `${spec.id} palette is not its board's parts`).toEqual(
        boardDefs,
      );
    }
  });

  it('ships the machine each level needs: the straight board and the closed-loop one', () => {
    // Chapter 4's board is the import channel (ruling 1), and it is the SAME
    // builder the chapter-3 reference grades against. The only knobs these four
    // turn are the level input's pin id -- each level names the pin its program
    // reads (`n`, `in`, `match`, `sensors`) -- and, for the two closed-loop
    // levels, `halt: false`. The default halt freezes the counter on the first
    // `out`, which is exactly right for 53 and 55 (the answer must stay) and
    // exactly wrong for 54 and 56 (the program must keep searching or walking).
    expect(level('ch4-53-conditional-jumps').board).toEqual(overtureBoard({ inputId: 'n' }));
    expect(level('ch4-54-code-breaker').board).toEqual(
      overtureBoard({ inputId: 'match', halt: false }),
    );
    expect(level('ch4-55-mod-4').board).toEqual(overtureBoard({ inputId: 'in' }));
    expect(level('ch4-56-the-maze').board).toEqual(
      overtureBoard({ inputId: 'sensors', halt: false }),
    );
    // Stated the other way round as well, because "the same board with halt
    // tied low" is the fact the two closed-loop levels depend on: a level that
    // shipped the halting board would look identical in every other assertion
    // here and be unsolvable.
    for (const id of ['ch4-54-code-breaker', 'ch4-56-the-maze']) {
      expect(level(id).board, `${id} ships the halting board`).not.toEqual(
        overtureBoard({ inputId: level(id).io.inputs[0]!.id }),
      );
    }
  });

  it('binds one 8-bit input connector and one 8-bit answer', () => {
    // The names the checker binds by (`IN_<pin>` / `OUT`), and the width the
    // board's connectors actually compile at: chapter 4's io is 8 in, 8 out --
    // including the closed-loop levels, whose `match` and `sensors` are bytes
    // even though the checker only needs 1 and 3 bits of them. Declaring them
    // narrower would fail at `bindLevelIo` and the checker would never run.
    for (const spec of CH4_BATCH2) {
      const graph = boardOf(spec);
      const inputId = `IN_${spec.io.inputs[0]?.id ?? ''}`;
      const input = graph.instances.find((inst) => inst.id === inputId);
      expect(input, `${spec.id} board has no ${inputId}`).toBeDefined();
      expect(input?.def, `${spec.id} ${inputId} is not a level_input`).toBe('level_input');
      expect(input?.params.width, `${spec.id} ${inputId} is not 8 bits`).toBe(8);
      const out = graph.instances.find((inst) => inst.id === 'OUT');
      expect(out, `${spec.id} board has no OUT`).toBeDefined();
      expect(out?.params.width, `${spec.id} OUT is not 8 bits`).toBe(8);
    }
  });

  it('states each closed-loop level\'s tick as the checker\'s own report', () => {
    // The two custom levels' ticks are not the walks' last assertion -- there is
    // no walk -- but the tick the checker itself spent. Re-measured here through
    // `runChecks` so the numbers in `threeStar` are the checker's report and not
    // a second, hand-written copy of it: 590 is the read that finds 42 on level
    // 54 (42 candidates at 14 instructions each), and 168 is the tick the robot
    // steps onto `G` on the maze's tenth move -- nine full 17-instruction passes
    // of the wall follower plus the tenth move's own `out` fourteen ticks into
    // its pass.
    for (const [id, ticks] of [
      ['ch4-54-code-breaker', 590],
      ['ch4-56-the-maze', 168],
    ] as const) {
      const spec = level(id);
      const outcome = runChecks(boardOf(spec), registry, spec, { text: referenceOf(spec).program });
      expect(outcome.passed, `${id} reference did not pass`).toBe(true);
      expect(outcome.ticksUsed, `${id} ticksUsed moved`).toBe(ticks);
      expect(spec.threeStar?.tick, `${id} threeStar.tick is not the checker's report`).toBe(ticks);
    }
  });
});

describe('chapter 4 batch 2 - the checks have teeth', () => {
  /** The sabotaged program per program level, and the wrong byte it must be caught at. */
  const SABOTAGE: Record<
    string,
    { readonly program: string; readonly tick: number; readonly wrong: number }
  > = {
    // ONE BIT FROM THE REFERENCE: the accumulator's `add` (01_000_000) becomes
    // `sub` (01_001_000), so each pass stores count - accumulator instead of
    // count + accumulator. The program runs exactly as long -- the exit still
    // tests the count-down's own r3 -- and publishes 251 for n = 10 where the
    // reference publishes 55. The second walk (n = 1) is unchanged by the
    // sabotage (1 - 0 = 1), which is why the mismatch below is pinned to the
    // long walk's tick.
    'ch4-53-conditional-jumps': {
      program: [
        'move|inp|d5',
        'move|s5|d1',
        'move|s4|d2',
        'sub',
        'move|s3|d4',
        'move|s5|d1',
        'loadi|1',
        'move|s0|d2',
        'sub',
        'move|s3|d5',
        'loadi|14',
        'jz',
        'loadi|1',
        'j',
        'move|s4|out',
      ].join('\n'),
      tick: 129,
      wrong: 251,
    },
    // The mask's one-bit mistake: `or` (01_011_000) instead of `and`
    // (01_010_000), so the program computes in | 3. For the walk's 42 that is
    // 43, and the answer is expected on tick 4 like every five-instruction
    // program in this chapter.
    'ch4-55-mod-4': {
      program: ['move|inp|d1', 'loadi|3', 'move|s0|d2', 'or', 'move|s3|out'].join('\n'),
      tick: 4,
      wrong: 43,
    },
  };

  it('rejects a sabotaged program in every program level', () => {
    for (const spec of programLevels()) {
      const sabotage = SABOTAGE[spec.id];
      expect(sabotage, `${spec.id} has no sabotage case`).toBeDefined();
      const outcome = runChecks(boardOf(spec), registry, spec, { text: sabotage!.program });
      expect(outcome.passed, `${spec.id} passed a program that computes the wrong answer`).toBe(false);
      // The first walk's mismatch at the reveal tick: with two walks the run
      // reports the second walk's too, and pinning `expected` to the first
      // walk's answer keeps this assertion on the walk the numbers above name.
      const mismatch = outcome.failures.find(
        (f) =>
          f.reason === 'mismatch' &&
          f.tick === sabotage!.tick &&
          f.expected.out === answerOf(spec),
      );
      expect(mismatch, `${spec.id} did not report a mismatch at tick ${sabotage!.tick}`).toBeDefined();
      expect(mismatch?.expected).toEqual({ out: answerOf(spec) });
      expect(mismatch?.actual).toEqual({ out: sabotage!.wrong });
    }
  });

  /**
   * THE CONSTANT SPOOF: a program that reads no input at all and publishes one
   * walk's answer on that walk's reveal tick anyway, then holds it.
   *
   * Each one PASSES the walk it was built for -- that is exactly the hole one
   * walk per level leaves open, and the solo run below proves the spoof really
   * does reproduce it -- and must be rejected all the same, because the sibling
   * walk drives a different input and demands different bytes on the same ticks
   * (ruling R9).
   *
   * `walk` names the walk the spoof reproduces; `caught` names the sibling
   * walk's mismatches that stop it (tick, expected byte, actual byte). Level 53
   * is caught twice over: the sibling demands 0 on tick 128 where the spoof
   * already publishes 1, and 55 on tick 129 where the spoof still publishes 1.
   */
  const SPOOF: Record<
    string,
    {
      readonly program: string;
      readonly walk: number;
      readonly caught: readonly {
        readonly tick: number;
        readonly expected: number;
        readonly actual: number;
      }[];
    }
  > = {
    // The shortest walk's answer, 1, is a bare immediate, so a constant can hold
    // it from tick 12 -- the tick that walk reveals on -- with twelve filler
    // moves. That is the whole spoof: no `inp` source anywhere in it.
    'ch4-53-conditional-jumps': {
      program: constantAtTick(1, 12),
      walk: 1,
      caught: [
        { tick: 128, expected: 0, actual: 1 },
        { tick: 129, expected: 55, actual: 1 },
      ],
    },
    // 255 & 3 is 3, and 3 is `loadi|3`: the walk that drives all ones is
    // answered by a constant revealed on tick 4, while the walk that drives 42
    // demands 2 on that same tick.
    'ch4-55-mod-4': {
      program: constantAtTick(3, 4),
      walk: 1,
      caught: [{ tick: 4, expected: 2, actual: 3 }],
    },
  };

  // One test per program level, so the constant spoof's evidence is reported per
  // level rather than stopping at the first one that trips.
  for (const spec of programLevels()) {
    it(`rejects a program that ignores its input and hard-codes the answer on ${spec.id}`, () => {
      const spoof = SPOOF[spec.id];
      expect(spoof, `${spec.id} has no constant spoof`).toBeDefined();
      // It really reads no input: no `move|inp|dN` opcode (10_110_NNN) anywhere
      // in the bytes.
      const image = assemble(spoof!.program, OVERTURE_ISA);
      expect(image.errors, `${spec.id} spoof does not even compile`).toEqual([]);
      expect(
        image.bytes.some((byte) => (byte & 0xf8) === 0xb0),
        `${spec.id} spoof reads the input`,
      ).toBe(false);
      // The walk it was built for it satisfies completely -- running THAT walk
      // alone (the single-walk shape ruling R9 retires) passes, right byte on the
      // reveal tick and held after, with the input ignored throughout.
      const solo = runChecks(
        boardOf(spec),
        registry,
        { ...spec, checks: [programsOf(spec)[spoof!.walk]!] },
        { text: spoof!.program },
      );
      expect(solo.passed, `${spec.id} spoof does not reproduce its own walk`).toBe(true);
      // And the level rejects it anyway: the sibling walk demands other bytes on
      // the same ticks, and a constant cannot answer both.
      const outcome = runChecks(boardOf(spec), registry, spec, { text: spoof!.program });
      expect(outcome.passed, `${spec.id} passed a program that ignores its input`).toBe(false);
      for (const want of spoof!.caught) {
        const caught = outcome.failures.find(
          (f) => f.reason === 'mismatch' && f.tick === want.tick && f.expected.out === want.expected,
        );
        expect(caught, `${spec.id} spoof was not caught at tick ${want.tick}`).toBeDefined();
        expect(caught?.actual).toEqual({ out: want.actual });
      }
    });
  }

  it('rejects an empty program as missing-program on every program level', () => {
    // The ordinary state of a level the player has not typed into yet: a hard
    // failure, not a pass and not a crash. Whitespace is nothing to run either.
    // One record per check -- a vacuum is a vacuum in both walks.
    for (const spec of programLevels()) {
      for (const text of ['', '   ', '\n\t\n']) {
        const outcome = runChecks(boardOf(spec), registry, spec, { text });
        expect(outcome.passed, `${spec.id} passed an empty program`).toBe(false);
        expect(outcome.failures.map((f) => f.reason), `${spec.id} / ${JSON.stringify(text)}`).toEqual([
          'missing-program',
          'missing-program',
        ]);
        for (const f of outcome.failures) expect(f.detail).toContain('player');
      }
    }
  });

  it('reports a corrupted program as invalid, naming its line', () => {
    // One fault, on a line that is not the first: the assembler's refusal has to
    // carry ITS line number, not a constant -- and each check compiles the text
    // on its own, so the refusal is reported once per check.
    for (const spec of programLevels()) {
      const lines = referenceOf(spec).program.trimEnd().split('\n');
      const outcome = runChecks(boardOf(spec), registry, spec, {
        text: [...lines, 'bogus'].join('\n'),
      });
      expect(outcome.passed, `${spec.id} passed a corrupted program`).toBe(false);
      expect(outcome.failures.map((f) => f.reason)).toEqual(['invalid', 'invalid']);
      for (const f of outcome.failures) {
        expect(f.detail).toContain(`program assembly failed at line ${lines.length + 1}`);
      }
    }
  });

  it('rejects an assembly program with a field that does not fit', () => {
    // The assembler analogue of a wrong width: `loadi`'s immediate is six bits,
    // so 99 is not a value the field can carry and the assembler refuses the line
    // rather than truncating it into a different program.
    for (const spec of programLevels()) {
      const outcome = runChecks(boardOf(spec), registry, spec, {
        text: ['# out of range', 'loadi|99'].join('\n'),
      });
      expect(outcome.passed, `${spec.id} passed an immediate that does not fit`).toBe(false);
      expect(outcome.failures.map((f) => f.reason)).toEqual(['invalid', 'invalid']);
      for (const f of outcome.failures) expect(f.detail).toContain('line 2');
    }
  });

  /**
   * THE CODE LOCK'S COUNTEREXAMPLES, on the level the player is handed.
   *
   * The wrong program here is the REFERENCE ITSELF WITH ONE IMMEDIATE CHANGED:
   * the increment at address 10 becomes `loadi|4`, so the search still counts --
   * and still publishes a candidate on every pass -- but its stride steps over
   * 42 (0, 4, 8, ... 40, 44). A checker that passed anything that loops would
   * pass this; the level has to reject it at the budget.
   */
  const STRIDED_SEARCH = [
    'loadi|0',
    'move|s0|d5',
    'move|s5|out',
    'move|inp|d1',
    'loadi|0',
    'move|s0|d2',
    'add',
    'loadi|16',
    'jnz',
    'move|s5|d1',
    'loadi|4',
    'move|s0|d2',
    'add',
    'move|s3|d5',
    'loadi|2',
    'j',
    'loadi|16',
    'j',
  ].join('\n');

  it('rejects a search that steps over the secret on the code lock', () => {
    const spec = level('ch4-54-code-breaker');
    const outcome = runChecks(boardOf(spec), registry, spec, { text: STRIDED_SEARCH });
    expect(outcome.passed, 'the code lock passed a search that never lands on the secret').toBe(false);
    const failure = outcome.failures[0]!;
    expect(failure.reason).toBe('mismatch');
    // THE RECORD THE PANEL RENDERS CARRIES NO SECRET. `truthTable.ts` draws
    // `expected` as a matrix column, so `{ try: 42 }` here would print the code
    // lock's answer as eight bits after the player's first failing run -- the
    // closed-loop search the level exists to be would collapse instead.
    expect(failure.expected).toEqual({});
    expect(JSON.stringify(failure)).not.toContain('42');
    expect(failure.tick).toBe(1024);
    expect(failure.detail).toContain('budget');
  });

  it('rejects a player who has typed nothing on the code lock, and a text that will not run', () => {
    // The vacuum and the corruption, through the checker rather than through the
    // `program` branch: both have to be refusals naming the player's buffer and
    // the offending line, never a board quietly reading zeros.
    const spec = level('ch4-54-code-breaker');
    const empty = runChecks(boardOf(spec), registry, spec, { text: '' });
    expect(empty.passed).toBe(false);
    expect(empty.failures[0]?.reason).toBe('missing-program');
    expect(empty.failures[0]?.detail).toContain('empty');
    expect(empty.ticksUsed).toBe(0);

    const broken = runChecks(boardOf(spec), registry, spec, { text: 'move|nowhere|d1' });
    expect(broken.passed).toBe(false);
    expect(broken.failures[0]?.reason).toBe('invalid');
    expect(broken.failures[0]?.detail).toContain('line 1');
  });

  /**
   * THE MAZE'S R3 COUNTEREXAMPLE, and the reason the grid was designed rather
   * than borrowed: a program that only ever publishes `move = 1` must NOT solve
   * the maze. It cannot -- the top corridor ends in a wall two cells before the
   * goal's column -- and the checker reports the collision at the cell and
   * facing the robot walked into it from.
   *
   * THE PROGRAM IS A FOUR-INSTRUCTION LOOP, which is the honest spelling of
   * "always forward" on a board whose `out` is combinational: `loadi|1`,
   * `move|s0|out`, `loadi|0`, `j`. The CPU publishes 1 only on the tick it is
   * executing the `out` instruction (tick 1 mod 4), so the robot advances one
   * cell on each of those ticks -- five cells east, and the sixth answer drives
   * it into the wall on tick 21.
   */
  const ALWAYS_FORWARD = ['loadi|1', 'move|s0|out', 'loadi|0', 'j'].join('\n');

  it('rejects a program that only walks forward on the maze', () => {
    const spec = level('ch4-56-the-maze');
    const outcome = runChecks(boardOf(spec), registry, spec, { text: ALWAYS_FORWARD });
    expect(outcome.passed, 'the maze passed a program that only ever walks forward').toBe(false);
    const failure = outcome.failures[0]!;
    expect(failure.reason).toBe('mismatch');
    expect(failure.actual).toEqual({ move: 1 });
    expect(failure.tick).toBe(21);
    expect(outcome.ticksUsed).toBe(21);
    expect(failure.detail).toContain('wall');
    expect(failure.detail).toContain('(6,1)');
    expect(failure.detail).toContain('east');
  });

  it('gives up at the budget on a program that only turns on the maze', () => {
    // A robot that only turns is a legal robot -- nothing about turning is an
    // error -- and what it is not is FINISHED, so the budget ends the run. The
    // record names the cell it gave up in and says the last move was applied.
    const spec = level('ch4-56-the-maze');
    const outcome = runChecks(boardOf(spec), registry, spec, {
      text: ['loadi|2', 'move|s0|out', 'loadi|0', 'j'].join('\n'),
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(1024);
    const failure = outcome.failures[0]!;
    expect(failure.reason).toBe('mismatch');
    expect(failure.detail).toContain('budget');
    expect(failure.detail).toContain('(1,1)');
  });

  it('rejects a player who has typed nothing on the maze', () => {
    const spec = level('ch4-56-the-maze');
    const outcome = runChecks(boardOf(spec), registry, spec, { text: '  \n' });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-program');
    expect(outcome.failures[0]?.detail).toContain('empty');
    expect(outcome.ticksUsed).toBe(0);
  });

  it('does not drive the steps after a refusal', () => {
    // A refused program must stop the check: an invalid failure AND a pile of
    // mismatches would tell the player their machine is wrong when their program
    // is. Both program checks refuse before driving anything, so the run's whole
    // record is one refusal per check and no mismatch at all.
    const spec = level('ch4-53-conditional-jumps');
    const outcome = runChecks(boardOf(spec), registry, spec, { text: 'bogus' });
    expect(outcome.failures.map((f) => f.reason)).toEqual(['invalid', 'invalid']);
  });
});

describe('chapter 4 batch 2 - level data', () => {
  it('uses the chapter-4 index range, and closes it', () => {
    expect(CH4_BATCH2.map((l) => l.index)).toEqual([53, 54, 55, 56]);
    expect(CH4_BATCH2.every((l) => l.chapter === 4)).toBe(true);
    expect(CH4_BATCH2.map((l) => l.id)).toEqual([
      'ch4-53-conditional-jumps',
      'ch4-54-code-breaker',
      'ch4-55-mod-4',
      'ch4-56-the-maze',
    ]);
    expect(CH4_BATCH2.map((l) => l.name.zh)).toEqual([
      '条件跳转',
      '道破心机',
      '高速掩码',
      '路在脚下',
    ]);
    expect(CH4_BATCH2.map((l) => l.name.en)).toEqual([
      'Conditional Jumps',
      'Code Breaker',
      'Mod 4',
      'The Maze',
    ]);
    // The two shapes, derived rather than asserted twice: 53 and 55 are program
    // levels, 54 and 56 are the closed-loop ones.
    expect(programLevels().map((l) => l.id)).toEqual([
      'ch4-53-conditional-jumps',
      'ch4-55-mod-4',
    ]);
    expect(customLevels().map((l) => l.id)).toEqual(['ch4-54-code-breaker', 'ch4-56-the-maze']);
  });

  it('rewards nothing: chapter 4 hands out no new parts', () => {
    // The unlock chain ends at level 45 (`halt`); chapter 4's gain is the
    // assembler and the debugger, not another component. A reward here would
    // mean the chain and the palette had drifted.
    expect(CH4_BATCH2.map((l) => l.rewards)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('offers no part that no level at or before it hands out', () => {
    // The whole-set walk holds this rule for every SHIPPED level, and chapter 4's
    // second batch is not joined into `LEVELS` yet -- so this batch states it for
    // its own four levels against chapters 1 through 3 and the first batch.
    const ordered: readonly LevelSpec[] = [
      ...CH1_PART1,
      ...CH1_PART2,
      ...CH2_LEVELS,
      ...CH3_LEVELS,
      ...CH4_BATCH1,
      ...CH4_BATCH2,
    ].filter((spec) => spec.index <= 56);
    for (const [position, spec] of ordered.entries()) {
      if (spec.chapter !== 4 || spec.index < 53) continue;
      const earned = new Set<string>(STARTER_COMPONENTS);
      for (const atOrBefore of ordered.slice(0, position + 1)) {
        for (const def of atOrBefore.rewards?.components ?? []) earned.add(def);
      }
      for (const def of spec.allowedComponents) {
        expect(earned.has(def), `${spec.id} offers ${def}, which no level at or before it rewards`).toBe(
          true,
        );
      }
    }
  });

  it('states the pin shape the chapter fixes: 8 bits in, 8 bits out', () => {
    // `match:8 -> try:8` and `sensors:8 -> move:8` are the brief's own io: the
    // board carries 8-bit connectors, and the checkers validate the names and the
    // minimum widths before they drive anything (`ioIssue`). The pin NAMES are
    // the checkers' contract -- exactly `match`/`try` and `sensors`/`move`, with
    // no extra pin either -- so they are pinned here rather than left to the
    // checker's own tests.
    expect(level('ch4-53-conditional-jumps').io).toEqual({
      inputs: [{ id: 'n', width: 8 }],
      outputs: [{ id: 'out', width: 8 }],
    });
    expect(level('ch4-54-code-breaker').io).toEqual({
      inputs: [{ id: 'match', width: 8 }],
      outputs: [{ id: 'try', width: 8 }],
    });
    expect(level('ch4-55-mod-4').io).toEqual({
      inputs: [{ id: 'in', width: 8 }],
      outputs: [{ id: 'out', width: 8 }],
    });
    expect(level('ch4-56-the-maze').io).toEqual({
      inputs: [{ id: 'sensors', width: 8 }],
      outputs: [{ id: 'move', width: 8 }],
    });
  });

  it('grades the player program and carries no source of its own', () => {
    // Ruling 2: the level data's `source` and the player buffer are two channels
    // that must not feed each other. Every check here reads the player's text --
    // the program levels through `from: 'player'`, the custom levels through the
    // checker -- and a `source` shipped beside one would be dead weight at best
    // and a silent fallback at worst.
    expect(levelExpectsProgram(level('ch4-53-conditional-jumps'))).toBe(true);
    expect(levelExpectsProgram(level('ch4-54-code-breaker'))).toBe(true);
    expect(levelExpectsProgram(level('ch4-55-mod-4'))).toBe(true);
    expect(levelExpectsProgram(level('ch4-56-the-maze'))).toBe(true);

    for (const spec of programLevels()) {
      // TWO checks per program level (ruling R9): two walks, two vectors, one
      // reader.
      expect(spec.checks, `${spec.id} does not carry two program checks`).toHaveLength(2);
      for (const check of programsOf(spec)) {
        expect(check.from, spec.id).toBe('player');
        expect(check.source, `${spec.id} ships a source of its own`).toBeUndefined();
        expect(check.format, `${spec.id} does not read assembly`).toBe('asm');
        expect(check.steps.length, `${spec.id} walk is empty`).toBeGreaterThan(0);
      }
    }
    for (const spec of customLevels()) {
      expect(spec.checks, `${spec.id} does not carry exactly one check`).toHaveLength(1);
      // The `custom` check has no `source` field and no reader of its own: the
      // checker reads the player's buffer as assembly. What it DOES carry is the
      // puzzle's data, and that is pinned level by level below.
      expect(customOf(spec).id, `${spec.id} names the wrong checker`).toBe(
        spec.index === 54 ? 'lock' : 'maze',
      );
    }
  });

  it('drives two independent vectors through every program level, one walk per check', () => {
    // Ruling R9: one `program` check is one execution of the player's text, so
    // one walk pins one (input, answer) pair -- and a program that ignores the
    // input can hard-code exactly that pair. Two checks with DIFFERENT vectors
    // close it: a constant answers both walks the same way and the walks
    // disagree, so the spoof above is caught by whichever walk it was not built
    // for. Each check builds its own Simulation (`runChecks` calls `createSim`
    // per check) and `ticksUsed` merges as `Math.max`.
    for (const spec of programLevels()) {
      const programs = programsOf(spec);
      expect(programs.length, `${spec.id} carries fewer than two program checks`).toBeGreaterThanOrEqual(
        2,
      );
      const vectors = drivenOf(spec).map((row) => row[0]);
      expect(new Set(vectors).size, `${spec.id} walks drive the same input`).toBe(programs.length);
      const answers = walksOf(spec).map((walk) => walk.find((v) => v !== undefined && v !== 0));
      expect(new Set(answers).size, `${spec.id} walks demand the same answer`).toBe(programs.length);
    }
  });

  it("pins the code lock's puzzle data: the secret byte and a budget above the search", () => {
    // Ruling 4: the puzzle's data lives in the level, not in the checker -- a
    // secret byte and a budget. 42 rather than 0, because on a real board the
    // first read of `try` happens before the program has run and a board that
    // has not moved yet publishes 0 (custom-lock.test.ts pins that boundary).
    // The budget is checked against the reference's OWN grade rather than a
    // comparison of two literals: the reference passes, and the ticks it spent
    // have to fit inside the budget -- which is what makes 1024 headroom rather
    // than a number that happens to be big.
    const spec = level('ch4-54-code-breaker');
    const params = paramsOf(spec);
    expect(params).toEqual({ secret: 42, budget: 1024 });
    const outcome = runReference(spec);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBeGreaterThan(0);
    expect(outcome.ticksUsed).toBeLessThan(params.budget as number);
  });

  it("pins the maze's pattern three ways: params, brief and this file", () => {
    // Ruling 3(d): the pattern lives in the level's `params` AND in the level's
    // story, and the batch test holds both to one literal -- so editing the grid
    // without editing the brief (or the other way round) is a red test rather
    // than a level whose story describes a maze it no longer ships.
    const spec = level('ch4-56-the-maze');
    expect(paramsOf(spec).grid).toEqual(MAZE_GRID);
    expect(paramsOf(spec).budget).toBe(1024);
    // No `facing`: the checker's documented default is 'east', which is the
    // direction the reference program's first decision assumes.
    expect(paramsOf(spec).facing).toBeUndefined();
    for (const row of MAZE_GRID) {
      expect(spec.brief.zh, `the zh brief does not show ${row}`).toContain(row);
      expect(spec.brief.en, `the en brief does not show ${row}`).toContain(row);
    }
  });

  it('ships a maze that is enclosed, single-cell-wide and solvable', () => {
    // The three properties ruling 3(a) asks for, asserted rather than eyeballed:
    // the grid is rectangular; the whole border is wall, so nothing walks off the
    // map; no 2x2 block of open cells exists anywhere, so every corridor is one
    // cell across; exactly one `S` and one `G`, on different cells; and a
    // breadth-first walk from `S` reaches `G`, which is what "solvable" means.
    const rows = MAZE_GRID;
    const width = rows[0]!.length;
    const height = rows.length;
    expect(rows.every((row) => row.length === width)).toBe(true);

    const open = (x: number, y: number): boolean => rows[y]![x] !== '#';
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
          expect(rows[y]![x], `the border is not wall at (${x},${y})`).toBe('#');
        }
        if (x + 1 < width && y + 1 < height) {
          const block = [open(x, y), open(x + 1, y), open(x, y + 1), open(x + 1, y + 1)];
          expect(block.filter(Boolean).length, `a 2x2 open block sits at (${x},${y})`).toBeLessThan(4);
        }
      }
    }

    const cells = (cell: string): readonly { x: number; y: number }[] => {
      const found: { x: number; y: number }[] = [];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) if (rows[y]![x] === cell) found.push({ x, y });
      }
      return found;
    };
    const starts = cells('S');
    const goals = cells('G');
    expect(starts).toHaveLength(1);
    expect(goals).toHaveLength(1);
    expect(starts[0]).not.toEqual(goals[0]);

    const start = starts[0]!;
    const seen = new Set<string>([`${start.x},${start.y}`]);
    const queue = [start];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = at.x + dx;
        const y = at.y + dy;
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        if (x < 0 || y < 0 || x >= width || y >= height || !open(x, y)) continue;
        seen.add(key);
        queue.push({ x, y });
      }
    }
    expect(seen.has(`${goals[0]!.x},${goals[0]!.y}`), 'G is not reachable from S').toBe(true);
  });

  it('carries the sourced-vs-authored data comment', () => {
    // The 2.x dossier fixes the names and the concepts; the io, the walks, the
    // boards, the grids and the targets are this replica's design. The marker
    // block is what a reviewer reads to tell the two apart, and this checks it
    // exists for every level in the batch.
    const source = readFileSync(
      new URL('../../src/levels/content/ch4/batch2.ts', import.meta.url),
      'utf8',
    );
    const comments = new Map<string, string>();
    for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\/\s*\{\s*id: '([^']+)'/g)) {
      const [, body, id] = match;
      if (body !== undefined && id !== undefined) comments.set(id, body);
    }
    for (const spec of CH4_BATCH2) {
      const comment = comments.get(spec.id) ?? '';
      expect(comment.length, `${spec.id} has no data comment`).toBeGreaterThan(0);
      expect(comment, `${spec.id} does not record what is sourced`).toContain('SOURCED');
      expect(comment, `${spec.id} does not record what is authored`).toContain('AUTHORED');
    }
  });

  it("says what the code lock's machine cannot do, instead of claiming otherwise", () => {
    // The brief's own limitation, pinned because it is the kind of sentence that
    // quietly becomes a lie: on this machine `out` is published only while the
    // instruction that writes it is decoded, and `match` is sampled by another
    // instruction, so what a program reads on `match` is always 0. Both briefs
    // have to say so -- a hint that promised the CPU reacts to `match` would
    // teach a program that cannot work.
    const spec = level('ch4-54-code-breaker');
    for (const text of [spec.brief.zh, spec.brief.en, spec.hint.zh, spec.hint.en]) {
      expect(text).toContain('match');
    }
    expect(`${spec.brief.zh}${spec.hint.zh}`).toContain('恒为 0');
    expect(`${spec.brief.en}${spec.hint.en}`).toContain('always 0');
  });
});
