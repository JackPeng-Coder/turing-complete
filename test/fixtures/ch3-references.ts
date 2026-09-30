import type { Graph } from '../../src/core/graph';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';
import { build, type Node } from './build';

/** Sets a level `level_output` instance's pin width (`params.width`). */
function outWidth(g: Graph, id: string, width: number): void {
  const inst = g.instances.find((i) => i.id === id);
  if (!inst) throw new Error(`no such instance: ${id}`);
  inst.params.width = width;
}

/**
 * Chapter 3's reference solutions.
 *
 * Same split as `ch2-references.ts`, for the same reason: the whole-set walk
 * (`test/levels/level-buildability.test.ts`) has to hand `paletteDefsFor` a
 * circuit per shipped level, and a test file may not reach into another test
 * file. One definition, graded by the batch test and by the walk.
 *
 * Only circuits that PASS their level live here -- the ones the three-star
 * targets were measured from. The plausible-wrong circuits stay in the batch
 * test that asserts they fail, because those are that file's argument.
 *
 * The chapter is authored batch by batch; each batch's references are added to
 * their own map and the union below, so an unfinished batch cannot make a
 * finished one look complete.
 */

/**
 * Level 39: the six-operation ALU.
 *
 * Every wire below is one row of the operation table, and the table is `aluOp`
 * in `src/levels/content/ch3/batch1.ts`:
 *
 * | op | operation |
 * |---|---|
 * | 0 | add |
 * | 1 | subtract |
 * | 2 | AND |
 * | 3 | OR |
 * | 4 | NAND |
 * | 5 | NOR |
 * | 6, 7 | 0 (reserved) |
 *
 * THE PIN NAMES ARE THE FIELD'S BIT POSITIONS, so the code is `op0 + 2*op1 +
 * 4*op2` and `op2` -- not `op0` -- is the high bit. Read as the pair `(op2, op1)`
 * the encoding is a four-way mode, and the circuit is one mux level per selector
 * bit rather than a decode tree:
 *
 *   op2 op1 | mode            | the row, and what chooses it
 *   --------|-----------------|----------------------------------------------
 *   0   0   | arithmetic      | op0 picks the adder's addend, `b` or `~b`, and
 *           |                 | is that same adder's carry-in: a+b, or a+~b+1
 *   0   1   | bitwise         | op0 picks AND or OR
 *   1   0   | bitwise negated | op0 picks NAND or NOR: that same pick, inverted
 *   1   1   | reserved        | 0, forced by `zero` below
 *
 * THE ROLES ARE NOT INTERCHANGEABLE, which is the mistake this wiring used to
 * carry. Subtract is code 1: `op0` high and `op1` low. An addend mux or a carry
 * driven by `op1` therefore cannot subtract anything -- code 1 came out as add
 * -- and codes 2 and 3, the bitwise rows, are `op2` LOW, so a class mux on `op2`
 * alone cannot reach them either: it publishes the arithmetic result for two
 * codes whose answer is AND and OR.
 *
 * WHY THE NEGATION IS NOT MASKED. NAND and NOR are a plain `not8` of the AND/OR
 * pick, with no `switch8`-gated all-ones byte and no `xor8` in front of it,
 * because the negation is only ever SELECTED by the op2 mux: the op1 = 1 half,
 * where codes 2, 3, 6 and 7 live, never sees it and has nothing to mask. The
 * masked spelling costs a `switch8` and an `xor8` -- 48 gates -- to publish the
 * same bytes `not8` publishes for 8, and a mask that has to agree with the mux's
 * own select is a second place for the two to disagree.
 *
 * WHY THE RESERVED CODES ARE ZEROED IN THE op1 = 1 HALF ALONE. Codes 6 and 7 are
 * `op1 = 1` with `op2 = 1`, so within that half `~op2` is the whole
 * discriminator and a single `not` plus a single `switch8` forces the byte to
 * zero. ANDing a broadcast all-ones mask into BOTH halves instead -- the
 * previous shape here -- spends a `nand`, a `switch8` and two `and8`s (49 gates)
 * to zero two codes that only one half can select, because `op2 & op1` is
 * exactly "the op1 = 1 half with op2 high".
 *
 * Wired one pin at a time on purpose: `build()`'s positional shorthand wires a
 * part's pins in DECLARATION order, and a mux tree is exactly where a
 * transposed pair stops being visible by eye. The mux convention is `(a, b,
 * sel)` with `a` passing at `sel = 0`, and `switch8`'s is `(a, on)` with `on = 1`
 * passing `a`.
 */
