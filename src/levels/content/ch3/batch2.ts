import { OVERTURE_ISA } from '../../../asm/index';
import type { FieldRange } from '../../../asm/index';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation).
import { truthTable, type LevelIo } from '../../tables';
import type { LevelSpec, ProgramStep, ScriptStep } from '../../spec';

/**
 * Chapter 3, levels 42-44: the instruction decoder, the calculation unit built
 * on it, and the condition test a jump is made of.
 *
 * WHAT THE SOURCE FIXES, AND WHAT IT DOES NOT. As in every batch before this
 * one: the compendium gives each level exactly three things -- its name (English
 * and Chinese), its place in the chapter, and one line of teaching concept. It
 * gives no ports, no widths, no pass conditions, no targets and no rewards.
 * Everything a player can see or a test can measure below is this replica's
 * design, and each level carries a data comment split into `SOURCED` and
 * `AUTHORED`, exactly as chapter 2's four batches and chapter 3's first batch do.
 * Where a level's design leans on a source's own number (level 44's achievement)
 * that number is recorded as an achievement and never used as a target -- spec
 * §5.4.
 *
 * THE INSTRUCTION ENCODING IS READ, NOT RESTATED. The field offsets and widths
 * below come from `OVERTURE_ISA` (`src/asm/isa.ts`), which is the single
 * authority for ruling 5's layout: level 42's truth table slices the word with
 * the ISA's own `offset`/`width` pairs, so a change to the table moves the level
 * with it instead of leaving two answers. What the ISA deliberately does NOT
 * state -- what any instruction DOES -- is the level's own wiring, which is the
 * whole content of this chapter (Global Constraint 11).
 *
 * THE `program` CHECKER'S TICK SEMANTICS ARE LOAD-BEARING FOR 43, as they are
 * for chapter 2's scripts. `levels/checks.ts` writes a step's inputs and settles
 * BEFORE it advances the clock to that step's tick (`driveSteps`), so:
 *
 *  * a step at tick `T` runs the edges from the previous step's tick up to `T`,
 *    and the edge into `T` samples the inputs THAT STEP wrote;
 *  * `tick` is therefore an absolute target, and a step at tick 0 runs no edge at
 *    all -- which is why level 43's walk starts at tick 0 with the reset state;
 *  * an edge executes the instruction the step wrote, and the comparison that
 *    follows reads the state after it.
 *
 * So level 43's steps drive `instr` with the ADDRESS of the instruction the edge
 * executes -- 0 at tick 1, 1 at tick 2, and so on -- which is the whole reason
 * that level's `instr` pin is an address and not the instruction word (see the
 * level comment).
 *
 * THE PALETTE. Every level offers `level_input`/`level_output`, which are
 * always available and never unlocked, and no level offers a part that no level
 * at or before it hands out -- the rule `test/levels/level-buildability.test.ts`
 * walks. That is why level 43's palette has `pc8` (level 42's reward) but not
 * `halt` (level 44's), even though both are listed in the phase plan's table for
 * this batch: `halt` is not earned yet at 43, and offering it there would fail
 * that walk. `ram_prog` is 43's own reward, which `paletteDefsFor` offers on the
 * level it belongs to.
 */

/** The two connectors every level offers and no level rewards. */
const LEVEL_IO = ['level_input', 'level_output'] as const;

/** The two packers and the byte constant level 13 handed out. */
const BYTE_WIRING = ['splitter', 'maker'] as const;

/** The decoder, the register file and the ALU chapters 3 levels 39-41 reward. */
const CPU_PARTS = ['alu8', 'regfile6', 'instr_decoder'] as const;

const IO_DECODER: LevelIo = {
  inputs: [{ id: 'instr', width: 8 }],
  outputs: [
    { id: 'mode', width: 2 },
    { id: 'op', width: 3 },
    { id: 'dst', width: 3 },
    { id: 'imm', width: 6 },
  ],
};
const IO_CALC: LevelIo = {
  inputs: [
    { id: 'clk', width: 1 },
    { id: 'instr', width: 8 },
    { id: 'inp', width: 8 },
  ],
  outputs: [{ id: 'res', width: 8 }],
};
const IO_CONDITIONS: LevelIo = {
  inputs: [
    { id: 'clk', width: 1 },
    { id: 'instr', width: 8 },
  ],
  outputs: [{ id: 'skip', width: 1 }],
};

