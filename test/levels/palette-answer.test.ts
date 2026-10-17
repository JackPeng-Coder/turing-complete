/**
 * NO LEVEL MAY BE ANSWERED BY A PART ON ITS OWN PALETTE.
 *
 * The defect this file exists for: `ch1-11-bigger-and-gate` (三路与门) listed
 * `and3` -- the 3-Pin AND it exists to teach -- in its own `allowedComponents`.
 * The tray drew it, the agent could place it, and ONE instance passes all eight
 * rows at `gate: 4, delay: 1`, which is three stars against the two-AND cascade's
 * `4/2`. The cause was an acquisition order (`and3` was level 8's reward, three
 * levels early) and a palette list written as "the previous level's list plus a
 * part", so nothing about the level itself said "offer the answer".
 *
 * WHY A GRADE-BASED AUDIT AND NOT A READING OF THE DATA. The palette decides what
 * may be PLACED; the grader scores any valid graph. A level's own type does not
 * say what its checks accept, so "is this part the answer?" can only be answered
 * by wiring the part to the level's pins and grading it -- which is what this file
 * does, for every shipped level, every palette part, every way of wiring the part's
 * pins to the level's inputs and outputs (widths must agree; a part input may take
 * the same level input twice, which is how NAND(a, a) becomes a NOT).
 *
 * FOUR QUESTIONS, ASKED OF EVERY LEVEL:
 *
 *  - `empty`  -- is a board with nothing on it already passing? (It must not.)
 *  - `const`  -- do constant sources alone pass? (Only where the level teaches the
 *    constant; a level must otherwise need a circuit.)
 *  - `wire`   -- do plain wires from the inputs to the outputs pass? (Only the
 *    forwarding level, whose three-star target IS the wire.)
 *  - `one-part` -- does one placed palette part pass?
 *
 * The exemption table below is not a whitelist of convenience: every row names the
 * level, the part and why the drop-in is the level's design rather than an
 * oversight, and a row that stops firing fails the test (`every exemption is
 * load-bearing`), so the table cannot rot into a list of stale permissions. A new
 * level that hands over its own answer -- or a palette edited by accident -- lands
 * in `reports only the exemptions the table records` as an unexpected finding.
 *
 * WHAT THIS FILE DOES NOT CLAIM. It wires PALETTE PARTS at their registered
 * widths: a `params.width` override, a part fed by a constant, and two-part
 * circuits are outside it. A part whose pin count makes the wiring product exceed
 * `COMBO_CAP` is skipped rather than sampled -- no shipped level comes close to
 * it (a three-pin part on a four-pin level is 64 wirings). It also grades the
 * level alone -- a level's checks are the ground truth, so a check too weak to
 * reject a wrong circuit is not a palette question and is covered by each
 * chapter's own wrong-circuit tests.
 */
import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { LEVELS } from '../../src/levels/index';
import { grade } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';
import { registry } from '../fixtures/build';

const IO = new Set(['level_input', 'level_output']);

/** One part on one level is at most `m^k` wirings; past this a part is skipped. */
const COMBO_CAP = 4096;

type Kind = 'empty' | 'const' | 'wire' | 'one-part';

interface Finding {
  readonly level: string;
  readonly kind: Kind;
  /** The part, for `one-part`; absent on the other kinds. */
  readonly def?: string;
}

/** A level's board with its connectors and nothing else. */
function base(level: LevelSpec): Graph {
  const g = emptyGraph();
  for (const pin of level.io.inputs) {
    const inst = addInstance(g, 'level_input', 0, 0, `IN_${pin.id}`);
    inst.params.width = pin.width;
  }
  for (const pin of level.io.outputs) {
    const inst = addInstance(g, 'level_output', 240, 0, outputName(level, pin.id));
    inst.params.width = pin.width;
  }
  return g;
}

function outputName(level: LevelSpec, pin: string): string {
  return level.io.outputs.length === 1 ? 'OUT' : `OUT_${pin}`;
}

/** Every tuple of pool values, with repetition, capped. */
function* combos(pools: readonly (readonly number[])[]): Generator<number[]> {
  if (pools.length === 0) return;
  for (const pool of pools) if (pool.length === 0) return;
  let count = 1;
  for (const pool of pools) count *= pool.length;
  if (count > COMBO_CAP) return;
  const position = pools.map(() => 0);
  for (;;) {
    yield pools.map((pool, k) => pool[position[k]!]!);
    let carry = pools.length - 1;
    while (carry >= 0) {
      position[carry] = (position[carry] ?? 0) + 1;
      if (position[carry]! < pools[carry]!.length) break;
      position[carry] = 0;
      carry -= 1;
    }
    if (carry < 0) return;
  }
}

/** Grades, and counts the work so the test can prove it did any. */
interface Audit {
  readonly findings: readonly Finding[];
  readonly gradings: number;
}

