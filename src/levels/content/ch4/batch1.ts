import { overtureBoard } from '../../boards/overture';
import type { LevelSpec, ProgramStep } from '../../spec';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation).
import type { LevelIo } from '../../tables';

/**
 * Chapter 4, levels 50-52: the machine the player BUILT becomes the machine the
 * player PROGRAMS.
 *
 * THE CPU IS THE ONE FROM CHAPTER 3, AND THE BOARD IS THE IMPORT CHANNEL
 * (ruling 1). Each level ships `board: overtureBoard({ inputId })` -- the same
 * builder `test/fixtures/ch3-references.ts` grades chapter 3's machine against,
 * so there is exactly one circuit behind both chapters and no copy to drift
 * (see `boards/overture.ts`). It is a STARTING POINT, not a built-in CPU: the
 * player can still edit every part and wire of it. `inputId` is the one knob
 * these levels turn, because every one of them reads the level's input pin.
 *
 * THE PROGRAM IS THE PLAYER'S (ruling 2). `runChecks(graph, registry, spec,
 * player?)` reads the buffer its fourth argument carries when the check says
 * `from: 'player'`, and that is the only channel these levels have: the level
 * data carries NO `source`, because the reference programs belong to
 * `test/fixtures/ch4-references.ts` and the player buffer must never be graded
 * against text the level ships. What the check DOES carry is the walk -- the
 * ticks and the bytes that must be on `out`.
 *
 * THE TICK ARITHMETIC IS CHAPTER 3'S, ONE SIDE FACING OUT. The program RAM is
 * combinational from the counter, so while the machine is looking at
 * `move|sX|out` the answer is ALREADY on `out`; that is the program's Nth
 * instruction (index N-1) and therefore tick N-1 after N-1 edges. The `halt`
 * line -- the default, and the reason these are all straight-line levels --
 * freezes the counter on that instruction and the byte stays put. So each walk
 * asserts 0 before that tick, the answer on it, and the same answer several
 * edges later, where a machine (or a program) that does not hold its answer
 * fails.
 *
 * EVERY STEP REPEATS ITS INPUTS, and that is a driver rule rather than a style
 * one: `driveSteps` writes EVERY input pin at every step and defaults the pins a
 * step omits to 0, so a step that forgot `inputs` would clear the very byte the
 * program is supposed to read. `test/levels/ch4-batch1.test.ts` holds every
 * step to it.
 *
 * TWO WALKS PER LEVEL, ON TWO DIFFERENT VECTORS (controller ruling R9). A
 * `program` check executes the player's text once, so one walk pins one
 * (input, answer) pair -- and a program that ignores the input could hard-code
 * exactly that pair, publish it on the reveal tick, and pass. Every level here
 * therefore carries TWO `program` checks: two walks of the same shape on
 * different inputs. `runChecks` builds a fresh Simulation per check and merges
 * `ticksUsed` as `Math.max`, so this is one data entry per vector and nothing
 * else -- but a constant answers both walks the same way and the walks demand
 * different bytes, so no input-ignoring program can answer both. The batch
 * test's constant spoofs are the proof: each one reproduces its own walk
 * perfectly and is rejected by the sibling walk.
 *
 * CHAPTER 4 HANDS OUT NO NEW PARTS (spec §3.3: "无新元件；解锁汇编 IDE 与调试器"),
 * so every level's `rewards` is absent and the palette is not "everything
 * earned" (chapter 3's shape) but the exact parts the SHIPPED BOARD is built
 * from -- the machine is the level, and the parts are the ones it is made of.
 */

/**
 * Every part the shipped board is made of: `overtureBoard({ inputId })`'s
 * parts, connectors included, and nothing else.
 *
 * Read against `boards/overture.ts`'s `placedParts`: the level's own pins, the
 * fetch stage (rails, program RAM, counter, decoder), the mode and field glue
 * (splitters, the four mode gates and the one-hot decoders), the register file
 * with its ALU and write path (muxes and switches), and the jump glue plus the
 * halt line. `test/levels/ch4-batch1.test.ts` holds this list to the board in
 * BOTH directions -- every part the board uses is listed, and the list names
 * nothing the board does not use.
 */
