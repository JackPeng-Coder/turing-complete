import type { LevelSpec, ProgramStep } from '../../spec';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation).
import type { LevelIo } from '../../tables';

/**
 * Chapter 3, levels 45-47: the machine itself -- the program RAM, the program
 * counter, the decoder, the registers, the ALU, and the conditional jump that
 * makes the whole thing a computer rather than a calculator.
 *
 * WHAT THE SOURCE FIXES, AND WHAT IT DOES NOT. The compendium gives each level
 * its name (English and Chinese), its place in the chapter, and one line of
 * teaching concept: 45 is "store the program in RAM with the counter as PC", 46
 * is "support values encoded directly in the instruction", 47 is "integrate the
 * conditional jump and become Turing complete". It gives no ports, no widths, no
 * pass conditions, no targets and no rewards. Everything a player sees or a test
 * measures below is this replica's design; each level carries a `SOURCED` /
 * `AUTHORED` comment, as every earlier batch does.
 *
 * ONE MACHINE, THREE PROGRAMS. All three levels use the same reference circuit
 * (`overtureMachine` in `test/fixtures/ch3-references.ts`), and that is the
 * levels' own claim rather than a shortcut: 45 is a straight line, 46 is the same
 * straight line built around the immediate field, and 47 adds a loop -- the
 * circuit does not change, the program does. So the batch test grades all three
 * against one graph and measures one set of metrics, and the only thing that
 * separates 47 from 45 is whether the machine can jump.
 *
 * WHY THESE ARE `program` CHECKS AND WHAT THAT DECIDES. `levels/checks.ts`
 * assembles each level's `source` and loads the bytes into the circuit's
 * `ram_prog` before the first step, then drives the steps exactly as `script`
 * does. The consequence a level author has to respect is the tick arithmetic:
 *
 *  * the RAM is combinational from `PC`, so the machine is looking at `ram[PC]`
 *    when a step's inputs are settled;
 *  * the edge into a step's tick executes THAT instruction -- the register file
 *    writes, the counter advances or jumps -- and the comparison after the edge
 *    reads the new state;
 *  * so after `T` edges, instructions 0..T-1 have executed, and a program of `N`
 *    instructions has put its answer on `out` by tick `N` (the halt freezes the
 *    counter there, or a player's own output register holds the byte).
 *
 * THE ANSWER MUST STAY ON `out`, AND THE BRIEF SAYS SO. The reference publishes
 * `out` combinationally from the `move|sX|out` instruction while the halt line
 * holds the counter on that instruction's address, so the byte is stable
 * forever; a player who registers the `out` byte needs no halt at all. Both pass
 * every assertion here -- what the levels grade is the value on `out` at the
 * ticks they name, never the spelling that produced it.
 *
 * THE PALETTE IS EVERYTHING EARNED THROUGH LEVEL 44. By this point the player
 * holds all of chapters 1 and 2 plus the six CPU parts (39's `alu8`, 40's
 * `regfile6`, 41's `instr_decoder`, 42's `pc8`, 43's `ram_prog`, 44's `halt`),
 * so the three levels offer that whole kit and no part they have not earned --
 * the rule `test/levels/level-buildability.test.ts` walks. `decoder2` is
 * deliberately absent: it is registered for a later chapter and rewarded by no
 * level, so no level may offer it.
 */

/** The two connectors every level offers and no level rewards. */
const LEVEL_IO = ['level_input', 'level_output'] as const;

/**
 * Every part the game has handed the player by the time level 45 opens, in the
 * order the chapters hand them out: chapter 1's gates and memories, chapter 2's
 * wide operators, storage and decoders, then chapter 3's CPU parts.
 */
