import type { ComponentDef } from '../registry';
import type { PortValue } from '../signal';
import { FULL_ADDER, toUint } from './wide';

/**
 * The CPU family (phase 2, task 2): the six parts chapter 3 hands out and level
 * 47 builds OVERTURE out of -- `alu8`, `regfile6`, `instr_decoder`, `pc8`,
 * `ram_prog` and `halt`.
 *
 * THEY ARE PARTS, NOT A CPU. Global Constraint 11 says the CPU is something the
 * player builds; a `class Overture`, or any def that knows what an instruction
 * MEANS, is the thing this family must not become. Each def below is therefore
 * one datapath element with pins and a transfer function: `instr_decoder` slices
 * fields and never validates them, `alu8` maps an `op` field to a result and
 * never sees the instruction word, `regfile6` is a register bank with no notion
 * of a source or a destination, and `ram_prog` is a read-only 256-byte memory.
 * Which field steers which pin, when `we` is asserted, what a jump condition is
 * -- all of that is the level's own wiring (Global Constraint 13: instruction
 * semantics come from the player's circuit, never from a def).
 *
 * PIN IDS AND WIDTHS ARE THE CONTRACT. `instr_decoder`'s five output names and
 * widths are the field layout ruling 5 fixes (`mode` 2, `op` 3, `dst` 3, `src` 3,
 * `imm` 6), and chapter 3's level data addresses them verbatim -- so the ids and
 * pin lists are written out literally, like `wide.ts`'s operators, rather than
 * derived from a naming scheme, and `test/core/defs-cpu.test.ts` asserts the
 * whole surface instead of spot-checking a part.
 *
 * CATEGORY `'cpu'`, one of its own. The existing families are pinned exactly by
 * tests -- `logic1` IS the ten one-bit gates, `wide` IS the wide module's own
 * registration tuples, `level` IS the two IO connectors -- and these six are none
 * of those: five are 8-bit parts that are not the wide module's, and `halt` is a
 * one-bit wire that is not a gate. Filing them under `wide` would also make
 * `byCategory('wide')` disagree with the family `wide.ts` declares. Nothing
 * downstream groups the palette by category (`defs/index.ts` says so, and
 * `ui/board/render.ts` checks only `'level'`), so this is a label that says which
 * family a part belongs to and nothing more.
 *
 * COST: TWO METRICS, TWO FIELDS, THE SAME SPLIT `wide.ts` DOCUMENTS. `cost` is
 * the DELAY unit (0 for storage, a wire and a rail; 1 for an operator that is a
 * gate); `gateCost` is the NAND-equivalent GATE metric read only by
 * `levels/grader.ts`. Every def that is worth a NAND states the field
 * explicitly, and the three storage defs leave it ABSENT so that it reads
 * `cost`'s 0 -- the storage ruling `wide.ts` already carries at `reg8` / `ram8`
 * (the gate metric prices what the player BUILT, and storage is that metric's
 * deliberate exception). A second explicit 0 would only give the two zeroes a
 * way to drift apart.
 */

// ---------------------------------------------------------------------------
// GATE COST: the NAND-equivalent basis. The same table as `wide.ts` and
// `defs/index.ts` -- one 2-input NAND is the unit, so NOT = NAND(a, a) = 1,
// AND = 2, OR = 3, XOR = 4, MUX2 = 4, and `FULL_ADDER` = 9 is IMPORTED from
// `wide.ts` rather than restated, so the one-bit part registered as
// `full_adder` and the bit `alu8`'s adder is built from cannot be priced two
// different ways.
//
// No count below is taken on trust: `alu8`'s total is the term-by-term sum
// written out at its def, and `test/core/defs-cpu.test.ts` rebuilds that total
// out of the registered parts' own `gateCost`s.
// ---------------------------------------------------------------------------
const NOT = 1;
const AND = 2;
const OR = 3;
const XOR = 4;
const MUX2 = 4;

/** The family's data width: eight bits, in every id and pin below. */
const W = 8;

/** `regfile6`'s register count -- the id says six, and `stateBytes` is one per register. */
const REGS = 6;

/** A single-bit port, read as 0 or 1 (`wide.ts`'s private `bit` makes the same reading). */
const bit = (v: PortValue | undefined): number => toUint(v, 1);

