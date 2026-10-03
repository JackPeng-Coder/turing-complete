import { describe, expect, it } from 'vitest';
import { assemble, OVERTURE_ISA } from '../../src/asm/index';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import { CH2_LEVELS } from '../../src/levels/content/ch2/index';
import { CH3_BATCH1 } from '../../src/levels/content/ch3/batch1';
import { CH3_BATCH2 } from '../../src/levels/content/ch3/batch2';
import { CH3_BATCH3 } from '../../src/levels/content/ch3/batch3';
import { runChecks } from '../../src/levels/checks';
import { grade } from '../../src/levels/grader';
import type { LevelSpec, ProgramCheck } from '../../src/levels/spec';
import { registry } from '../fixtures/build';
import { CH3_BATCH3_REFERENCES, overtureMachine } from '../fixtures/ch3-references';

/**
 * Chapter 3, levels 47-49 -- the machine, and the phase's acceptance level.
 *
 * All three levels are graded against ONE graph (`overtureMachine`), which is the
 * claim the levels make: 48 is a straight line, 47 the same straight line built
 * around the immediate field, and 49 adds the loop. So the counterexamples here
 * are not second circuits; they are that same machine with exactly one thing
 * short-circuited -- the conditional jump (twice: never and always), the sixth
 * immediate bit, the immediate write path, and the halt line -- and each block
 * names which of the level's own assertions catches it.
 *
 * The programs are pinned against the assembler the way `program-check.test.ts`
 * pins its fixture: the byte arrays below are hand-encoded from ruling 5, so an
 * encoding change cannot pass by moving the level and the test together.
 */

function level(id: string): LevelSpec {
  const found = CH3_BATCH3.find((l) => l.id === id);
  if (!found) throw new Error(`no such level in this batch: ${id}`);
  return found;
}

/** A level's program check, or a loud failure. */
function programOf(spec: LevelSpec): ProgramCheck {
  const check = spec.checks[0];
  if (check?.kind !== 'program') throw new Error(`${spec.id} has no program check`);
  return check;
}

/** The byte the walk demands on `out` at this tick, or `undefined`. */
function expectedAt(spec: LevelSpec, tick: number): number | undefined {
  const step = programOf(spec).steps.find((entry) => entry.tick === tick);
  return step?.expect?.out;
}

