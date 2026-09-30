import { describe, expect, it } from 'vitest';
import { build, registry } from '../fixtures/build';
import { CH3_BATCH1_REFERENCES } from '../fixtures/ch3-references';
import { CH3_BATCH1, aluOp } from '../../src/levels/content/ch3/batch1';
import { grade } from '../../src/levels/grader';
import { runChecks } from '../../src/levels/checks';
import type { PortValue } from '../../src/core/signal';
import type { LevelSpec } from '../../src/levels/spec';

/**
 * Chapter 3, levels 39-41.
 *
 * The reference circuits live in `test/fixtures/ch3-references.ts` so the
 * whole-set walk can grade them too. The counterexample circuits live HERE,
 * because "this plausible circuit must fail" is this file's argument and nobody
 * else's.
 */

function level(id: string): LevelSpec {
  const found = CH3_BATCH1.find((l) => l.id === id);
  if (!found) throw new Error(`no such level in this batch: ${id}`);
  return found;
}

/** The same level with its checks replaced, for probing one behaviour at a time. */
function withChecks(spec: LevelSpec, steps: LevelSpec['checks']): LevelSpec {
  return { ...spec, checks: steps };
}

describe('chapter 3 batch 1 - reference solutions', () => {
  it('files a reference for every level in the batch', () => {
    for (const spec of CH3_BATCH1) {
      expect(CH3_BATCH1_REFERENCES[spec.id], `${spec.id} has no reference circuit`).toBeTypeOf(
        'function',
      );
    }
  });

  it('grades every filed reference against the level it is filed under', () => {
    for (const spec of CH3_BATCH1) {
      const graph = CH3_BATCH1_REFERENCES[spec.id]!();
      const outcome = runChecks(graph, registry, spec);
      expect(
        outcome.passed,
        `${spec.id}: ${outcome.failures
          .map((f) => `${f.reason} ${f.detail ?? ''} in=${JSON.stringify(f.inputs)} want=${JSON.stringify(f.expected)} got=${JSON.stringify(f.actual)}`)
          .join(' | ')}`,
      ).toBe(true);
    }
  });

  it('grades every reference at three stars', () => {
    for (const spec of CH3_BATCH1) {
      const graph = CH3_BATCH1_REFERENCES[spec.id]!();
      const result = grade(graph, registry, spec);
      expect(result.passed, `${spec.id} did not pass`).toBe(true);
      expect(result.stars, `${spec.id} did not earn three stars`).toBe(3);
    }
  });

  it('pins every three-star target to its reference solution own metrics', () => {
    // A target is the reference's measured score, never a hand-written
    // aspiration. This reads the measurement rather than restating it, so a
    // stale target fails here instead of quietly denying a player three stars.
    for (const spec of CH3_BATCH1) {
      const graph = CH3_BATCH1_REFERENCES[spec.id]!();
      const m = grade(graph, registry, spec).metrics;
      console.log('METRICS', spec.id, JSON.stringify(m), JSON.stringify(runChecks(graph, registry, spec).failures));
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
    for (const spec of CH3_BATCH1) {
      const graph = CH3_BATCH1_REFERENCES[spec.id]!();
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

  it('the ALU reference answers all six operations', () => {
    // The fuzz check walks the six, but a check is only as strong as its
    // expectation. This compares the reference against a table computed here, so
    // a mistake in the level's own expectation cannot hide behind it.
    const graph = CH3_BATCH1_REFERENCES['ch3-39-arithmetic-engine']!();
    const spec = level('ch3-39-arithmetic-engine');
    for (const [op, a, b] of [
      [0, 200, 100],
      [1, 0, 1],
      [1, 153, 209],
      [2, 0b1100, 0b1010],
      [3, 0b1100, 0b1010],
      [3, 106, 252],
      [4, 0b1100, 0b1010],
      [4, 106, 252],
      [5, 0b1100, 0b1010],
      [5, 106, 252],
      [6, 0b1100, 0b1010],
      [7, 0b1100, 0b1010],
    ] as const) {
      const one = withChecks(spec, [
        {
          kind: 'script',
          steps: [
            {
              tick: 1,
              inputs: { a, b, op0: op & 1, op1: (op >> 1) & 1, op2: (op >> 2) & 1 },
              expect: { out: aluOp(op, a, b) },
            },
          ],
        },
      ]);
      expect(runChecks(graph, registry, one).passed, `op ${op} with a=${a} b=${b}`).toBe(true);
    }
  });

  it('the level expectation agrees with the ALU this level rewards', () => {
    // THE TEST THAT WAS MISSING, and the reason a real defect shipped.
    //
    // `aluOp` is what the level tells the player their circuit must compute, and
    // `alu8` is the part the level REWARDS. They have to be the same function --
    // a player who earns the reward and drops it into the level must pass. They
    // were not: the expectation zeroed codes 4 and 5 (NAND and NOR) and answered
    // codes 6 and 7 (the reserved pair), so the rewarded part failed half the
    // level.
    //
    // Nothing in this file could see it, because the level's `fuzz` check builds
    // its expected value by CALLING `aluOp`: expectation and generator were the
    // same function, and a function cannot disagree with itself. The reference
    // circuit could see it -- it is wired from gates -- but only once chapter 3
    // was registered in the whole-set walks, which is the separate defect this
    // batch shipped alongside.
    //
    // This compares the two DIRECTLY, over every op and a dense set of operand
    // pairs, so the coupling is asserted rather than assumed. `defs-cpu.test.ts`
    // independently pins `alu8` to the ISA's numbering, so this test transitively
    // pins `aluOp` to the ISA as well.
    const alu8 = registry.get('alu8');
    const hardware = (a: number, b: number, op: number): number => {
      const staged: PortValue[] = [];
      alu8.evaluate!([a, b, op], staged, undefined, { tick: 0 } as never);
      const v = staged[0];
      if (typeof v === 'number') return v;
      return Array.from(v ?? []).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);
    };

    // Dense rather than exhaustive: every operand boundary plus a stride that
    // crosses byte wraps, for all eight codes.
    const vals = [...new Set([0, 1, 2, 3, 15, 16, 105, 106, 127, 128, 200, 240, 252, 254, 255,
      ...Array.from({ length: 256 }, (_, i) => (i * 37) & 0xff)])];
    const mismatches: string[] = [];
    for (let op = 0; op < 8; op += 1) {
      for (const a of vals) {
        for (const b of vals) {
          const want = hardware(a, b, op);
          const got = aluOp(op, a, b);
          if (want !== got && mismatches.length < 8) {
            mismatches.push(`op=${op} a=${a} b=${b}: alu8=${want} aluOp=${got}`);
          }
        }
      }
    }
    expect(mismatches, 'the level expectation and the rewarded ALU disagree').toEqual([]);
  });
});

describe('chapter 3 batch 1 - the checks have teeth', () => {
  it('rejects an adder that ignores the operation selector', () => {
    // Plausible-wrong for level 39: always add. It agrees wherever the drawn op
    // folds to 0 and must disagree everywhere else.
    const alwaysAdd = build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'input', name: 'b', width: 8 },
      { kind: 'input', name: 'op0', width: 1 },
      { kind: 'input', name: 'op1', width: 1 },
      { kind: 'input', name: 'op2', width: 1 },
      { kind: 'part', def: 'add8', id: 'ad', from: ['a', 'b'] },
      { kind: 'output', from: 'ad', width: 8 },
    ]);
    const outcome = runChecks(alwaysAdd, registry, level('ch3-39-arithmetic-engine'));
    expect(outcome.passed, 'an adder passed the arithmetic-engine level').toBe(false);
  });

  it('rejects an ALU that gets subtraction wrong by one', () => {
    // The classic off-by-one: ~b without the plus one. It agrees with `sub`
    // exactly when b is 0, so the level must fail it.
    const noPlusOne = build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'input', name: 'b', width: 8 },
      { kind: 'input', name: 'op0', width: 1 },
      { kind: 'input', name: 'op1', width: 1 },
      { kind: 'input', name: 'op2', width: 1 },
      { kind: 'part', def: 'not8', id: 'nb', from: ['b'] },
      { kind: 'part', def: 'mux8', id: 'mx', from: ['b', 'nb', 'op0'] },
      { kind: 'part', def: 'add8', id: 'ad', from: ['a', 'mx'] },
      { kind: 'output', from: 'ad', width: 8 },
    ]);
    const outcome = runChecks(noPlusOne, registry, level('ch3-39-arithmetic-engine'));
    expect(outcome.passed, 'a subtract-without-the-plus-one passed').toBe(false);
  });

  it('rejects a register bank that writes while the enable is low', () => {
    // The plausible-wrong bank: the enable is ignored, so any change to `data`
    // lands in the addressed store. The level's own script asserts the hold, so
    // this must fail it.
    const enableIgnored = build([
      { kind: 'input', name: 'clk', width: 1 },
      { kind: 'input', name: 'we', width: 1 },
      { kind: 'input', name: 'addr', width: 3 },
      { kind: 'input', name: 'data', width: 8 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['addr'] },
      { kind: 'part', def: 'decoder3', id: 'dec', from: ['addr'] },
      { kind: 'part', def: 'splitter', id: 'sel', from: ['dec.out'] },
      // No AND with `we` anywhere: every store is always enabled.
      { kind: 'part', def: 'mem1', id: 'b0', from: ['data', 'sel.b0'] },
      { kind: 'part', def: 'mem1', id: 'b1', from: ['data', 'sel.b1'] },
      { kind: 'part', def: 'mem1', id: 'b2', from: ['data', 'sel.b2'] },
      { kind: 'part', def: 'mem1', id: 'b3', from: ['data', 'sel.b3'] },
      { kind: 'part', def: 'mem1', id: 'b4', from: ['data', 'sel.b4'] },
      { kind: 'part', def: 'mem1', id: 'b5', from: ['data', 'sel.b5'] },
      { kind: 'part', def: 'mem1', id: 'b6', from: ['data', 'sel.b6'] },
      { kind: 'part', def: 'mem1', id: 'b7', from: ['data', 'sel.b7'] },
      { kind: 'part', def: 'maker', id: 'mk', from: ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'] },
    ]);
    const outcome = runChecks(enableIgnored, registry, level('ch3-40-registers'));
    expect(outcome.passed, 'a bank that ignores the write enable passed').toBe(false);
  });

  it('rejects a fan-out circuit that forwards sel to the outputs', () => {
    // Plausible-wrong for level 41: hand `a` the low bits of `sel` and `b` the
    // whole data byte, ignoring every selector bit above bit 0. It agrees at
    // sel 0 and disagrees everywhere else, so the level's own script must fail
    // it. Built through `maker` on `sel`'s bit 0 with the remaining maker inputs
    // tied to a rail, because forwarding a two-bit value onto an eight-bit pin
    // is exactly the mistake being modelled.
    const forwarded = build([
      { kind: 'input', name: 'clk', width: 1 },
      { kind: 'input', name: 'sel', width: 2 },
      { kind: 'input', name: 'data', width: 8 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['sel'] },
      ...Array.from({ length: 8 }, (_, bit) => ({
        kind: 'part' as const,
        def: 'const_off',
        id: `rail${bit}`,
        from: [],
      })),
      { kind: 'part', def: 'maker', id: 'mk', from: ['sp.b0', 'rail1', 'rail2', 'rail3', 'rail4', 'rail5', 'rail6', 'rail7'] },
      { kind: 'output', name: 'a', from: 'mk', width: 8 },
      { kind: 'output', name: 'b', from: 'data', width: 8 },
    ]);
    const outcome = runChecks(forwarded, registry, level('ch3-41-component-factory'));
    expect(outcome.passed, 'a forwarding circuit passed level 41').toBe(false);
  });
});

describe('chapter 3 batch 1 - level data', () => {
  it('uses the chapter-3 index range', () => {
    expect(CH3_BATCH1.map((l) => l.index)).toEqual([39, 40, 41]);
    expect(CH3_BATCH1.every((l) => l.chapter === 3)).toBe(true);
  });

  it('rewards the three parts this chapter is built from', () => {
    // The plan's unlock chain: these three are unlocked by this batch, and the
    // later batch consumes them. A reward that moved would break the chapter.
    expect(CH3_BATCH1.map((l) => l.rewards?.components)).toEqual([
      ['alu8'],
      ['regfile6'],
      ['instr_decoder'],
    ]);
  });
});