export function aluReference(): Graph {
  const g = emptyGraph();
  const inst = new Map<string, string>();
  const add = (id: string, def: string): string => {
    const i = addInstance(g, def, 120, 0, id).id;
    inst.set(id, i);
    return i;
  };
  const input = (pin: string, width: number): string => {
    const i = addInstance(g, 'level_input', 0, 0, `IN_${pin}`).id;
    g.instances.find((x) => x.id === i)!.params.width = width;
    inst.set(`IN_${pin}`, i);
    return i;
  };
  const wire = (fromId: string, fromPin: string, toId: string, toPin: string): void => {
    connect(g, { inst: inst.get(fromId)!, port: fromPin }, { inst: inst.get(toId)!, port: toPin });
  };

  input('a', 8);
  input('b', 8);
  input('op0', 1);
  input('op1', 1);
  input('op2', 1);

  // op0 PICKS INSIDE EACH PAIR, and it is the same bit for both pairs: `b` vs
  // `~b` for the adder's addend, AND vs OR for the bitwise result. Subtract is
  // the same sum with the addend inverted and the bit that
  // inverted it added back -- `a + ~b + 1` -- so op0 drives the adder's `cin` as
  // well as the mux in front of its `b`, and the two rows cost one adder and one
  // mux. Driving either from `op1` is the transposition the header records: code
  // 1 is `op0` high and `op1` low, so it would come out as add.
  add('nb', 'not8');
  wire('IN_b', 'out', 'nb', 'a');
  add('mxAdd', 'mux8');
  wire('IN_b', 'out', 'mxAdd', 'a');
  wire('nb', 'out', 'mxAdd', 'b');
  wire('IN_op0', 'out', 'mxAdd', 'sel');
  add('ad', 'add8');
  wire('IN_a', 'out', 'ad', 'a');
  wire('mxAdd', 'out', 'ad', 'b');
  wire('IN_op0', 'out', 'ad', 'cin');

  // and = a & b; or = a | b, the other op0 pick.
  add('la', 'and8');
  wire('IN_a', 'out', 'la', 'a');
  wire('IN_b', 'out', 'la', 'b');
  add('lo', 'or8');
  wire('IN_a', 'out', 'lo', 'a');
  wire('IN_b', 'out', 'lo', 'b');
  add('mxLog', 'mux8');
  wire('la', 'out', 'mxLog', 'a');
  wire('lo', 'out', 'mxLog', 'b');
  wire('IN_op0', 'out', 'mxLog', 'sel');

  // NAND and NOR are that pick inverted, and NOTHING is done to the inversion:
  // the op2 mux below is the only part that can ever select `inv`, so a mask
  // saying "only invert when op2 is high" would be a second copy of a select
  // this circuit already makes (see the header).
  add('inv', 'not8');
  wire('mxLog', 'out', 'inv', 'a');

  // Codes 6 and 7 are op1 and op2 both high, so inside the op1 = 1 half `~op2`
  // is the whole discriminator: it passes the bitwise byte for codes 2 and 3 and
  // forces zero for 6 and 7. `switch8` rather than an AND against a broadcast
  // mask, which would need a `const8` plus an `and8` to say the same thing.
  add('nOp2', 'not');
  wire('IN_op2', 'out', 'nOp2', 'a');
  add('zero', 'switch8');
  wire('mxLog', 'out', 'zero', 'a');
  wire('nOp2', 'out', 'zero', 'on');

  // THE HALVES, one mux each. op1 = 0 is arithmetic (op2 = 0) or negated
  // bitwise (op2 = 1); op1 = 1 is bitwise (op2 = 0) or the zeroed reserved codes
  // (op2 = 1). `a` is the sel = 0 input, which for the top mux is the op1 = 0
  // half -- the half the arithmetic rows live in.
  add('mxOp2', 'mux8');
  wire('ad', 'out', 'mxOp2', 'a');
  wire('inv', 'out', 'mxOp2', 'b');
  wire('IN_op2', 'out', 'mxOp2', 'sel');
  add('mxOp1', 'mux8');
  wire('mxOp2', 'out', 'mxOp1', 'a');
  wire('zero', 'out', 'mxOp1', 'b');
  wire('IN_op1', 'out', 'mxOp1', 'sel');

  const out = addInstance(g, 'level_output', 240, 0, 'OUT').id;
  outWidth(g, out, 8);
  connect(g, { inst: inst.get('mxOp1')!, port: 'out' }, { inst: out, port: 'in' });
  return g;
}