const BOARD_PARTS = [
  // The level's own pins: two inputs (the clock the driver ticks on, and the
  // data pin this level reads) and the answer.
  'level_input',
  'level_output',
  // Fetch and the constant rails.
  'const_on',
  'const_off',
  'ram_prog',
  'pc8',
  'instr_decoder',
  // Mode and fields: splitters, the mode gates, the one-hot decoders, and the
  // REG1/REG2/REG3 constants the read addresses are made from.
  'splitter',
  'not',
  'nor',
  'and',
  'nand',
  'decoder3',
  'maker',
  // The register file, the ALU and the write path (source, calc/loadi selects,
  // and the write-address rules).
  'mux8',
  'switch8',
  'regfile6',
  'alu8',
  // The jump glue and the halt line that holds the answer on `out`.
  'equal8',
  'or3',
  'or',
  'halt',
] as const;

/** The two arithmetic levels: one 8-bit input, one 8-bit answer. */
const IO_IN: LevelIo = {
  inputs: [{ id: 'in', width: 8 }],
  outputs: [{ id: 'out', width: 8 }],
};

/** Level 52's pin shape: the same one byte in, one byte out, named `r`. */
const IO_R: LevelIo = {
  inputs: [{ id: 'r', width: 8 }],
  outputs: [{ id: 'out', width: 8 }],
};

/**
 * Level 50's walks: `in` driven at 100 for 105, and at 42 for 47 -- the two
 * (input, answer) pairs this level grades (ruling R9: two vectors, two checks).
 *
 * TICK 4 IS WHERE THE ANSWER APPEARS, and the number is the program's own
 * shape: `out` publishes while the counter looks at `move|s3|out`, the fifth
 * instruction (index 4), so the byte is there after four edges. Tick 3 demands
 * 0 one edge earlier and tick 10 demands the byte again -- the halt has to have
 * frozen the counter, or the byte would have fallen back to 0. The second walk
 * repeats the shape on its own input: same ticks, different bytes.
 *
 * WHY 100 AND 42. The vectors are chosen to be spoof-proof TOGETHER rather
 * than alone. At tick 4 an input-ignoring program has executed four setup
 * instructions, and the values that can be sitting in a register by then are a
 * bare immediate (0-63), its complement (192-255), twice an immediate, or the
 * few constants the ops make from zero -- so 105 cannot be hard-coded at this
 * tick at all, while 47 can (`loadi|47`, three filler moves, `move|s0|out`).
 * One walk alone would accept that constant; the sibling walk demands 105 and
 * rejects it. That is exactly the invariant ruling R9 protects: every level
 * rejects at least one program that produces the right answer at the right
 * tick while ignoring its input.
 */
const STEPS_50_AT_100: readonly ProgramStep[] = [
  { tick: 0, inputs: { in: 100 }, expect: { out: 0 } },
  { tick: 3, inputs: { in: 100 }, expect: { out: 0 } },
  { tick: 4, inputs: { in: 100 }, expect: { out: 105 } },
  { tick: 10, inputs: { in: 100 }, expect: { out: 105 } },
];

const STEPS_50_AT_42: readonly ProgramStep[] = [
  { tick: 0, inputs: { in: 42 }, expect: { out: 0 } },
  { tick: 3, inputs: { in: 42 }, expect: { out: 0 } },
  { tick: 4, inputs: { in: 42 }, expect: { out: 47 } },
  { tick: 10, inputs: { in: 42 }, expect: { out: 47 } },
];

/**
 * Level 51's walks: the same two-vector shape against `in + 3` -- driven at
 * 100 for 103, and at 200 for 203.
 *
 * Same tick arithmetic as level 50's (the program is the same five
 * instructions with the constant changed) and the same two-vector rule. 103
 * cannot be hard-coded at tick 4 (odd, outside the immediate and its
 * complement), while 203 can: it is 52's complement, `loadi|52` into both
 * addends followed by `nor`. So the constant that reproduces the second walk
 * is caught by the first, whichever walk a spoofer aims at.
 */