/**
 * `alu8`: the eight-bit arithmetic engine level 39 rewards. `op` selects the
 * function, `a` and `b` are the operands, and every result is an unsigned byte
 * on `out`:
 *
 *   op | function | note
 *   ---|----------|----------------------------------------------------------
 *   0  | a + b    | the low eight bits; there is no carry-out pin
 *   1  | a - b    | `a + ~b + 1`, so 0 - 1 is 255, never a negative number
 *   2  | a AND b  |
 *   3  | a OR b   |
 *   4  | a NAND b |
 *   5  | a NOR b  |
 *   6  | 0        | RESERVED, decided below
 *   7  | 0        | RESERVED, decided below
 *
 * THE RESERVED OPS PUBLISH 0, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.
 * Ruling 5 gives computation six operations ([5:3] = 000..101) and leaves 110 /
 * 111 unreachable from a well-formed instruction. Left undefined ("don't care"),
 * the two codes would be values the ALU publishes without promising anything,
 * and the first level that asserts `out` across all eight codes would be
 * asserting a value no construction owes it. Publishing 0 makes the op map
 * total and observable, and neither reserved code aliases an implemented
 * operation -- the cheapest "default" would have been to fall through to `add`,
 * which turns a malformed instruction into silent arithmetic. The ISA rule that
 * `calc`'s reserved bits must be zero stays the LEVEL's (the decoder publishes
 * the field, the level checks it); this def reports 0, it does not trap.
 *
 * THE CELL, IN 2-INPUT NANDs -- 264 of them, one term per piece of the drawing.
 * The op field is decoded only into the four control lines the structure needs
 * (`c_sub`, `c_arith`, `c_or`, `c_inv`, plus `reserved`), never into a one-hot
 * decode:
 *
 *   term                       count             construction
 *   -------------------------- ----------------- -------------------------------
 *   ripple adder               8 x 9   =  72     8 x FULL_ADDER, `a` and `b` in
 *   sub's controlled inverter  8 x 4   =  32     one XOR per bit, `b XOR c_sub`.
 *                                                 The two's complement's +1 is
 *                                                 the adder's `cin` tied to that
 *                                                 same control line -- a rail, so
 *                                                 it is not a gate
 *   and                        8 x 2   =  16     one AND per bit
 *   or                         8 x 3   =  24     one OR per bit
 *   and/or select              8 x 4   =  32     one MUX2 per bit, on `op[0]`
 *   nand/nor invert            8 x 4   =  32     `x XOR ~op[1]`: nand is ~and and
 *                                                 nor is ~or, so the negated ops
 *                                                 are one inverter per bit
 *                                                 rather than two more arrays
 *   arithmetic/logic select    8 x 4   =  32     one MUX2 per bit, on `~op[2]`
 *   reserved-op zero mask      8 x 2   =  16     one AND per bit against
 *                                                 `~(op[2] & op[1])` -- true for
 *                                                 ops 6 (110) and 7 (111) only
 *   op decode                  1+1+4+2 =   8     ~op[1] and ~op[2] (one NOT
 *                                                 each), `c_sub = AND3(~op2,
 *                                                 ~op1, op0)` (4), and
 *                                                 `reserved = op2 & op1` (2)
 *   -------------------------- ----------------- -------------------------------
 *   total                                   264
 *
 * The three op bits enter only as those controls, so each row above is checkable
 * against the function by hand: 000 leaves `b` alone with `cin` low (add), 001
 * inverts `b` and raises `cin` (sub), 010/011 select the and/or result,
 * 100/101 select that same result and invert it, and 110/111 mask it to zero.
 * Sharing the and/or select across all four logic ops is why `nand8`'s 8 and
 * `nor8`'s 32 are not separate terms here: paying for them AND for a four-way
 * select would be the same function at a higher count.
 *
 * `test/core/defs-cpu.test.ts` rebuilds 264 from the registered parts' own
 * counts (`add8` 72, `and8` 16, `or8` 24, `mux8` 32, `switch8` 16, `xor` 4,
 * `not` 1, `and` 2), so the identity -- not this comment's arithmetic -- is what
 * pins the number.
 */