function audit(): Audit {
  const findings: Finding[] = [];
  let gradings = 0;

  const passed = (level: LevelSpec, graph: Graph): boolean => {
    gradings += 1;
    return grade(graph, registry, level).passed;
  };

  const constSweep = (level: LevelSpec): boolean => {
    const sources = level.allowedComponents
      .filter((def) => !IO.has(def))
      .map((def) => registry.get(def))
      .filter((def) => def.inputs.length === 0 && def.outputs.length === 1);
    const pools = level.io.outputs.map((pin) =>
      sources.flatMap((def, i) => (def.outputs[0]!.width === pin.width ? [i] : [])),
    );
    if (pools.some((pool) => pool.length === 0)) return false;
    let found = false;
    for (const pick of combos(pools)) {
      const g = base(level);
      level.io.outputs.forEach((pin, i) => {
        const src = addInstance(g, sources[pick[i]!]!.id, 120, 0);
        connect(g, { inst: src.id, port: 'out' }, { inst: outputName(level, pin.id), port: 'in' });
      });
      found ||= passed(level, g);
    }
    return found;
  };

  const wireSweep = (level: LevelSpec): boolean => {
    const pools = level.io.outputs.map((pin) =>
      level.io.inputs.flatMap((src, i) => (src.width === pin.width ? [i] : [])),
    );
    if (pools.some((pool) => pool.length === 0)) return false;
    let found = false;
    for (const pick of combos(pools)) {
      const g = base(level);
      level.io.outputs.forEach((pin, i) => {
        const src = level.io.inputs[pick[i]!]!;
        connect(
          g,
          { inst: `IN_${src.id}`, port: 'out' },
          { inst: outputName(level, pin.id), port: 'in' },
        );
      });
      found ||= passed(level, g);
    }
    return found;
  };

  const onePartSweep = (level: LevelSpec): string[] => {
    const hits: string[] = [];
    for (const id of level.allowedComponents) {
      if (IO.has(id)) continue;
      const def = registry.get(id);
      if (def.hidden === true || def.inputs.length === 0) continue;

      // Any part output may drive any level output of its width; every part input
      // takes a level input of its own width, repeats allowed.
      const outPools = level.io.outputs.map((pin) =>
        def.outputs.flatMap((port, k) => (port.width === pin.width ? [k] : [])),
      );
      const inPools = def.inputs.map((pin) =>
        level.io.inputs.flatMap((src, i) => (src.width === pin.width ? [i] : [])),
      );
      if (outPools.some((pool) => pool.length === 0)) continue;
      if (inPools.some((pool) => pool.length === 0)) continue;

      let found = false;
      for (const inPick of combos(inPools)) {
        for (const outPick of combos(outPools)) {
          const g = base(level);
          const inst = addInstance(g, id, 120, 0);
          def.inputs.forEach((pin, k) => {
            const src = level.io.inputs[inPick[k]!]!;
            connect(g, { inst: `IN_${src.id}`, port: 'out' }, { inst: inst.id, port: pin.id });
          });
          level.io.outputs.forEach((pin, i) => {
            const port = def.outputs[outPick[i]!]!;
            connect(g, { inst: inst.id, port: port.id }, { inst: outputName(level, pin.id), port: 'in' });
          });
          found ||= passed(level, g);
          if (found) break; // one wiring is enough; the finding is the part
        }
        if (found) break;
      }
      if (found) hits.push(id);
    }
    return hits;
  };

  for (const level of LEVELS) {
    if (passed(level, base(level))) findings.push({ level: level.id, kind: 'empty' });
    if (constSweep(level)) findings.push({ level: level.id, kind: 'const' });
    if (wireSweep(level)) findings.push({ level: level.id, kind: 'wire' });
    for (const def of onePartSweep(level)) findings.push({ level: level.id, kind: 'one-part', def });
  }
  return { findings, gradings };
}

/**
 * The drop-ins that are the campaign's own design, one row per (level, part).
 *
 * A row is a claim about the LEVEL as it ships, so it carries the reason rather
 * than a bare name: a future edit that changes a level enough to make its row
 * false fails `every exemption is load-bearing`.
 */
interface Exemption {
  readonly level: string;
  readonly kind: Kind;
  readonly defs?: readonly string[];
  readonly why: string;
}

