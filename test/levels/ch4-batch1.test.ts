// tsconfig lists only `vitest/globals` in `types`, so Node's ambient types are
// deliberately not in this program. The import is real at runtime (vitest runs
// this file in Node) and the marker assertion below is what reads the batch
// source; the suppression is one line rather than a project-wide `@types/node`
// dependency, exactly as chapter 2's batch tests spell it.
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OVERTURE_ISA, assemble, parseImage } from '../../src/asm/index';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import { runChecks } from '../../src/levels/checks';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import { CH2_LEVELS } from '../../src/levels/content/ch2/index';
import { CH3_LEVELS } from '../../src/levels/content/ch3/index';
import { CH4_BATCH1 } from '../../src/levels/content/ch4/batch1';
import { grade } from '../../src/levels/grader';
import type { LevelSpec, ProgramCheck, ProgramStep } from '../../src/levels/spec';
import { registry } from '../fixtures/build';
import { CH4_REFERENCES } from '../fixtures/ch4-references';

/**
 * Chapter 4, levels 50-52 -- the machine the player built in chapter 3, now
 * programmed by the player.
 *
 * The chapter turns both halves of the earlier games around: the CIRCUIT is
 * given (`level.board` ships `overtureBoard({ inputId })`, the same builder the
 * chapter-3 reference grades against) and the PROGRAM is the player's
 * (`from: 'player'`, read from the buffer `runChecks`'s fourth argument). So
 * every assertion below runs the fixture's program through the player channel
 * against the level's own board -- there is no second circuit in this file and
 * no `source` in the level data to lean on (ruling 2), which is also what this
 * file pins.
 *
 * The counterexamples are therefore PROGRAMS, not machines: a sabotaged
 * reference, an empty buffer, a corrupted line, a byte written at the wrong
 * width. Each names the failure reason the checker has to report -- `mismatch`
 * with the tick and both bytes, `missing-program` for the vacuum, `invalid`
 * with the reader's own line number for a text that will not parse.
 */

function level(id: string): LevelSpec {
  const found = CH4_BATCH1.find((l) => l.id === id);
  if (!found) throw new Error(`no such level in this batch: ${id}`);
  return found;
}

/** A level's program check, or a loud failure. */
function programOf(spec: LevelSpec): ProgramCheck {
  const check = spec.checks[0];
  if (check?.kind !== 'program') throw new Error(`${spec.id} has no program check`);
  return check;
}

/**
 * The reference program filed for a level, or a loud failure.
 *
 * Chapter 4's references are TEXTS -- the board comes from the level itself --
 * so this is the fixture's `{ program, format }` pair and not a circuit. The
 * pair is handed to `runChecks`/`grade` wrapped as a `PlayerProgram`, exactly
 * as the app wraps the player's buffer.
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

/** The tick of the walk's last assertion -- the batch's `threeStar.tick`. */
function lastAssertedTick(spec: LevelSpec): number {
  const asserted = programOf(spec).steps.filter((step: ProgramStep) => step.expect !== undefined);
  if (asserted.length === 0) throw new Error(`${spec.id} asserts nothing`);
  return asserted.reduce((max, step) => Math.max(max, step.tick), 0);
}

/** Every `out` byte the walk asserts, in step order. */
function walkOf(spec: LevelSpec): readonly (number | undefined)[] {
  return programOf(spec).steps.map((step) => step.expect?.out);
}

/** The answer a walk demands once the program has published it. */
function answerOf(spec: LevelSpec): number {
  const answer = walkOf(spec).find((value) => value !== undefined && value !== 0);
  if (answer === undefined) throw new Error(`${spec.id} walk never demands an answer`);
  return answer;
}