function aluOp(a: number, b: number, op: number): number {
  switch (op) {
    case 0:
      return (a + b) & 0xff;
    case 1:
      // Two's complement subtraction, `a + ~b + 1`, kept in one expression so
      // the intermediate is never negative: `(a - b) & 0xff` is the same byte.
      return (a - b) & 0xff;
    case 2:
      return a & b;
    case 3:
      return a | b;
    case 4:
      return ~(a & b) & 0xff;
    case 5:
      return ~(a | b) & 0xff;
    default:
      // Ops 6 and 7: reserved, and decided to publish 0 rather than to fall
      // through to an implemented operation (see the table above).
      return 0;
  }
}

const alu8: ComponentDef = {
  id: 'alu8',
  name: { zh: '8 位运算器', en: '8-Bit ALU' },
  category: 'cpu',
  inputs: [
    { id: 'a', width: W },
    { id: 'b', width: W },
    { id: 'op', width: 3 },
  ],
  outputs: [{ id: 'out', width: W }],
  // The DELAY unit, one per node (spec §3.2), like every operator in `wide.ts`.
  // The gate metric above is a different number on purpose.
  cost: 1,
  gateCost:
    W * FULL_ADDER + // ripple adder, 72
    W * XOR + // sub's controlled inverter, 32
    W * AND + // and, 16
    W * OR + // or, 24
    W * MUX2 + // and/or select, 32
    W * XOR + // nand/nor invert, 32
    W * MUX2 + // arithmetic/logic select, 32
    W * AND + // reserved-op zero mask, 16
    (2 * NOT + 2 * AND + AND), // op decode, 8
  sequential: false,
  stateBytes: 0,
  evaluate: (i, o) => {
    // `toUint` masks each pin into its field, so a poisoned or unwired input is
    // read as 0 exactly as the kernel reads an unwired bit.
    o[0] = aluOp(toUint(i[0], W), toUint(i[1], W), toUint(i[2], 3));
  },
};

/**
 * `regfile6`: six eight-bit registers, two combinational read ports and one
 * clocked write port. `a` publishes `state[addrA]`, `b` publishes
 * `state[addrB]`, and a clock edge writes `data` into `state[waddr]` -- but only
 * while `we` is high.
 *
 * NO INSTRUCTION SEMANTICS WHATSOEVER. The part does not know that a source or a
 * destination field exists, does not know what REG0 is, and does not gate
 * anything on which mode an instruction is in: the level wires `we`, `waddr` and
 * `data` from its own decode, which is the whole content of ruling 3 (the CPU is
 * built, not provided). The one coupling the level does not have is that the
 * reads are combinational while the write is clocked -- reading a register and
 * overwriting it in the same instruction is defined here as "the write wins for
 * the NEXT instruction, the read still sees the old byte", because the read path
 * never consults `we` or `data`.
 *
 * THE TWO READ ADDRESSES ARE THE STORAGE CONTRACT'S ONE PERMITTED EXCEPTION,
 * APPLIED TWICE. `evaluate` here reads `addrA` and `addrB`, and the registry's
 * rule allows exactly that and nothing else: an input that only SELECTS among
 * bytes already in `state`, where every byte it can select was written by a clock
 * edge. No input's *value* can reach a pin through this path -- not `data`, not
 * `we`, and not `waddr`, all three of which `evaluate` never reads -- so the bank
 * cannot degrade into a wire. `ram8` documents the same rule at its def; this one
 * has two selectors instead of one, which is what "2 read ports" means.
 *
 * WHAT `waddr` 6 AND 7 DO: NOTHING. The register file has six registers, and
 * ruling 5 gives codes 6 and 7 to `inp` and `out` -- ports that are not
 * registers and have no state to write. So a write to 6 or 7 is IGNORED, and a
 * read of 6 or 7 publishes 0 (an unwritten byte's value, and the same reading an
 * unwired pin gets). The rejected alternatives both invent an alias: folding the
 * address modulo 6 would let a stray write land in REG0, and extending `state`
 * to eight bytes would give `inp`/`out` storage the CPU is supposed to model as
 * an external port. Six bytes of state, and an out-of-range address touches none
 * of them.
 *
 * FREE ON BOTH METRICS, LIKE `reg8`. `clockEdge` samples and `evaluate`
 * publishes; neither reads the other's inputs, and `cost` is 0 because a storage
 * element cuts the combinational path rather than adding a delay unit. `gateCost`
 * is left absent, which reads as that 0: the gate metric prices what the player
 * BUILT, and storage is its deliberate exception (argued at length in `wide.ts`).
 */