/**
 * Level 40: eight byte-wide registers, one per address.
 *
 * The write path is the level's point: `decoder3` turns the address into one
 * selected line and the line is ANDed with `we`, so enable and address must agree
 * before anything moves. The read path is a three-level mux tree.
 *
 * THIS REFERENCE WAS REBUILT, NOT PATCHED. The version that shipped with the
 * chapter was wrong in three independent ways at once, which is worth recording
 * because each one alone would have been enough to fail the level and none was
 * visible without running it:
 *
 *  * its stores were `mem1` cells wired `from: ['data', gate]`, and `build()`
 *    wires a part's pins in DECLARATION order -- `mem1` declares `set` first and
 *    `value` second, so the store latched on the data bit and the write gate was
 *    irrelevant. `byteStore` is gone rather than repaired;
 *  * its read tree was built from `mux8`, the BYTE-wide mux, to select single
 *    BITS, and its `sel` inputs came from a splitter on `addr` while the write
 *    path decoded the same address through `decoder3` -- two different readings
 *    of one signal in one circuit;
 *  * its `level_output` declared no width, so it compiled at 1 bit and
 *    `bindLevelIo` refused to bind it, turning every failure into the same
 *    uninformative `missing-io`.
 *
 * The rebuild uses `reg8` -- the byte-wide register with a `load` enable -- for
 * the stores, and gets the read select from the SAME `decoder3` one-hot lines the
 * write path uses, which is what makes the two halves agree by construction
 * rather than by two independent decodings that happen to look alike.
 */
function registerBankReference(): Graph {
  return build([
    { kind: 'input', name: 'clk', width: 1 },
    { kind: 'input', name: 'we', width: 1 },
    { kind: 'input', name: 'addr', width: 3 },
    { kind: 'input', name: 'data', width: 8 },

    // One node addresses all eight registers on both sides.
    { kind: 'part', def: 'decoder3', id: 'dec', from: ['addr'] },
    // `decoder3` publishes ONE eight-bit output pin, not eight one-bit pins --
    // `dec.out` is the one-hot byte and this splitter is what turns it into the
    // eight individual select lines. Referring to `dec.b0`..`dec.b7` directly was
    // the original bug: those pins do not exist, `validateGraph` reported eight
    // `unknown-port` issues, all eight AND gates lost their `b` input to
    // `dangling-input`, and the whole write path held at zero.
    { kind: 'part', def: 'splitter', id: 'sel', from: ['dec.out'], width: 8 },
    { kind: 'part', def: 'splitter', id: 'as', from: ['addr'] },
    // `reset` is tied low, so a register never clears: that pin is the reset
    // input `reg8` carries for other circuits, and this one has no use for it.
    { kind: 'part', def: 'const_off', id: 'never', from: [] },

    // Write select: the address line AND the write enable. Both must agree.
    { kind: 'part', def: 'and', id: 'g0', from: ['we', 'sel.b0'] },
    { kind: 'part', def: 'and', id: 'g1', from: ['we', 'sel.b1'] },
    { kind: 'part', def: 'and', id: 'g2', from: ['we', 'sel.b2'] },
    { kind: 'part', def: 'and', id: 'g3', from: ['we', 'sel.b3'] },
    { kind: 'part', def: 'and', id: 'g4', from: ['we', 'sel.b4'] },
    { kind: 'part', def: 'and', id: 'g5', from: ['we', 'sel.b5'] },
    { kind: 'part', def: 'and', id: 'g6', from: ['we', 'sel.b6'] },
    { kind: 'part', def: 'and', id: 'g7', from: ['we', 'sel.b7'] },

    { kind: 'part', def: 'reg8', id: 'r0', from: ['data', 'g0', 'never'] },
    { kind: 'part', def: 'reg8', id: 'r1', from: ['data', 'g1', 'never'] },
    { kind: 'part', def: 'reg8', id: 'r2', from: ['data', 'g2', 'never'] },
    { kind: 'part', def: 'reg8', id: 'r3', from: ['data', 'g3', 'never'] },
    { kind: 'part', def: 'reg8', id: 'r4', from: ['data', 'g4', 'never'] },
    { kind: 'part', def: 'reg8', id: 'r5', from: ['data', 'g5', 'never'] },
    { kind: 'part', def: 'reg8', id: 'r6', from: ['data', 'g6', 'never'] },
    { kind: 'part', def: 'reg8', id: 'r7', from: ['data', 'g7', 'never'] },

    // Read select: an 8:1 tree over bytes, `as.b0` choosing within each pair and
    // `as.b2` choosing between the halves.
    { kind: 'part', def: 'mux8', id: 'p0', from: ['r0', 'r1', 'as.b0'] },
    { kind: 'part', def: 'mux8', id: 'p1', from: ['r2', 'r3', 'as.b0'] },
    { kind: 'part', def: 'mux8', id: 'p2', from: ['r4', 'r5', 'as.b0'] },
    { kind: 'part', def: 'mux8', id: 'p3', from: ['r6', 'r7', 'as.b0'] },
    { kind: 'part', def: 'mux8', id: 'q0', from: ['p0', 'p1', 'as.b1'] },
    { kind: 'part', def: 'mux8', id: 'q1', from: ['p2', 'p3', 'as.b1'] },
    { kind: 'part', def: 'mux8', id: 'm6', from: ['q0', 'q1', 'as.b2'] },

    // `width: 8` is not decoration. `build()`'s `output` node defaults to ONE bit,
    // and a `level_output` compiled at 1 bit against a level declaring 8 is not a
    // narrower read -- `bindLevelIo` refuses to bind it at either width, so the
    // whole check collapses to `missing-io` and the reference looks like it fails
    // the level it is the reference FOR. Level 41's two outputs carry the same
    // property and were the reason its reference never hit this.
    { kind: 'output', from: 'm6', width: 8 },
  ]);
}