const STEPS_51_AT_100: readonly ProgramStep[] = [
  { tick: 0, inputs: { in: 100 }, expect: { out: 0 } },
  { tick: 3, inputs: { in: 100 }, expect: { out: 0 } },
  { tick: 4, inputs: { in: 100 }, expect: { out: 103 } },
  { tick: 10, inputs: { in: 100 }, expect: { out: 103 } },
];

const STEPS_51_AT_200: readonly ProgramStep[] = [
  { tick: 0, inputs: { in: 200 }, expect: { out: 0 } },
  { tick: 3, inputs: { in: 200 }, expect: { out: 0 } },
  { tick: 4, inputs: { in: 200 }, expect: { out: 203 } },
  { tick: 10, inputs: { in: 200 }, expect: { out: 203 } },
];

/**
 * Level 52's walks: `r` driven at 200, where 6r = 1200 wraps to 176, and at 9,
 * where 6r = 54 -- the wrap case and the plain one, the exact pair
 * `reference-programs.md` verifies on the real board (r = 1/9/42/200 give
 * 6/54/252/176).
 *
 * THE WRAP IS THE LEVEL'S OWN TEACHING POINT -- `out = (6 * r) & 0xff` and the
 * mod 256 is real -- and 200 is the value the reference-program verification
 * measured (r = 200 -> 176). The answer appears at tick 8, the index of this
 * program's `move|s3|out`, and tick 7 demands 0 one edge earlier.
 *
 * WHY TWO WALKS HERE, ABOVE ALL. At eight setup instructions even 176 can be
 * built from constants alone -- `loadi|63, move|s0|d1, loadi|50, move|s0|d2,
 * add, move|s3|d2, move|s0|d4, add, move|s3|out` is 63 + (63 + 50), revealed
 * on tick 8 exactly like the reference -- so a single walk was spoofable
 * whatever vector it chose. The second walk is what closes it: that constant
 * answers 176 to r = 9 as well, where the answer has to be 54.
 */
const STEPS_52_AT_200: readonly ProgramStep[] = [
  { tick: 0, inputs: { r: 200 }, expect: { out: 0 } },
  { tick: 7, inputs: { r: 200 }, expect: { out: 0 } },
  { tick: 8, inputs: { r: 200 }, expect: { out: 176 } },
  { tick: 14, inputs: { r: 200 }, expect: { out: 176 } },
];

const STEPS_52_AT_9: readonly ProgramStep[] = [
  { tick: 0, inputs: { r: 9 }, expect: { out: 0 } },
  { tick: 7, inputs: { r: 9 }, expect: { out: 0 } },
  { tick: 8, inputs: { r: 9 }, expect: { out: 54 } },
  { tick: 14, inputs: { r: 9 }, expect: { out: 54 } },
];