const regfile6: ComponentDef = {
  id: 'regfile6',
  name: { zh: '六级寄存器堆', en: '6-Register File' },
  category: 'cpu',
  inputs: [
    { id: 'addrA', width: 3 },
    { id: 'addrB', width: 3 },
    { id: 'waddr', width: 3 },
    { id: 'data', width: W },
    { id: 'we', width: 1 },
  ],
  outputs: [
    { id: 'a', width: W },
    { id: 'b', width: W },
  ],
  cost: 0,
  sequential: true,
  // One byte per register: REG0..REG5, and no seventh byte to alias (see above).
  stateBytes: REGS,
  evaluate: (i, o, state) => {
    // `addrA` / `addrB` are INDICES into `state`; `waddr`, `data` and `we` are
    // deliberately not read here, so nothing on the write path can leak onto a
    // read port. An address of 6 or 7 indexes past the six registers and the
    // `?? 0` gives it the value of a byte that was never written.
    o[0] = state?.[toUint(i[0], 3)] ?? 0;
    o[1] = state?.[toUint(i[1], 3)] ?? 0;
  },
  clockEdge: (i, _o, state) => {
    // `we` gates the write: asserted low, this edge changes NOTHING, whatever
    // `data` and `waddr` are doing -- the property the tests pin with `data`
    // changing under a low `we`.
    if (bit(i[4]) !== 1) return;
    const target = toUint(i[2], 3);
    // Codes 6 / 7 name `inp` / `out`, not a register: no byte to write.
    if (target >= REGS) return;
    state[target] = toUint(i[3], W);
  },
};

/**
 * `instr_decoder`: slices the eight-bit instruction word into the fields ruling 5
 * lays out --
 *
 *   mode = instr[7:6]   op = instr[5:3]   dst = instr[2:0]
 *   src  = instr[5:3]   imm = instr[5:0]
 *
 * PURE WIRING, SO 0 NAND EQUIVALENTS AND 0 DELAY UNITS -- exactly the price
 * `splitter` and `maker` carry, and for the same reason: every output bit is one
 * bit of `instr` moved to a differently named pin, so there is no gate in this
 * part to count. `cost` is 0 rather than 1 because a part that IS a wire must not
 * add a delay unit (spec §3.2 prices sources and wires at 0). The rejected
 * alternative is a "real" decoder built from comparators or a one-hot minterm
 * tree: that is a different part with different pins (one-hot lines instead of
 * packed fields), and pricing this one at that construction would charge the
 * player for gates the part does not contain. Level 42's gate target is therefore
 * carried by `delay` rather than by `gate` -- expected, not a bug.
 *
 * `op` AND `src` ARE THE SAME THREE BITS, PUBLISHED TWICE ON PURPOSE. Ruling 5
 * gives [5:3] two meanings: the operation in `calc` (mode 01) and the source in
 * `move` (mode 10). Publishing both on their own pins is what lets the level's
 * wiring take whichever its decode needs without the decoder branching on
 * `mode` -- branching would be instruction semantics, the exact thing Global
 * Constraint 13 keeps out of the engine. The duplicated slice costs nothing:
 * it is the same wire with two names.
 *
 * NO RESERVED-BIT VALIDATION. Ruling 5 marks bits [2:0] of `calc` and `jump` as
 * "reserved, must be 0", and this def does NOT check that -- it publishes them as
 * `dst`, whatever they are. Validating them here would both be semantics and
 * destroy the information the level needs: level 42's check asserts the reserved
 * field through this very pin, and a decoder that forced it to 0 would make the
 * check pass for every input. The ordering is deliberate -- the part reports, the
 * level judges.
 */
