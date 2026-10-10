import { overtureBoard } from '../../boards/overture';
import type { LevelSpec, ProgramStep } from '../../spec';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation).
import type { LevelIo } from '../../tables';

/**
 * Chapter 4, levels 53-56: the chapter's closing four, and the first levels in
 * it that are not all one shape.
 *
 * TWO KINDS OF LEVEL, ONE CHANNEL. Levels 53 and 55 are the straight-line shape
 * batch 1 established: `overtureBoard({ inputId })` as the board, the player's
 * program read by a `program` check (`from: 'player'`, no `source`), and a step
 * list that names the ticks the answer must and must not be on `out`. Levels 54
 * and 56 close the loop: the board is the same machine with `halt: false`, and
 * the check is `custom` -- the puzzle's data (a secret byte, a maze grid) lives
 * in the level, and a registered checker (`lock`, `maze`) resets the board,
 * loads the player's program itself, drives the level's pins and decides its own
 * verdict and tick count. Copying that driving logic into level data would be
 * hiding an engine in the level layer, which ruling 4 forbids.
 *
 * WHY THE CLOSED-LOOP LEVELS ARE `halt: false`, AND WHY THAT IS A FACT RATHER
 * THAN A TUNING. `out` on this machine is combinational: it publishes the byte a
 * `move|sX|out` instruction copies while that instruction is being decoded, and
 * the halt line freezes the program counter on that instruction so the byte
 * stays put. That is exactly what levels 53 and 55 want -- the answer must
 * remain on `out` for the walk's later assertions -- and exactly what 54 and 56
 * cannot have: a searching or walking program writes `out` inside its loop, so
 * on the halting board it would stop at its first guess or its first move.
 * Measured: the code lock's reference locks at PC 2 with `try` at 0 forever.
 *
 * THE PROGRAM IS THE PLAYER'S (ruling 2). `runChecks(graph, registry, spec,
 * player?)` reads the buffer its fourth argument carries -- for `from: 'player'`
 * directly, and for a `custom` check through the checker, which is handed the
 * same buffer. The level data therefore carries NO `source` anywhere: the
 * reference programs belong to `test/fixtures/ch4-references.ts`, and a level
 * that shipped one would let an empty buffer be graded against text the player
 * never wrote.
 *
 * THE PROGRAM LEVELS EACH CARRY TWO WALKS, ON TWO VECTORS (ruling R9). One
 * `program` check is one execution of the player's text, so one walk pins one
 * (input, answer) pair -- and a program that ignores its input can hard-code
 * exactly that pair and publish it on the reveal tick. Two walks whose vectors
 * and answers differ close that hole, because `runChecks` builds a fresh
 * Simulation per check and a constant cannot answer both. Both levels here are
 * deliberately the two ends of that argument: level 53's second vector is 1,
 * whose answer is small enough to hold as an immediate from tick 12, so a
 * constant program CAN reproduce that walk -- and the sibling walk's 55 at tick
 * 129 is what rejects it; level 55's answers (2 and 3) are both one-instruction
 * constants, and its walks disagree on the same tick 4.
 *
 * EVERY STEP REPEATS ITS INPUTS, and that is `driveSteps`' contract rather than
 * a style rule: it writes EVERY input pin at every step and defaults the pins a
 * step omits to 0, so a step without `inputs` would clear the byte the program
 * is supposed to read. `test/levels/ch4-batch2.test.ts` holds every step to it.
 *
 * CHAPTER 4 HANDS OUT NO NEW PARTS (spec §3.3), so every level's `rewards` is
 * absent and the palette is the exact part list the shipped board is built from
 * -- not "everything earned". `test/levels/ch4-batch2.test.ts` holds the list to
 * the board in BOTH directions.
 */