/**
 * One field of the ISA, looked up by mode and field id, or a loud failure.
 *
 * `throw` is right here and not a "reads 0" default: this is authored data
 * failing at module load, where a missing field is a bug in the level rather
 * than something a player typed, and a quietly zeroed field would make level 42
 * assert a slice nobody chose.
 */
function isaField(modeId: string, fieldId: string): FieldRange {
  const mode = OVERTURE_ISA.modes.find((entry) => entry.id === modeId);
  const field = mode?.fields.find((entry) => entry.id === fieldId);
  if (!field) throw new Error(`OVERTURE_ISA has no "${fieldId}" field in mode "${modeId}"`);
  return field;
}

/** `word`'s bits under `field`, as a value of that field's own width. */
function sliceOf(field: FieldRange, word: number): number {
  return (word >>> field.offset) & ((1 << field.width) - 1);
}

/**
 * The four slices level 42 publishes, named by the ISA field each one IS.
 *
 * `mode` is the ISA's own shared mode field; `op` is `calc`'s operation field,
 * `dst` is `move`'s destination field and `imm` is `immediate`'s value field.
 * The decoder publishes all of them for EVERY instruction, whatever its mode --
 * which is exactly what the level asserts: the four slices exist in the word,
 * and which of them an instruction uses is the rest of the chapter's business.
 */
const MODE_FIELD = OVERTURE_ISA.modeField;
const OP_FIELD = isaField('calc', 'op');
const DST_FIELD = isaField('move', 'dst');
const IMM_FIELD = isaField('immediate', 'imm');

/**
 * Level 42's check: all 2^8 instructions, one row each.
 *
 * `truthTable` enumerates the single 8-bit input and asks each output pin's
 * function for its value; the four functions slice the word with the ISA's own
 * offsets and widths, so the table cannot disagree with `isa.ts` and cannot be
 * left half-written (a declared output pin with no function throws at module
 * load). 256 rows is every instruction there is: nothing is sampled and nothing
 * is omitted.
 */
const DECODER_TABLE = truthTable(IO_DECODER, {
  mode: ({ instr }) => sliceOf(MODE_FIELD, instr ?? 0),
  op: ({ instr }) => sliceOf(OP_FIELD, instr ?? 0),
  dst: ({ instr }) => sliceOf(DST_FIELD, instr ?? 0),
  imm: ({ instr }) => sliceOf(IMM_FIELD, instr ?? 0),
});

/**
 * Level 43's program, in the source text the `program` checker assembles.
 *
 * Ten instructions, one per tick, each one exercising a different path of the
 * machine: `loadi` (the immediate into REG0), `move|inp|d1` (the input port),
 * `move|s0|d2` (a register-to-register move), `add`, `move|s3|d4` (REG3 read
 * back as a source), `sub`, `move|s3|out` (a move whose destination is a port,
 * which the register file must ignore), `nor` (a third ALU operation) and
 * `move|s4|d3` (a move whose destination IS REG3, which is how the check sees
 * that REG4 held the byte written earlier).
 */
export const PROGRAM_43 = [
  '# the calculation unit, one instruction per tick',
  'loadi|5', // 0: REG0 = 5
  'move|inp|d1', // 1: REG1 = inp
  'move|s0|d2', // 2: REG2 = REG0 = 5
  'add', // 3: REG3 = REG1 + REG2
  'move|s3|d4', // 4: REG4 = REG3
  'sub', // 5: REG3 = REG1 - REG2
  'move|s3|out', // 6: the output port; this level has none, and no register is written
  'nor', // 7: REG3 = ~(REG1 | REG2)
  'move|s3|d5', // 8: REG5 = REG3
  'move|s4|d3', // 9: REG3 = REG4, the byte instruction 3 computed
].join('\n');