const instrDecoder: ComponentDef = {
  id: 'instr_decoder',
  name: { zh: '指令解码器', en: 'Instruction Decoder' },
  category: 'cpu',
  inputs: [{ id: 'instr', width: W }],
  outputs: [
    { id: 'mode', width: 2 },
    { id: 'op', width: 3 },
    { id: 'dst', width: 3 },
    { id: 'src', width: 3 },
    { id: 'imm', width: 6 },
  ],
  // A wire, on both metrics: see the header. No `gateCost` field is stated
  // explicitly because 0 IS this part's count rather than a fallback -- the same
  // two zeroes `splitter` / `maker` carry.
  cost: 0,
  gateCost: 0,
  sequential: false,
  stateBytes: 0,
  evaluate: (i, o) => {
    const instr = toUint(i[0], W);
    // Five slices of the one input, in the pin order above. Shifts and masks,
    // not gates: this is the whole transfer function.
    o[0] = (instr >> 6) & 0b11;
    o[1] = (instr >> 3) & 0b111;
    o[2] = instr & 0b111;
    o[3] = (instr >> 3) & 0b111;
    o[4] = instr & 0b111111;
  },
};

/**
 * `pc8`: the program counter. `out` publishes the held address; on a clock edge
 * `load` high makes `state = in`, and `load` low makes `state = state + 1`.
 *
 * DECIDED: THE COUNT WRAPS TO 0 AT 256 (255 + 1 = 0), not saturates. The program
 * counter is an eight-bit address register, so its successor is the next
 * instruction's address modulo the address space -- which is also what makes
 * `ram_prog`'s 256 bytes and this counter the same width by construction rather
 * than by coincidence. Saturating would freeze the CPU at the top of its program
 * instead of running off the end, and a wrap is the behaviour the level's
 * `program` driver can predict.
 *
 * DECIDED: `load` BEATS THE INCREMENT. A jump is an instruction like any other:
 * on the edge that executes it, the PC takes the jump TARGET, and if `load` is
 * low the same edge just advances. There is no third state -- every edge either
 * loads or increments -- which is what makes the counter a total function of
 * (`load`, `in`, `state`) and the level's glue logic a plain OR of "is a jump"
 * and "is executing".
 *
 * STORAGE, SO FREE ON BOTH METRICS AND `evaluate` PUBLISHES ONLY. One byte of
 * state holds the address; `evaluate` reads `state` and must never read `in` or
 * `load` (a counter that published its input would be a wire), and `clockEdge`
 * samples both and writes no output. `gateCost` is left absent, reading as
 * `cost`'s 0 -- the storage ruling in `wide.ts`.
 */
const pc8: ComponentDef = {
  id: 'pc8',
  name: { zh: '程序计数器', en: 'Program Counter' },
  category: 'cpu',
  inputs: [
    { id: 'load', width: 1 },
    { id: 'in', width: W },
  ],
  outputs: [{ id: 'out', width: W }],
  cost: 0,
  sequential: true,
  stateBytes: 1,
  evaluate: (_i, o, state) => {
    // Publish the held address and nothing else: `i` is accepted because the
    // kernel passes it, and deliberately never read.
    o[0] = state?.[0] ?? 0;
  },
  clockEdge: (i, _o, state) => {
    if (bit(i[0]) === 1) state[0] = toUint(i[1], W);
    else state[0] = ((state[0] ?? 0) + 1) & 0xff;
  },
};

/**
 * `ram_prog`: the 256-byte program memory the OVERTURE's instructions are read
 * from. `addr:8 -> out:8`, one byte per address, read combinationally.
 *
 * THE READ PATH IS COMBINATIONAL AND READS `addr` AS AN INDEX -- the storage
 * contract's one permitted exception, the same one `ram8` documents: `addr` can
 * only SELECT a byte of `state`, and the byte it selects is only ever one a
 * loader put there, so no input's value can reach the pin. There is no write pin
 * at all: the image is not something the circuit can change, it is the program
 * the level handed the machine.
 *
 * THE IMAGE ARRIVES VIA `Simulation.loadImage`, NOT VIA `params`. The phase-2
 * plan's deliverable row 7 spelled the route as `params.image`, and task 1's
 * recon (`.superpowers/sdd/2026-09-29-turing-complete-phase2/recon-kernel.md`)
 * showed why that spelling cannot work: `compile()` never touches an instance's
 * state (it is allocated zeroed in the `Simulation` constructor, `net.ts`), it
 * reads exactly one param key (`params.width`), and `reset()` clears every state
 * byte -- and every check that drives a circuit calls `reset()` AFTER compiling.
 * So the image is copied into this def's `state` by `Simulation.loadImage` after
 * the reset, and `evaluate` then publishes `state[addr]` like any other read.
 * Loading is a kernel operation, not a pin: a `data`/`load` write port here would
 * be a different part (that is `ram8`), and would let the program rewrite itself.
 *
 * `clockEdge` IS EMPTY, AND THAT IS THE HONEST STATEMENT OF A READ-ONLY PART: no
 * edge can change the image, because there is no input that could describe a
 * write. The edge exists because the kernel hands a def its `state` only when
 * `sequential` is true (`net.ts`, `settle` and `#publishState`) -- a part whose
 * whole content is state must be sequential to publish it -- and the storage
 * contract's other half is a `clockEdge` on every sequential def.
 *
 * FREE ON BOTH METRICS, like every other storage element: `gateCost` is absent
 * and reads `cost`'s 0 (the storage exception argued in `wide.ts`).
 */