describe('chapter 3 batch 3 - reference solutions', () => {
  it('files a reference for every level in the batch', () => {
    for (const spec of CH3_BATCH3) {
      expect(CH3_BATCH3_REFERENCES[spec.id], `${spec.id} has no reference circuit`).toBeTypeOf(
        'function',
      );
    }
  });

  it('grades every filed reference against the level it is filed under', () => {
    for (const spec of CH3_BATCH3) {
      const graph = CH3_BATCH3_REFERENCES[spec.id]!();
      const outcome = runChecks(graph, registry, spec);
      expect(
        outcome.passed,
        `${spec.id}: ${outcome.failures.map((f) => f.detail ?? JSON.stringify(f)).join(' | ')}`,
      ).toBe(true);
    }
  });

  it('grades every reference at three stars', () => {
    for (const spec of CH3_BATCH3) {
      const graph = CH3_BATCH3_REFERENCES[spec.id]!();
      const result = grade(graph, registry, spec);
      expect(result.passed, `${spec.id} did not pass`).toBe(true);
      expect(result.stars, `${spec.id} did not earn three stars`).toBe(3);
    }
  });

  it('pins every three-star target to its reference solution own metrics', () => {
    // A target is the reference's measured score, never a hand-written
    // aspiration. All three levels share the graph, so 47 and 48 must state the
    // same gate and delay as 49 -- and this test says so by measuring each.
    for (const spec of CH3_BATCH3) {
      const graph = CH3_BATCH3_REFERENCES[spec.id]!();
      const m = grade(graph, registry, spec).metrics;
      expect(spec.threeStar, `${spec.id} states no target`).toBeDefined();
      expect(spec.threeStar, `${spec.id} target is not its reference's metrics`).toEqual({
        gate: m.gate,
        delay: m.delay,
        tick: m.tick,
      });
    }
  });

  it('offers every part its own reference needs', () => {
    for (const spec of CH3_BATCH3) {
      const graph = CH3_BATCH3_REFERENCES[spec.id]!();
      for (const inst of graph.instances) {
        if (inst.def === 'level_input' || inst.def === 'level_output') continue;
        const offered =
          spec.allowedComponents.includes(inst.def) ||
          (spec.rewards?.components?.includes(inst.def) ?? false);
        expect(offered, `${spec.id} reference uses ${inst.def}, which its palette does not offer`).toBe(
          true,
        );
      }
    }
  });

  it('assembles each program to the bytes ruling 5 fixes', () => {
    const expected: Record<string, readonly number[]> = {
      'ch3-48-program': [0x06, 0x81, 0x07, 0x82, 0x40, 0x9f],
      'ch3-47-immediate-values': [0x3f, 0x81, 0x06, 0x82, 0x48, 0x9f],
      'ch3-49-turing-complete': [
        0x06, 0x81, 0x8d, 0xa1, 0xaa, 0x40, 0x9c, 0xa9, 0x01, 0x82, 0x48, 0x99, 0x10, 0xc8, 0x02,
        0xc0, 0xa7,
      ],
    };
    for (const spec of CH3_BATCH3) {
      const assembled = assemble(programOf(spec).source, OVERTURE_ISA);
      expect(assembled.errors, spec.id).toEqual([]);
      expect(assembled.bytes, spec.id).toEqual([...(expected[spec.id] ?? [])]);
    }
  });

  it('resolves the label operands to the instruction indices they name', () => {
    // `loadi|finish` and `loadi|done`/`loadi|loop` carry ADDRESSES, so the level
    // data depends on where the assembler puts each label: 47's is the index of
    // the instruction after the six-instruction program, and 49's two are the
    // loop head and the instruction after the loop.
    const labels47 = assemble(programOf(level('ch3-47-immediate-values')).source, OVERTURE_ISA).labels;
    expect(labels47).toEqual({ finish: 6 });
    const labels49 = assemble(programOf(level('ch3-49-turing-complete')).source, OVERTURE_ISA).labels;
    expect(labels49).toEqual({ loop: 2, done: 16 });
  });

  it('states the answer each program computes, and where it appears', () => {
    // The three walks, read out of the level data: 48 publishes 13 and 47
    // publishes 57 with their output instructions as their last, and 49 demands
    // 0 while the loop runs and 21 -- 6 + 5 + 4 + 3 + 2 + 1 -- once it exits.
    expect(programOf(level('ch3-48-program')).steps.map((step) => step.expect?.out)).toEqual([
      0, 0, 13, 13,
    ]);
    expect(programOf(level('ch3-47-immediate-values')).steps.map((step) => step.expect?.out)).toEqual([
      0, 0, 57, 57,
    ]);
    expect(programOf(level('ch3-49-turing-complete')).steps.map((step) => step.expect?.out)).toEqual([
      0, 0, 0, 21, 21,
    ]);
    // The loop's answer is the sum of 6 down to 1, so it is not a byte any
    // single instruction in the program writes.
    expect(6 + 5 + 4 + 3 + 2 + 1).toBe(21);
    expect(expectedAt(level('ch3-49-turing-complete'), 83)).toBe(0);
    expect(expectedAt(level('ch3-49-turing-complete'), 85)).toBe(21);
  });

  it('gives the three levels the same machine, pin shape and check kind', () => {
    // What separates these levels is the program, and this is that claim in the
    // level data: one io shape, one check kind, three sources.
    for (const spec of CH3_BATCH3) {
      expect(spec.io, spec.id).toEqual({
        inputs: [{ id: 'clk', width: 1 }],
        outputs: [{ id: 'out', width: 8 }],
      });
      expect(spec.checks).toHaveLength(1);
      expect(spec.checks[0]?.kind, spec.id).toBe('program');
    }
    const sources = CH3_BATCH3.map((spec) => programOf(spec).source);
    expect(new Set(sources).size).toBe(3);
  });
});