export const CH4_BATCH1: readonly LevelSpec[] = [
  /**
   * ch4-50-punchcard-programming -- Punchcard Programming / 打孔编程
   *
   * SOURCED: the name in both languages and its position from the 2.x dossier's
   * chapter-4 table -- its first level, global 50 -- plus its one-line concept,
   * hand-written binary encoding, and its 1.x ancestor's name ("Add 5").
   * Chapter 4's teaching goal is sourced with it: first hand-write machine
   * code, then unlock the assembler, and solve programming puzzles with your
   * own CPU.
   *
   * AUTHORED (this replica's design): everything a player sees or a test
   * measures. The `in:8 -> out:8` pin shape; the semantics `out = (in + 5) &
   * 0xff`; the board (the chapter-3 machine, `overtureBoard({ inputId: 'in' })`
   * with the default halt -- see the module note); the `program` check that
   * reads the PLAYER's buffer as one-byte-per-line machine code
   * (`from: 'player'`, `format: 'bytes'`); the two four-step walks and their
   * inputs 100 and 42 (two vectors on two checks, ruling R9 -- see the module
   * note); the palette (the board's own parts) and the absent reward; and the
   * measured three-star target.
   *
   * THIS IS THE LEVEL THAT HAND-ENCODES. No mnemonics and no assembler: the
   * player writes the opcode bits themselves, which is the whole concept, so
   * the check's reader is `parseImage` (`asm/image.ts`) -- eight binary digits
   * per line, comments allowed -- rather than the assembler the next level
   * unlocks. The reference program in the fixture is those five bytes, and the
   * batch test re-derives them from the ISA table so the two readers cannot
   * drift apart.
   */
  {
    id: 'ch4-50-punchcard-programming',
    chapter: 4,
    index: 50,
    name: { zh: '打孔编程', en: 'Punchcard Programming' },
    brief: {
      zh: '这台 CPU 就是你第 3 章搭好的那台 OVERTURE——现在轮到给它写程序了。这一关从最底层开始：手工机器码，每行 8 位二进制就是一个字节的指令，装进程序 RAM 后一个时钟沿执行一条。程序要算 out = (in + 5) & 0xff：把输入搬进寄存器，loadi 取常数 5，add 相加，最后把结果 move 到 out。写 out 之后机器会停在那条指令上，out 上的字节必须一直保持。',
      en: 'This is the very CPU you built in chapter 3 -- now it is your turn to write programs for it. This level starts at the bottom: hand-written machine code, one line of 8 binary digits per byte of instruction, loaded into the program RAM and executed one instruction per clock edge. The program must compute out = (in + 5) & 0xff: move the input into a register, loadi the constant 5, add, and move the sum to out. Once out is written the machine stops on that instruction, and the byte on out has to stay there.',
    },
    hint: {
      zh: '一条指令就是一个字节：高 2 位是模式——00 是 loadi，01 是计算，10 是 move，11 是跳转。loadi 的低 6 位就是立即数（0-63）；计算指令的低 6 位是「运算码 + 000」，add 的运算码是 000；move 的低 6 位是「源 + 目的」：源 000-101 是寄存器 s0-s5、110 是输入 inp，目的 000-101 是 d0-d5、111 是 out。所以 move|inp|d1 是 10110001，loadi|5 是 00000101，move|s0|d2 是 10000010，add 是 01000000，move|s3|out 是 10011111。每行必须正好 8 位，# 之后是注释。',
      en: 'One instruction is one byte: the top 2 bits are the mode -- 00 loadi, 01 calc, 10 move, 11 jump. A loadi\u2019s low 6 bits are the immediate (0-63); a calc\u2019s low 6 bits are "opcode + 000", and add is opcode 000; a move\u2019s low 6 bits are "source + destination", where source 000-101 is registers s0-s5 and 110 is the input inp, and destination 000-101 is d0-d5 and 111 is out. So move|inp|d1 is 10110001, loadi|5 is 00000101, move|s0|d2 is 10000010, add is 01000000, and move|s3|out is 10011111. Every line has to be exactly 8 binary digits; everything after # is a comment.',
    },
    allowedComponents: [...BOARD_PARTS],
    io: IO_IN,
    // The player's program text, read as one byte per line, on two walks with
    // two different vectors (ruling R9). No `source`: the reference lives in
    // the fixture (ruling 2).
    checks: [
      {
        kind: 'program',
        from: 'player',
        format: 'bytes',
        steps: STEPS_50_AT_100,
      },
      {
        kind: 'program',
        from: 'player',
        format: 'bytes',
        steps: STEPS_50_AT_42,
      },
    ],
    board: overtureBoard({ inputId: 'in' }),
    // Measured: 675 gates and 6 deep (the shipped board -- see the module note
    // and `boards/overture.ts`), and the tick is the walks' last assertion
    // (both share the shape, so `Math.max` is 10).
    threeStar: { gate: 675, delay: 6, tick: 10 },
  },

  /**
   * ch4-51-assembly-programming -- Assembly Programming / 汇编程序
   *
   * SOURCED: the name in both languages and its position (the second level of
   * chapter 4, global 51) from the 2.x dossier's table, and its one-line
   * concept: assembly syntax, imm/mov/add. The chapter's sequence is sourced
   * too -- this is the level where the assembler is unlocked, one level after
   * the hand encoding.
   *
   * AUTHORED (this replica's design): the `in:8 -> out:8` pin shape; the
   * semantics `out = (in + 3) & 0xff`; the board (the same chapter-3 machine,
   * `overtureBoard({ inputId: 'in' })`); the `program` checks that read the
   * PLAYER's buffer as assembly (`from: 'player'`, `format: 'asm'`); the two
   * walks, which are level 50's shape against `in + 3`, on the two vectors
   * ruling R9 demands; the palette and the absent reward; and the measured
   * three-star target.
   *
   * THE PROGRAM IS LEVEL 50'S PROGRAM SPELLED DIFFERENTLY, which is the
   * level's own claim rather than a coincidence: the same five instructions,
   * the same bytes except the immediate, and the batch test pins both spellings
   * against one ISA table. What the player learns here is that the assembler
   * does not compute anything new -- it names the bits the previous level wrote
   * by hand -- so the answer still has to be built out of registers, and `add`
   * still reads r1 and r2 into r3.
   */
  {
    id: 'ch4-51-assembly-programming',
    chapter: 4,
    index: 51,
    name: { zh: '汇编程序', en: 'Assembly Programming' },
    brief: {
      zh: '还是你第 3 章搭的那台 CPU，这次不用手写字节了：这一关解锁汇编器，你写助记符，汇编器替你编成机器码。程序要算 out = (in + 3) & 0xff，和上一关同一条路，只是常数从 5 换成 3。每行一条指令——move|inp|d1、loadi|3、move|s0|d2、add、move|s3|out 这样的写法，# 之后是注释。写 out 之后机器停住，结果要保持。',
      en: 'The same CPU you built in chapter 3, and no hand encoding this time: this level unlocks the assembler -- you write mnemonics and it compiles the bytes for you. The program must compute out = (in + 3) & 0xff, the same path as the last level with the constant changed from 5 to 3. One instruction per line, spelled like move|inp|d1, loadi|3, move|s0|d2, add, move|s3|out, with # starting a comment. After out is written the machine stops, and the result has to stay.',
    },
    hint: {
      zh: '汇编器认的写法就这几种：loadi|N（N 是 0-63 的立即数）、move|sX|dY（源可以是 s0-s5 或 inp，目的可以是 d0-d5 或 out）、六种运算 add/sub/and/or/nand/nor，以及 label 和跳转。上一关的五个字节在这里就是 move|inp|d1、loadi|5、move|s0|d2、add、move|s3|out——把 5 改成 3 就是本关的程序。注意 add 固定读 r1 与 r2、把结果写进 r3，所以两个加数要先 move 进 r1 和 r2，结果再 move 出去。',
      en: 'The assembler takes a handful of spellings: loadi|N (N is an immediate from 0 to 63), move|sX|dY (source s0-s5 or inp, destination d0-d5 or out), the six calculations add/sub/and/or/nand/nor, and labels with jumps. Last level\u2019s five bytes spelled this way are move|inp|d1, loadi|5, move|s0|d2, add, move|s3|out -- change the 5 to 3 and you have this level\u2019s program. Note that add always reads r1 and r2 and writes r3: move your two addends into r1 and r2 first, and move the result out afterwards.',
    },
    allowedComponents: [...BOARD_PARTS],
    io: IO_IN,
    checks: [
      {
        kind: 'program',
        from: 'player',
        format: 'asm',
        steps: STEPS_51_AT_100,
      },
      {
        kind: 'program',
        from: 'player',
        format: 'asm',
        steps: STEPS_51_AT_200,
      },
    ],
    board: overtureBoard({ inputId: 'in' }),
    // Measured: the same board as level 50, so the same gate and delay; the
    // tick is the walks' last assertion (both share the shape, so `Math.max`
    // is 10).
    threeStar: { gate: 675, delay: 6, tick: 10 },
  },

  /**
   * ch4-52-circumference -- Circumference / 三番两次
   *
   * SOURCED: the name in both languages and its position (the third level of
   * chapter 4, global 52) from the 2.x dossier's table -- including the odd
   * pairing the source makes: the Chinese name 三番两次 is the idiom for "over
   * and over", and the English one is Circumference (the level's 1.x ancestor
   * was "Calibrating Laser Cannons"). The one-line concept is sourced with
   * them: compute 6r. The joke is the arithmetic itself -- a circumference is
   * about 6r, and 三番两次 reads as "three, twice", which is exactly how the
   * reference program computes it.
   *
   * AUTHORED (this replica's design): the `r:8 -> out:8` pin shape (the radius
   * is the chapter's one renamed input); the semantics `out = (6 * r) & 0xff`,
   * wrap and all; the board (`overtureBoard({ inputId: 'r' })`); the `program`
   * check reading the PLAYER's assembly; the two walks -- r = 200, where 6r
   * wraps to 176, and r = 9, where it is 54 -- on the two vectors ruling R9
   * demands (this level above all: see the walk note); the palette and the
   * absent reward; and the measured three-star target.
   *
   * WHY THIS LEVEL EXISTS BETWEEN THE ASSEMBLER AND THE LOOPS: the ISA has no
   * multiply, so 6r is addition used again and again -- and `add` reads r1 and
   * r2 into r3 and NOWHERE else, so every intermediate result has to be moved
   * back into place before the next sum. The program's seventh instruction is
   * that lesson: without `move|s3|d1` the two addends are 2r and 3r and the
   * answer is 5r -- the exact mistake the reference-program notes record, and
   * the sabotage case the batch test runs.
   */
  {
    id: 'ch4-52-circumference',
    chapter: 4,
    index: 52,
    name: { zh: '三番两次', en: 'Circumference' },
    brief: {
      zh: '这台 CPU 是你第 3 章搭的，给它写程序的第三课：指令表里没有乘法，只有 add/sub/and/or/nand/nor——要算 6r，就得把加法三番两次地用。输入脚叫 r，程序要算 out = (6 * r) & 0xff，注意结果按 256 取模（r = 200 时 6r = 1200，out 是 176）。写 out 之后机器停住，结果保持。',
      en: 'The CPU you built in chapter 3, and the third lesson in programming it: the instruction table has no multiply -- only add/sub/and/or/nand/nor -- so 6r has to come from addition used over and over. The input pin is r, and the program must compute out = (6 * r) & 0xff, wrapping at 256 (r = 200 gives 6r = 1200 and out = 176). After out is written the machine stops, and the result has to stay.',
    },
    hint: {
      zh: 'add 固定算 r3 = r1 + r2，结果不 move 回 r1 或 r2 就没法参加下一步。一条省指令的路：r1 = r、r2 = r，相加得 2r；把 2r move 回 r1，再和 r2 里的 r 相加得 3r；把 3r 分别 move 进 r1 和 r2，最后一次相加就是 6r——这正是「三番两次」。最后那步别只 move 进 r2：两个加数都得是 3r，否则加出来的是 5r。',
      en: 'add always computes r3 = r1 + r2, and a result that is not moved back into r1 or r2 cannot take part in the next step. One short route: r1 = r, r2 = r, add to get 2r; move 2r back into r1 and add r2\u2019s r to get 3r; move 3r into BOTH r1 and r2, then add once more for 6r -- three, twice. Do not move 3r into r2 alone: both addends have to be 3r, or the sum is 5r.',
    },
    allowedComponents: [...BOARD_PARTS],
    io: IO_R,
    checks: [
      {
        kind: 'program',
        from: 'player',
        format: 'asm',
        steps: STEPS_52_AT_200,
      },
      {
        kind: 'program',
        from: 'player',
        format: 'asm',
        steps: STEPS_52_AT_9,
      },
    ],
    board: overtureBoard({ inputId: 'r' }),
    // Measured: the same board as levels 50 and 51 (only the input pin's name
    // changes), so the same gate and delay; the tick is the walks' last
    // assertion (both share the shape, so `Math.max` is 14).
    threeStar: { gate: 675, delay: 6, tick: 14 },
  },
];