const EXEMPT: readonly Exemption[] = [
  {
    level: 'ch1-01-humble-beginnings',
    kind: 'const',
    why: 'Tutorial: wiring a Constant On source to the output IS the lesson, and the hint names it.',
  },
  {
    level: 'ch1-02-nand-gate',
    kind: 'one-part',
    defs: ['nand'],
    why: 'Tutorial: the level is the NAND itself -- it hands the part out and asks for one placed on the tray.',
  },
  {
    level: 'ch1-03-not-gate',
    kind: 'one-part',
    defs: ['nand'],
    why: 'NAND(a, a) is the construction the level teaches (its hint says so); there is no ready-made NOT on the tray.',
  },
  {
    level: 'ch1-07-always-on',
    kind: 'const',
    why: 'The Constant On part IS the lesson: an always-high output is one rail, and the level is named for it.',
  },
  {
    level: 'ch2-14-binary-racer',
    kind: 'wire',
    why: 'The answer is four straight wires -- the three-star target is 0/0/0 because the level teaches reading a nibble.',
  },
  {
    level: 'ch2-20-delayed-lines',
    kind: 'one-part',
    defs: ['delay8'],
    why: "delay8 is the level's own reward and its reference; the hint says one 8-bit delay line is the answer and three spellings tie at 0/0.",
  },
  {
    level: 'ch2-24-bit-switch',
    kind: 'one-part',
    defs: ['and', 'and3', 'switch'],
    why: 'The level teaches that a Switch and an AND are one circuit: the comment measures both at 2/1 and names the AND the reference.',
  },
  {
    level: 'ch2-25-byte-nand',
    kind: 'one-part',
    defs: ['nand8'],
    why: "nand8 is the level's own reward and its reference (8/1), and the hint offers the drop-in by name.",
  },
  {
    level: 'ch2-26-byte-not',
    kind: 'one-part',
    defs: ['nand8', 'nor8', 'not8'],
    why: "not8 is the level's own reward; nand8(a,a) and nor8(a,a) are the documented spellings (8/1 tie, 32/1 one star).",
  },
  {
    level: 'ch2-28-bit-inverter',
    kind: 'one-part',
    defs: ['xor'],
    why: "xor is the reference at the level's own 4/1 target: the level teaches that XOR is conditional inversion.",
  },
  {
    level: 'ch2-30-multiplexer',
    kind: 'one-part',
    defs: ['mux8'],
    why: "mux8 is the level's own reward and its reference (32/1), and the measure the three-star target states.",
  },
  {
    level: 'ch2-32-the-bus',
    kind: 'one-part',
    defs: ['mux8'],
    why: "The level is the driver-selection half of the bus reframing, its function is level 33's, and mux8 is the reference (32/1).",
  },
  {
    level: 'ch2-33-saving-gracefully',
    kind: 'one-part',
    defs: ['mem1'],
    why: 'mem1 IS the part this level is about using (level 28 is where the loop is built); the hint says so.',
  },
  {
    level: 'ch2-35-1-bit-decoder',
    kind: 'one-part',
    defs: ['decoder1'],
    why: "decoder1 is the level's own reward and its reference (1/1): its gate cost is the one NOT the level teaches.",
  },
  {
    level: 'ch2-36-2-bit-decoder',
    kind: 'one-part',
    defs: ['decoder2'],
    why: "decoder2 is the level's own reward, and its gate cost IS the minterm tree the level teaches (10/1 against 10/2).",
  },
  {
    level: 'ch2-37-3-bit-decoder',
    kind: 'one-part',
    defs: ['decoder3'],
    why: "decoder3 is the level's own reward, and its gate cost IS the shared tree (27/1 against 27/3).",
  },
  {
    level: 'ch2-38-little-box',
    kind: 'one-part',
    defs: ['ram8'],
    why: 'ram8 is the 256-byte box this level is about; the 513-step check walks the whole range and the hint names the part.',
  },
  {
    level: 'ch3-44-instruction-decoder',
    kind: 'one-part',
    defs: ['instr_decoder'],
    why: "instr_decoder is level 41's reward and this level's reference: both spellings measure 0/0 because slicing is free on the metrics.",
  },
];

function keyOf(finding: Finding): string {
  return finding.kind === 'one-part'
    ? `${finding.level}|one-part|${finding.def}`
    : `${finding.level}|${finding.kind}`;
}

const exemptKeys = new Set(EXEMPT.flatMap((row) =>
  row.kind === 'one-part'
    ? (row.defs ?? []).map((def) => `${row.level}|one-part|${def}`)
    : [`${row.level}|${row.kind}`],
));

const RESULT = audit();
const OBSERVED = RESULT.findings.map(keyOf).sort();

describe('no level is answered by a part on its own palette', () => {
  it('reports only the exemptions the table records', () => {
    // The assertion the 三路与门 defect would have failed: an unlisted (level,
    // part) pair that passes the level on its own.
    expect(OBSERVED.filter((key) => !exemptKeys.has(key))).toEqual([]);
  });

  it('keeps every exemption load-bearing', () => {
    // The other direction: a row that no longer fires is a stale permission and
    // fails here instead of quietly widening the table.
    expect([...exemptKeys].filter((key) => !OBSERVED.includes(key)).sort()).toEqual([]);
  });

  it('walks every shipped level and grades enough circuits to be a test', () => {
    // Non-vacuity: an audit that skipped every part would satisfy both assertions
    // above with an empty table. The floors are the shipped level count and a
    // round number well under one level's own sweep.
    expect(LEVELS.length).toBeGreaterThanOrEqual(56);
    expect(RESULT.gradings).toBeGreaterThan(2000);
    expect(new Set(RESULT.findings.map((finding) => finding.level)).size).toBeLessThanOrEqual(
      LEVELS.length,
    );
  });

  it('finds no level passable on an empty board', () => {
    // Separated from the table above on purpose: this one is not a policy list but
    // a completeness claim -- a level that grades nothing, or that a blank board
    // already satisfies, is a missing-level test rather than a design choice.
    expect(OBSERVED.filter((key) => key.endsWith('|empty'))).toEqual([]);
  });
});