const UNLOCKED_BY_45 = [
  // Chapter 1.
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
  'delay_line',
  'mem1',
  // Chapter 2's wide family.
  'splitter',
  'maker',
  'const8',
  'and8',
  'or8',
  'nand8',
  'nor8',
  'xor8',
  'xnor8',
  'not8',
  'add8',
  'neg8',
  'less_u',
  'less_s',
  'equal8',
  'shift_l8',
  'shift_r8',
  'ashr8',
  'rot_l8',
  'rot_r8',
  'mul8',
  'div8',
  'full_adder',
  'switch',
  'switch8',
  'mux8',
  'delay8',
  'reg8',
  'counter8',
  'ram8',
  'decoder1',
  'decoder3',
  // Chapter 3's CPU parts.
  'alu8',
  'regfile6',
  'instr_decoder',
  'pc8',
  'ram_prog',
  'halt',
  ...LEVEL_IO,
] as const;

/**
 * The three levels' pin shape: one clock pin in, one answer byte out.
 *
 * `clk` is the level's tick, as it is on every storage level since chapter 2 --
 * the driver advances the simulation, and the pin exists so the level declares
 * the tick it runs on.
 */
const IO_PROGRAM: LevelIo = {
  inputs: [{ id: 'clk', width: 1 }],
  outputs: [{ id: 'out', width: 8 }],
};

/**
 * Level 45's program: a straight line with no jumps at all.
 *
 * Six instructions: two constants moved into REG1 and REG2, one addition into
 * REG3, and the output instruction. Every value that reaches the ALU arrives
 * through a register, which is what makes this the "the machine runs a program"
 * level rather than a calculation level: the bytes come out of the program RAM
 * one per tick and nothing about them is chosen by the harness.
 */
export const PROGRAM_45 = [
  '# six instructions, no jumps: the machine walks the image in order',
  'loadi|6', // 0: REG0 = 6
  'move|s0|d1', // 1: REG1 = 6
  'loadi|7', // 2: REG0 = 7
  'move|s0|d2', // 3: REG2 = 7
  'add', // 4: REG3 = 13
  'move|s3|out', // 5: out = 13
].join('\n');

/**
 * Level 45's walk: the answer is 0 until the output instruction has executed,
 * and 13 from then on.
 *
 * Tick 6 is the edge that executes instruction 5, so the assertion there holds
 * for both spellings of "the answer stays on out" -- a halt that freezes the
 * counter on that instruction, and an output register that keeps the byte. Tick
 * 10 then asserts the byte is still there several edges later, which is where a
 * machine that neither halts nor holds the byte fails.
 */
const STEPS_45: readonly ProgramStep[] = [
  { tick: 0, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 3, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 6, inputs: { clk: 1 }, expect: { out: 13 } },
  { tick: 10, inputs: { clk: 1 }, expect: { out: 13 } },
];

/**
 * Level 46's program: the immediate field on both of its paths.
 *
 * `loadi|63` is the largest value the six-bit field can carry, so a circuit that
 * wired only five of the bits into the register file, or sign-extended bit 5,
 * disagrees here. `loadi|finish` carries a LABEL rather than a number: the
 * assembler resolves it to the index of the next instruction, which for a
 * six-instruction program is 6, and the subtraction leaves 57 on `out`. Both
 * operands therefore come out of the instruction word itself.
 */
export const PROGRAM_46 = [
  '# the six-bit immediate, at the top of its range and through a label',
  'loadi|63', // 0: REG0 = 63 (the field's maximum)
  'move|s0|d1', // 1: REG1 = 63
  'loadi|finish', // 2: REG0 = the index of `finish`, which is 6
  'move|s0|d2', // 3: REG2 = 6
  'sub', // 4: REG3 = 63 - 6 = 57
  'move|s3|out', // 5: out = 57
  'label finish',
].join('\n');

/**
 * Level 46's walk: the same shape as level 45's, against the other program.
 *
 * A five-bit immediate path publishes 25 here (31 - 6), and a path that ignored
 * `loadi` publishes 250 (0 - 6): both are named in the batch test, which builds
 * them from the machine's own options.
 */
const STEPS_46: readonly ProgramStep[] = [
  { tick: 0, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 3, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 6, inputs: { clk: 1 }, expect: { out: 57 } },
  { tick: 9, inputs: { clk: 1 }, expect: { out: 57 } },
];