/**
 * Level 43's walk: eleven steps, one instruction each, and the `res` byte the
 * machine must publish after that instruction's edge.
 *
 * `inp` is driven with 10 for the first two instructions and 40 from then on,
 * and instruction 3 still has to publish 15 (`10 + 5`). A circuit that wired the
 * level's input pin straight into the ALU instead of through REG1 would publish
 * 45 there -- the walk's first assertion with teeth. The addresses are the
 * program's own: the step at tick `T` drives the address `T - 1`, because that is
 * the instruction its edge executes.
 */
const STEPS_43: readonly ProgramStep[] = [
  { tick: 0, inputs: { instr: 0, inp: 10 }, expect: { res: 0 } },
  { tick: 1, inputs: { instr: 0, inp: 10 }, expect: { res: 0 } },
  { tick: 2, inputs: { instr: 1, inp: 10 }, expect: { res: 0 } },
  { tick: 3, inputs: { instr: 2, inp: 40 }, expect: { res: 0 } },
  { tick: 4, inputs: { instr: 3, inp: 40 }, expect: { res: 15 } },
  { tick: 5, inputs: { instr: 4, inp: 40 }, expect: { res: 15 } },
  { tick: 6, inputs: { instr: 5, inp: 40 }, expect: { res: 5 } },
  { tick: 7, inputs: { instr: 6, inp: 40 }, expect: { res: 5 } },
  { tick: 8, inputs: { instr: 7, inp: 40 }, expect: { res: 240 } },
  { tick: 9, inputs: { instr: 8, inp: 40 }, expect: { res: 240 } },
  { tick: 10, inputs: { instr: 9, inp: 40 }, expect: { res: 15 } },
];

/**
 * The instruction bytes level 44's walk drives, hand-encoded from ruling 5.
 *
 * They are written as literals rather than assembled because this level's check
 * is a `script`: the decoding IS the level, so a byte whose mode or condition
 * field has been mis-sliced is the thing being tested. `MOVE_S0_D1` and `SUB`
 * are in the walk on purpose -- their `[5:3]` fields are 000 and 001, so a
 * circuit that decoded the condition without looking at the mode would call them
 * `j` and `jz`.
 */
const LOADI_5 = 0x05; // 00 000101: loadi|5
const LOADI_0 = 0x00; // 00 000000: loadi|0
const MOVE_S0_D1 = 0x81; // 10 000 001: move|s0|d1 -- [5:3] = 000
const SUB = 0x48; // 01 001 000: sub -- [5:3] = 001
const J = 0xc0; // 11 000 000: j
const JZ = 0xc8; // 11 001 000: jz
const JNZ = 0xd0; // 11 010 000: jnz
const INVALID_COND = 0xd8; // 11 011 000: condition code 3, which is not a branch

/**
 * Level 44's walk: one held value, then every condition against it.
 *
 * The value is loaded with `loadi` (the level's one register), a `move` and a
 * `calc` are driven while it is held to show they are not branches, and then the
 * three conditions are asked against 5, against 0 and against 5 again. The last
 * two steps drive `INVALID_COND`, whose condition code is not one of the ISA's
 * three: the level defines `skip` as 0 there, so the contract is total.
 */
const STEPS_44: readonly ScriptStep[] = [
  { tick: 0, inputs: { instr: LOADI_5 }, expect: { skip: 0 } },
  { tick: 1, inputs: { instr: LOADI_5 }, expect: { skip: 0 } },
  { tick: 2, inputs: { instr: MOVE_S0_D1 }, expect: { skip: 0 } },
  { tick: 3, inputs: { instr: SUB }, expect: { skip: 0 } },
  { tick: 4, inputs: { instr: JZ }, expect: { skip: 0 } },
  { tick: 5, inputs: { instr: JNZ }, expect: { skip: 1 } },
  { tick: 6, inputs: { instr: J }, expect: { skip: 1 } },
  { tick: 7, inputs: { instr: LOADI_0 }, expect: { skip: 0 } },
  { tick: 8, inputs: { instr: JZ }, expect: { skip: 1 } },
  { tick: 9, inputs: { instr: JNZ }, expect: { skip: 0 } },
  { tick: 10, inputs: { instr: J }, expect: { skip: 1 } },
  { tick: 11, inputs: { instr: LOADI_5 }, expect: { skip: 0 } },
  { tick: 12, inputs: { instr: JZ }, expect: { skip: 0 } },
  { tick: 13, inputs: { instr: JNZ }, expect: { skip: 1 } },
  { tick: 14, inputs: { instr: INVALID_COND }, expect: { skip: 0 } },
];