describe('chapter 3 batch 3 - the checks have teeth', () => {
  it('rejects a machine that never wires the immediate into the bank', () => {
    // Level 48's check with the `loadi` select tied low: the write data is the
    // move source, so every `loadi` writes a zero and the answer never leaves 0.
    const outcome = runChecks(
      overtureMachine({ immediate: 'never' }),
      registry,
      level('ch3-48-program'),
    );
    expect(outcome.passed, 'a machine with no immediate path passed level 48').toBe(false);
    const failure = outcome.failures.find((f) => f.reason === 'mismatch');
    expect(failure?.tick).toBe(6);
    expect(failure?.expected).toEqual({ out: 13 });
    expect(failure?.actual).toEqual({ out: 0 });
  });

  it('rejects a five-bit immediate path at level 47', () => {
    // The near-miss the level exists for: 63 arrives as 31, so the subtraction
    // publishes 25 where the walk demands 57.
    const outcome = runChecks(
      overtureMachine({ immediate: 'fiveBits' }),
      registry,
      level('ch3-47-immediate-values'),
    );
    expect(outcome.passed, 'a machine with a five-bit immediate passed level 47').toBe(false);
    const failure = outcome.failures.find((f) => f.reason === 'mismatch');
    expect(failure?.tick).toBe(6);
    expect(failure?.expected).toEqual({ out: 57 });
    expect(failure?.actual).toEqual({ out: 25 });
  });

  it('rejects a machine with no conditional jump on level 49', () => {
    // The same machine, with the counter's load signal short-circuited low: the
    // loop runs exactly once, so instruction 16 publishes 6 -- the sum after a
    // single pass -- where the level demands 21, and it demands 0 at tick 83
    // while the loop is still running.
    const outcome = runChecks(
      overtureMachine({ jump: 'never' }),
      registry,
      level('ch3-49-turing-complete'),
    );
    expect(outcome.passed, 'a machine that cannot jump passed the acceptance level').toBe(false);
    const failures = outcome.failures.filter((f) => f.reason === 'mismatch');
    // Tick 83 is where the loop should still be running and this machine has
    // already stopped; tick 85 is where the answer should appear.
    expect(failures.map((f) => f.tick)).toContain(83);
    expect(failures.map((f) => f.tick)).toContain(85);
    const at85 = failures.find((f) => f.tick === 85);
    expect(at85?.expected).toEqual({ out: 21 });
    expect(at85?.actual).toEqual({ out: 6 });
  });

  it('rejects a machine whose jumps are always taken on level 49', () => {
    // The other short circuit: every jump is taken, so the exit `jz` leaves the
    // loop on the first pass too. A machine that cannot tell a taken branch from
    // an untaken one is not the thing this level is named after, in either
    // direction.
    const outcome = runChecks(
      overtureMachine({ jump: 'always' }),
      registry,
      level('ch3-49-turing-complete'),
    );
    expect(outcome.passed, 'a machine whose jumps are always taken passed level 49').toBe(false);
    const at85 = outcome.failures.find((f) => f.reason === 'mismatch' && f.tick === 85);
    expect(at85?.expected).toEqual({ out: 21 });
    expect(at85?.actual).toEqual({ out: 6 });
  });

  it('rejects a machine that publishes out but never holds it', () => {
    // The halt line tied low, with no output register to replace it: the byte is
    // right on the edge that writes it and gone as soon as the counter moves on.
    // This is what makes the level's "the byte must stay there" assertion -- the
    // last tick of each walk -- worth having.
    const outcome = runChecks(
      overtureMachine({ halt: false }),
      registry,
      level('ch3-49-turing-complete'),
    );
    expect(outcome.passed, 'a machine that does not hold its answer passed').toBe(false);
    const at95 = outcome.failures.find((f) => f.reason === 'mismatch' && f.tick === 95);
    expect(at95?.expected).toEqual({ out: 21 });
    expect(at95?.actual).toEqual({ out: 0 });
  });

  it('separates the loop from a straight line in the level data itself', () => {
    // The counterexamples above only mean something because the walk's two ends
    // disagree about the byte: 0 inside the loop and 21 after it. If a broken
    // machine's answer coincided with the expected byte at both ends, the check
    // would have no teeth at all.
    for (const spec of CH3_BATCH3) {
      const expected = programOf(spec).steps
        .map((step) => step.expect?.out)
        .filter((value): value is number => value !== undefined);
      expect(new Set(expected).size, `${spec.id} asserts one constant`).toBeGreaterThan(1);
    }
  });
});