/**
 * Level 47's program: the compendium's do-while countdown, made to accumulate.
 *
 * The source's §10.3 shows the shape -- `label loop`, a body, `loadi|loop`, a
 * conditional jump back -- and this program keeps it: the loop counts a register
 * down from 6 and adds each value to a running total, so the number it leaves on
 * `out` says how many times the loop ran as well as what it computed. The exit
 * is a `jz` on the decremented counter (instruction 10's subtraction leaves the
 * test value in REG3), and BOTH jump targets are load-bearing and different:
 * `done` (16) leaves the loop, `loop` (2) is the back edge of the unconditional
 * `j` at instruction 15.
 *
 * WHY IT COUNTS DOWN AND ACCUMULATES RATHER THAN COUNTING UP TO OVERFLOW, as
 * §10.3's literal example does: that example's exit value is REG3 = 0, which is
 * also what an empty `out` pin publishes, so a circuit that hard-wired `out` to
 * zero would pass a walk that only asserted the final byte. This program's
 * answer is 21 -- 6 + 5 + 4 + 3 + 2 + 1 -- which no constant produces, and the
 * walk asserts both that `out` is 0 while the loop is running and that it is 21
 * once the loop has exited, so neither constant passes either. The batch test
 * checks that arithmetic: the straight-line machine stops the loop after one
 * pass and publishes 6.
 *
 * THE LOOP RUNS SIX TIMES AND 14 INSTRUCTIONS WIDE, and the last pass is one
 * instruction shorter: the exit `jz` is the loop body's twelfth instruction, so
 * the final pass never reaches the back edge. The output instruction is therefore
 * the 85th edge -- 2 setup instructions, five full passes of 14 (70), the last
 * pass's 12, and one more -- and the steps below name ticks 83 and 85 around that
 * boundary.
 */
export const PROGRAM_47 = [
  '# do-while: count down from 6, accumulating, until the counter hits zero',
  'loadi|6', // 0: REG0 = 6
  'move|s0|d1', // 1: REG1 = 6, the counter
  'label loop', // -> 2
  'move|s1|d5', // 2: REG5 = the counter
  'move|s4|d1', // 3: REG1 = the running total
  'move|s5|d2', // 4: REG2 = the counter
  'add', // 5: REG3 = total + counter
  'move|s3|d4', // 6: REG4 = the new total
  'move|s5|d1', // 7: REG1 = the counter again
  'loadi|1', // 8: REG0 = 1
  'move|s0|d2', // 9: REG2 = 1
  'sub', // 10: REG3 = counter - 1
  'move|s3|d1', // 11: REG1 = counter - 1, the next counter
  'loadi|done', // 12: REG0 = 16, where the loop leaves to
  'jz', // 13: counter reached zero -> jump to REG0
  'loadi|loop', // 14: REG0 = 2, the loop's own address
  'j', // 15: back to the top
  'label done', // -> 16
  'move|s4|out', // 16: out = the total
].join('\n');

/**
 * Level 47's walk, and the one the whole phase is graded on.
 *
 * Ticks 0, 40 and 83 are inside the loop or its setup, and all three demand 0:
 * the answer is not on `out` yet, whatever the loop is computing. Tick 85 is the
 * edge that executes instruction 16, and 21 is the total; tick 95 asserts it is
 * still there. A machine without the conditional jump leaves the loop after one
 * pass and publishes 6 (or, with a jump that is always taken, leaves it just as
 * early); a circuit that hard-wires `out` fails one end of the walk or the other.
 */
const STEPS_47: readonly ProgramStep[] = [
  { tick: 0, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 40, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 83, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 85, inputs: { clk: 1 }, expect: { out: 21 } },
  { tick: 95, inputs: { clk: 1 }, expect: { out: 21 } },
];

