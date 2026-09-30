import { describe, expect, it } from 'vitest';
import { assemble, OVERTURE_ISA } from '../../src/asm/index';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import { CH2_LEVELS } from '../../src/levels/content/ch2/index';
import { CH3_BATCH1 } from '../../src/levels/content/ch3/batch1';
import { CH3_BATCH2 } from '../../src/levels/content/ch3/batch2';
import { runChecks } from '../../src/levels/checks';
import { grade } from '../../src/levels/grader';
import { LEVELS } from '../../src/levels/index';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import type { LevelSpec, ProgramCheck, ScriptCheck, TruthRow } from '../../src/levels/spec';
import { build, registry } from '../fixtures/build';
import {
  CH3_BATCH2_REFERENCES,
  computeUnitGraph,
  conditionsGraph,
} from '../fixtures/ch3-references';

/**
 * Chapter 3, levels 42-44.
 *
 * The reference circuits live in `test/fixtures/ch3-references.ts` so the
 * whole-set walk can grade them too, and the counterexample circuits come from
 * the options those builders expose -- a counterexample that is the reference
 * with one wire moved is a stronger statement than a second circuit written out
 * by hand, because the diff between it and the reference is the argument.
 *
 * Level 42's table and level 43's program are cross-checked against the ISA
 * table with the offsets written out HERE, in ruling 5's own numbers: if
 * `src/asm/isa.ts` ever moved a field, the level data would move with it (it
 * reads the table) and this file would fail, which is the point of spelling the
 * numbers twice in two different places.
 */

function level(id: string): LevelSpec {
  const found = CH3_BATCH2.find((l) => l.id === id);
  if (!found) throw new Error(`no such level in this batch: ${id}`);
  return found;
}

/** Level 42's truth table, or a loud failure -- a check is data, and may be misshapen. */
function rowsOf(spec: LevelSpec): readonly TruthRow[] {
  const check = spec.checks[0];
  if (check?.kind !== 'truth-table') throw new Error(`${spec.id} has no truth-table check`);
  return check.rows ?? [];
}

/** Level 43's program check, or a loud failure. */
function programOf(spec: LevelSpec): ProgramCheck {
  const check = spec.checks[0];
  if (check?.kind !== 'program') throw new Error(`${spec.id} has no program check`);
  return check;
}

/** Level 44's script check, or a loud failure. */
function scriptOf(spec: LevelSpec): ScriptCheck {
  const check = spec.checks[0];
  if (check?.kind !== 'script') throw new Error(`${spec.id} has no script check`);
  return check;
}