/**
 * Level 41: the control fan-out. `sel[1]` picks the side and a switch forces the
 * other side to zero -- deliberately NOT `sel` forwarded to the outputs.
 */
function fanOutReference(): Graph {
  return build([
    { kind: 'input', name: 'clk', width: 1 },
    { kind: 'input', name: 'sel', width: 2 },
    { kind: 'input', name: 'data', width: 8 },
    { kind: 'part', def: 'splitter', id: 'sp', from: ['sel'] },
    { kind: 'part', def: 'not', id: 'n1', from: ['sp.b1'] },
    { kind: 'part', def: 'switch8', id: 'sa', from: ['data', 'n1'] },
    { kind: 'part', def: 'switch8', id: 'sb', from: ['data', 'sp.b1'] },
    // `OUT_<pin>`, not the bare pin name. `bindLevelIo` looks for `OUT_a.in` /
    // `OUT_b.in` on a multi-output level, and `build()` names an output instance
    // from `node.name` -- so `name: 'a'` produces an instance called `a`, which
    // binds nothing, and BOTH outputs read 0 for every step of every check.
    // Chapter 2's multi-output references spell it `OUT_sum`/`OUT_cout` for
    // exactly this reason.
    { kind: 'output', name: 'OUT_a', from: 'sa', width: 8 },
    { kind: 'output', name: 'OUT_b', from: 'sb', width: 8 },
  ]);
}

export const CH3_BATCH1_REFERENCES: Record<string, () => Graph> = {
  'ch3-39-arithmetic-engine': aluReference,
  'ch3-40-registers': registerBankReference,
  'ch3-41-component-factory': fanOutReference,
};

// ---------------------------------------------------------------------------
// Levels 42-44 (batch 2): the decoder, the calculation unit, the conditions
// ---------------------------------------------------------------------------

/**
 * Level 42: the instruction word sliced into the four fields the level
 * publishes -- `instr[7:6]` mode, `instr[5:3]` op, `instr[2:0]` dst and
 * `instr[5:0]` imm.
 *
 * Five parts and one rail, and no `instr_decoder`: the level's whole point is
 * that the player knows which bits are which field, so the reference shows the
 * slices rather than dropping the packaged part in. Both spellings tie -- 0
 * gates, 0 delay, 0 ticks -- and the level's palette offers both, so the level
 * cannot tell them apart and does not try to.
 *
 * `maker` is 8 bits wide and the fields it feeds are 2, 3, 3 and 6, so the high
 * inputs are tied to the low rail: an unwired input would read 0 just the same,
 * and wiring it says so on the page.
 */
function sliceDecoderReference(): Graph {
  const off = ['off', 'off', 'off', 'off', 'off', 'off', 'off', 'off'] as const;
  return build([
    { kind: 'input', name: 'instr', width: 8 },
    { kind: 'part', def: 'splitter', id: 'sp', from: ['instr'] },
    { kind: 'part', def: 'const_off', id: 'off', from: [] },
    // mode = instr[7:6], least significant bit first: b6 is mode bit 0.
    { kind: 'part', def: 'maker', id: 'mode', from: ['sp.b6', 'sp.b7', ...off.slice(2)] },
    { kind: 'part', def: 'maker', id: 'op', from: ['sp.b3', 'sp.b4', 'sp.b5', ...off.slice(3)] },
    { kind: 'part', def: 'maker', id: 'dst', from: ['sp.b0', 'sp.b1', 'sp.b2', ...off.slice(3)] },
    {
      kind: 'part',
      def: 'maker',
      id: 'imm',
      from: ['sp.b0', 'sp.b1', 'sp.b2', 'sp.b3', 'sp.b4', 'sp.b5', 'off', 'off'],
    },
    { kind: 'output', name: 'OUT_mode', from: 'mode', width: 2 },
    { kind: 'output', name: 'OUT_op', from: 'op', width: 3 },
    { kind: 'output', name: 'OUT_dst', from: 'dst', width: 3 },
    { kind: 'output', name: 'OUT_imm', from: 'imm', width: 6 },
  ]);
}