export const CH3_BATCH2: readonly LevelSpec[] = [
  /**
   * ch3-42-instruction-decoder -- Instruction Decoder / 指令解码器
   *
   * SOURCED: the name in both languages, its position (the 42nd level, and the
   * fourth of chapter 3), and the source's one-line concept -- parse the
   * instruction byte and select the operation. The source's §6.3 fixes the shape
   * the level decodes: two high bits of mode and six low bits of argument, with
   * `move` splitting its six into a three-bit source and a three-bit
   * destination, and §6.1 fixes the one-byte word. The FIELD ORDER inside the low
   * six bits is ruling 5 of this replica's plan, not the source's, and it is read
   * from `src/asm/isa.ts` rather than restated here.
   *
   * AUTHORED: the pin shape (one 8-bit `instr` in; `mode` 2, `op` 3, `dst` 3 and
   * `imm` 6 out -- the level does not publish the `src` pin, because `src` and
   * `op` are the same three bits and one of them is enough to teach the slice),
   * the 256-row truth table, the palette, the `pc8` reward and the measured
   * target.
   *
   * THE TABLE IS GENERATED FROM THE ISA, NOT COPIED FROM IT. `truthTable`
   * enumerates every one of the 256 bytes and each of the four functions slices
   * the word with the ISA's own `offset` and `width`, so the level cannot drift
   * from `isa.ts` and cannot be left half-written: a declared output pin with no
   * function throws when this module loads. There is no sampling and no
   * "representative rows" -- an instruction decoder is exactly the circuit whose
   * whole input space is affordable.
   *
   * THE PALETTE OFFERS BOTH SPELLINGS AND THEY TIE. `instr_decoder` is level 41's
   * reward, and it IS the five slices; `splitter` plus four `maker`s is the same
   * wiring drawn by hand. Both measure 0 NAND equivalents and 0 delay units (a
   * packer and a wire slice are free on both metrics, spec §3.2), so the level
   * cannot tell them apart and does not try to: what it grades is which bits are
   * which field, and both a player who knows the layout and a player who reaches
   * for the part express that same knowledge. The measured `gate` of 0 is
   * therefore expected rather than a missing number -- this level's cost is its
   * `delay`, and that is 0 too.
   */
  {
    id: 'ch3-42-instruction-decoder',
    chapter: 3,
    index: 42,
    name: { zh: '指令解码器', en: 'Instruction Decoder' },
    brief: {
      zh: '一条指令是一个字节：高 2 位是模式，低 6 位是这一模式的参数。把 instr 拆成四个字段输出——mode = instr[7:6]、op = instr[5:3]、dst = instr[2:0]、imm = instr[5:0]。256 种输入组合全部都要对。',
      en: 'An instruction is one byte: the top two bits are the mode and the low six are that mode\u2019s argument. Publish four slices of instr -- mode = instr[7:6], op = instr[5:3], dst = instr[2:0], imm = instr[5:0]. All 256 input combinations have to be right.',
    },
    hint: {
      zh: '位拆分器把 instr 拆成八根线，再用四个位合并器把每个字段需要的位按低位在前的顺序拼回去：mode 用第 6、7 位，op 用第 3、4、5 位，dst 用第 0、1、2 位，imm 用第 0 到第 5 位。奖励的指令解码器（instr_decoder）就是这五条切片，直接放上去也一样。',
      en: 'Split instr into its eight bits and pack each field back with four Makers, least significant bit first: mode takes bits 6 and 7, op bits 3-5, dst bits 0-2 and imm bits 0-5. The Instruction Decoder this level rewards is those same five slices, so dropping it in works too.',
    },
    allowedComponents: [...BYTE_WIRING, 'instr_decoder', 'const_on', 'const_off', ...LEVEL_IO],
    io: IO_DECODER,
    checks: [DECODER_TABLE],
    // Measured: the hand-sliced reference (one Splitter and four Makers) is 0
    // NAND equivalents and 0 delay units, and a purely combinational level runs
    // no ticks. `instr_decoder` measures the same three numbers -- see the
    // comment above.
    threeStar: { gate: 0, delay: 0, tick: 0 },
    rewards: { components: ['pc8'] },
  },

  /**
   * ch3-43-calculations -- Calculations / 计算单元
   *
   * SOURCED: the name in both languages, its position (43rd), and the source's
   * one-line concept -- integrate the ALU with the registers and implement the
   * calculation instructions. The register roles the machine wires are the
   * source's own §6.2 table: `loadi` targets REG0, a calculation reads REG1 and
   * REG2 and leaves its result in REG3, and `move` carries a source and a
   * destination field. The instructions the level's program runs are §6.4's.
   *
   * AUTHORED, AND ONE THING THE BRIEF HAD TO RESOLVE. The level is a `program`
   * check, and `programTargets` (`levels/checks.ts`) requires the circuit to have
   * a `ram_prog` instance to load the assembled image into -- a `program` check
   * with nowhere to put its program is a `missing-io` failure. So the level's
   * `instr` pin carries the ADDRESS of the instruction to fetch and the image is
   * what the machine executes: the level's own program is under test, not a list
   * of bytes written into the level data a second time. Level 45 replaces that
   * pin with a `pc8`, and this is the only difference between the two machines.
   *
   * AUTHORED (the rest): the pin shape; the field-to-pin wiring, including
   * `addrA` carrying the `move` source and REG1 for a `calc` while `addrB` stays
   * REG2; the write path (REG0 for `loadi`, REG3 for a `calc`, the destination
   * field for a `move`, and `we` low for a jump); the ten-instruction program and
   * its eleven-step walk; the palette; the `ram_prog` reward; and the measured
   * target.
   *
   * WHERE AN INSTRUCTION WRITES IS NOT ONE FIELD, and the machine says so with
   * two selects: `loadi`'s six bits ARE its value, so it writes REG0; `calc`
   * writes REG3 because the source's §6.2 puts the result there and ruling 5
   * leaves `calc`'s [2:0] slice RESERVED (the assembler writes zero into it);
   * and only `move` writes the destination field it carries.
   *
   * `res` PUBLISHES REG3, WHICH COSTS ONE SHADOW REGISTER. `regfile6` has two
   * read ports and both are spoken for -- one for the `move` source, one for the
   * ALU's second operand -- so REG3 is published by an 8-bit register that
   * latches the same `data` byte on exactly the edges the register file writes
   * REG3: every `calc`, and a `move` whose destination field is 3. The two cannot
   * disagree: REG3 changes only on those edges, both start at zero, and the
   * shadow reads no other pin. Storage is free on both metrics by the chapter's
   * ruling, so the shadow costs the three-star target nothing while keeping the
   * level's pin honest about where the byte comes from.
   *
   * THE WALK IS WHAT GIVES THE CHECK TEETH, and its shape is the tick semantics
   * in the module note. `inp` changes after instruction 1 and instruction 3 must
   * still publish 15, so a machine that fed the input pin into the ALU instead of
   * REG1 fails; the `sub` and `nor` steps fail a machine that hard-wired `add`;
   * the last step (`move|s4|d3`) publishes the byte instruction 3 computed, so it
   * fails a machine whose move destination or source is mis-decoded. The batch
   * test builds all three of those machines and asserts they fail.
   */
  {
    id: 'ch3-43-calculations',
    chapter: 3,
    index: 43,
    name: { zh: '计算单元', en: 'Calculations' },
    brief: {
      zh: '计算单元：一个时钟沿执行一条指令。程序存放在 ram_prog 里，instr 引脚给出要取哪一条指令（地址）。loadi 把 6 位立即数写进 REG0；calc 按 op 计算 REG1 与 REG2，结果写进 REG3；move 把源字段指定的寄存器（源为 6 时是 inp）复制到目标字段指定的寄存器，目标为 out 时寄存器堆不写入。写使能在跳转模式（11）下为低。res 始终输出 REG3。',
      en: 'The calculation unit: one instruction per clock edge. The program lives in the ram_prog and the instr pin carries the ADDRESS of the instruction to fetch. loadi writes its 6-bit immediate into REG0; calc computes REG1 op REG2 into REG3; move copies the register its source field names (inp when the source is 6) into the register its destination field names, and a destination of out writes no register. The write enable is low in jump mode (11). res always publishes REG3.',
    },
    hint: {
      zh: '指令先经 instr_decoder 拆成字段。寄存器堆的两个读地址必须随模式切换：计算时读 REG1/REG2，复制时读源字段。写地址有三个来源，不是字段照抄：loadi 写 REG0、calc 写 REG3（它的低 3 位是保留位，汇编器写 0）、只有 move 写目标字段——用两次选择把这三条规则拼出来即可。寄存器堆只有两个读端口，res 却要输出 REG3：再加一个 8 位寄存器，让它在「寄存器堆正在写 REG3」的那些时钟沿上（每次 calc，以及目标字段为 3 的 move）锁下同一个字节；存储元件不花门也不花延迟。',
      en: 'Decode the instruction first. The register file\u2019s two read addresses follow the mode: REG1/REG2 for a calc, the source field for a move. The write address has three sources rather than one copied field: loadi writes REG0, calc writes REG3 (its low three bits are RESERVED and the assembler leaves them zero), and only move writes its destination field -- two selects express all three rules. The register file has only two read ports while res publishes REG3, so add one 8-bit register and let it latch the same byte on the edges where the register file is writing REG3 (every calc, and a move whose destination field is 3); storage costs nothing on either metric.',
    },
    allowedComponents: [
      ...BYTE_WIRING,
      ...CPU_PARTS,
      'ram_prog',
      'pc8',
      'const_on',
      'const_off',
      'decoder3',
      'mem1',
      'delay_line',
      'delay8',
      'reg8',
      'mux8',
      'switch',
      'switch8',
      'and',
      'or',
      'nor',
      'nand',
      'not',
      'xor',
      'and3',
      'or3',
      ...LEVEL_IO,
    ],
    io: IO_CALC,
    checks: [
      {
        kind: 'program',
        source: PROGRAM_43,
        steps: STEPS_43,
      },
    ],
    // Measured: the machine above -- see the comment. `ram_prog`, `regfile6` and
    // `reg8` are storage and contribute nothing to either metric; the two
    // `decoder3`s (27 each), five `mux8`s (32 each), one `switch8` (16) and the
    // ALU (264) are what the 510 is made of.
    threeStar: { gate: 510, delay: 4, tick: 10 },
    rewards: { components: ['ram_prog'] },
  },

  /**
   * ch3-44-conditions -- Conditions / 条件判断
   *
   * SOURCED: the name in both languages, its position (44th), the source's
   * one-line concept -- decide whether a value is below, equal to or above zero
   * -- and §6.4's jump table, which is what the level evaluates: `j` is taken,
   * `jz` is taken when the compared value is zero, `jnz` when it is not, and the
   * compared value comes from a register the machine holds. The compendium also
   * records an achievement for this level, "only 10 blue components"; per spec
   * §5.4 achievements are RECORDED and never used as the three-star target, so it
   * appears in this comment and nowhere else.
   *
   * AUTHORED, AND THE ONE REDUCTION THIS LEVEL MAKES. This level's machine has a
   * single register: `loadi` writes its 6-bit immediate into it and a jump reads
   * it back as the condition value. In the full OVERTURE those are two registers
   * -- REG0 holds the target, REG3 holds the value compared -- and levels 45-47
   * build them; here the level is about the condition logic alone, so the brief
   * says the reduction in both languages and the walk drives `loadi` to set the
   * value. Everything else is the ISA's: the mode field decides whether the
   * instruction is a jump at all, and the condition field's three defined codes
   * select between always-taken, taken-on-zero and taken-on-nonzero, with every
   * other code publishing 0.
   *
   * AUTHORED (the rest): the pin shape; the twelve-part condition unit (decode,
   * the one register, `equal8` against zero, a `decoder3` for the condition
   * field, and the AND/OR/NOT glue); the fifteen-step walk; the palette; the
   * `halt` reward; and the measured target.
   *
   * THE WALK IS BUILT SO THAT THE TWO PLAUSIBLE-WRONG UNITS FAIL IT, and the
   * batch test builds both. A unit that reads the condition field without
   * checking the mode calls a `move|s0|d1` a `j` (its `[5:3]` field is 000) and
   * a `sub` a `jz` (001), and the walk drives both while the held value is
   * nonzero, where the level demands 0. A unit that never loads the held value
   * has it stuck at zero, so `jnz` against 5 publishes 0 where the walk demands
   * 1. The condition code 3 step then fails a unit that ORs the condition bits
   * together instead of decoding them.
   */
  {
    id: 'ch3-44-conditions',
    chapter: 3,
    index: 44,
    name: { zh: '条件判断', en: 'Conditions' },
    brief: {
      zh: '条件判断：跳转指令从寄存器里读条件值（完整机器里是 REG3）。本关的机器只有一个寄存器——loadi 把 6 位立即数写进去，跳转指令读它。skip 在分支成立时为 1：j（条件 000）永远成立；jz（001）在值为 0 时成立；jnz（010）在值不为 0 时成立；其它条件码不是分支，skip 为 0，而 move 或 calc 这类不是跳转的指令，skip 也必须是 0。',
      en: 'Conditions: a jump reads its condition value from a register (REG3 in the full machine). This level\u2019s machine has exactly one register -- loadi writes the 6-bit immediate into it, and a jump reads it back. skip is 1 when the branch is taken: j (condition 000) always, jz (001) when the value is zero, jnz (010) when it is not. Any other condition code is not a branch and publishes 0, and an instruction that is not a jump -- a move or a calc -- must publish 0 as well.',
    },
    hint: {
      zh: '先用 instr_decoder 拆出 mode 与条件字段：mode 等于 11 才是跳转。条件字段（3 位）送进 3 位译码器，得到「条件 0 / 1 / 2」三根线；寄存器的值用 equal8 与 0 比较得到「是否为零」。jz 与「是零」相与、jnz 与「不是零」相与，再和 j 或起来，最后与「这是跳转」相与。寄存器由 loadi（mode 00）写入，数据就是 imm 字段。',
      en: 'Decode mode and the condition field first: only mode 11 is a jump. Feed the 3-bit condition field to a 3-Bit Decoder for the "condition 0 / 1 / 2" lines, and compare the register against zero with an Equal part. AND jz with "is zero", AND jnz with "is not zero", OR those with j, and finally AND the result with "this is a jump". The register is written by loadi (mode 00) from the imm field.',
    },
    allowedComponents: [
      ...BYTE_WIRING,
      ...CPU_PARTS,
      'reg8',
      'equal8',
      'decoder3',
      'const_on',
      'const_off',
      'not',
      'and',
      'or',
      'nor',
      'nand',
      'xor',
      'and3',
      'or3',
      'switch',
      'switch8',
      'mux8',
      ...LEVEL_IO,
    ],
    io: IO_CONDITIONS,
    checks: [{ kind: 'script', steps: STEPS_44 }],
    // Measured: the reference above -- `equal8` (54 NAND equivalents) and
    // `decoder3` (27) dominate the gate metric, and the AND/OR glue adds the
    // rest; the longest combinational path runs from the held register through
    // the zero test, the jnz gate and the two ANDs to `skip`. The source's "10
    // blue components" achievement is recorded in the comment and is
    // deliberately NOT this target: spec §5.4.
    threeStar: { gate: 100, delay: 5, tick: 14 },
    rewards: { components: ['halt'] },
  },
];