export const CH3_BATCH3: readonly LevelSpec[] = [
  /**
   * ch3-45-program -- Program / 程序
   *
   * SOURCED: the name in both languages, its position (45th), and the source's
   * one-line concept -- store the program in RAM and use the counter as the
   * program counter. The one-byte instruction and its two-bit mode come from
   * §6.1/§6.3; the register roles the program relies on (REG0 for `loadi`, REG1
   * and REG2 into REG3 for a calculation, `out` for the output port) are §6.2's.
   *
   * AUTHORED: the pin shape (`clk` in, `out` out -- the plan's table for this
   * batch); the six-instruction program; the four-step walk; the palette; and
   * the measured target. There is no new reward: chapters 1-3 have handed the
   * player every part this level needs, which is why it is the level where they
   * are used together rather than the level where another one arrives.
   *
   * THE MACHINE IS THE LEVEL, AND THE PROGRAM IS THE ONLY THING THAT CHANGES
   * between 45, 46 and 47. This level's program has no jumps: a straight line of
   * six instructions whose values all arrive through the decoder and the
   * registers, so the player's decoder, register file, ALU, RAM and counter all
   * have to work for the walk to reach tick 6. What it does NOT exercise is the
   * conditional jump, which is why level 47 is the acceptance level and this one
   * is not.
   *
   * THE WALK ASSERTS THE ANSWER TWICE, four ticks apart. That is the property
   * the level's brief asks for in both languages: the byte must still be on `out`
   * after the program has stopped executing, so a machine that publishes `out`
   * combinationally from the current instruction either has to halt or has to
   * hold the byte in a register. Both spellings pass; neither is named in the
   * check.
   */
  {
    id: 'ch3-45-program',
    chapter: 3,
    index: 45,
    name: { zh: '程序', en: 'Program' },
    brief: {
      zh: '整台机器：程序放在 ram_prog 里，pc8 依次给出地址，取出的字节经指令解码器驱动寄存器堆与运算器。一个时钟沿执行一条指令。本关的程序是一条直路：loadi 把数值写进 REG0，move|s0|dN 把它转进别的寄存器，calc 用 REG1 与 REG2 算出 REG3，最后 move|s3|out 把 REG3 写到 out。写 out 之后机器不再前进（或者你自己把结果锁住），out 上的值要一直保持。',
      en: 'The whole machine: the program lives in the ram_prog, a pc8 walks the addresses, and each byte it fetches drives the register file and the ALU through the instruction decoder. One clock edge executes one instruction. This level\u2019s program is a straight line: loadi writes a value into REG0, move|s0|dN carries it into another register, a calc turns REG1 and REG2 into REG3, and move|s3|out writes REG3 to out. After that the machine stops advancing (or you latch the result yourself), and the byte on out has to stay there.',
    },
    hint: {
      zh: '把上一关的计算单元加上 pc8 与 ram_prog：ram_prog 的地址接 PC 的输出，取出的字节接指令解码器；PC 的 load 由跳转信号与停机信号控制，没有跳转时它每个时钟沿加一。out 可以就用一个「这条指令是 move|sX|out 时把源字节放出去」的开关，再让停机信号把 PC 按住（PC 的 in 接自己的输出、load 接停机），这样答案就停在那里；也可以另加一个 8 位寄存器在写 out 的那一拍锁住字节。',
      en: 'Add a pc8 and a ram_prog to the calculation unit: the RAM\u2019s address is the counter\u2019s output, its byte is the decoder\u2019s input, and the counter\u2019s load pin is driven by the jump and halt signals (with neither, it just increments). For out, a Switch that passes the move source while the instruction is move|sX|out works if the halt line then holds the counter (wire the counter\u2019s in to its own output and its load to the halt), or add an 8-Bit Register that latches the byte on the edge that writes out.',
    },
    allowedComponents: [...UNLOCKED_BY_45],
    io: IO_PROGRAM,
    checks: [{ kind: 'program', source: PROGRAM_45, steps: STEPS_45 }],
    // Measured: the machine in `test/fixtures/ch3-references.ts`, graded against
    // this level's program. All three levels of the batch share the graph, so
    // they share the gate and delay numbers; the tick is this walk's last step.
    threeStar: { gate: 643, delay: 6, tick: 10 },
  },

  /**
   * ch3-46-immediate-values -- Immediate Values / 立即数
   *
   * SOURCED: the name in both languages, its position (46th), the source's
   * one-line concept -- support values encoded directly in the instruction -- and
   * §6.3's field: immediate mode is `00` followed by a six-bit value, so the
   * range is 0-63 and §6.5 lists "cannot encode a value above 63" as one of
   * OVERTURE's stated limits. §6.6's label rule ("a label is the index of the
   * instruction after it") is what `loadi|finish` uses.
   *
   * AUTHORED: the pin shape; the six-instruction program; the four-step walk;
   * the palette; and the measured target, which is the same machine as level
   * 45's and therefore the same numbers. No new reward.
   *
   * THE PROGRAM IS BUILT TO FAIL THE TWO NEAR-MISSES, and the batch test builds
   * both from the machine's options. `loadi|63` sits at the top of the six-bit
   * field, so a machine whose immediate reaches the register file through five
   * bits publishes 25 (31 - 6) rather than 57; `loadi|finish` is a label, so a
   * machine that somehow passed the opcode through instead of the field would
   * have to answer with the wrong address. And a machine whose `loadi` write path
   * is not wired at all publishes 250 (0 - 6), which is why the walk's value is a
   * subtraction rather than another sum: the two failures land on different
   * bytes.
   */
  {
    id: 'ch3-46-immediate-values',
    chapter: 3,
    index: 46,
    name: { zh: '立即数', en: 'Immediate Values' },
    brief: {
      zh: '还是上一关那台机器，换一段程序：这一段专门走立即数通路。loadi|N 把 0 到 63 的常数写进 REG0；loadi|标签 写进去的是标签所指的那条指令的序号（本关的标签在程序末尾）。程序会用到字段的上限 63，减法之后把结果留在 out 上，写 out 之后的值同样要保持。',
      en: 'The same machine as the last level with a different program: this one walks the immediate path. loadi|N writes a constant from 0 to 63 into REG0, and loadi|<label> writes the index of the instruction the label names (this level\u2019s label sits at the end of the program). The program uses 63, the top of the field, subtracts, and leaves the result on out -- and the byte on out has to stay there just as before.',
    },
    hint: {
      zh: '立即数通路只有一处：指令解码器的 imm 是 6 位，而寄存器堆的数据是 8 位，高位补 0 即可——把 imm 直接接到写数据选择器的立即数一侧，选择信号用「模式为 00」。务必接满 6 位：少接最高位会让 63 变成 31。标签由汇编器解析成指令序号，写进 imm 字段，所以标签这一路和常数走的是同一根线。',
      en: 'There is exactly one place the immediate can go wrong: the decoder\u2019s imm pin is six bits while the register file takes eight, so the top two bits are zeroes -- wire imm into the immediate side of the write-data mux with "mode is 00" as the select. Wire all six bits: dropping the top one turns 63 into 31. A label is resolved by the assembler into an instruction index and written into that same imm field, so it travels the same wire as a number.',
    },
    allowedComponents: [...UNLOCKED_BY_45],
    io: IO_PROGRAM,
    checks: [{ kind: 'program', source: PROGRAM_46, steps: STEPS_46 }],
    // Measured: the same machine as level 45, so the same pair; the tick is this
    // walk's last step.
    threeStar: { gate: 643, delay: 6, tick: 9 },
  },

  /**
   * ch3-47-turing-complete -- Turing Complete / 图灵完备
   *
   * SOURCED: the name in both languages, its position (47th, and the last level
   * of the chapter), the source's one-line concept -- integrate the conditional
   * jump and become Turing complete -- and §6.4's jump table: `j` is taken, `jz`
   * is taken when the compared value is zero, `jnz` when it is not, with the
   * target in REG0 and the compared value in REG3. §10.3 is where the source
   * shows the loop these instructions are for, and this level's program is that
   * do-while shape.
   *
   * AUTHORED: the pin shape; the machine's conditional-jump glue (the three
   * conditions decoded from bits [5:3] and the counter's load/in pair); the
   * program; the five-step walk; the palette; and the measured target. No new
   * reward: this is where the chapter's six parts are used together, which is
   * the acceptance criterion the phase plan names for the whole phase.
   *
   * THIS IS THE PHASE'S ACCEPTANCE LEVEL, AND ITS TEST HAS TO SHOW THAT. A walk
   * that a straight-line machine can pass would not be testing the thing the
   * level is named after, so the batch test grades the SAME machine with the
   * conditional jump short-circuited -- never taken, and always taken -- and
   * asserts both fail this level's walk. It also grades a machine with the halt
   * line tied low, which publishes the right byte for one edge and loses it as
   * soon as the counter moves on.
   *
   * THE PROGRAM'S ARITHMETIC IS THE ANSWER'S EVIDENCE. The loop counts a
   * register down from 6 and accumulates as it goes, so `out` ends at 21 = 6 + 5
   * + 4 + 3 + 2 + 1: a machine that runs the loop once publishes 6, one that
   * never exits publishes 0, and the walk asserts 0 at three ticks inside the
   * loop before it asserts 21 after the exit. Whichever way the jump is broken,
   * one of those five assertions catches it.
   */
  {
    id: 'ch3-47-turing-complete',
    chapter: 3,
    index: 47,
    name: { zh: '图灵完备', en: 'Turing Complete' },
    brief: {
      zh: '验收关：把条件跳转接上，这台机器就能循环。跳转指令从 REG0 取目标地址、从 REG3 取条件值：j（条件 000）永远跳，jz（001）在 REG3 为 0 时跳，jnz（010）在 REG3 不为 0 时跳，其它条件码不跳。本关的程序是一个 do-while 循环：从 6 开始倒数，每一步把当前的数累加起来，数到 0 就跳出循环，把累加和写到 out。循环期间 out 必须还是 0。',
      en: 'The acceptance level: wire the conditional jump and this machine can loop. A jump takes its target from REG0 and its condition value from REG3: j (condition 000) always jumps, jz (001) jumps when REG3 is zero, jnz (010) when it is not, and any other condition code does not jump. This level\u2019s program is a do-while loop: it counts down from 6, adds each value to a running total, and when the count reaches zero it leaves the loop and writes the total to out. While the loop is running, out must still read 0.',
    },
    hint: {
      zh: '条件判断那一关的三条条件线接进 PC 的 load：条件字段（也就是解码器的 op 引脚）经 3 位译码器得到「条件 0/1/2」，REG3 用 equal8 与 0 比较；jz 与「是零」相与、jnz 与「不是零」相与，和 j 或起来，再与「模式是 11」相与，就是「这次要跳」。PC 的 in 接 REG0（跳转时读地址 A 就是 REG0），load 由「要跳」或「停机」驱动；写 out 的那条指令同时把停机拉高，PC 就停在那里。',
      en: 'Wire the three condition lines into the counter\u2019s load: decode the condition field (the decoder\u2019s op pin) with a 3-Bit Decoder for conditions 0/1/2, compare REG3 against zero with an Equal part, AND jz with "is zero" and jnz with "is not zero", OR those with j, and AND the result with "the mode is 11". That signal is "this jump is taken". The counter\u2019s in pin takes REG0 (the jump target, which the register file publishes on address A during a jump) and its load is driven by "taken or halted"; the instruction that writes out raises the halt line, and the counter stops there.',
    },
    allowedComponents: [...UNLOCKED_BY_45],
    io: IO_PROGRAM,
    checks: [{ kind: 'program', source: PROGRAM_47, steps: STEPS_47 }],
    // Measured: the machine in `test/fixtures/ch3-references.ts` graded against
    // this level's loop. The gate and delay are the shared machine's; the tick is
    // the last step of the walk, one edge past the loop's exit.
    threeStar: { gate: 643, delay: 6, tick: 95 },
  },
];