const ramProg: ComponentDef = {
  id: 'ram_prog',
  name: { zh: '程序存储器', en: 'Program RAM' },
  category: 'cpu',
  inputs: [{ id: 'addr', width: W }],
  outputs: [{ id: 'out', width: W }],
  cost: 0,
  sequential: true,
  // One byte per address, 2 ** 8 of them -- the same honest 256 `ram8` holds.
  stateBytes: 2 ** W,
  evaluate: (i, o, state) => {
    // `addr` selects; no other input exists, and none is read.
    o[0] = state?.[toUint(i[0], W)] ?? 0;
  },
  clockEdge: () => {
    // Nothing to sample: the pin list has no write port (see the header). The
    // program is loaded out of band by `Simulation.loadImage` and is read-only
    // from inside the circuit.
  },
};

/**
 * `halt`: a one-bit passthrough (`out = in`) whose reason to exist is that a
 * level's check can NAME the CPU's halt line and assert on it.
 *
 * DECIDED: COMBINATIONAL, `cost: 0`, `gateCost: 0` -- it is a wire with a pin
 * name, the same price `level_output` carries, and chapter 3's expected targets
 * are unaffected by placing it. The rejected alternative is a latching halt (set
 * on the edge, held until reset): that is a storage element, it would need a
 * clear or the level could never run a second program, and it would make the
 * halt line's value depend on tick history rather than on the signal the
 * player's circuit produces. A wire is also the part a level can probe at an
 * arbitrary point of its own reference circuit.
 *
 * `out = in` AND NOT `out = 0`: the level asserts the halt line GOING HIGH, so
 * the part has to carry the signal it names; a constant 0 would be a rail that
 * can never be asserted.
 */
const halt: ComponentDef = {
  id: 'halt',
  name: { zh: '停机', en: 'Halt' },
  category: 'cpu',
  inputs: [{ id: 'in', width: 1 }],
  outputs: [{ id: 'out', width: 1 }],
  // A wire: no delay unit and no NAND, like `level_output` and `splitter`.
  cost: 0,
  gateCost: 0,
  sequential: false,
  stateBytes: 0,
  evaluate: (i, o) => {
    o[0] = bit(i[0]);
  },
};

/**
 * Ids `CPU_DEFS` registers, in order, as a literal tuple so `defs/index.ts` can
 * spread it and `DefId` still narrows to the individual strings.
 *
 * The order is the plan's Task 2 table order. These six are not generated from a
 * width parameter -- the ids say which part each one is, and `instr_decoder`'s
 * five pins have four different widths -- so this list and the defs above are
 * pinned against each other by `test/core/defs-cpu.test.ts`, the way
 * `WIDE_STORAGE_DEF_IDS` is pinned against the storage family.
 */
export const CPU_DEF_IDS = [
  'alu8',
  'regfile6',
  'instr_decoder',
  'pc8',
  'ram_prog',
  'halt',
] as const;

/**
 * The CPU family, in `CPU_DEF_IDS` order.
 *
 * Registered from this list next to the defs it names rather than from a
 * generator call in `defs/index.ts`: there is no parameter that could produce
 * these six (see the id tuple), and keeping the list here is what lets the
 * family-boundary tests in `test/core/registry.test.ts` exclude the family by
 * its own declaration instead of by a hand-copied list of ids.
 */
export const CPU_DEFS: readonly ComponentDef[] = [
  alu8,
  regfile6,
  instrDecoder,
  pc8,
  ramProg,
  halt,
];
