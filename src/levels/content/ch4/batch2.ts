// 第 4 章第 2 批：全局第 53-56 关，本章收尾的四关，也是本章头一次不全是同一形状的关卡。
// 依赖下层 `boards/overture`（第 3 章机器的共享构造器）与 `spec`/`tables` 的关卡类型；
// 本文件只被 `content/ch4/index.ts` 拼接。第 54、56 关使用 `custom` 检查器（lock、maze），
// 由内容路径上的副作用 import 登记。关键不变量：编程关每关两段步进、两个向量；
// 闭环关的谜题数据（秘密字节、迷宫网格）只住在关卡 `params` 里。

import { overtureBoard } from '../../boards/overture';
import type { LevelSpec, ProgramStep } from '../../spec';
// 这里的 `LevelIo` 是"引脚形状"，来自 `tables.ts`；`checks.ts` 也导出了一个同名但无关的
// 运行时接口（绑定后的仿真环境），两者不要混用。
import type { LevelIo } from '../../tables';

/**
 * 第 4 章第 53-56 关：本章收尾的四关，也是本章头一次不全是同一形状的关卡。
 *
 * 两种关卡、一个通道。第 53、55 关是批次 1 建立的直线形状：
 * `overtureBoard({ inputId })` 当画板，`program` 检查读玩家的程序（`from: 'player'`，无 `source`），
 * 步进列表点名答案必须与不得出现在 `out` 上的节拍。第 54、56 关闭环：
 * 画板是同一台机器但 `halt: false`，检查是 `custom`——谜题数据（秘密字节、迷宫网格）
 * 住在关卡里，由注册的检查器（`lock`、`maze`）重置画板、自己装载玩家程序、驱动关卡引脚，
 * 并决定自己的判定与节拍数。把那段驱动逻辑复制进关卡数据，等于把引擎藏进关卡层，
 * 而裁决 4 禁止这样做。
 *
 * 闭环关为什么是 `halt: false`，以及为什么这是事实而不是调参。这台机器的 `out` 是组合的：
 * 它在 `move|sX|out` 指令被译码期间发布该指令复制的字节，而停机线把程序计数器冻在该指令上，
 * 字节于是留在那里。这正是第 53、55 关想要的——答案必须留在 `out` 上供步进后面的断言读取——
 * 也恰恰是 54、56 关不能有的：搜索或走迷宫的程序在循环内部写 `out`，
 * 在会停机的画板上它会在第一次猜测或第一步就停住。实测：密码锁的参考程序在 PC 2 处锁定，
 * `try` 永远停在 0。
 *
 * 程序是玩家的（裁决 2）。`runChecks(graph, registry, spec, player?)` 读取它第四个参数携带的缓冲区——
 * `from: 'player'` 时直接读，`custom` 检查时通过检查器（同一个缓冲区交给它）。
 * 因此关卡数据任何地方都不带 `source`：参考程序属于 `test/fixtures/ch4-references.ts`，
 * 自带参考文本的关卡会让空缓冲区被拿去和玩家从未写过的文本比对。
 *
 * 编程关每关带两段步进、两个向量（裁决 R9）。一个 `program` 检查是玩家文本的一次执行，
 * 所以一段步进只钉住一个（输入，答案）对——忽略输入的程序可以把那一对硬编码，
 * 在揭晓节拍发布它。两段向量与答案都不同的步进堵住这个洞，因为 `runChecks`
 * 为每个检查新建一份 Simulation，常数不可能同时答对两段。这里两关刻意处在那套论证的两端：
 * 第 53 关第二个向量是 1，它的答案小到可以在节拍 12 用一条立即数保持，
 * 所以常数程序"能"复现那段步进——拒绝它的是另一段步进在第 129 拍给出的 55；
 * 第 55 关的两个答案（2 与 3）都是单指令常数，而两段步进在同一个节拍 4 上意见不同。
 *
 * 每一步都重复写输入，这是 `driveSteps` 的契约而不是风格规则：它在每一步写"每一根"输入引脚，
 * 并把步骤省略的引脚默认为 0，所以没有 `inputs` 的步骤会清掉程序本该读取的字节。
 * `test/levels/ch4-batch2.test.ts` 让每一步都接受这条规则。
 *
 * 第 4 章不发放新元件（设计规格 §3.3），所以每关的 `rewards` 都缺席，
 * 而托盘是随游戏发布的画板"由哪些元件构成"的精确清单——不是"已挣到的一切"。
 * `test/levels/ch4-batch2.test.ts` 让这份清单与画板双向对上。
 */