/**
 * Every part the shipped board is made of: `overtureBoard({ inputId })`'s parts,
 * connectors included, and nothing else.
 *
 * Read against `boards/overture.ts`'s `placedParts`: the level's own pins, the
 * fetch stage (rails, program RAM, counter, decoder), the mode and field glue
 * (splitters, the four mode gates and the one-hot decoders), the register file
 * with its ALU and write path (muxes and switches), and the jump glue plus the
 * halt line. `halt: false` ties a wire low rather than adding a part, which is
 * why the closed-loop levels state the same list and the same gate count.
 *
 * A COPY OF BATCH 1'S LIST, deliberately: this file's levels are pure data and
 * exporting the constant from `batch1.ts` would make one batch's module graph
 * depend on another's for a reviewable list that is the board's own. The batch
 * test holds each copy to the board, so a board change breaks both.
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

/**
 * THE TWO 8-BIT CONNECTORS, and the reason the closed-loop levels declare the
 * same shape as the straight ones even though their checkers need fewer bits on
 * paper (`match` is one bit of answer, `move` a two-bit code, `sensors` three
 * bits of wall). The level's io is what `bindLevelIo` compares against the
 * COMPILED pin, and the chapter's board carries 8-bit connectors; a level that
 * declared 3-bit `sensors` would fail at bind time with `missing-io` and the
 * checker would never run. The checkers validate these names and widths
 * themselves (`ioIssue`), so the names here are their contract.
 */
const IO_N: LevelIo = {
  inputs: [{ id: 'n', width: 8 }],
  outputs: [{ id: 'out', width: 8 }],
};

const IO_IN: LevelIo = {
  inputs: [{ id: 'in', width: 8 }],
  outputs: [{ id: 'out', width: 8 }],
};

const IO_MATCH: LevelIo = {
  inputs: [{ id: 'match', width: 8 }],
  outputs: [{ id: 'try', width: 8 }],
};

const IO_SENSORS: LevelIo = {
  inputs: [{ id: 'sensors', width: 8 }],
  outputs: [{ id: 'move', width: 8 }],
};

/**
 * Level 53's walks: the countdown sum driven at n = 10 for 55, and at n = 1 for
 * 1 -- two vectors, two checks (ruling R9).
 *
 * THE TICKS ARE THE PROGRAM'S OWN SHAPE, not a measurement to be adjusted. The
 * loop is instructions 1..13 and its exit pass is 1..11 (the `jz` at 11 is taken
 * once the counter reaches 0), so n passes put the `move|s4|out` at address 14
 * on tick 13n - 1: 129 for n = 10 and 12 for n = 1. Each walk asserts 0 one tick
 * earlier -- the machine is still working -- the answer on the reveal tick, and
 * the answer six ticks later, where the halt has to have frozen the counter.
 *
 * WHY 10 AND 1. 10 is the vector `reference-programs.md` measured this program
 * against. 1 is the other end: its answer (1) is a bare immediate, so an
 * input-ignoring program can hold it from tick 12 with `loadi|1` and eleven
 * filler moves -- the exact spoof ruling R9 exists for, and the batch test
 * builds it and shows that the 10-walk's 55 at tick 129 rejects it.
 */
const STEPS_53_AT_10: readonly ProgramStep[] = [
  { tick: 0, inputs: { n: 10 }, expect: { out: 0 } },
  { tick: 128, inputs: { n: 10 }, expect: { out: 0 } },
  { tick: 129, inputs: { n: 10 }, expect: { out: 55 } },
  { tick: 135, inputs: { n: 10 }, expect: { out: 55 } },
];

const STEPS_53_AT_1: readonly ProgramStep[] = [
  { tick: 0, inputs: { n: 1 }, expect: { out: 0 } },
  { tick: 11, inputs: { n: 1 }, expect: { out: 0 } },
  { tick: 12, inputs: { n: 1 }, expect: { out: 1 } },
  { tick: 18, inputs: { n: 1 }, expect: { out: 1 } },
];

/**
 * Level 55's walks: `in & 3` driven at 42 for 2 and at 255 for 3 -- the mask's
 * two vectors, and two answers that disagree on the same tick.
 *
 * TICK 4 IS WHERE THE ANSWER APPEARS, and the number is the program's shape:
 * `out` publishes while the counter looks at `move|s3|out`, the fifth
 * instruction (index 4), so the byte is there after four edges. Tick 3 demands 0
 * one edge earlier and tick 10 demands the byte again -- the halt has to have
 * frozen the counter, or it would have fallen back to 0.
 *
 * WHY 255 IS THE SECOND VECTOR. It is the all-ones byte, so the mask's answer is
 * 3 -- the complement of the first walk's 2 -- and both are single-instruction
 * constants (`loadi|2`, `loadi|3`), which is what makes this pair the sharpest
 * form of the R9 argument: either walk alone is spoofable by one immediate, and
 * only together do they refuse it.
 */