/**
 * Level 43: the calculation unit -- program memory, instruction decoder, the
 * six-register file, the ALU and the write path, with no program counter.
 *
 * THE INSTRUCTION ADDRESS ARRIVES ON THE LEVEL'S `instr` PIN. A `program` check
 * must have a `ram_prog` to load its image into (`programTargets` in
 * `levels/checks.ts`), so the image is what this machine executes and the level
 * pin carries the ADDRESS it is fetched from. That is the one thing this level
 * does not share with levels 45-47, where a `pc8` supplies the address.
 *
 * THE REGISTER FILE'S TWO READ PORTS ARE BOTH SPOKEN FOR: `addrA` carries the
 * `move` source (and REG1 for a `calc`) and `addrB` stays REG2. So the byte the
 * level publishes on `res` is a SHADOW of REG3: an 8-bit register that latches
 * the same `data` byte on exactly the edges the register file writes REG3
 * (`we AND dst = 3`). The two can never disagree -- REG3 changes only on those
 * edges, and both start at zero -- and storage is free on both metrics, so the
 * shadow costs the reference nothing but says where the byte came from.
 *
 * The options are what `test/levels/ch3-batch2.test.ts` varies to build
 * plausible-wrong machines; the level's own reference takes both defaults.
 */
export interface ComputeUnitOptions {
  /** Where `loadi` writes: this level's design muxes REG0 in, or straight to `dst`. */
  readonly loadiAddress?: 'reg0' | 'dst';
  /** What the ALU is asked to compute: the decoded `op` field, or always `add`. */
  readonly aluOp?: 'decoded' | 'add';
}

export function computeUnitGraph(options: ComputeUnitOptions = {}): Graph {
  const off = ['off', 'off', 'off', 'off', 'off', 'off', 'off', 'off'] as const;
  return build([
    { kind: 'input', name: 'clk' },
    { kind: 'input', name: 'instr', width: 8 },
    { kind: 'input', name: 'inp', width: 8 },
    { kind: 'part', def: 'const_on', id: 'on', from: [] },
    { kind: 'part', def: 'const_off', id: 'off', from: [] },
    // The program image, addressed by the level's own `instr` pin.
    { kind: 'part', def: 'ram_prog', id: 'RAM', from: ['instr'] },
    { kind: 'part', def: 'instr_decoder', id: 'DEC', from: ['RAM'] },
    { kind: 'part', def: 'splitter', id: 'MODE', from: ['DEC.mode'] },
    { kind: 'part', def: 'not', id: 'n_m1', from: ['MODE.b1'] },
    { kind: 'part', def: 'not', id: 'n_m0', from: ['MODE.b0'] },
    // 00 loadi, 01 calc, 10 move, and `we` is "not 11" -- a jump writes nothing.
    { kind: 'part', def: 'nor', id: 'is_loadi', from: ['MODE.b1', 'MODE.b0'] },
    { kind: 'part', def: 'and', id: 'is_calc', from: ['n_m1', 'MODE.b0'] },
    { kind: 'part', def: 'and', id: 'is_move', from: ['MODE.b1', 'n_m0'] },
    { kind: 'part', def: 'nand', id: 'we', from: ['MODE.b1', 'MODE.b0'] },
    // One-hot decodes: dst = 3 selects the shadow's edge, src = 6 selects `inp`.
    { kind: 'part', def: 'decoder3', id: 'DST', from: ['DEC.dst'] },
    { kind: 'part', def: 'splitter', id: 'DST_BITS', from: ['DST'] },
    { kind: 'part', def: 'decoder3', id: 'SRC', from: ['DEC.src'] },
    { kind: 'part', def: 'splitter', id: 'SRC_BITS', from: ['SRC'] },
    // The three 3-bit read addresses this level needs: REG1, REG2 and REG3.
    { kind: 'part', def: 'maker', id: 'ONE', from: ['on', ...off.slice(1)] },
    { kind: 'part', def: 'maker', id: 'TWO', from: ['off', 'on', ...off.slice(2)] },
    { kind: 'part', def: 'maker', id: 'THREE', from: ['on', 'on', ...off.slice(2)] },
    // addrA = move ? src : REG1. addrB is REG2, always: only `calc` reads it.
    { kind: 'part', def: 'mux8', id: 'addrA', from: ['ONE', 'DEC.src', 'is_move'] },
    { kind: 'part', def: 'regfile6', id: 'RF', from: ['addrA', 'TWO', 'waddr_final', 'data', 'we'] },
    {
      kind: 'part',
      def: 'alu8',
      id: 'ALU',
      from: ['RF.a', 'RF.b', options.aluOp === 'add' ? 'off' : 'DEC.op'],
    },
    // The move source: code 6 is `inp`, and the register file has no byte for it.
    { kind: 'part', def: 'mux8', id: 'srcData', from: ['RF.a', 'inp', 'SRC_BITS.b6'] },
    { kind: 'part', def: 'mux8', id: 'd1', from: ['srcData', 'ALU', 'is_calc'] },
    { kind: 'part', def: 'mux8', id: 'data', from: ['d1', 'DEC.imm', 'is_loadi'] },
    // WHERE AN INSTRUCTION WRITES, which is not one field. `loadi` writes REG0
    // (its six bits ARE the value), `calc` writes REG3 -- its [2:0] slice is
    // RESERVED and the assembler leaves it zero -- and `move` writes the
    // destination field it carries. Three rules, two selects.
    {
      kind: 'part',
      def: 'switch8',
      id: 'waddr',
      from: ['DEC.dst', options.loadiAddress === 'dst' ? 'on' : 'is_move'],
    },
    {
      kind: 'part',
      def: 'mux8',
      id: 'waddr_final',
      from: ['waddr', 'THREE', 'is_calc'],
    },
    // The shadow follows REG3, so its edge is "the effective write address is 3":
    // every `calc`, and a `move` whose destination field says 3.
    { kind: 'part', def: 'and', id: 'move_to_reg3', from: ['is_move', 'DST_BITS.b3'] },
    { kind: 'part', def: 'or', id: 'reg3_select', from: ['is_calc', 'move_to_reg3'] },
    { kind: 'part', def: 'reg8', id: 'REG3', from: ['data', 'reg3_select', 'off'] },
    { kind: 'output', from: 'REG3', width: 8 },
  ]);
}