describe('chapter 4 batch 1 - reference programs', () => {
  it('files a reference program for every level in the batch', () => {
    for (const spec of CH4_BATCH1) {
      const reference = referenceOf(spec);
      expect(reference.program.trim(), `${spec.id} reference is empty`).not.toBe('');
      // The fixture's reader is the reader the LEVEL's check declares: a
      // reference written for the other one would not even parse the same way
      // the player's buffer is graded.
      expect(reference.format, `${spec.id} reference is filed under the wrong reader`).toBe(
        programOf(spec).format ?? 'asm',
      );
    }
  });

  it('runs every filed reference against the board its level ships', () => {
    for (const spec of CH4_BATCH1) {
      const outcome = runReference(spec);
      expect(
        outcome.passed,
        `${spec.id}: ${outcome.failures.map((f) => f.detail ?? JSON.stringify(f)).join(' | ')}`,
      ).toBe(true);
    }
  });

  it('grades every reference at three stars', () => {
    for (const spec of CH4_BATCH1) {
      const result = grade(boardOf(spec), registry, spec, { text: referenceOf(spec).program });
      expect(result.passed, `${spec.id} did not pass`).toBe(true);
      expect(result.stars, `${spec.id} did not earn three stars`).toBe(3);
    }
  });

  it('pins every three-star target to its reference solution own metrics', () => {
    // A target is the reference's measured score, never a hand-written
    // aspiration. All three levels ship the SAME board shape (the chapter-3
    // machine plus one source mux), so they must state one gate and one delay
    // -- 675 and 6 -- and the tick is the walk's own last assertion.
    for (const spec of CH4_BATCH1) {
      const result = grade(boardOf(spec), registry, spec, { text: referenceOf(spec).program });
      const m = result.metrics;
      expect(m.gate, `${spec.id} gate metric moved off the brief's 675`).toBe(675);
      expect(m.delay, `${spec.id} delay metric moved off the brief's 6`).toBe(6);
      expect(m.tick, `${spec.id} tick metric is not its walk's last assertion`).toBe(
        lastAssertedTick(spec),
      );
      expect(spec.threeStar, `${spec.id} states no target`).toBeDefined();
      expect(spec.threeStar, `${spec.id} target is not its reference's metrics`).toEqual({
        gate: m.gate,
        delay: m.delay,
        tick: m.tick,
      });
    }
  });

  it('states the answer each program computes, and where it appears', () => {
    // The three walks, read out of the level data: 0 while the machine is still
    // working, the answer on the edge that reveals the `move|sX|out`
    // instruction, and the same byte held afterwards. The inputs are the ones
    // the steps drive, and the answers are the semantics the chapter-4 table
    // fixes -- (in + 5), (in + 3) and (6r), each taken mod 256.
    expect(walkOf(level('ch4-50-punchcard-programming'))).toEqual([0, 0, 105, 105]);
    expect(walkOf(level('ch4-51-assembly-programming'))).toEqual([0, 0, 103, 103]);
    expect(walkOf(level('ch4-52-circumference'))).toEqual([0, 0, 176, 176]);
    expect((100 + 5) & 0xff).toBe(105);
    expect((100 + 3) & 0xff).toBe(103);
    // 6 * 200 = 1200, and the mod 256 is the level's teaching point: the byte
    // is 176, which is what the reference-program verification measured.
    expect((6 * 200) & 0xff).toBe(176);
  });

  it('never lets a walk assert one constant', () => {
    // The teeth rule from chapter 3, one channel over: a walk that demanded the
    // same byte at every tick would pass a program that did nothing but hold a
    // constant. Each walk disagrees with itself -- 0 before the answer, the
    // answer after -- so the program has to actually get there.
    for (const spec of CH4_BATCH1) {
      const expected = walkOf(spec).filter((v): v is number => v !== undefined);
      expect(new Set(expected).size, `${spec.id} asserts one constant`).toBeGreaterThan(1);
    }
  });

  it('reads each reference into the bytes the ISA table fixes', () => {
    // Hand-encoded from `asm/isa.ts`'s table (mode in bits [7:6]): `move|inp|d1`
    // is 10_110_001, `loadi|5` is 00_000101, `move|s0|d2` is 10_000_010, `add`
    // is 01_000_000, `move|s3|out` is 10_011_111. So an encoding change cannot
    // pass by moving the fixture and the assembler together, and the punchcard
    // level's image reader and the assembler cannot drift apart: level 50's
    // bytes and level 51's assembly are the same five instructions with one
    // immediate changed.
    const bytes50 = parseImage(referenceOf(level('ch4-50-punchcard-programming')).program);
    expect(bytes50.errors).toEqual([]);
    expect(bytes50.bytes).toEqual([0xb1, 0x05, 0x82, 0x40, 0x9f]);
    const bytes51 = assemble(referenceOf(level('ch4-51-assembly-programming')).program, OVERTURE_ISA);
    expect(bytes51.errors).toEqual([]);
    expect(bytes51.bytes).toEqual([0xb1, 0x03, 0x82, 0x40, 0x9f]);
    const bytes52 = assemble(referenceOf(level('ch4-52-circumference')).program, OVERTURE_ISA);
    expect(bytes52.errors).toEqual([]);
    expect(bytes52.bytes).toEqual([0xb1, 0xb2, 0x40, 0x99, 0x40, 0x9a, 0x99, 0x40, 0x9f]);
  });

  it('offers every part its own reference board needs', () => {
    for (const spec of CH4_BATCH1) {
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
    for (const spec of CH4_BATCH1) {
      const boardDefs = [...new Set(boardOf(spec).instances.map((inst) => inst.def))].sort();
      expect([...spec.allowedComponents].sort(), `${spec.id} palette is not its board's parts`).toEqual(
        boardDefs,
      );
    }
  });

  it('ships the chapter-3 machine as its starting board', () => {
    // Ruling 1: the board is the import channel, and it is the SAME builder the
    // chapter-3 reference grades against -- one circuit, two readers. The
    // straight-line levels take the default `halt: true`, and the only knob
    // these three turn is the level input's pin id.
    expect(level('ch4-50-punchcard-programming').board).toEqual(overtureBoard({ inputId: 'in' }));
    expect(level('ch4-51-assembly-programming').board).toEqual(overtureBoard({ inputId: 'in' }));
    expect(level('ch4-52-circumference').board).toEqual(overtureBoard({ inputId: 'r' }));
  });

  it('binds one 8-bit input connector and one 8-bit answer', () => {
    // The names the checker binds by (`IN_<pin>` / `OUT`), and the width the
    // board's connectors actually compile at: the chapter's io is 8 in, 8 out.
    for (const spec of CH4_BATCH1) {
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
});

describe('chapter 4 batch 1 - the checks have teeth', () => {
  /** The sabotaged program per level, and the wrong byte it must be caught at. */
  const SABOTAGE: Record<string, { readonly program: string; readonly tick: number; readonly wrong: number }> = {
    // The constant 5 becomes 4: the program still runs, still publishes on the
    // right tick, and is wrong by exactly the one bit of the immediate.
    'ch4-50-punchcard-programming': {
      program: ['10110001', '00000100', '10000010', '01000000', '10011111'].join('\n'),
      tick: 4,
      wrong: 104,
    },
    // The same shape of mistake in assembly: `loadi|2` makes the answer in + 2.
    'ch4-51-assembly-programming': {
      program: ['move|inp|d1', 'loadi|2', 'move|s0|d2', 'add', 'move|s3|out'].join('\n'),
      tick: 4,
      wrong: 102,
    },
    // THE BUG THE REFERENCE PROGRAMMING NOTES RECORD: the first draft of this
    // program forgot `move|s3|d1` and computed 5r instead of 6r -- measured at
    // r = 9 as 45. The sabotaged text below is that first draft, eight
    // instructions whose `out` instruction lands one tick early.
    'ch4-52-circumference': {
      program: ['move|inp|d1', 'move|inp|d2', 'add', 'move|s3|d1', 'add', 'move|s3|d2', 'add', 'move|s3|out'].join(
        '\n',
      ),
      tick: 8,
      wrong: 232,
    },
  };

  it('rejects a sabotaged program in every level', () => {
    for (const spec of CH4_BATCH1) {
      const sabotage = SABOTAGE[spec.id];
      expect(sabotage, `${spec.id} has no sabotage case`).toBeDefined();
      const outcome = runChecks(boardOf(spec), registry, spec, { text: sabotage!.program });
      expect(outcome.passed, `${spec.id} passed a program that computes the wrong answer`).toBe(false);
      const mismatch = outcome.failures.find(
        (f) => f.reason === 'mismatch' && f.tick === sabotage!.tick && f.expected.out !== undefined,
      );
      expect(mismatch, `${spec.id} did not report a mismatch at tick ${sabotage!.tick}`).toBeDefined();
      expect(mismatch?.expected).toEqual({ out: answerOf(spec) });
      expect(mismatch?.actual).toEqual({ out: sabotage!.wrong });
    }
  });

  it('rejects an empty program as missing-program', () => {
    // The ordinary state of a level the player has not typed into yet: a hard
    // failure, not a pass and not a crash. Whitespace is nothing to run either.
    for (const spec of CH4_BATCH1) {
      for (const text of ['', '   ', '\n\t\n']) {
        const outcome = runChecks(boardOf(spec), registry, spec, { text });
        expect(outcome.passed, `${spec.id} passed an empty program`).toBe(false);
        expect(outcome.failures.map((f) => f.reason), `${spec.id} / ${JSON.stringify(text)}`).toEqual([
          'missing-program',
        ]);
        // The detail names the buffer: "the level ships no program" and "you
        // have not typed one" are different problems for different people.
        expect(outcome.failures[0]?.detail).toContain('player');
      }
    }
  });

  it('refuses a text that compiles to zero bytes', () => {
    // Not the empty buffer -- a comment-only one. Both readers accept it as a
    // legal zero-byte program, and the checker refuses it for the same reason
    // it refuses the vacuum: no instruction would ever execute.
    for (const spec of CH4_BATCH1) {
      const outcome = runChecks(boardOf(spec), registry, spec, { text: '# nothing runnable yet\n' });
      expect(outcome.passed, `${spec.id} passed a zero-byte program`).toBe(false);
      expect(outcome.failures.map((f) => f.reason)).toEqual(['missing-program']);
      expect(outcome.failures[0]?.detail).toContain('zero bytes');
    }
  });

  it('reports a corrupted program as invalid, naming its line', () => {
    // One fault per format, on a line that is not the first: the byte level's
    // reader and the assembler word their refusals differently, and both have
    // to carry THEIR line number -- not a constant.
    const brokenBytes = runChecks(boardOf(level('ch4-50-punchcard-programming')), registry, level('ch4-50-punchcard-programming'), {
      text: ['10110001', '00000101', '00000102'].join('\n'),
    });
    expect(brokenBytes.passed).toBe(false);
    expect(brokenBytes.failures.map((f) => f.reason)).toEqual(['invalid']);
    expect(brokenBytes.failures[0]?.detail).toContain('program image failed at line 3');

    for (const id of ['ch4-51-assembly-programming', 'ch4-52-circumference']) {
      const spec = level(id);
      const lines = referenceOf(spec).program.trimEnd().split('\n');
      const outcome = runChecks(boardOf(spec), registry, spec, {
        text: [...lines, 'bogus'].join('\n'),
      });
      expect(outcome.passed, `${id} passed a corrupted program`).toBe(false);
      expect(outcome.failures.map((f) => f.reason)).toEqual(['invalid']);
      expect(outcome.failures[0]?.detail).toContain(`program assembly failed at line ${lines.length + 1}`);
    }
  });

  it('rejects a machine-code program written at the wrong width', () => {
    // The punchcard format is exactly eight binary digits per line. A line
    // that is short (or long) is not a narrower byte -- it is a refusal, at its
    // own line, before anything is loaded.
    const spec = level('ch4-50-punchcard-programming');
    for (const wrong of ['1011000', '101100011']) {
      const outcome = runChecks(boardOf(spec), registry, spec, {
        text: ['10110001', wrong, '10011111'].join('\n'),
      });
      expect(outcome.passed, `${spec.id} passed the width ${wrong.length}`).toBe(false);
      expect(outcome.failures.map((f) => f.reason)).toEqual(['invalid']);
      expect(outcome.failures[0]?.detail).toContain('program image failed at line 2');
      expect(outcome.failures[0]?.detail).toContain('8 binary digits');
    }
  });

  it('rejects an assembly program with a field that does not fit', () => {
    // The assembly analogue of the wrong width: `loadi`'s immediate is six
    // bits, so 99 is not a value the field can carry and the assembler refuses
    // the line rather than truncating it into a different program.
    for (const id of ['ch4-51-assembly-programming', 'ch4-52-circumference']) {
      const spec = level(id);
      const outcome = runChecks(boardOf(spec), registry, spec, {
        text: ['# out of range', 'loadi|99'].join('\n'),
      });
      expect(outcome.passed, `${id} passed an immediate that does not fit`).toBe(false);
      expect(outcome.failures.map((f) => f.reason)).toEqual(['invalid']);
      expect(outcome.failures[0]?.detail).toContain('line 2');
    }
  });

  it('does not drive the steps after a refusal', () => {
    // A refused program must stop the check: an invalid failure AND a pile of
    // mismatches would tell the player their machine is wrong when their
    // program is.
    const spec = level('ch4-51-assembly-programming');
    const outcome = runChecks(boardOf(spec), registry, spec, { text: 'bogus' });
    expect(outcome.failures.map((f) => f.reason)).toEqual(['invalid']);
  });
});

describe('chapter 4 batch 1 - level data', () => {
  it('uses the chapter-4 index range', () => {
    expect(CH4_BATCH1.map((l) => l.index)).toEqual([50, 51, 52]);
    expect(CH4_BATCH1.every((l) => l.chapter === 4)).toBe(true);
    expect(CH4_BATCH1.map((l) => l.id)).toEqual([
      'ch4-50-punchcard-programming',
      'ch4-51-assembly-programming',
      'ch4-52-circumference',
    ]);
  });

  it('rewards nothing: chapter 4 hands out no new parts', () => {
    // The unlock chain ends at level 45 (`halt`); chapter 4's gain is the
    // assembler and the debugger, not another component. A reward here would
    // mean the chain and the palette had drifted.
    expect(CH4_BATCH1.map((l) => l.rewards)).toEqual([undefined, undefined, undefined]);
  });

  it('offers no part that no level at or before it hands out', () => {
    // The whole-set walk holds this rule for every SHIPPED level, and chapter 4
    // is not joined into `LEVELS` yet -- so this batch states it for its own
    // three levels against chapters 1 through 3 and itself.
    const ordered: readonly LevelSpec[] = [
      ...CH1_PART1,
      ...CH1_PART2,
      ...CH2_LEVELS,
      ...CH3_LEVELS,
      ...CH4_BATCH1,
    ].filter((spec) => spec.index <= 52);
    for (const [position, spec] of ordered.entries()) {
      if (spec.chapter !== 4 || spec.index < 50) continue;
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

  it('gives the three levels one 8-bit input and one 8-bit answer', () => {
    // The board's connectors are 8 bits, so the chapter's io is 8 in and 8 out
    // whatever the bits MEAN -- and the input pin carries the name the
    // reference program reads (`in` for the two arithmetic levels, `r` for the
    // radius whose circumference the third one computes).
    expect(level('ch4-50-punchcard-programming').io).toEqual({
      inputs: [{ id: 'in', width: 8 }],
      outputs: [{ id: 'out', width: 8 }],
    });
    expect(level('ch4-51-assembly-programming').io).toEqual({
      inputs: [{ id: 'in', width: 8 }],
      outputs: [{ id: 'out', width: 8 }],
    });
    expect(level('ch4-52-circumference').io).toEqual({
      inputs: [{ id: 'r', width: 8 }],
      outputs: [{ id: 'out', width: 8 }],
    });
  });

  it('grades the player program and carries no source of its own', () => {
    // Ruling 2: the level data's `source` and the player buffer are two
    // channels that must not feed each other. Every check here reads the
    // player's text -- that is what makes these levels chapter 4 -- and a
    // `source` shipped beside `from: 'player'` would be dead weight at best
    // and a silent fallback at worst.
    expect(CH4_BATCH1.map((l) => l.checks)).toHaveLength(3);
    for (const spec of CH4_BATCH1) {
      const check = programOf(spec);
      expect(spec.checks, `${spec.id} declares more than one check`).toHaveLength(1);
      expect(check.from, spec.id).toBe('player');
      expect(check.source, `${spec.id} ships a source of its own`).toBeUndefined();
      expect(check.steps.length, `${spec.id} walk is empty`).toBeGreaterThan(0);
    }
    // The reader is the one the chapter teaches, in order: hand-written bytes
    // first, then assembly from the level that introduces it.
    expect(CH4_BATCH1.map((l) => programOf(l).format)).toEqual(['bytes', 'asm', 'asm']);
  });

  it('drives its walk on the level input pin, repeating it every step', () => {
    // `driveSteps` writes EVERY input pin at every step and defaults the ones
    // the step omits to 0 -- a step that forgot `inputs` would clear the very
    // byte the program is supposed to read. So every step of every walk names
    // the input, and the name is the level's own pin id.
    for (const spec of CH4_BATCH1) {
      const pin = spec.io.inputs[0]?.id ?? '';
      for (const step of programOf(spec).steps) {
        expect(step.inputs, `${spec.id} step ${step.tick} names no input`).toBeDefined();
        expect(Object.keys(step.inputs ?? {}), `${spec.id} step ${step.tick}`).toEqual([pin]);
      }
    }
  });

  it('carries the sourced-vs-authored data comment', () => {
    // The 2.x dossier fixes the names and the concept; the io, the programs,
    // the boards and the targets are this replica's design. The marker block is
    // what a reviewer reads to tell the two apart, and this checks it exists.
    const source = readFileSync(
      new URL('../../src/levels/content/ch4/batch1.ts', import.meta.url),
      'utf8',
    );
    const comments = new Map<string, string>();
    for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\/\s*\{\s*id: '([^']+)'/g)) {
      const [, body, id] = match;
      if (body !== undefined && id !== undefined) comments.set(id, body);
    }
    for (const spec of CH4_BATCH1) {
      const comment = comments.get(spec.id) ?? '';
      expect(comment.length, `${spec.id} has no data comment`).toBeGreaterThan(0);
      expect(comment, `${spec.id} does not record what is sourced`).toContain('SOURCED');
      expect(comment, `${spec.id} does not record what is authored`).toContain('AUTHORED');
    }
  });
});
