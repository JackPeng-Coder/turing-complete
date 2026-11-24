// 第 4 章第 1 批：全局第 50-52 关，让"玩家亲手搭的机器"变成"玩家来编程的机器"。
// 依赖下层 `boards/axis`（第 3 章那台机器的共享构造器）与 `spec`/`tables` 的关卡类型；
// 本文件只被 `content/ch4/index.ts` 拼接。程序来自玩家缓冲区（不留参考源），
// 关键不变量：每关两段步进、两个不同输入向量，任何忽略输入、硬编码答案的程序都无法同时通过。

import { axisBoard } from '../../boards/axis';
import type { LevelSpec, ProgramStep } from '../../spec';
// 这里的 `LevelIo` 是"引脚形状"，来自 `tables.ts`；`checks.ts` 也导出了一个同名但无关的
// 运行时接口（绑定后的仿真环境），两者不要混用。
import type { LevelIo } from '../../tables';

/**
 * 第 4 章第 50-52 关：玩家"搭出来"的机器成为玩家"编程"的机器。
 *
 * CPU 就是第 3 章那台，画板是导入它的通道（裁决 1）。每一关都带
 * `board: axisBoard({ inputId })`——与 `test/fixtures/ch3-references.ts` 给第 3 章机器评分
 * 所用的是同一个构造器，所以两章背后只有一套电路，没有会漂移的副本（见 `boards/axis.ts`）。
 * 它是一个"起点"而不是内置 CPU：玩家仍然可以编辑它的每个元件与每根导线。
 * `inputId` 是这些关卡唯一拧动的旋钮，因为它们每一关都读关卡的输入引脚。
 *
 * 程序是玩家的（裁决 2）。`runChecks(graph, registry, spec, player?)` 在检查写着
 * `from: 'player'` 时会读取它第四个参数携带的缓冲区，而这就是这些关卡唯一的通道：
 * 关卡数据不带 `source`，因为参考程序属于 `test/fixtures/ch4-references.ts`，
 * 玩家缓冲区绝不能去和关卡自带的文本比对。检查真正携带的是"步进"——节拍与必须出现在 `out` 上的字节。
 *
 * 节拍算术是第 3 章那一套，朝向玩家敞开了一面。程序 RAM 对计数器是组合的，
 * 所以当机器正看着 `move|sX|out` 时，答案"已经"在 `out` 上了；
 * 那是程序的第 N 条指令（下标 N-1），也就是 N-1 个沿之后的节拍 N-1。
 * `halt` 线（默认值，也是这些关卡全是直线关的原因）把计数器冻在该指令上，字节便留在那里。
 * 于是每段步进都在那个节拍之前断言 0、在节拍上断言答案、在若干沿之后再次断言同一答案——
 * 不保持答案的机器（或程序）会在这里失败。
 *
 * 每一步都重复写输入，这是驱动器的规则而不是风格：`driveSteps` 在每一步写"每一根"输入引脚，
 * 并把步骤省略的引脚默认为 0，所以省略 `inputs` 的步骤会清掉程序本该读取的那个字节。
 * `test/levels/ch4-batch1.test.ts` 让每一步都接受这条规则。
 *
 * 每关两段步进、两个不同向量（控制器裁决 R9）。一个 `program` 检查只执行一次玩家文本，
 * 所以一段步进只钉住一个（输入，答案）对——一个忽略输入的程序可以把那一对硬编码，
 * 在揭晓节拍发布它并通过。因此这里每一关都带两个 `program` 检查：同一形状的两段步进、不同输入。
 * `runChecks` 为每个检查新建一份 Simulation，并用 `Math.max` 合并 `ticksUsed`，
 * 所以这只是一份向量一条数据，别无其他——但常数程序对两段步进的回答相同，
 * 而两段步进要求不同字节，所以任何忽略输入的程序都答不了两段。批次测试里的常数冒充就是证明：
 * 每个冒充者都能完美复现它自己那段步进，却被另一段步进拒绝。
 *
 * 第 4 章不发放新元件（课程表 §3.3："无新元件；解锁汇编 IDE 与调试器"），
 * 所以每关的 `rewards` 都缺席，而托盘不是"已挣到的一切"（第 3 章的形状），
 * 而是随游戏发布的那块画板"由哪些元件构成"——机器就是关卡，元件就是它身上的那些。
 */