describe('chapter 3 batch 3 - level data', () => {
  it('uses the chapter-3 index range', () => {
    expect(CH3_BATCH3.map((l) => l.index)).toEqual([47, 48, 49]);
    expect(CH3_BATCH3.every((l) => l.chapter === 3)).toBe(true);
  });

  it('rewards nothing: the chapter has handed out every part already', () => {
    // The unlock chain ends at level 45 (`halt`). These three levels are where
    // the parts are used together, not where another one arrives; a reward here
    // would mean the chain and the palette had drifted.
    expect(CH3_BATCH3.map((l) => l.rewards)).toEqual([undefined, undefined, undefined]);
  });

  it('offers no part that no level at or before it hands out', () => {
    // The whole-set walk holds this rule for every SHIPPED level, and chapter 3
    // is not joined into `LEVELS` yet -- so this batch states it for its own
    // three levels against chapters 1 and 2 and the three earlier batches.
    const ordered: readonly LevelSpec[] = [
      ...CH1_PART1,
      ...CH1_PART2,
      ...CH2_LEVELS,
      ...CH3_BATCH1,
      ...CH3_BATCH2,
      ...CH3_BATCH3,
    ].filter((spec) => spec.index <= 49);
    for (const [index, spec] of ordered.entries()) {
      if (spec.chapter !== 3 || spec.index < 47) continue;
      const earned = new Set<string>(STARTER_COMPONENTS);
      for (const atOrBefore of ordered.slice(0, index + 1)) {
        for (const def of atOrBefore.rewards?.components ?? []) earned.add(def);
      }
      for (const def of spec.allowedComponents) {
        expect(earned.has(def), `${spec.id} offers ${def}, which no level at or before it rewards`).toBe(
          true,
        );
      }
    }
  });

  it('does not offer decoder2, which the OVERTURE machine never needs', () => {
    // The 2.x shape gave `decoder2` an owner (`ch2-36-2-bit-decoder` rewards it),
    // so its absence here is no longer an unlock hole: the OVERTURE machine is
    // built from six named parts -- `alu8`, `regfile6`, `instr_decoder`, `pc8`,
    // `ram_prog`, `halt` -- and a 2-bit decode is not one of them. A palette that
    // had gained it would be a level reaching for a part the machine's brief
    // never names.
    for (const spec of CH3_BATCH3) {
      expect(spec.allowedComponents, spec.id).not.toContain('decoder2');
    }
  });

  it('offers every level its own I/O connectors and the six CPU parts', () => {
    for (const spec of CH3_BATCH3) {
      for (const def of [
        'level_input',
        'level_output',
        'alu8',
        'regfile6',
        'instr_decoder',
        'pc8',
        'ram_prog',
        'halt',
      ]) {
        expect(spec.allowedComponents, `${spec.id} does not offer ${def}`).toContain(def);
      }
    }
  });
});