/**
 * 随游戏发布的画板由哪些元件构成：`overtureBoard({ inputId })` 的全部元件，含连接器，别无其他。
 *
 * 对照 `boards/overture.ts` 的 `placedParts` 阅读：关卡自己的引脚、取指级
 * （常量轨、程序 RAM、计数器、译码器）、模式与字段胶水（拆分器、四个模式门与独热译码器）、
 * 寄存器堆及其 ALU 与写路径（多路选择器与开关），以及跳转胶水与停机线。
 * `halt: false` 是把一根导线接低，而不是增加元件，所以闭环关声明同样的清单、同样的门数。
 *
 * 这是批次 1 那份清单的副本，而且是刻意的：本文件的关卡都是纯数据，
 * 从 `batch1.ts` 导出那个常量会让一个批次的模块图依赖另一个批次，
 * 只为了一份可评审的、本就属于画板的清单。批次测试把每份副本都钉在画板上，
 * 所以画板一改，两份都会失败。
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

/**
 * 两个 8 位连接器，以及闭环关为什么明明在纸面上用不了这么多位
 * （`match` 只是一位答案、`move` 是两位码、`sensors` 是三位墙）却仍声明成直线关的形状。
 * 关卡的 io 是 `bindLevelIo` 拿来与"编译后的引脚"比较的东西，而本章的画板带的是 8 位连接器；
 * 一个把 `sensors` 声明成 3 位的关卡会在绑定时以 `missing-io` 失败，检查器根本不会跑。
 * 检查器自己会校验这些名字与宽度（`ioIssue`），所以这里的名字就是它们的契约。
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
 * 第 53 关的步进：倒数求和，n = 10 时求 55，n = 1 时求 1——两个向量、两个检查（裁决 R9）。
 *
 * 节拍来自程序自身的形状，不是可调的测量值。循环是第 1..13 条指令，退出那一趟是 1..11
 * （计数器到 0 后第 11 条的 `jz` 成立），所以 n 趟之后位于地址 14 的 `move|s4|out`
 * 出现在节拍 13n - 1：n = 10 是 129，n = 1 是 12。每段步进在早一拍断言 0——机器还在工作——
 * 在揭晓节拍断言答案，六拍之后再断言答案，那里停机必须已经冻住计数器。
 *
 * 为什么是 10 和 1。10 是 `reference-programs.md` 测量本程序时用的向量。
 * 1 是另一端：它的答案（1）是裸立即数，所以忽略输入的程序可以用 `loadi|1`
 * 加十一条填充移动，从节拍 12 起保持它——这正是裁决 R9 要防的冒充，
 * 批次测试把它搭出来，并证明 10 那段步进在第 129 拍的 55 会拒绝它。
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
 * 第 55 关的步进：`in & 3`，驱动 42 求 2、驱动 255 求 3——掩码的两个向量，
 * 两个答案在同一个节拍上意见不同。
 *
 * 节拍 4 是答案出现的地方，这个数字来自程序的形状：`out` 在计数器看向 `move|s3|out`
 * 时发布，那是第五条指令（下标 4），所以四个沿之后字节就在那里。节拍 3 在早一个沿要求 0，
 * 节拍 10 再次要求该字节——停机必须已经冻住计数器，否则它会回落到 0。
 *
 * 为什么第二个向量是 255。它是全 1 字节，所以掩码的答案是 3——第一段步进的 2 的补数——
 * 而两者都是单指令常数（`loadi|2`、`loadi|3`），这正是这对向量构成本形式最锋利的 R9 论证的原因：
 * 单看任一段步进都能被一条立即数冒充，只有合起来才能拒绝它。
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
 * 密码锁的预算，单位是"交换"——一次交换 = 读一次 `try`、在 `match` 上回答一次、
 * 结算一次、走一个节拍。
 *
 * 1024 是余量，不是凑整的数字。参考程序从 0 开始逐个试候选值，在一条十四指令的循环里发布每一个，
 * 所以读到秘密值 42 的那次读取发生在节拍 590（实测，且由批次测试重新测量）；
 * 1024 留给不怎么会计数的程序四百多拍——大约多试三十个候选值。
 * 它同时也给"玩家写错的程序在每次改板时的代价"封了顶，这正是检查器自己的默认值（4096）所关心的事。
 */
const LOCK_BUDGET = 1024;

