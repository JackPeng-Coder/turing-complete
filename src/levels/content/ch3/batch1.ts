import type { LevelSpec } from '../../spec';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation).
import type { LevelIo } from '../../tables';

/**
 * Chapter 3, levels 39-41: the first three steps of OVERTURE -- the arithmetic
 * engine, the register bank underneath the registers, and the control fan-out
 * that lets one instruction drive several destinations at once.
 *
 * WHAT THE SOURCE FIXES, AND WHAT IT DOES NOT. The compendium gives each of
 * these levels exactly three things: its name (English and Chinese), its place
 * in the chapter, and one line of teaching concept. It gives no ports, no
 * widths, no pass conditions, no targets and no rewards. Everything else below
 * is this replica's design, derived from the name and that one line -- so each
 * level carries a data comment split into `SOURCED` and `AUTHORED`, exactly as
 * chapter 2's four batches do.
 *
 * ONE LEVEL IS A REBUILD. The source's level 41 is "Component Factory" and it
 * teaches encapsulating a circuit into a reusable part. Blueprints (spec §3.4)
 * are phase 3 work, so this replica builds the same goal -- one control signal
 * driving several destinations correctly -- out of parts that exist now. That
 * level's comment records the divergence under `AUTHORED`.
 *
 * THE INSTRUCTION ENCODING LIVES IN `src/asm/isa.ts`, not here: the levels that
 * need it (42 and up) read the ISA table, and this batch states field positions
 * only where a level's pins make them observable.
 */