/** Level 43's reference: the calculation unit as designed above. */
function computeUnitReference(): Graph {
  return computeUnitGraph();
}

/**
 * Level 44: the condition test alone -- one register holding the compared value,
 * the jump's condition field, and `skip`.
 *
 * ONE REGISTER, AND THE LEVEL SAYS SO. The source's achievement for this level is
 * "only 10 blue components", and the reduced machine is what buys it: a `loadi`
 * writes the 6-bit immediate into the register and a jump reads it back as its
 * condition value. In the full OVERTURE (levels 45-47) those are two registers --
 * REG0 and REG3 -- wired by a `move`; here the level's brief states the reduction
 * in both languages, and the check drives `loadi` to set the value.
 *
 * The condition logic is the ISA's three defined conditions and nothing else:
 * `j` (000) is taken, `jz` (001) is taken when the held byte is zero, `jnz` (010)
 * when it is not, and every other three-bit code is not a branch and publishes 0
 * -- `decoder3` already answers `cond = 0/1/2` and leaves 3..7 low, so the
 * level's contract is total without a second comparison.
 *
 * The options are what `test/levels/ch3-batch2.test.ts` varies to build
 * plausible-wrong condition units; the reference takes both defaults.
 */
export interface ConditionsOptions {
  /** Gate the branch on the mode bits (this level's design), or publish the condition decode alone. */
  readonly modeGate?: boolean;
  /** Let `loadi` write the compared value, or never load it at all. */
  readonly loadValue?: boolean;
}

export function conditionsGraph(options: ConditionsOptions = {}): Graph {
  return build([
    { kind: 'input', name: 'clk' },
    { kind: 'input', name: 'instr', width: 8 },
    { kind: 'part', def: 'const_on', id: 'on', from: [] },
    { kind: 'part', def: 'const_off', id: 'off', from: [] },
    { kind: 'part', def: 'instr_decoder', id: 'DEC', from: ['instr'] },
    { kind: 'part', def: 'splitter', id: 'MODE', from: ['DEC.mode'] },
    { kind: 'part', def: 'nor', id: 'is_loadi', from: ['MODE.b1', 'MODE.b0'] },
    { kind: 'part', def: 'and', id: 'is_jump', from: ['MODE.b1', 'MODE.b0'] },
    {
      kind: 'part',
      def: 'reg8',
      id: 'REG',
      from: ['DEC.imm', options.loadValue === false ? 'off' : 'is_loadi', 'off'],
    },
    { kind: 'part', def: 'equal8', id: 'ZERO', from: ['REG', 'off'] },
    { kind: 'part', def: 'decoder3', id: 'COND', from: ['DEC.op'] },
    { kind: 'part', def: 'splitter', id: 'COND_BITS', from: ['COND'] },
    { kind: 'part', def: 'and', id: 'g_jz', from: ['COND_BITS.b1', 'ZERO'] },
    { kind: 'part', def: 'not', id: 'n_zero', from: ['ZERO'] },
    { kind: 'part', def: 'and', id: 'g_jnz', from: ['COND_BITS.b2', 'n_zero'] },
    { kind: 'part', def: 'or3', id: 'taken', from: ['COND_BITS.b0', 'g_jz', 'g_jnz'] },
    {
      kind: 'part',
      def: 'and',
      id: 'skip',
      from: [options.modeGate === false ? 'on' : 'is_jump', 'taken'],
    },
    { kind: 'output', from: 'skip', width: 1 },
  ]);
}

/** Level 44's reference: the condition unit as designed above. */
function conditionsReference(): Graph {
  return conditionsGraph();
}

export const CH3_BATCH2_REFERENCES: Record<string, () => Graph> = {
  'ch3-42-instruction-decoder': sliceDecoderReference,
  'ch3-43-calculations': computeUnitReference,
  'ch3-44-conditions': conditionsReference,
};

// ---------------------------------------------------------------------------
// Levels 45-47 (batch 3): the machine
// ---------------------------------------------------------------------------