const STEPS_55_AT_42: readonly ProgramStep[] = [
  { tick: 0, inputs: { in: 42 }, expect: { out: 0 } },
  { tick: 3, inputs: { in: 42 }, expect: { out: 0 } },
  { tick: 4, inputs: { in: 42 }, expect: { out: 2 } },
  { tick: 10, inputs: { in: 42 }, expect: { out: 2 } },
];

const STEPS_55_AT_255: readonly ProgramStep[] = [
  { tick: 0, inputs: { in: 255 }, expect: { out: 0 } },
  { tick: 3, inputs: { in: 255 }, expect: { out: 0 } },
  { tick: 4, inputs: { in: 255 }, expect: { out: 3 } },
  { tick: 10, inputs: { in: 255 }, expect: { out: 3 } },
];

/**
 * The code lock's budget, in exchanges -- one exchange being one read of `try`,
 * one answer on `match`, one settle and one edge.
 *
 * 1024 IS HEADROOM, NOT A ROUND NUMBER. The reference walks the candidates up
 * from 0 and publishes each one inside a fourteen-instruction loop, so the read
 * that finds the secret 42 is tick 590 (measured, and re-measured by the batch
 * test); 1024 leaves over four hundred ticks -- some thirty more candidates --
 * for a program that counts less cleverly. It also bounds the cost of a player's
 * wrong program on every board edit, which is what the checker's own default
 * (4096) is about.
 */
const LOCK_BUDGET = 1024;

/**
 * The maze's budget, in the checker's own units -- one read of `move`, one
 * applied move, one published sensor byte and one edge.
 *
 * The reference needs 168 of them: ten moves along the wall follower's route,
 * each one costing a full pass of its 17-instruction loop except the last, whose
 * `out` is reached fourteen instructions in. So 1024 is roughly six times the
 * reference and still a cheap ceiling for a program that walks in circles. A
 * budget is the only thing that ends such a program, so it is level data rather
 * than a checker default: the puzzle is "arrive", and how long the robot may try
 * is part of the puzzle.
 */
const MAZE_BUDGET = 1024;

/**
 * THE MAZE ITSELF: single-cell-wide, fully enclosed, and solvable by the
 * reference rule.
 *
 * HOW IT WAS CHOSEN. `custom-maze.test.ts` solves one grid with the RIGHT-hand
 * follower ("right open then turn right, ..."); flipping that grid top to bottom
 * turns a right-hand maze into a left-hand one -- a reflection swaps left for
 * right and clockwise for anticlockwise while leaving east and west alone -- so
 * this is that grid's mirror image and the reference program's LEFT-hand rule
 * ("left open then turn left, else ahead open then forward, else turn right")
 * walks the mirror of the same route: five cells east along the top corridor, a
 * right turn at the wall, then four south onto `G`.
 *
 * WHY "ALWAYS FORWARD" CANNOT SOLVE IT. The top corridor runs east and then
 * stops at a wall two cells before the goal's column, so a program that only
 * publishes `move = 1` drives into that wall and the checker reports the
 * collision. That is ruling 3(c)'s counterexample, and the batch test drives it
 * through a real CPU.
 *
 * THE PATTERN IS ALSO IN THE LEVEL'S BRIEF, in both languages, and the batch
 * test holds the two to this same literal (ruling 3(d)): a grid edited here
 * without editing the story -- or the other way round -- is a red test.
 */
const MAZE_GRID: readonly string[] = [
  '########',
  '#S.....#',
  '#.#.##.#',
  '#.#..#.#',
  '#.##.#.#',
  '#....#G#',
  '########',
];