const IO_ALU: LevelIo = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
    // The operation arrives as THREE one-bit pins rather than one three-bit
    // pin, and that is a wiring fact rather than a taste: an instance's
    // `params.width` covers every pin of that instance (spec §3.3, `net.ts`
    // `effectiveWidth`), so no part can turn a three-bit value into its three
    // bits -- a `splitter` at width 3 would publish three-bit outputs, and at
    // width 1 it can only read bit 0. Three pins make the same selector
    // expressible with parts the game has, and they name the encoding in the
    // level's own interface instead of hiding it inside a packer.
    { id: 'op0', width: 1 },
    { id: 'op1', width: 1 },
    { id: 'op2', width: 1 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_REGISTER: LevelIo = {
  inputs: [
    { id: 'clk', width: 1 },
    { id: 'we', width: 1 },
    { id: 'addr', width: 3 },
    { id: 'data', width: 8 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_FANOUT: LevelIo = {
  inputs: [
    { id: 'clk', width: 1 },
    { id: 'sel', width: 2 },
    { id: 'data', width: 8 },
  ],
  outputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
  ],
};

/**
 * The two connectors every level offers and no level rewards.
 *
 * Declared here rather than inline in each level's palette, which is what batches
 * 2 and 3 do: the pair is not a part the chapter teaches, and a level that lists
 * it by hand is one edit away from a level that forgets to.
 */
const LEVEL_IO = ['level_input', 'level_output'] as const;

/**
 * The six operations `alu8` implements, as this batch's levels and the def
 * agree on them. Kept here as a function so the level data and the test file
 * cannot disagree about what a selector code means.
 *
 * The op NUMBER is the ISA's operand field (ruling 5's `mnemonics` table in
 * `src/asm/isa.ts`), and `alu8` implements that numbering exactly:
 *
 * | op | operation | note |
 * |----|---|---|
 * | 0 | add | low eight bits; no carry-out pin |
 * | 1 | subtract | `a + ~b + 1`, so 0 - 1 is 255 |
 * | 2 | AND | |
 * | 3 | OR | |
 * | 4 | NAND | |
 * | 5 | NOR | |
 * | 6 | 0 | reserved |
 * | 7 | 0 | reserved |
 *
 * THE THREE LEVEL PINS CARRY THAT NUMBER WITH `op0` AS THE HIGH BIT:
 * `op = 4*op0 + 2*op1 + op2`. So `op0` is the class (0 arithmetic, 1 logic),
 * `op1` picks inside the class, and `op2` inverts the logic result. Codes 6 and 7
 * are the ones with no operation behind them, and `alu8` publishes zero for both,
 * which keeps the level's contract total: every input a player can drive has a
 * defined answer.
 *
 * THE ORDER MATTERS AND WAS WRONG IN TWO PLACES AT ONCE. This function used to
 * read the pins as `op0` = bit 0, and the level's own `fuzz` check assembled them
 * that way too, so the two agreed with each other while both disagreed with
 * `alu8`: on the vector the grader failed at, the level expected NOR (156) where
 * the rewarded part answers sub (29). An expectation compared against a
 * generator that shares its mistake cannot catch it -- what caught it was the
 * reference circuit, which had the pins wired the ISA's way.
 */
export function aluOp(op: number, a: number, b: number): number {
  const x = a & 0xff;
  const y = b & 0xff;
  // A SWITCH ON THE OP NUMBER, BECAUSE THE NUMBER IS THE ISA'S FIELD.
  // Ruling 5 gives `calc` a 3-bit operation field and numbers it linearly
  // (`mnemonics: { add: 0, sub: 1, and: 2, or: 3, nand: 4, nor: 5 }` in
  // `src/asm/isa.ts`), and `alu8` implements exactly that numbering -- verified
  // against the registered def over every op and operand pair. So the map is a
  // lookup, and decoding the number into "class / select / invert" bits is not
  // just unnecessary, it is WRONG: no assignment of those three roles to the
  // three bits reproduces the table, which is why every field-recipe version of
  // this function disagreed with `alu8` somewhere.
  //
  // HOW THE ORIGINAL WENT WRONG, because the shape recurs. It read the guard as
  // `op2 === 1 && op0 === 0`: true for ops 4 and 5, which are NAND and NOR, and
  // false for 6 and 7, which are the spares -- both halves inverted. So the level
  // zeroed the NAND/NOR codes and answered NOR/AND-with-inversion for the two
  // reserved ones, contradicting the part the level REWARDS on four of eight
  // codes. It survived because the level's own `fuzz` check built its expectation
  // by calling this same function: an expectation compared against a generator
  // that shares its bug cannot fail. What caught it was the reference CIRCUIT in
  // `test/fixtures/ch3-references.ts`, wired from gates and muxes and therefore
  // holding no opinion -- the first time the level's contract was tested against
  // something that was not itself.
  switch (op & 7) {
    case 0:
      return (x + y) & 0xff;
    case 1:
      return (x - y) & 0xff;
    case 2:
      return x & y;
    case 3:
      return x | y;
    case 4:
      return ~(x & y) & 0xff;
    case 5:
      return ~(x | y) & 0xff;
    default:
      // 6 and 7: the codes with no operation behind them. "Don't care" would make
      // them values the ALU publishes without promising anything, and the first
      // level to assert `out` across all eight codes would be asserting a value
      // no construction owes it; `alu8` declares the same two codes zero.
      return 0;
  }
}

export const CH3_BATCH1: readonly LevelSpec[] = [
  /**
   * ch3-40-alu-1 -- Arithmetic Engine / 算数引擎
   *
   * SOURCED: the name in both languages, its position (the 39th level, and the
   * first of chapter 3), and the source's one-line concept -- build the ALU, the
   * part that does the arithmetic and the bitwise work. The source's §6.4 also
   * names the operator set the OVERTURE ALU answers to: `add`, `sub`, `and`,
   * `or`, `nand`, `nor`. Those six names are the source's.
   *
   * AUTHORED: everything a player can see or a test can measure. The selector
   * (the source names six operators but no encoding), the pin shape, the choice
   * that codes 6 and 7 publish zero, the twenty-four-round fuzz check that draws
   * each of the six, the reward, and the measured three-star target.
   *
   * WHY THE SELECTOR IS THREE ONE-BIT PINS. Six operators do not fit in two
   * bits, and the source's own instruction word spends three bits on the
   * operator field (§6.3's `01` mode, whose low six bits carry it) -- so the
   * selector is three bits wide here and in the `alu8` reward, whose `op` pin is
   * three bits. What differs is only how the player receives it: a single
   * three-bit pin cannot be split by any part in the game, because an instance's
   * `params.width` widens every pin of that instance and a `splitter` at width 3
   * would publish three-bit outputs. Three pins teach the same encoding and are
   * buildable with the parts this level hands out. The two spare codes publish
   * zero rather than being an error, so the level's contract is total: every
   * input the player can drive has a defined answer, including that one.
   */
  {
    id: 'ch3-40-alu-1',
    chapter: 3,
    index: 40,
    name: { zh: '逻辑整合', en: 'Arithmetic Logic Unit (ALU) 1' },
    brief: {
      // THE THREE BITS ARE NAMED BY THEIR WEIGHT, and this brief had two of them
      // swapped. The code is `op = op0 + 2*op1 + 4*op2`, so `op1` is the tens bit
      // and is therefore the CLASS, `op0` is the ones bit and picks the operation
      // inside the class (add/sub, AND/OR), and `op2` is the fours bit and asks
      // for the inversion that turns AND into NAND and OR into NOR. The hint below
      // always described this correctly; the brief described `op2` and `op0` the
      // other way round, which is a sentence that sends a player to the wrong
      // circuit. `aluOp` in this file and the `alu8` the level rewards are the
      // authority, and both implement the reading above.
      //
      // 'Read as the code' means the three bits in weight order, which is what
      // "op2 op1 op0" was trying to say -- written out as the number instead,
      // since "op2 op1 op0" reads like a bit order and is the other common way to
      // get this wrong.
      zh: 'a 与 b 各是一个字节。三个选择位按权重读成一个编号：op0 是个位、op1 是二位、op2 是四位。op1 是类别位（0 算术、1 逻辑），op0 在该类别内二选一，op2 把逻辑结果取反。于是编号 0 加、1 减、2 与、3 或、4 与非、5 或非；编号 6、7（op1 与 op2 同时为高）输出 0。减法按 256 取模：0 减 1 得 255。',
      en: 'a and b are each one byte. The three selector bits read as one number by weight: op0 is the ones bit, op1 the twos bit, op2 the fours bit. op1 is the class (0 arithmetic, 1 logic), op0 picks between the two operations inside that class, and op2 inverts the logic result. So the code is 0 add, 1 subtract, 2 AND, 3 OR, 4 NAND, 5 NOR, and 6 or 7 (op1 and op2 both high) output 0. Subtraction wraps modulo 256: 0 minus 1 is 255.',
    },
    hint: {
      zh: '加法器给你加和减：把 b 取反再加 1 就是减，用 op0 在 b 与 ~b 之间选，并让同一个 op0 当进位。与门和或门给你与和或，同样用 op0 在两者间选；再用 op2 把结果取反就得到与非与或非。op1 在算术与逻辑之间二选一——注意 op1=op2=1 时输出必须压成 0。',
      en: 'The adder gives you add and subtract: subtract is b inverted plus one, so let op0 choose between b and ~b and let the same bit drive the carry. AND and OR gates give you the other pair, again selected by op0; inverting that result with op2 gives NAND and NOR. op1 chooses between the arithmetic and the logic half -- and note that when op1 and op2 are both high the output must be forced to 0.',
    },
    allowedComponents: [
      'const_on',
      'const_off',
      'nand',
      'not',
      'and',
      'or',
      'nor',
      'xor',
      'xnor',
      'and3',
      'or3',
      'full_adder',
      'add8',
      'neg8',
      'and8',
      'or8',
      'nand8',
      'nor8',
      'xor8',
      'xnor8',
      'not8',
      'splitter',
      'maker',
      'const8',
      'mux8',
      'switch8',
      'switch',
      ...LEVEL_IO,
    ],
    io: IO_ALU,
    checks: [
      {
        kind: 'fuzz',
        seed: 0x3915_00aa,
        rounds: 24,
        inputs: {
          a: (s) => s.a ?? 0,
          b: (s) => s.b ?? 0,
          // All three selector bits are drawn independently, so the eight codes
          // are exercised; the level DEFINES six and folds 6 and 7 onto a
          // zero-output rule of its own. Drawing them rather than pinning them
          // is what makes the reserved-code case a test instead of a hope.
          op0: (s) => s.op0 ?? 0,
          op1: (s) => s.op1 ?? 0,
          op2: (s) => s.op2 ?? 0,
        },
        outputs: {
          // Pin `opN` is BIT N OF THE ISA'S OPERATION FIELD, so the code is
          // `op0 + 2*op1 + 4*op2` -- the pin names are the field's bit positions
          // and nothing has to be transposed. The wired reference in
          // `test/fixtures/ch3-references.ts` implements exactly this: it reads
          // `op1` as the arithmetic-vs-logic class, `op0` as the operation inside
          // the class and `op2` as the logic inversion. (This comment said `op0`
          // for the class and `op1` for the operation, which is the transposition
          // the assembly below had already been fixed out of -- prose that
          // contradicts the line it annotates is how the next reader reintroduces
          // the bug.)
          //
          // THIS IS THE LINE THE LEVEL GOT WRONG, and the reason it matters is
          // worth keeping: the expectation and the `fuzz` generator that feeds it
          // are the same function, so any encoding they share cannot be caught by
          // grading the circuit they are checked against. The reference circuit
          // and the `alu8` component are where the encoding is actually pinned,
          // and this assembly has to agree with BOTH.
          out: (v) =>
            aluOp((v.op0 ?? 0) | ((v.op1 ?? 0) << 1) | ((v.op2 ?? 0) << 2), v.a ?? 0, v.b ?? 0),
        },
      },
    ],
    threeStar: { gate: 273, delay: 5, tick: 0 },
    rewards: { components: ['alu8'] },
  },

  /**
   * ch3-41-registers -- Registers / 寄存器之间
   *
   * SOURCED: the name in both languages, its position, and the source's concept
   * line, which is about moving data between registers.
   *
   * AUTHORED, and a rebuild: the level below is an ADDRESSABLE REGISTER BANK --
   * one byte in, the addressed byte out, writes gated by an enable -- not a
   * register-to-register copy. The reason is that the source's copy belongs to
   * the instruction layer: §6.2 gives it as `move|sX|dY`, a two-field
   * instruction, and this replica's plan (ruling 3) puts that instruction in
   * levels 42 and 43 where a decoder and an instruction word exist. What is left
   * for THIS level is the part both of those stand on: six bytes of stores, an
   * address decoder, and a write enable. The source's own §6.5 lists `move` as
   * one of the processor's four modes, which is where the player meets it.
   *
   * The eight-part store is the level's real lesson: a register file is not six
   * registers, it is one store per address plus a decoder that decides which one
   * the enable reaches. `mem1` is the only part that already behaves this way,
   * and there is no `decoder3`-shaped shortcut for eight addresses in the
   * palette -- by design, so the player builds the tree.
   *
   * AUTHORED: the pin shape, the three-bit address, the eight addresses, the
   * script below (which asserts the HOLD as well as the write: a bank that
   * ignores the enable would still pass a test that only ever wrote), and the
   * measured target.
   */
  {
    id: 'ch3-41-registers',
    chapter: 3,
    index: 41,
    name: { zh: '川流不息', en: 'Registers' },
    brief: {
      zh: '一个可寻址的寄存器堆：we 为高时，addr 选中的那个字节在时钟沿被写入；we 为低时整排寄存器原样保持。out 始终输出 addr 选中的那个字节，八个地址都要能读写。',
      en: 'An addressable register bank: while we is high, the byte at addr is written on the clock edge; while we is low the whole bank holds. out always publishes the byte at addr, and all eight addresses must read and write.',
    },
    hint: {
      zh: '每个地址一个 mem1 存一位？不——每个地址要存整个字节。为八个地址各准备一组 8 位存储，用一位地址译码器把它们各自的 set 选出来，再让 set 与 we 相与。输出侧把八组存储按地址多路选择回一个字节。',
      en: 'One mem1 per address is not enough -- each address holds a whole byte. Give all eight addresses a byte-wide store of their own, decode the address into one selected set line per address, and AND that line with we. On the read side, mux the eight stores back down to one byte using the same address.',
    },
    allowedComponents: [
      'const_on',
      'const_off',
      'nand',
      'not',
      'and',
      'or',
      'nor',
      'xor',
      'xnor',
      'and3',
      'or3',
      'mem1',
      'delay_line',
      'delay8',
      'reg8',
      'ram8',
      'counter8',
      'switch',
      'switch8',
      'mux8',
      'splitter',
      'maker',
      'const8',
      'decoder3',
      'and8',
      'or8',
      'not8',
      ...LEVEL_IO,
    ],
    io: IO_REGISTER,
    checks: [
      {
        kind: 'script',
        steps: [
          // TWO FACTS ABOUT `driveSteps` (src/levels/checks.ts) DECIDE THIS
          // SCRIPT'S SHAPE, and both are easy to get wrong from the outside:
          //
          //  1. Every input the step does not name is written as ZERO. Inputs do
          //     not persist between steps, so a step that means "hold everything,
          //     just clock it" has to restate every pin it wants held.
          //  2. `tick` is an ABSOLUTE target on the run's tick counter, not a
          //     per-step count: the loop is `while (io.sim.tickCount < step.tick)
          //     io.tick()`. A run of steps that all say `tick: 1` therefore
          //     produces exactly ONE edge at the first of them and none after, so
          //     a script written as a sequence of `tick: 1` steps silently stops
          //     clocking. The steps below count up instead.
          //
          // ONE EDGE PER WRITE IS ALSO THE CIRCUIT'S REQUIREMENT. `reg8.load` is
          // `we AND decoder[addr]`, combinational, so it is stable before an edge
          // only if the inputs were written and settled first -- which `driveSteps`
          // does. The edge that should LAND a byte is therefore the one whose step
          // carries `we = 1`, and the read has to happen at a later tick with `we`
          // back to 0 (a step that leaves `we` unset writes 0, which is what makes
          // the read step safe).
          { tick: 1, inputs: { clk: 1, we: 0, addr: 3, data: 0xa5 }, expect: { out: 0 } },
          { tick: 2, inputs: { clk: 1, we: 1, addr: 3, data: 0xa5 } },
          { tick: 3, inputs: { clk: 1, we: 0, addr: 3, data: 0xa5 }, expect: { out: 0xa5 } },
          // A byte parked on `data` at a different address changes nothing: the
          // enable is low, so no register's load line is asserted.
          { tick: 4, inputs: { clk: 1, we: 0, addr: 0, data: 0x11 }, expect: { out: 0 } },
          // The hold, read back at address 3 while `data` carries something else:
          // a bank that latched `data` whenever it changed would show 0x11 here.
          { tick: 5, inputs: { clk: 1, we: 0, addr: 3, data: 0x11 }, expect: { out: 0xa5 } },
          // A second write, to the top address, leaves the first byte alone.
          { tick: 6, inputs: { clk: 1, we: 1, addr: 7, data: 0x5a } },
          { tick: 7, inputs: { clk: 1, we: 0, addr: 7, data: 0x5a }, expect: { out: 0x5a } },
          { tick: 8, inputs: { clk: 1, we: 0, addr: 3, data: 0x5a }, expect: { out: 0xa5 } },
        ],
      },
    ],
    // The rebuilt reference's measured metrics. `tick: 8` is the script's last
    // step: eight edges, one per write and read.
    threeStar: { gate: 267, delay: 3, tick: 8 },
    rewards: { components: ['regfile6'] },
  },

  /**
   * ch3-42-alu-2 -- Arithmetic Logic Unit (ALU) 2 / 算术逻辑单元
   *
   * SOURCED: the name in both languages, its position (the 42nd level, the third
   * of chapter 3), the source's one-line concept for it -- 加入 ADD/SUB, "adds
   * ADD/SUB" -- and, from the same table's row for ALU 1, the four operations it
   * adds to: NAND, OR, AND and NOR. The operation SET is the source's; nothing
   * else about this level is.
   *
   * AUTHORED: the pin shape (the same `IO_ALU` ALU 1 uses, three one-bit selector
   * pins rather than one three-bit pin, for the reason that level's comment gives:
   * no part in the game can split a three-bit value); the eight-code contract,
   * including codes 6 and 7 publishing zero; the fuzz check; the palette; the
   * measured three-star target; and the `alu2` reward.
   *
   * THE SELECTOR IS THE ISA'S OPERATION FIELD, read exactly as ALU 1 and the
   * calculation unit read it: `op0` is the ones bit, `op1` the twos and `op2` the
   * fours, so the code is `op0 + 2*op1 + 4*op2`, and 0 is add, 1 subtract, 2 AND,
   * 3 OR, 4 NAND, 5 NOR. The single authority for that table is `aluOp` in this
   * file -- the same function the previous level's expectation calls, and the
   * function `alu8` implements -- so this level's expectation, the previous
   * level's and the registered part cannot disagree about what a code means. That
   * coupling is deliberate: the defect the previous level shipped was an
   * expectation that shared a misreading with its own generator, and the cure was
   * to give the table one home rather than two.
   *
   * THE OVERLAP WITH `ch3-40-alu-1`, ON THE RECORD. The source splits the machine's
   * operation set across two levels: ALU 1 is the four logic operations and ALU 2
   * adds ADD and SUB. This replica's ALU 1 predates that split -- it was authored
   * as the chapter's arithmetic engine and answers all eight codes -- so as the two
   * levels stand today they state the same function over the same interface, and a
   * reader is owed that sentence rather than left to discover it. What ALU 2 owns
   * is the whole table (the four logic operations plus add and subtract), which is
   * also the contract of `alu8`, the part ALU 1 rewards and the calculation unit
   * consumes; narrowing ALU 1 to its four logic operations is a change to THAT
   * level's check, reference and target, and nothing here depends on it either
   * way. The two `threeStar` targets are equal for the reason the two palettes are:
   * the same construction is the cheapest circuit either level admits, and
   * `test/fixtures/ch3-references.ts` files one graph for each so the measurement
   * is written down twice rather than shared.
   *
   * WHY `alu8` IS NOT OFFERED, WHICH IS THE PALETTE RULE RATHER THAN AN OVERSIGHT.
   * It is the previous level's reward, so the player owns it by now, and its pins
   * are `a:8 b:8 op:3 -> out:8` -- this level's interface with the three selector
   * pins packed by a `maker` at its registered eight-bit width and padded with rails
   * on the five spare inputs (the same padding the decoder references use;
   * `params.width = 3` is NOT the way, because an instance parameter widens every
   * pin of that instance at once and the packer then reads its own inputs wrongly).
   * Packing is free on both metrics, so one instance would answer the level in a
   * single drop, measured at 264 gates and 1 delay against the 273-gate, five-deep
   * circuit the level exists to teach. It is the same subtraction level 22 makes for
   * `add8` and level 20 for `full_adder`: a part that is not this level's own reward
   * and would answer the level by itself is withheld, and this comment is where the
   * price is recorded.
   */
  {
    id: 'ch3-42-alu-2',
    chapter: 3,
    index: 42,
    name: { zh: '算术逻辑单元', en: 'Arithmetic Logic Unit (ALU) 2' },
    brief: {
      zh: 'a 与 b 各是一个字节。三个选择位按权重读成一个编号：op0 是个位、op1 是二位、op2 是四位。编号 0 加、1 减、2 与、3 或、4 与非、5 或非；编号 6、7（op1 与 op2 同时为高）输出 0。减法按 256 取模：0 减 1 得 255。这就是上一关那四个逻辑运算再加上加法与减法。',
      en: 'a and b are each one byte. The three selector bits read as one number by weight: op0 is the ones bit, op1 the twos bit, op2 the fours bit. The code is 0 add, 1 subtract, 2 AND, 3 OR, 4 NAND, 5 NOR, and 6 or 7 (op1 and op2 both high) output 0. Subtraction wraps modulo 256: 0 minus 1 is 255. It is the previous level\'s four logic operations with addition and subtraction added.',
    },
    hint: {
      zh: '和上一关同一套选择器，只是这次六个编号都要有结果。加法器给你加和减：把 b 取反再加 1 就是减，用 op0 在 b 与 ~b 之间选，并让同一个 op0 当进位。与门和或门给你与和或，同样用 op0 在两者间选；再用 op2 把结果取反就得到与非与或非。op1 在算术与逻辑之间二选一——注意 op1=op2=1 时输出必须压成 0。',
      en: 'The same selector as the previous level, but now all six codes need an answer. The adder gives you add and subtract: subtract is b inverted plus one, so let op0 choose between b and ~b and let the same bit drive the carry. AND and OR gates give you the other pair, again selected by op0; inverting that result with op2 gives NAND and NOR. op1 chooses between the arithmetic and the logic half -- and note that when op1 and op2 are both high the output must be forced to 0.',
    },
    allowedComponents: [
      'const_on',
      'const_off',
      'nand',
      'not',
      'and',
      'or',
      'nor',
      'xor',
      'xnor',
      'and3',
      'or3',
      'full_adder',
      'add8',
      'neg8',
      'and8',
      'or8',
      'nand8',
      'nor8',
      'xor8',
      'xnor8',
      'not8',
      'splitter',
      'maker',
      'const8',
      'mux8',
      'switch8',
      'switch',
      ...LEVEL_IO,
    ],
    io: IO_ALU,
    checks: [
      {
        kind: 'fuzz',
        // A fixed literal, and this level's own: nothing draws it at run time, so
        // the same vectors are driven on every run and after every board edit. The
        // high half reads as this level's global index; the low half is distinct
        // from the previous level's `0x3915_00aa`, so the two levels never grade
        // the same sequence.
        seed: 0x4215_00ab,
        rounds: 64,
        inputs: {
          a: (s) => s.a ?? 0,
          b: (s) => s.b ?? 0,
          // All three selector bits are drawn independently, so the eight codes are
          // exercised; six of them are operations and two are the reserved pair the
          // level folds onto a zero-output rule of its own. Drawing them rather
          // than pinning them is what makes the reserved case a test rather than a
          // hope, exactly as on the previous level.
          op0: (s) => s.op0 ?? 0,
          op1: (s) => s.op1 ?? 0,
          op2: (s) => s.op2 ?? 0,
        },
        outputs: {
          // Pin `opN` is BIT N of the ISA's operation field, so the code is
          // `op0 + 2*op1 + 4*op2` with nothing transposed, and `aluOp` is the
          // table. The wired reference in `test/fixtures/ch3-references.ts` reads
          // the same three pins the same way.
          out: (v) =>
            aluOp((v.op0 ?? 0) | ((v.op1 ?? 0) << 1) | ((v.op2 ?? 0) << 2), v.a ?? 0, v.b ?? 0),
        },
      },
    ],
    // Measured: the reference's own metrics, and they are the previous level's
    // because the cheapest circuit either palette admits is the same construction
    // -- one `not8` and one `mux8` pick the adder's addend (`b` or `~b`, with the
    // same bit as the carry), an `add8` and an `and8`/`or8` pair with their own
    // `mux8` picks, a `not8` for the NAND/NOR inversion, a `switch8` gated by
    // `~op2` for the reserved codes, and two more `mux8`s to select the half and
    // then the operation: 8 + 32 + 72 + 16 + 24 + 32 + 8 + 1 + 16 + 32 + 32 = 273
    // NAND equivalents on a path five components deep. The overlap is recorded in
    // the comment above rather than hidden by a different measurement.
    threeStar: { gate: 273, delay: 5, tick: 0 },
    // `alu2` USED TO BE NAMED HERE AS A REWARD, AND IT WAS A MISTAKE: the 2.x
    // plan listed it as "a part no level hands out", but there is no `alu2` in
    // `src/core/defs/` at all -- it was never a part, only the level's name. A
    // reward naming an unregistered id can never appear in a palette, and
    // `registry.test.ts` fails on it, so the line now hands out only parts that
    // exist. OVERTURE's own ALU remains `alu8`, and this level does not list it:
    // see the comment above for the measurement behind that.
    //
    // `ashr8`, `rot_l8` and `rot_r8` land here because this level is what the 2.x
    // realignment left in the removed Logic Engine's place: chapter 2 used to hand
    // the shift and rotate family out at that capstone, and no surviving chapter-2
    // level has a puzzle that calls for them. They are registered parts with a
    // sandbox life of their own, so the choice was to hand them out here or leave
    // them dead content; the design spec's §3.3 row moved with them.
    rewards: { components: ['ashr8', 'rot_l8', 'rot_r8'] },
  },

  /**
   * ch3-43-the-foundry -- Component Factory / 元件工坊
   *
   * SOURCED: the name in both languages, its position, and the source's concept
   * line, which is about modularising a circuit into reusable parts.
   *
   * AUTHORED, and a REBUILD -- the second divergence in this chapter, recorded
   * here because the source's own reading of this level cannot be built yet.
   * Encapsulating a selection into a custom component is spec §3.4's blueprint,
   * and blueprints ship with the phase-3 editor. Rather than leave the slot
   * empty, this level teaches the part of that idea a single level can: one
   * control word driving several destinations at once, with the two destinations
   * deliberately out of step so that "fan the control bits out" cannot be done
   * by wiring the whole word to both.
   *
   * The lesson is the one a module boundary has to get right anyway: a part that
   * publishes two ports must derive each from the fields it needs, not from the
   * word it was handed. `sel` 0 and 1 both put `data` on `a`; 2 and 3 put it on
   * `b`. So `a` is `data AND NOT sel[1]` and `b` is `data AND sel[1]`, and a
   * player who forwards `sel` wholesale gets the low case wrong.
   *
   * AUTHORED: the pin shape, the two-bit selector, the script (which walks all
   * four select codes and asserts the other output stays at zero -- the case a
   * forwarding circuit fails), and the measured target.
   */
  {
    id: 'ch3-43-the-foundry',
    chapter: 3,
    index: 43,
    name: { zh: '元件工坊', en: 'The Foundry' },
    brief: {
      zh: '这块部件有两个输出。sel 为 0 或 1 时 data 出现在 a 上、b 为 0；sel 为 2 或 3 时 data 出现在 b 上、a 为 0。两个输出任何时候都不能同时为非零。',
      en: 'This part has two outputs. When sel is 0 or 1, data appears on a and b is zero; when sel is 2 or 3, data appears on b and a is zero. The two outputs must never both be non-zero.',
    },
    hint: {
      zh: '把 sel 拆成两位：最高位决定 data 走 a 还是走 b，用开关把 data 分别闸向两边。别把 sel 直接接到输出上——它只有两位，而输出是八位。',
      en: 'Split sel into its two bits: the top bit decides whether data goes to a or to b, and a pair of switches gates data to each side. Do not wire sel straight through -- it is two bits wide and the outputs are eight.',
    },
    allowedComponents: [
      'const_on',
      'const_off',
      'nand',
      'not',
      'and',
      'or',
      'switch',
      'switch8',
      'splitter',
      'maker',
      'and8',
      'or8',
      'not8',
      ...LEVEL_IO,
    ],
    io: IO_FANOUT,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 1, inputs: { clk: 1, sel: 0, data: 0x3c }, expect: { a: 0x3c, b: 0 } },
          { tick: 1, inputs: { clk: 1, sel: 1, data: 0x3c }, expect: { a: 0x3c, b: 0 } },
          { tick: 1, inputs: { clk: 1, sel: 2, data: 0x3c }, expect: { a: 0, b: 0x3c } },
          { tick: 1, inputs: { clk: 1, sel: 3, data: 0x3c }, expect: { a: 0, b: 0x3c } },
          { tick: 1, inputs: { clk: 1, sel: 0, data: 0xff }, expect: { a: 0xff, b: 0 } },
          { tick: 1, inputs: { clk: 1, sel: 3, data: 0xff }, expect: { a: 0, b: 0xff } },
          { tick: 1, inputs: { clk: 1, sel: 2, data: 0 }, expect: { a: 0, b: 0 } },
        ],
      },
    ],
    threeStar: { gate: 33, delay: 2, tick: 1 },
    rewards: { components: ['instr_decoder'] },
  },
];