/**
 * The OVERTURE machine levels 45, 46 and 47 are graded on: one program RAM
 * addressed by the program counter, the decoder, the six-register file, the ALU,
 * the write path, the conditional jump's glue, and the halt line that freezes the
 * counter once the program has put its answer on `out`.
 *
 * ONE BUILDER, THREE LEVELS, and the same graph for all three: 45's straight-line
 * program and 47's loop differ only in the image the check assembles, which is
 * exactly the claim those levels make. 47 is the acceptance level, so its test
 * also builds this machine with the conditional jump short-circuited
 * (`jump: 'never'` and `jump: 'always'`) and asserts the loop program fails both.
 *
 * THE INSTRUCTION IS EXECUTED BY THE EDGE THAT ADVANCES PAST IT. The program RAM
 * is combinational from `PC`, so at the start of a tick the machine is looking at
 * `ram[PC]`; every storage element samples that same decode on the edge -- the
 * register file writes, the counter takes the jump target or its successor -- and
 * the settle that follows publishes the new state. One edge, one instruction.
 *
 * THE READ PORTS. `addrA` is the `move` source, REG1 for a `calc` and REG0 for a
 * `jump` (the jump target, per the compendium's §6.4); `addrB` is REG2 for a
 * `calc` and REG3 for a `jump` (the condition value). The mux chain is what makes
 * one pair of ports serve all three modes.
 *
 * `out` IS COMBINATIONAL AND `halt` IS WHAT MAKES THAT HONEST. `out` publishes
 * the `move` source while the instruction being looked at is `move|sX|out`;
 * without the halt the counter would walk on and `out` would fall back to zero,
 * so the halt line freezes the counter on the `out` instruction's own address and
 * the answer stays put. A player who instead registers the `out` byte passes the
 * same checks (the byte they publish is the same byte), and both are accepted:
 * what the level asserts is the value, not the spelling.
 */
export interface OvertureOptions {
  /**
   * What the counter's load signal does with a jump: this machine's conditional
   * glue, never (the jump path is short-circuited low), or always (a jump is
   * taken whatever the condition says).
   */
  readonly jump?: 'conditional' | 'never' | 'always';
  /**
   * How the immediate reaches the register file: the full six-bit field, a
   * five-bit slice of it (bit 5 dropped, the classic off-by-one-wire), or not at
   * all (the `loadi` select tied low, so the write data is always the move
   * source).
   */
  readonly immediate?: 'sixBits' | 'fiveBits' | 'never';
  /**
   * Whether writing `out` freezes the counter. `false` ties the halt line low,
   * which is the machine a player builds when they forget that `out` is
   * combinational: the byte is right for one edge and gone the next.
   */
  readonly halt?: boolean;
}