export const CH4_BATCH2: readonly LevelSpec[] = [
  /**
   * ch4-53-conditional-jumps -- Conditional Jumps / 条件跳转
   *
   * SOURCED: the name in both languages, its position (the fourth level of
   * chapter 4, global 53) and its one-line concept from the phase plan's
   * chapter-4 table, which transcribes the 2.x dossier's chapter-4 table (the
   * brief for this task, `task-8-brief.md`); the concept is the conditional jump
   * -- `jz`/`jnz` are what turn the machine's straight line into a loop.
   *
   * AUTHORED (this replica's design): the `n:8 -> out:8` pin shape; the
   * semantics `out = n + (n-1) + ... + 1, mod 256`; the board (the chapter-3
   * machine, `overtureBoard({ inputId: 'n' })` with the default halt); the
   * `program` checks that read the PLAYER's buffer as assembly
   * (`from: 'player'`); the two walks and their vectors 10 and 1, with the ticks
   * the reference program's own shape fixes (ruling R9 -- see the walk note);
   * the palette (the board's own parts) and the absent reward; and the measured
   * three-star target.
   */
  {
    id: 'ch4-53-conditional-jumps',
    chapter: 4,
    index: 53,
    name: { zh: '条件跳转', en: 'Conditional Jumps' },
    brief: {
      zh: '你的 OVERTURE 只在遇到跳转指令时才改变取指顺序——这一关把它用起来。输入脚 n，程序要算 out = n + (n-1) + … + 1（按 256 取模）：拿一个寄存器当计数器、一个当累加器，每轮把计数器加进累加器，再把计数器减 1，减到 0 就跳出循环，最后把累加器写到 out。写 out 之后 halt 会把 PC 冻在那条指令上，所以结果会一直保持。',
      en: 'Your OVERTURE only changes the order it fetches instructions when it meets a jump -- and this level is where the conditional jump earns its place. The input pin is n, and the program must publish out = n + (n-1) + ... + 1, taken mod 256. Keep the counter in one register and the running total in another: each pass adds the counter into the total, subtracts one from the counter, and leaves the loop when it reaches zero, then writes the total to out. After out is written the halt line freezes the program counter on that instruction, so the answer stays put.',
    },
    hint: {
      zh: '两条跳转都拿 r3 当条件、r0 当地址：先用 loadi 把目标地址装进 r0，jz 在 r3 == 0 时跳过去，jnz 在 r3 不为 0 时跳过去。循环体是「把计数器加进累加器，再把计数器减 1」：move|s5|d1 与 move|s4|d2 把两个操作数摆到 r1/r2，add 写 r3，move|s3|d4 存回累加器；接着 move|s5|d1、loadi|1、move|s0|d2、sub 得到「计数器 - 1」，move|s3|d5 存回计数器，再用 loadi|14 与 jz 决定出不出去（14 就是循环外那条 move|s4|out 的地址，循环头是地址 1）。输入只在第一拍读一次，之后全靠寄存器；另外注意计数器减到 0 的那一轮已经把 1 加进去了，所以和里正好包含 1。',
      en: 'Both jumps take their condition from r3 and their target from r0: loadi an address into r0 first, then jz jumps there when r3 is zero (jnz when it is not). The loop body is "add the counter into the total, then subtract one from the counter": move|s5|d1 and move|s4|d2 line the operands up in r1 and r2, add writes r3, and move|s3|d4 stores it back as the total. Then move|s5|d1, loadi|1, move|s0|d2 and sub produce counter - 1, move|s3|d5 puts it back in the counter, and loadi|14 with jz decides whether to leave (14 is the address of the move|s4|out just past the loop; the loop head is address 1). The input is read once, on the first tick, and the loop works from registers after that -- and because the pass that adds 1 is the pass that takes the counter to 0, the sum does include 1.',
    },
    allowedComponents: [...BOARD_PARTS],
    io: IO_N,
    // The player's program text, read as assembly, on two walks with two
    // different vectors (ruling R9). No `source`: the reference lives in the
    // fixture (ruling 2).
    checks: [
      {
        kind: 'program',
        from: 'player',
        format: 'asm',
        steps: STEPS_53_AT_10,
      },
      {
        kind: 'program',
        from: 'player',
        format: 'asm',
        steps: STEPS_53_AT_1,
      },
    ],
    board: overtureBoard({ inputId: 'n' }),
    // Measured: 675 gates and 6 deep (the shipped board -- see the module note),
    // and the tick is the walks' last assertion, merged as `Math.max`: the long
    // walk runs to 135, the short one to 18.
    threeStar: { gate: 675, delay: 6, tick: 135 },
  },

  /**
   * ch4-54-code-breaker -- Code Breaker / 道破心机
   *
   * SOURCED: the name in both languages, its position (the fifth level of
   * chapter 4, global 54) and its one-line concept -- a closed-loop guessing
   * game -- from the phase plan's chapter-4 table (the brief for this task),
   * which transcribes the 2.x dossier's chapter-4 table. The 1.x compendium's
   * ancestor of this level is the "code lock" family, which is where the
   * checker's name comes from.
   *
   * AUTHORED (this replica's design): the `match:8 -> try:8` pin shape; the
   * secret (42, and the level's own choice of a non-zero byte -- see the note
   * below); the budget (1024, measured against the reference's 590); the
   * `custom: lock` check with its params; the board (`overtureBoard({ inputId:
   * 'match', halt: false })`, which this level cannot do without -- see the
   * module note); the palette and the absent reward; and the measured three-star
   * target.
   *
   * THE BRIEF MUST NOT CLAIM THE CPU REACTS TO `match`, and it does not: `out` is
   * combinational and published only while the instruction that writes it is
   * decoded, while `match` is sampled by a DIFFERENT instruction -- on that tick
   * `out` has already fallen back to 0, so the byte a program reads on `match` is
   * always 0 and the reference program's "found, stop" branch is never taken. The
   * level is still solvable, because its criterion is "the secret byte went out
   * within the budget", but a hint that promised a reaction to `match` would
   * teach a program that cannot work. And the secret is not 0, because a board
   * that has not moved yet publishes 0 on the checker's first read -- honest, but
   * no puzzle at all.
   */
  {
    id: 'ch4-54-code-breaker',
    chapter: 4,
    index: 54,
    name: { zh: '道破心机', en: 'Code Breaker' },
    brief: {
      zh: '这台 CPU 不知道密码。它唯一能做的，是每一拍把自己当前猜的值发布在 try 上；检查器读到 try 正好等于秘密值时通过，否则在 match 上回答 0。做法是逐值试探：候选值从 0 开始，一次加 1 发布出去，直到某个候选正好是密码。注意这台机器的语义——out 是组合输出，只在写它的那条指令执行期间发布，而 CPU 读 match 用的是另一条指令，那一拍 out 已经回落到 0，所以程序采样到的 match 恒为 0。这一关的判据只是「在预算内把密码这个字节发布出去」，不是「CPU 对 match 作出反应」。',
      en: 'This CPU does not know the code. All it can do is publish its current guess on try, one candidate at a time; the checker passes on the tick it reads a try equal to the secret, and answers 0 on match otherwise. The way to solve it is to try the values one by one: start the candidate at 0, add one, publish it again, until a candidate is exactly the code. A machine fact worth reading twice: out is a combinational output, published only while the instruction that writes it is being decoded, and the CPU samples match with a DIFFERENT instruction -- on that tick out has already fallen back to 0, so the match a program samples is always 0. What this level grades is "the secret byte went out within the budget", not "the CPU reacted to match".',
    },
    hint: {
      zh: '搜索的骨架：把候选值放在一个寄存器里，循环体第一件事就是 move|sX|out 把候选发布出去；然后 loadi|1、move|s0|d2、add 把候选加 1，用 move|s3|d5 存回候选寄存器，最后无条件 j 回循环头。回边的目标地址要写对——板子是 halt: false 的闭环板，写 out 不会冻住 PC，这正是这一关能搜索的原因；如果目标是别的地址，程序就会拿着旧的候选值原地打转。match 你读到的永远是 0，所以别指望「找到了就自旋」的分支会被走到：能不能过关只看预算内有没有把密码那个字节发出去，预算 1024 拍足够从 0 数上去。',
      en: 'The skeleton of the search: keep the candidate in one register and make the first thing the loop does publishing it with move|sX|out; then loadi|1, move|s0|d2 and add to count the candidate up, move|s3|d5 to put it back, and an unconditional j back to the loop head. Get that jump target right -- the board is the closed-loop board with halt: false, which is exactly what lets a program search, and jumping anywhere else leaves the machine spinning on the candidate it already tried. The match you read is always 0, so do not expect a "stop once I find it" branch ever to be taken: the only question is whether the secret byte goes out within the budget, and 1024 ticks is plenty to count upwards.',
    },
    allowedComponents: [...BOARD_PARTS],
    io: IO_MATCH,
    // The puzzle's data lives here, not in the checker (ruling 4): the secret
    // byte, and a budget four hundred ticks above the reference's measured 590.
    checks: [{ kind: 'custom', id: 'lock', params: { secret: 42, budget: LOCK_BUDGET } }],
    board: overtureBoard({ inputId: 'match', halt: false }),
    // Measured: 675 gates and 6 deep (`halt` is a 0-cost part, so the closed-loop
    // board weighs the same as the straight one), and 590 ticks -- the read at
    // which the reference publishes 42, re-measured through `runChecks` by the
    // batch test.
    threeStar: { gate: 675, delay: 6, tick: 590 },
  },

  /**
   * ch4-55-mod-4 -- Mod 4 / 高速掩码
   *
   * SOURCED: the name in both languages, its position (the sixth level of
   * chapter 4, global 55) and its one-line concept -- bit masking -- from the
   * phase plan's chapter-4 table (the brief for this task), which transcribes
   * the 2.x dossier's chapter-4 table. The Chinese name 高速掩码 is the "fast
   * mask" the level teaches: one `and` instead of a division or a countdown.
   *
   * AUTHORED (this replica's design): the `in:8 -> out:8` pin shape; the
   * semantics `out = in & 3`; the board (`overtureBoard({ inputId: 'in' })`);
   * the `program` checks reading the PLAYER's assembly; the two walks, on 42
   * (for 2) and 255 (for 3) -- the two vectors ruling R9 demands, and the pair
   * whose answers are both single-instruction constants; the palette and the
   * absent reward; and the measured three-star target.
   *
   * THE PROGRAM IS LEVEL 51'S FIVE INSTRUCTIONS with `and` where `add` was,
   * which is the level's own claim rather than a coincidence: the assembler does
   * not compute anything new, and the operation is the only thing that changed.
   * The batch test pins both spellings against one ISA table.
   */
  {
    id: 'ch4-55-mod-4',
    chapter: 4,
    index: 55,
    name: { zh: '高速掩码', en: 'Mod 4' },
    brief: {
      zh: '高速掩码：输入脚 in，程序只要算 out = in & 3——保留最低两位，其余清零。ISA 里没有「和常数按位与」的专门指令，但也不需要：loadi 把 3 装进一个寄存器，move|inp|d1 读输入，and 算出 r3 = r1 & r2，再把 r3 写到 out。写 out 之后机器停在那条指令上，结果保持。',
      en: 'A fast mask: the input pin is in, and the program must publish out = in & 3 -- keep the low two bits and clear the rest. The ISA has no special "and with a constant" instruction, and it needs none: loadi 3 into a register, move|inp|d1 to read the input, and to compute r3 = r1 & r2, then write r3 to out. Once out is written the machine stops on that instruction and the result stays.',
    },
    hint: {
      zh: 'and 和别的计算指令一样固定读 r1 与 r2、把结果写进 r3，所以顺序是：先把输入 move 进一个寄存器、把常数 3 装进另一个寄存器，再 and，最后 move|s3|out。用 and 而不是 add／or 是关键——add 会进位、or 会把高位置 1，只有 and 掩码能把最低两位之外的东西全部清掉。写 out 之后 halt 冻住 PC，答案一直留在 out 上。',
      en: 'and, like every calculation, always reads r1 and r2 and always writes r3 -- so the order is: move the input into one register, load the constant 3 into another, run and, then move|s3|out. Using and rather than add or or is the whole point: add carries and or lights high bits up, while a mask is the one operation that clears everything above the two bits you keep. After out is written the halt freezes the program counter and the answer stays on out.',
    },
    allowedComponents: [...BOARD_PARTS],
    io: IO_IN,
    checks: [
      {
        kind: 'program',
        from: 'player',
        format: 'asm',
        steps: STEPS_55_AT_42,
      },
      {
        kind: 'program',
        from: 'player',
        format: 'asm',
        steps: STEPS_55_AT_255,
      },
    ],
    board: overtureBoard({ inputId: 'in' }),
    // Measured: the same board as every other chapter-4 level, so 675 gates and
    // 6 deep; the tick is the walks' last assertion (both share the shape, so
    // `Math.max` is 10).
    threeStar: { gate: 675, delay: 6, tick: 10 },
  },

  /**
   * ch4-56-the-maze -- The Maze / 路在脚下
   *
   * SOURCED: the name in both languages, its position (the seventh level of
   * chapter 4, global 56, the chapter's last) and its one-line concept -- steer a
   * robot through a grid from three wall sensors -- from the phase plan's
   * chapter-4 table (the brief for this task), which transcribes the 2.x
   * dossier's chapter-4 table. The reference algorithm is sourced with it: keep
   * one hand on the wall, which is the "left open, turn left; else ahead open,
   * forward; else turn right" rule the fixture's program implements.
   *
   * AUTHORED (this replica's design): the `sensors:8 -> move:8` pin shape and
   * the sensor/move encoding the checker and the brief share (bit0 ahead, bit1
   * left, bit2 right, wall = 1; move 0 stay, 1 forward, 2 left, 3 right); the
   * maze grid itself, its start facing east and its budget of 1024; the
   * `custom: maze` check with its params; the board (`overtureBoard({ inputId:
   * 'sensors', halt: false })`, without which the walker freezes on its first
   * move); the palette and the absent reward; and the measured three-star target.
   *
   * THE MAZE IS DESIGNED, NOT BORROWED, and ruling 3 fixes what it has to be: one
   * cell wide, enclosed, solvable by the reference rule within the budget, and
   * NOT solvable by the trivial "always forward" program -- which the batch test
   * drives through a real CPU and asserts it fails. The pattern is in `params`
   * and in both briefs, and the batch test holds all three to one literal.
   */
  {
    id: 'ch4-56-the-maze',
    chapter: 4,
    index: 56,
    name: { zh: '路在脚下', en: 'The Maze' },
    brief: {
      zh: '路在脚下：CPU 每一拍看到三个传感器位——bit0 = 正前方有墙，bit1 = 左侧有墙，bit2 = 右侧有墙（墙为 1，网格之外也算墙），它要用 move 回答一个动作码：0 = 原地，1 = 前进，2 = 左转，3 = 右转。迷宫是固定的单格宽走廊，S 是起点（默认朝东），G 是终点：\n########\n#S.....#\n#.#.##.#\n#.#..#.#\n#.##.#.#\n#....#G#\n########\n参考解是沿墙走：左边空就左转，否则前方空就前进，否则右转。',
      en: 'The road is under your feet: every tick the CPU sees three sensor bits -- bit0 a wall directly ahead, bit1 a wall on the left, bit2 a wall on the right (a wall is 1, and everything outside the grid counts as one) -- and it answers with a move code: 0 stay, 1 forward, 2 turn left, 3 turn right. The maze is a fixed one-cell-wide grid, S is the start (facing east by default) and G is the goal:\n########\n#S.....#\n#.#.##.#\n#.#..#.#\n#.##.#.#\n#....#G#\n########\nThe reference solution follows a wall: turn left when the left is open, otherwise walk forward when ahead is open, otherwise turn right.',
    },
    hint: {
      zh: '三个传感器位就是 1/2/4，直接用 and 取出来判断：sensors & 2 为 0 说明左边空（左转，move = 2），否则 sensors & 1 为 0 说明前方空（前进，move = 1），两个都被挡住才右转（move = 3）。最关键的一点是每一轮都要跳回读 inp 的那条指令（地址 0）重新读传感器——寄存器不会自己刷新，回边写错就会拿着第一拍的旧字节一直走，撞墙为止。还有：检查器只在 CPU 正在执行写 out 的那条指令时读到动作码，其余每一拍的 move 都读成 0（原地），所以程序必须循环，把动作一拍一拍地发布出去。',
      en: 'The three sensor bits are 1, 2 and 4, and you can mask them off with and: sensors & 2 being zero means the left is open (turn left, move = 2); otherwise sensors & 1 being zero means ahead is open (walk forward, move = 1); only when both are blocked do you turn right (move = 3). The one thing that matters most: every pass has to jump back to the instruction that reads inp (address 0) and take the sensors again -- a register does not refresh itself, and a loop that returns to the wrong address walks the first tick\'s byte until it hits a wall. One more fact: the checker only sees a move code on the tick the CPU is executing the instruction that writes out; every other tick reads move = 0 (stay), so the program has to loop and publish its moves one tick at a time.',
    },
    allowedComponents: [...BOARD_PARTS],
    io: IO_SENSORS,
    // The grid and the budget are the puzzle (ruling 4); `facing` is left absent
    // because the checker's documented default is east, which is the direction
    // the reference program's first decision assumes.
    checks: [
      { kind: 'custom', id: 'maze', params: { grid: MAZE_GRID, budget: MAZE_BUDGET } },
    ],
    board: overtureBoard({ inputId: 'sensors', halt: false }),
    // Measured: 675 gates and 6 deep (the same machine, `halt` tied low), and
    // 168 ticks -- the exchange whose edge put the robot on `G` on its tenth
    // move, re-measured through `runChecks` by the batch test. The route costs
    // nine full passes of the follower's 17-instruction loop and the tenth
    // move's own `out` fourteen instructions into its pass.
    threeStar: { gate: 675, delay: 6, tick: 168 },
  },
];