describe('chapter 3 batch 2 - reference solutions', () => {
  it('files a reference for every level in the batch', () => {
    for (const spec of CH3_BATCH2) {
      expect(CH3_BATCH2_REFERENCES[spec.id], `${spec.id} has no reference circuit`).toBeTypeOf(
        'function',
      );
    }
  });

  it('grades every filed reference against the level it is filed under', () => {
    for (const spec of CH3_BATCH2) {
      const graph = CH3_BATCH2_REFERENCES[spec.id]!();
      const outcome = runChecks(graph, registry, spec);
      expect(
        outcome.passed,
        `${spec.id}: ${outcome.failures.map((f) => f.detail ?? JSON.stringify(f)).join(' | ')}`,
      ).toBe(true);
    }
  });

  it('grades every reference at three stars', () => {
    for (const spec of CH3_BATCH2) {
      const graph = CH3_BATCH2_REFERENCES[spec.id]!();
      const result = grade(graph, registry, spec);
      expect(result.passed, `${spec.id} did not pass`).toBe(true);
      expect(result.stars, `${spec.id} did not earn three stars`).toBe(3);
    }
  });

  it('pins every three-star target to its reference solution own metrics', () => {
    // A target is the reference's measured score, never a hand-written
    // aspiration. This reads the measurement rather than restating it, so a
    // stale target fails here instead of quietly denying a player three stars.
    for (const spec of CH3_BATCH2) {
      const graph = CH3_BATCH2_REFERENCES[spec.id]!();
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
    // A level whose palette cannot build its own reference is unplayable. This
    // is the check that caught chapter 2's rewards-not-offered bug.
    for (const spec of CH3_BATCH2) {
      const graph = CH3_BATCH2_REFERENCES[spec.id]!();
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

  it('publishes the ISA slicing of all 256 instructions at level 42', () => {
    // The independent half of the ISA cross-check: these four expressions are
    // ruling 5 written out, and the level's own rows are computed from
    // `OVERTURE_ISA`. A table that omitted rows, sampled them, or hand-copied a
    // wrong offset fails here.
    const spec = level('ch3-42-instruction-decoder');
    const rows = rowsOf(spec);
    expect(rows).toHaveLength(256);
    expect(new Set(rows.map((row) => row.inputs.instr)).size).toBe(256);
    for (const row of rows) {
      const instr = row.inputs.instr ?? 0;
      expect(row.outputs).toEqual({
        mode: (instr >> 6) & 0b11,
        op: (instr >> 3) & 0b111,
        dst: instr & 0b111,
        imm: instr & 0b111111,
      });
    }
  });

  it('assembles level 43 program to the instruction bytes ruling 5 fixes', () => {
    // The level's machine executes these bytes; the test's copy is hand-encoded
    // from the ISA table, so an encoding change cannot pass by moving both sides.
    const check = programOf(level('ch3-43-calculations'));
    const assembled = assemble(check.source, OVERTURE_ISA);
    expect(assembled.errors).toEqual([]);
    expect(assembled.bytes).toEqual([0x05, 0xb1, 0x82, 0x40, 0x9c, 0x48, 0x9f, 0x68, 0x9d, 0xa3]);
    // One instruction per step, one address each, and no step re-reads a byte
    // the walk has already passed except the first (tick 0 runs no edge).
    expect(check.steps.map((step) => step.inputs?.instr)).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('asserts a spread of results at level 43, not one constant', () => {
    // A check whose every expectation is the same byte would pass a machine that
    // hard-wired `res`; the walk has to move.
    const check = programOf(level('ch3-43-calculations'));
    const expected = check.steps.map((step) => step.expect?.res).filter((v) => v !== undefined);
    expect(new Set(expected).size).toBeGreaterThanOrEqual(4);
    expect(expected).toContain(15);
    expect(expected).toContain(5);
    expect(expected).toContain(240);
  });

  it('walks level 44 conditions against a held value and against zero', () => {
    // Both sides of every condition are driven: 5 (nonzero) and 0, so a unit
    // that answers one of the two cannot pass, and the undefined condition code
    // 3 is driven too, so the contract is total.
    const steps = scriptOf(level('ch3-44-conditions')).steps;
    const codes = new Set(steps.map((step) => ((step.inputs?.instr ?? 0) >> 3) & 0b111));
    expect([...codes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(steps.some((step) => step.expect?.skip === 1)).toBe(true);
    expect(steps.some((step) => step.expect?.skip === 0)).toBe(true);
    // The held value is written by `loadi` and read back by the jumps around it.
    expect(steps.map((step) => step.inputs?.instr)).toEqual([
      0x05, 0x05, 0x81, 0x48, 0xc8, 0xd0, 0xc0, 0x00, 0xc8, 0xd0, 0xc0, 0x05, 0xc8, 0xd0, 0xd8,
    ]);
  });
});

describe('chapter 3 batch 2 - the checks have teeth', () => {
  it('rejects a decoder that wires dst from the op pin', () => {
    // Plausible-wrong for level 42: both pins are three bits wide and sit next
    // to each other, and `dst` is `instr[2:0]` while `op` is `instr[5:3]`. They
    // agree only where the word's two halves repeat.
    const swapped = build([
      { kind: 'input', name: 'instr', width: 8 },
      { kind: 'part', def: 'instr_decoder', id: 'dec', from: ['instr'] },
      { kind: 'output', name: 'OUT_mode', from: 'dec.mode', width: 2 },
      { kind: 'output', name: 'OUT_op', from: 'dec.op', width: 3 },
      { kind: 'output', name: 'OUT_dst', from: 'dec.op', width: 3 },
      { kind: 'output', name: 'OUT_imm', from: 'dec.imm', width: 6 },
    ]);
    const outcome = runChecks(swapped, registry, level('ch3-42-instruction-decoder'));
    expect(outcome.passed, 'a decoder with dst on the op slice passed').toBe(false);
    const failure = outcome.failures[0];
    expect(failure?.reason).toBe('mismatch');
    expect(failure?.expected).toHaveProperty('dst');
  });

  it('rejects a decoder that drops the top immediate bit', () => {
    // The other classic near-miss: five bits of immediate and a zero above.
    // Every instruction with bit 5 of the word set disagrees with the table.
    const fiveBitImm = build([
      { kind: 'input', name: 'instr', width: 8 },
      { kind: 'part', def: 'instr_decoder', id: 'dec', from: ['instr'] },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['instr'] },
      { kind: 'part', def: 'const_off', id: 'off', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'imm5',
        from: ['sp.b0', 'sp.b1', 'sp.b2', 'sp.b3', 'sp.b4', 'off', 'off', 'off'],
      },
      { kind: 'output', name: 'OUT_mode', from: 'dec.mode', width: 2 },
      { kind: 'output', name: 'OUT_op', from: 'dec.op', width: 3 },
      { kind: 'output', name: 'OUT_dst', from: 'dec.dst', width: 3 },
      { kind: 'output', name: 'OUT_imm', from: 'imm5', width: 6 },
    ]);
    const outcome = runChecks(fiveBitImm, registry, level('ch3-42-instruction-decoder'));
    expect(outcome.passed, 'a decoder that dropped immediate bit 5 passed').toBe(false);
    expect(outcome.failures[0]?.reason).toBe('mismatch');
  });

  it('rejects a calculation unit that writes loadi into the destination field', () => {
    // Plausible-wrong for level 43: the write address is wired straight from
    // `dst`, forgetting that `loadi` always writes REG0 -- and that a `loadi`'s
    // `dst` bits are its own immediate's low three bits. The walk's first
    // `move|s0|d2` then copies a zero, so the `add` publishes 10 where the level
    // demands 15.
    const outcome = runChecks(
      computeUnitGraph({ loadiAddress: 'dst' }),
      registry,
      level('ch3-43-calculations'),
    );
    expect(outcome.passed, 'a unit whose loadi writes dst passed').toBe(false);
    const failure = outcome.failures.find((f) => f.expected.res !== undefined);
    expect(failure?.reason).toBe('mismatch');
    expect(failure?.expected).toEqual({ res: 15 });
  });

  it('rejects a calculation unit that always adds', () => {
    // The other plausible-wrong machine: the ALU's `op` pin tied low. `add`
    // itself is answered correctly, so the walk has to reach `sub` (tick 6)
    // before it disagrees -- and it then stays wrong through the `nor` step
    // (tick 8) and the two moves that copy the stale byte (ticks 7 and 9),
    // until instruction 9 overwrites REG3 from REG4 and agrees again.
    const outcome = runChecks(
      computeUnitGraph({ aluOp: 'add' }),
      registry,
      level('ch3-43-calculations'),
    );
    expect(outcome.passed, 'an always-add unit passed').toBe(false);
    const failures = outcome.failures.filter((f) => f.reason === 'mismatch');
    expect(failures.map((f) => f.tick)).toEqual([6, 7, 8, 9]);
    expect(failures[0]?.expected).toEqual({ res: 5 });
    expect(failures[0]?.actual).toEqual({ res: 15 });
  });

  it('rejects a condition unit that ignores the mode field', () => {
    // Plausible-wrong for level 44: the condition decode alone decides, so a
    // `loadi` (whose [5:3] slice is 000) looks like `j`, and so does a
    // `move|s0|d1`. The walk drives three of those while demanding `skip` 0.
    const outcome = runChecks(
      conditionsGraph({ modeGate: false }),
      registry,
      level('ch3-44-conditions'),
    );
    expect(outcome.passed, 'a condition unit blind to the mode passed').toBe(false);
    const failures = outcome.failures.filter((f) => f.reason === 'mismatch');
    expect(failures.map((f) => f.tick)).toEqual([0, 1, 2, 7, 11]);
    expect(failures[0]?.expected).toEqual({ skip: 0 });
    expect(failures[0]?.actual).toEqual({ skip: 1 });
  });

  it('rejects a condition unit that never loads the compared value', () => {
    // The held byte stays zero, so the two jumps against 5 answer the wrong way
    // round at ticks 4 and 5, and again at 12 and 13 after the walk reloads 5.
    // The register is the level's, and a unit that skips it answers only half
    // the table -- the half the walk walks second.
    const outcome = runChecks(
      conditionsGraph({ loadValue: false }),
      registry,
      level('ch3-44-conditions'),
    );
    expect(outcome.passed, 'a condition unit with no held value passed').toBe(false);
    const failures = outcome.failures.filter((f) => f.reason === 'mismatch');
    expect(failures.map((f) => f.tick)).toEqual([4, 5, 12, 13]);
    expect(failures[0]?.expected).toEqual({ skip: 0 });
    expect(failures[0]?.actual).toEqual({ skip: 1 });
    expect(failures[1]?.expected).toEqual({ skip: 1 });
    expect(failures[1]?.actual).toEqual({ skip: 0 });
  });
});

describe('chapter 3 batch 2 - level data', () => {
  it('uses the chapter-3 index range', () => {
    expect(CH3_BATCH2.map((l) => l.index)).toEqual([42, 43, 44]);
    expect(CH3_BATCH2.every((l) => l.chapter === 3)).toBe(true);
  });

  it('rewards the three parts the chapter unlock chain needs next', () => {
    // The plan's chain: 42 hands out the program counter, 43 the program RAM and
    // 44 the halt line, and level 45 builds its machine from all three.
    expect(CH3_BATCH2.map((l) => l.rewards?.components)).toEqual([
      ['pc8'],
      ['ram_prog'],
      ['halt'],
    ]);
  });

  it('offers no part that no level at or before it hands out', () => {
    // The whole-set walk (`test/levels/level-buildability.test.ts`) holds this
    // rule for every SHIPPED level, and chapter 3 is not joined into `LEVELS`
    // yet -- so this batch states the rule for its own three levels against the
    // chapters that are: chapter 1, chapter 2, and batch 1.
    const ordered: readonly LevelSpec[] = [
      ...CH1_PART1,
      ...CH1_PART2,
      ...CH2_LEVELS,
      ...CH3_BATCH1,
      ...CH3_BATCH2,
    ].filter((spec) => spec.index <= 47);
    expect(LEVELS.length).toBeGreaterThan(0);
    for (const [index, spec] of ordered.entries()) {
      if (spec.chapter !== 3 || spec.index < 42) continue;
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

  it('keeps halt out of level 43 and the chapter palette rule honest', () => {
    // The phase plan's batch-2 table lists `halt` in level 43's palette, but
    // `halt` is level 44's reward: a level may not offer a part no level at or
    // before it hands out, so 43 cannot have it and the rule above is what says
    // so. This pins that the decision is deliberate rather than a forgotten line.
    expect(level('ch3-43-calculations').allowedComponents).not.toContain('halt');
    expect(level('ch3-44-conditions').rewards?.components).toEqual(['halt']);
  });

  it('offers every level its own I/O connectors', () => {
    // Chapter 1 and 2 list them in every palette; a level that does not would
    // have a palette its own reference cannot be built from.
    for (const spec of CH3_BATCH2) {
      expect(spec.allowedComponents, spec.id).toContain('level_input');
      expect(spec.allowedComponents, spec.id).toContain('level_output');
    }
  });
});