export function overtureMachine(options: OvertureOptions = {}): Graph {
  const off = ['off', 'off', 'off', 'off', 'off', 'off', 'off', 'off'] as const;
  const jumpSignal =
    options.jump === 'never' ? 'off' : options.jump === 'always' ? 'is_jump' : 'taken';
  return build([
    { kind: 'input', name: 'clk' },
    { kind: 'part', def: 'const_on', id: 'on', from: [] },
    { kind: 'part', def: 'const_off', id: 'off', from: [] },
    { kind: 'part', def: 'ram_prog', id: 'RAM', from: ['PC'] },
    { kind: 'part', def: 'pc8', id: 'PC', from: ['pc_load', 'pc_in'] },
    { kind: 'part', def: 'instr_decoder', id: 'DEC', from: ['RAM'] },
    { kind: 'part', def: 'splitter', id: 'MODE', from: ['DEC.mode'] },
    { kind: 'part', def: 'not', id: 'n_m1', from: ['MODE.b1'] },
    { kind: 'part', def: 'not', id: 'n_m0', from: ['MODE.b0'] },
    // 00 loadi, 01 calc, 10 move; `we` is "not 11" and `is_jump` is 11 itself.
    { kind: 'part', def: 'nor', id: 'is_loadi', from: ['MODE.b1', 'MODE.b0'] },
    { kind: 'part', def: 'and', id: 'is_calc', from: ['n_m1', 'MODE.b0'] },
    { kind: 'part', def: 'and', id: 'is_move', from: ['MODE.b1', 'n_m0'] },
    { kind: 'part', def: 'and', id: 'is_jump', from: ['MODE.b1', 'MODE.b0'] },
    { kind: 'part', def: 'nand', id: 'we', from: ['MODE.b1', 'MODE.b0'] },
    { kind: 'part', def: 'decoder3', id: 'DST', from: ['DEC.dst'] },
    { kind: 'part', def: 'splitter', id: 'DST_BITS', from: ['DST'] },
    // The condition field is bits [5:3], the same slice the decoder calls `op`.
    { kind: 'part', def: 'decoder3', id: 'COND', from: ['DEC.op'] },
    { kind: 'part', def: 'splitter', id: 'COND_BITS', from: ['COND'] },
    // REG1 / REG2 / REG3 as 8-bit makers: only the low three bits reach `addrA`/`addrB`.
    { kind: 'part', def: 'maker', id: 'ONE', from: ['on', ...off.slice(1)] },
    { kind: 'part', def: 'maker', id: 'TWO', from: ['off', 'on', ...off.slice(2)] },
    { kind: 'part', def: 'maker', id: 'THREE', from: ['on', 'on', ...off.slice(2)] },
    // addrA = move ? src : REG1; a jump reads REG0 (we is low, so the switch zeroes it).
    { kind: 'part', def: 'mux8', id: 'addrA1', from: ['ONE', 'DEC.src', 'is_move'] },
    { kind: 'part', def: 'switch8', id: 'addrA', from: ['addrA1', 'we'] },
    // addrB = jump ? REG3 : REG2: the condition value, or the ALU's second operand.
    { kind: 'part', def: 'mux8', id: 'addrB', from: ['TWO', 'THREE', 'is_jump'] },
    { kind: 'part', def: 'regfile6', id: 'RF', from: ['addrA', 'addrB', 'waddr_final', 'data', 'we'] },
    { kind: 'part', def: 'alu8', id: 'ALU', from: ['RF.a', 'RF.b', 'DEC.op'] },
    { kind: 'part', def: 'mux8', id: 'd1', from: ['RF.a', 'ALU', 'is_calc'] },
    // The five-bit variant slices the immediate before it reaches the mux: the
    // counterexample for level 46, where 63 would arrive as 31.
    ...(options.immediate === 'fiveBits'
      ? ([
          { kind: 'part', def: 'splitter', id: 'SPIMM', from: ['DEC.imm'] },
          {
            kind: 'part',
            def: 'maker',
            id: 'IMM5',
            from: ['SPIMM.b0', 'SPIMM.b1', 'SPIMM.b2', 'SPIMM.b3', 'SPIMM.b4', 'off', 'off', 'off'],
          },
        ] as const)
      : []),
    {
      kind: 'part',
      def: 'mux8',
      id: 'data',
      from: [
        'd1',
        options.immediate === 'fiveBits' ? 'IMM5' : 'DEC.imm',
        options.immediate === 'never' ? 'off' : 'is_loadi',
      ],
    },
    // WHERE AN INSTRUCTION WRITES, which is not one field: `loadi` writes REG0
    // (its six bits ARE the value), `calc` writes REG3 -- its [2:0] slice is
    // RESERVED and the assembler leaves it zero -- and `move` writes the
    // destination field it carries.
    { kind: 'part', def: 'switch8', id: 'waddr', from: ['DEC.dst', 'is_move'] },
    { kind: 'part', def: 'mux8', id: 'waddr_final', from: ['waddr', 'THREE', 'is_calc'] },
    // The condition value is REG3, which `addrB` publishes during a jump.
    { kind: 'part', def: 'equal8', id: 'ZERO', from: ['RF.b', 'off'] },
    { kind: 'part', def: 'and', id: 'g_jz', from: ['COND_BITS.b1', 'ZERO'] },
    { kind: 'part', def: 'not', id: 'n_zero', from: ['ZERO'] },
    { kind: 'part', def: 'and', id: 'g_jnz', from: ['COND_BITS.b2', 'n_zero'] },
    { kind: 'part', def: 'or3', id: 'inner', from: ['COND_BITS.b0', 'g_jz', 'g_jnz'] },
    { kind: 'part', def: 'and', id: 'taken', from: ['is_jump', 'inner'] },
    // Writing `out` is what ends the program: the halt line holds the counter.
    { kind: 'part', def: 'and', id: 'out_load', from: ['is_move', 'DST_BITS.b7'] },
    { kind: 'part', def: 'halt', id: 'HALT', from: [options.halt === false ? 'off' : 'out_load'] },
    { kind: 'part', def: 'mux8', id: 'pc_in', from: ['RF.a', 'PC', 'HALT'] },
    { kind: 'part', def: 'or', id: 'pc_load', from: [jumpSignal, 'HALT'] },
    { kind: 'part', def: 'switch8', id: 'out_pin', from: ['RF.a', 'out_load'] },
    { kind: 'output', from: 'out_pin', width: 8 },
  ]);
}

/** Levels 45-47's reference: the machine above. */
function overtureReference(): Graph {
  return overtureMachine();
}

export const CH3_BATCH3_REFERENCES: Record<string, () => Graph> = {
  'ch3-45-program': overtureReference,
  'ch3-46-immediate-values': overtureReference,
  'ch3-47-turing-complete': overtureReference,
};

export const CH3_REFERENCES: Record<string, () => Graph> = {
  ...CH3_BATCH1_REFERENCES,
  ...CH3_BATCH2_REFERENCES,
  ...CH3_BATCH3_REFERENCES,
};