/**
 * 迷宫的预算，单位是检查器自己的单位——读一次 `move`、应用一步、发布一个传感器字节、走一个节拍。
 *
 * 参考程序需要 168 个单位：沿"沿墙走"路线走十步，除最后一步外每一步都花掉其
 * 17 指令循环的一整趟，而最后一步的 `out` 在那一趟的第 14 条指令到达。
 * 所以 1024 大约是参考的六倍，对一个绕圈走的程序来说仍是便宜的封顶。
 * 预算也是终止这类程序的唯一手段，所以它是关卡数据而不是检查器默认值：
 * 谜题是"走到终点"，而机器人可以试多久是谜题的一部分。
 */
const MAZE_BUDGET = 1024;

/**
 * 迷宫本身：单格宽、完全封闭、且能被参考规则解出。
 *
 * 它是怎么选出来的。`custom-maze.test.ts` 先用"右手法则"（"右边通就右转……"）解一个网格；
 * 把那个网格上下翻转，就把右手迷宫变成左手迷宫——镜像会交换左右与顺时针/逆时针，
 * 而东与西不受影响——所以本网格是那个网格的镜像，
 * 而参考程序的左手规则（"左边通就左转，否则前方通就前进，否则右转"）走的是同一条路线的镜像：
 * 沿上方走廊向东五格，在墙处右转，再向南四格到达 `G`。
 *
 * 为什么"永远前进"解不了它。上方走廊先向东、然后在离目标列还差两格处被墙挡住，
 * 所以一个只发布 `move = 1` 的程序会撞上那面墙，检查器报告碰撞。
 * 这就是裁决 3(c) 的反例，批次测试会通过真实 CPU 驱动它。
 *
 * 这张图也写进关卡 brief 的两种语言里，批次测试把三者钉在同一个字面量上（裁决 3(d)）：
 * 只改这里的网格、不改故事——或者反过来——都是红测试。
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
   * ch4-53-conditional-jumps —— 条件跳转 / Conditional Jumps
   *
   * SOURCED：双语名字、位置（第 4 章第四关，全局第 53 关）与一句话概念，
   * 来自阶段计划的第 4 章表格，它转录了 2.x 档案的第 4 章表格（本任务的 brief，
   * `task-8-brief.md`）；概念就是条件跳转——`jz`/`jnz` 把机器的直线变成循环。
   *
   * AUTHORED（本项目的设计）：`n:8 -> out:8` 引脚形状；语义
   * `out = n + (n-1) + ... + 1, mod 256`；画板（第 3 章机器，`overtureBoard({ inputId: 'n' })`，
   * 默认停机）；读"玩家"缓冲区、按汇编解析的 `program` 检查（`from: 'player'`）；
   * 两段步进及其向量 10 与 1，节拍由参考程序自身形状固定（裁决 R9——见步进注释）；
   * 托盘（画板自己的元件）与缺席的奖励；以及实测的三星目标。
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
    // 玩家写的程序文本，按汇编解析，两段步进、两个不同向量（裁决 R9）。
    // 没有 `source`：参考程序在 fixture 里（裁决 2）。
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
    // 实测：675 门、6 级深（随游戏发布的画板——见模块说明），
    // 节拍取两段步进的最后一条断言并按 `Math.max` 合并：长的那段跑到 135，短的到 18。
    threeStar: { gate: 675, delay: 6, tick: 135 },
  },

  /**
   * ch4-54-code-breaker —— 道破心机 / Code Breaker
   *
   * SOURCED：双语名字、位置（第 4 章第五关，全局第 54 关）与一句话概念——
   * 闭环猜谜游戏——来自阶段计划的第 4 章表格（本任务的 brief），
   * 它转录了 2.x 档案的第 4 章表格。本关在 1.x 攻略里的前身属于 "code lock" 家族，
   * 检查器的名字就来自那里。
   *
   * AUTHORED（本项目的设计）：`match:8 -> try:8` 引脚形状；秘密值（42，关卡自己选的非零字节——
   * 见下面的注释）；预算（1024，对着参考程序的 590 实测）；带 params 的 `custom: lock` 检查；
   * 画板（`overtureBoard({ inputId: 'match', halt: false })`，本关离不开它——见模块说明）；
   * 托盘与缺席的奖励；以及实测的三星目标。
   *
   * brief 不能宣称 CPU 会对 `match` 作出反应，而它确实没有这样宣称：`out` 是组合的，
   * 只在写它的指令被译码时发布，而 `match` 由"另一条"指令采样——那一拍 `out` 已经回落到 0，
   * 所以程序在 `match` 上读到的字节永远是 0，参考程序的"找到了，停"分支永远不会被走到。
   * 关卡仍然可解，因为它的判据是"秘密字节在预算内被发布出去"，
   * 但一个承诺"会对 `match` 作出反应"的提示会教出一个不可能工作的程序。
   * 秘密值也不是 0，因为尚未移动过的画板在检查器第一次读取时发布 0——
   * 诚实，但完全不成其为谜题。
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
    // 谜题数据住在这里，不在检查器里（裁决 4）：秘密字节，以及比参考程序实测 590 拍多四百拍的预算。
    checks: [{ kind: 'custom', id: 'lock', params: { secret: 42, budget: LOCK_BUDGET } }],
    board: overtureBoard({ inputId: 'match', halt: false }),
    // 实测：675 门、6 级深（`halt` 是零成本元件，所以闭环画板与直线画板一样重），
    // 590 拍——参考程序发布 42 的那次读取，由批次测试通过 `runChecks` 重新测量。
    threeStar: { gate: 675, delay: 6, tick: 590 },
  },

  /**
   * ch4-55-mod-4 —— 高速掩码 / Mod 4
   *
   * SOURCED：双语名字、位置（第 4 章第六关，全局第 55 关）与一句话概念——
   * 位掩码——来自阶段计划的第 4 章表格（本任务的 brief），它转录了 2.x 档案的第 4 章表格。
   * 中文名"高速掩码"就是本关所教的"快掩码"：一个 `and` 取代一次除法或一次倒数。
   *
   * AUTHORED（本项目的设计）：`in:8 -> out:8` 引脚形状；语义 `out = in & 3`；
   * 画板（`overtureBoard({ inputId: 'in' })`）；读"玩家"汇编的 `program` 检查；
   * 两段步进，42（求 2）与 255（求 3）——裁决 R9 要求的两个向量，
   * 也是答案都属于单指令常数的那一对；托盘与缺席的奖励；以及实测的三星目标。
   *
   * 程序就是第 51 关那五条指令，只是把 `add` 换成 `and`，这是关卡自己的主张而不是巧合：
   * 汇编器不计算任何新东西，变的只有运算。批次测试把两种拼写钉在同一张 ISA 表上。
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
    // 实测：与第 4 章其它关卡同一块画板，所以 675 门、6 级深；节拍取两段步进的最后一条断言
    // （形状相同，所以 `Math.max` 是 10）。
    threeStar: { gate: 675, delay: 6, tick: 10 },
  },

  /**
   * ch4-56-the-maze —— 路在脚下 / The Maze
   *
   * SOURCED：双语名字、位置（第 4 章第七关，全局第 56 关，本章最后一关）与一句话概念——
   * 用三个墙面传感器把机器人开过网格——来自阶段计划的第 4 章表格（本任务的 brief），
   * 它转录了 2.x 档案的第 4 章表格。参考算法也一并来自资料：把手一直放在墙上，
   * 也就是 fixture 程序实现的"左边通就左转；否则前方通就前进；否则右转"规则。
   *
   * AUTHORED（本项目的设计）：`sensors:8 -> move:8` 引脚形状，
   * 以及检查器与 brief 共享的传感器/动作编码（bit0 前方、bit1 左、bit2 右，墙 = 1；
   * move 0 原地、1 前进、2 左转、3 右转）；迷宫网格本身、它朝东的起点与 1024 的预算；
   * 带 params 的 `custom: maze` 检查；画板（`overtureBoard({ inputId: 'sensors', halt: false })`，
   * 没有它，行走者会在第一步就冻住）；托盘与缺席的奖励；以及实测的三星目标。
   *
   * 迷宫是设计出来的，不是借来的，而裁决 3 固定了它必须满足什么：单格宽、封闭、
   * 参考规则能在预算内解出，而"永远前进"这种平凡程序"解不出"——批次测试会通过真实 CPU
   * 驱动它并断言失败。图案写在 `params` 与两份 brief 里，批次测试把三者钉在同一个字面量上。
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
    // 网格与预算是谜题（裁决 4）；`facing` 故意不写，因为检查器文档规定的默认值是朝东，
    // 也正是参考程序第一次判断所假设的方向。
    checks: [
      { kind: 'custom', id: 'maze', params: { grid: MAZE_GRID, budget: MAZE_BUDGET } },
    ],
    board: overtureBoard({ inputId: 'sensors', halt: false }),
    // 实测：675 门、6 级深（同一台机器，`halt` 接低），168 拍——那一次交换的沿在第十步
    // 把机器人放到 `G` 上，由批次测试通过 `runChecks` 重新测量。
    // 路线花掉沿墙者 17 指令循环的九整趟，第十步的 `out` 出现在它那一趟的第 14 条指令。
    threeStar: { gate: 675, delay: 6, tick: 168 },
  },
];