/**
 * 随游戏发布的画板由哪些元件构成：`axisBoard({ inputId })` 的全部元件，含连接器，别无其他。
 *
 * 对照 `boards/axis.ts` 的 `placedParts` 阅读：关卡自己的引脚、取指级
 * （常量轨、程序 RAM、计数器、译码器）、模式与字段胶水（拆分器、四个模式门与独热译码器）、
 * 寄存器堆及其 ALU 与写路径（多路选择器与开关），以及跳转胶水与停机线。
 * `test/levels/ch4-batch1.test.ts` 让这份清单与画板"双向"对上——
 * 画板用到的每个元件都在清单里，清单里点名的每个元件画板都真的用到。
 */
const BOARD_PARTS = [
  // 关卡自己的引脚：两个输入（驱动器走节拍用的时钟，以及本关读取的数据引脚）与答案。
  'level_input',
  'level_output',
  // 取指与常量轨。
  'const_on',
  'const_off',
  'ram_prog',
  'pc8',
  'instr_decoder',
  // 模式与字段：拆分器、模式门、独热译码器，以及拼读地址用的 REG1/REG2/REG3 常量。
  'splitter',
  'not',
  'nor',
  'and',
  'nand',
  'decoder3',
  'maker',
  // 寄存器堆、ALU 与写路径（源选择、calc/loadi 选择、写地址规则）。
  'mux8',
  'switch8',
  'regfile6',
  'alu8',
  // 跳转胶水，以及把答案留在 `out` 上的停机线。
  'equal8',
  'or3',
  'or',
  'halt',
] as const;

/** 两个算术关：一个 8 位输入，一个 8 位答案。 */
const IO_IN: LevelIo = {
  inputs: [{ id: 'in', width: 8 }],
  outputs: [{ id: 'out', width: 8 }],
};

/** 第 52 关的引脚形状：同样是一字节进、一字节出，只是入口叫 `r`。 */
const IO_R: LevelIo = {
  inputs: [{ id: 'r', width: 8 }],
  outputs: [{ id: 'out', width: 8 }],
};

/**
 * 第 50 关的步进：`in` 驱动 100 时求 105，驱动 42 时求 47——本关评分的两个
 * （输入，答案）对（裁决 R9：两个向量、两个检查）。
 *
 * 节拍 4 是答案出现的地方，这个数字来自程序自身的形状：`out` 在计数器看向
 * `move|s3|out` 时发布，那是第五条指令（下标 4），所以四个沿之后字节就在那里。
 * 节拍 3 在早一个沿要求 0，节拍 10 再次要求该字节——停机必须已经冻住计数器，
 * 否则字节会回落到 0。第二段步进在自己的输入上重复同样的形状：同样的节拍，不同的字节。
 *
 * 为什么是 100 和 42。两个向量是"合起来"防冒充的，而不是各自单独防。
 * 在节拍 4，忽略输入的程序已经执行了四条准备指令，此时可能停在寄存器里的值
 * 只可能是裸立即数（0-63）、它的补码（192-255）、立即数的两倍，或运算从零做出的少数常数——
 * 所以 105 在这个节拍根本硬编码不出来，而 47 可以（`loadi|47`、三条填充移动、`move|s0|out`）。
 * 单看一段步进会接受那个常数；另一段要求 105，就会拒绝它。
 * 这正是裁决 R9 保护的不变量：每关至少拒绝一个"在正确节拍产生正确答案、却忽略输入"的程序。
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
 * 第 51 关的步进：同样的两向量形状，对着 `in + 3`——驱动 100 求 103，驱动 200 求 203。
 *
 * 与第 50 关相同的节拍算术（程序就是同样五条指令、只换了常数）与同样的两向量规则。
 * 103 在节拍 4 无法硬编码（奇数，既不在立即数范围内、也不是立即数的补码），
 * 而 203 可以：它是 52 的补码，`loadi|52` 进两个加数再 `nor`。所以能复现第二段步进的常数，
 * 会被第一段抓住，无论冒充者瞄准哪一段。
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
 * 第 52 关的步进：`r` 驱动 200 时 6r = 1200 回绕成 176，驱动 9 时 6r = 54——
 * 回绕的情形与平常的情形，正好是 `reference-programs.md` 在真实画板上验证过的那一对
 * （r = 1/9/42/200 分别得 6/54/252/176）。
 *
 * 回绕是本关自己的教学点——`out = (6 * r) & 0xff`，模 256 是真实存在的——
 * 而 200 是参考程序验证时测过的值（r = 200 -> 176）。答案出现在节拍 8，
 * 也就是本程序 `move|s3|out` 的下标；节拍 7 在早一个沿要求 0。
 *
 * 为什么这里"尤其"需要两段步进。在八条准备指令之后，连 176 都能用纯常数搭出来——
 * `loadi|63, move|s0|d1, loadi|50, move|s0|d2, add, move|s3|d2, move|s0|d4, add, move|s3|out`
 * 就是 63 + (63 + 50)，和参考程序一样正好在节拍 8 揭晓——所以单段步进无论选什么向量都可能被冒充。
 * 第二段步进堵住了它：那个常数对 r = 9 也回答 176，而正确答案必须是 54。
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
   * ch4-50-punchcard-programming —— 打孔编程 / Punchcard Programming
   *
   * 这一关是"手写编码"的关卡。没有助记符、没有汇编器：玩家自己写操作码位，
   * 这就是全部概念，所以检查的读取器是 `parseImage`（`asm/image.ts`）——每行八个二进制位、
   * 允许注释——而不是下一关才解锁的汇编器。fixture 里的参考程序就是那五个字节，
   * 批次测试会从 ISA 表重新推导它们，好让两个读取器不能漂移。
   */
  {
    id: 'ch4-50-punchcard-programming',
    chapter: 4,
    index: 50,
    name: { zh: '打孔编程', en: 'Punchcard Programming' },
    brief: {
      zh: '这台 CPU 就是你第 3 章搭好的那台 AXIS——现在轮到给它写程序了。这一关从最底层开始：手工机器码，每行 8 位二进制就是一个字节的指令，装进程序 RAM 后一个时钟沿执行一条。程序要算 out = (in + 5) & 0xff：把输入搬进寄存器，loadi 取常数 5，add 相加，最后把结果 move 到 out。写 out 之后机器会停在那条指令上，out 上的字节必须一直保持。',
      en: 'This is the very CPU you built in chapter 3 -- now it is your turn to write programs for it. This level starts at the bottom: hand-written machine code, one line of 8 binary digits per byte of instruction, loaded into the program RAM and executed one instruction per clock edge. The program must compute out = (in + 5) & 0xff: move the input into a register, loadi the constant 5, add, and move the sum to out. Once out is written the machine stops on that instruction, and the byte on out has to stay there.',
    },
    hint: {
      zh: '一条指令就是一个字节：高 2 位是模式——00 是 loadi，01 是计算，10 是 move，11 是跳转。loadi 的低 6 位就是立即数（0-63）；计算指令的低 6 位是「运算码 + 000」，add 的运算码是 000；move 的低 6 位是「源 + 目的」：源 000-101 是寄存器 s0-s5、110 是输入 inp，目的 000-101 是 d0-d5、111 是 out。一个例子：move|s2|d4 的高 2 位是 10（move）、接下来 010 是 s2、最后 100 是 d4，拼起来就是 10010100。每行必须正好 8 位，# 之后是注释。',
      en: 'One instruction is one byte: the top 2 bits are the mode -- 00 loadi, 01 calc, 10 move, 11 jump. A loadi\u2019s low 6 bits are the immediate (0-63); a calc\u2019s low 6 bits are "opcode + 000", and add is opcode 000; a move\u2019s low 6 bits are "source + destination", where source 000-101 is registers s0-s5 and 110 is the input inp, and destination 000-101 is d0-d5 and 111 is out. One worked example: move|s2|d4 is 10 for move, then 010 for s2 and 100 for d4, so the byte is 10010100. Every line has to be exactly 8 binary digits; everything after # is a comment.',
    },
    allowedComponents: [...BOARD_PARTS],
    io: IO_IN,
    // 玩家写的程序文本，按每行一字节读取，两段步进、两个不同向量（裁决 R9）。
    // 没有 `source`：参考程序在 fixture 里（裁决 2）。
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
    board: axisBoard({ inputId: 'in' }),
    // 实测：675 门、6 级深（随游戏发布的画板——见模块说明与 `boards/axis.ts`），
    // 节拍取两段步进的最后一条断言（形状相同，所以 `Math.max` 是 10）。
    threeStar: { gate: 675, delay: 6, tick: 10 },
  },

  /**
   * ch4-51-assembly-programming —— 汇编程序 / Assembly Programming
   *
   * 程序就是第 50 关的程序换一种拼写，这是关卡自己的主张而不是巧合：
   * 同样五条指令、除立即数外同样字节，批次测试把两种拼写钉在同一张 ISA 表上。
   * 玩家在这里学到的是：汇编器不计算任何新东西——它给上一关手写的那串位起了名字——
   * 所以答案仍然必须由寄存器搭出来，`add` 仍然把 r1、r2 读成 r3。
   */
  {
    id: 'ch4-51-assembly-programming',
    chapter: 4,
    index: 51,
    name: { zh: '汇编程序', en: 'Assembly Programming' },
    brief: {
      zh: '还是你第 3 章搭的那台 CPU，这次不用手写字节了：这一关解锁汇编器，你写助记符，汇编器替你编成机器码。程序要算 out = (in + 3) & 0xff，和上一关同一条路，只是常数从 5 换成 3。每行一条指令，# 之后是注释——汇编器认哪几种写法、每种长什么样，提示里列了表和例子。写 out 之后机器停住，结果要保持。',
      en: 'The same CPU you built in chapter 3, and no hand encoding this time: this level unlocks the assembler -- you write mnemonics and it compiles the bytes for you. The program must compute out = (in + 3) & 0xff, the same path as the last level with the constant changed from 5 to 3. One instruction per line, with # starting a comment: the hint lists the spellings the assembler accepts, with a worked example. After out is written the machine stops, and the result has to stay.',
    },
    hint: {
      zh: '汇编器认的写法就这几种：loadi|N（N 是 0-63 的立即数）、move|sX|dY（源可以是 s0-s5 或 inp，目的可以是 d0-d5 或 out）、六种运算 add/sub/and/or/nand/nor，以及 label 和跳转。一个例子：move|s2|d4 就是上一关手写的那个位布局，只是有了名字——高 2 位 10 是 move、010 是 s2、100 是 d4，也就是字节 10010100。# 之后是注释，每行一条指令。注意 add 固定读 r1 与 r2、把结果写进 r3，所以两个加数要先 move 进 r1 和 r2，结果再 move 出去。',
      en: 'The assembler takes a handful of spellings: loadi|N (N is an immediate from 0 to 63), move|sX|dY (source s0-s5 or inp, destination d0-d5 or out), the six calculations add/sub/and/or/nand/nor, and labels with jumps. One worked example: move|s2|d4 is the bit layout you wrote by hand last level, with a name on it -- 10 for move, 010 for s2, 100 for d4, the byte 10010100. # starts a comment and every line is one instruction. Note that add always reads r1 and r2 and writes r3: move your two addends into r1 and r2 first, and move the result out afterwards.',
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
    board: axisBoard({ inputId: 'in' }),
    // 实测：与第 50 关同一块画板，所以门与延迟相同；节拍取两段步进的最后一条断言
    // （形状相同，所以 `Math.max` 是 10）。
    threeStar: { gate: 675, delay: 6, tick: 10 },
  },

  /**
   * ch4-52-circumference —— 三番两次 / Circumference
   *
   * 这一关为什么放在"汇编器"与"循环"之间：ISA 没有乘法，所以 6r 就是加法一遍又一遍地用——
   * 而 `add` 只把 r1、r2 读成 r3，"只"能这样，所以每个中间结果都得先搬回去才能参加下一步。
   * 程序的第七条指令就是这堂课：没有 `move|s3|d1`，两个加数就是 2r 和 3r，答案是 5r——
   * 参考程序的笔记记录过这个错误，批次测试也把它当作破坏用例跑。
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
    board: axisBoard({ inputId: 'r' }),
    // 实测：与第 50、51 关同一块画板（只有输入引脚的名字变了），所以门与延迟相同；
    // 节拍取两段步进的最后一条断言（形状相同，所以 `Math.max` 是 14）。
    threeStar: { gate: 675, delay: 6, tick: 14 },
  },
];
