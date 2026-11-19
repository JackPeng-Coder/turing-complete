// 第 3 章第 3 批：全局第 45-47 关——机器本身：程序 RAM、程序计数器、译码器、寄存器、ALU，
// 以及让整台机器从"计算器"变成"计算机"的条件跳转。
// 依赖下层 `spec`（关卡与程序步类型）与 `tables`（引脚形状）；本文件只被 `content/ch3/index.ts` 拼接。
// 导出的 PROGRAM_45/46/47 是三个 `program` 检查运行的汇编源。
// 关键不变量：三关共用同一台参考机器，只有程序不同；程序字节与答案都按节拍语义推导。

import type { LevelSpec, ProgramStep } from '../../spec';
// 这里的 `LevelIo` 是"引脚形状"，来自 `tables.ts`；`checks.ts` 也导出了一个同名但无关的
// 运行时接口（绑定后的仿真环境），两者不要混用。
import type { LevelIo } from '../../tables';

/**
 * 第 3 章第 45-47 关：机器本体——程序 RAM、程序计数器、译码器、寄存器、ALU，
 * 以及让整台机器从"计算器"变成"计算机"的条件跳转。
 *
 * 资料固定了什么、没固定什么。攻略资料对每一关给出双语名字、在章节里的位置，
 * 以及一句话的教学概念：45 关是"把程序存进 RAM，用计数器当 PC"，46 关是"支持直接编码在指令里的值"，
 * 47 关是"整合条件跳转，成为图灵完备"。它没有给端口、位宽、通过条件、目标值和奖励。
 * 下面玩家看到、测试测到的一切都是本项目的设计；每关带一条 `SOURCED` / `AUTHORED` 注释，
 * 与前面每个批次一样。
 *
 * 一台机器、三段程序。三关使用同一套参考电路（`test/fixtures/ch3-references.ts` 的
 * `overtureMachine`），这是关卡自己的主张而不是走捷径：45 关是一条直线，46 关是同一条直线
 * 围绕立即数字段来写，47 关加上循环——电路不变，变的是程序。所以批次测试用一张图给三关评分、
 * 只测一组指标，而 47 关与 45 关的唯一区别就是机器能不能跳转。
 *
 * 为什么这些是 `program` 检查，以及它决定了什么。`levels/checks.ts` 会汇编每关的 `source`，
 * 在第一步之前把字节装进电路的 `ram_prog`，然后像 `script` 一样驱动各步。
 * 关卡作者必须尊重的后果是节拍算术：
 *
 *  * RAM 对 `PC` 是组合的，所以当一步的输入稳定时，机器看到的就是 `ram[PC]`；
 *  * 进入某步节拍的那个沿执行"那条"指令——寄存器堆写入、计数器前进或跳转——
 *    沿之后的比较读取新状态；
 *  * 因此经过 `T` 个沿之后，第 0..T-1 条指令已经执行；一个 `N` 条指令的程序会在节拍 `N`
 *    把答案放到 `out` 上（停机把计数器冻在那里，或者玩家自己的输出寄存器保持那个字节）。
 *
 * 答案必须留在 `out` 上，brief 也是这么说的。参考电路从 `move|sX|out` 指令组合地发布 `out`，
 * 同时停机线把计数器冻在该指令的地址上，所以那个字节永远稳定；而把 `out` 字节
 * 用寄存器锁住的玩家根本不需要停机。两种写法都通过这里的所有断言——
 * 关卡评的是"在它点名的节拍上 `out` 的值"，从不是产生它的写法。
 *
 * 托盘是"到第 44 关为止挣到的一切"。到这里玩家已拥有第 1、2 章的全部内容
 * 加上六个 CPU 元件（39 的 `alu8`、40 的 `regfile6`、41 的 `instr_decoder`、
 * 42 的 `pc8`、43 的 `ram_prog`、44 的 `halt`），所以三关提供整套装备，
 * 不提供任何尚未挣到的元件——这条规则由 `test/levels/level-buildability.test.ts` 遍历。
 * `decoder2` 刻意不在其中：它为后续章节注册、没有任何关卡奖励它，所以没有关卡可以提供它。
 */

/** 每一关都提供、但任何关卡都不作为奖励发放的两个连接器。 */
const LEVEL_IO = ['level_input', 'level_output'] as const;

/**
 * 第 45 关开始时游戏已经交给玩家的全部元件，按章节发放顺序排列：
 * 第 1 章的门与存储、第 2 章的多位运算/存储/译码器，然后是第 3 章的 CPU 元件。
 */
const UNLOCKED_BY_45 = [
  // 第 1 章。
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
  // 第 2 章的多位元件家族。
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
  // 第 3 章的 CPU 元件。
  'alu8',
  'regfile6',
  'instr_decoder',
  'pc8',
  'ram_prog',
  'halt',
  ...LEVEL_IO,
] as const;

/**
 * 三关共用的引脚形状：一根时钟进，一个答案字节出。
 *
 * `clk` 就是关卡的节拍，和第 2 章以来每个存储关卡一样——驱动器推进仿真，
 * 这根引脚存在是为了让关卡声明它按哪个节拍运行。
 */
const IO_PROGRAM: LevelIo = {
  inputs: [{ id: 'clk', width: 1 }],
  outputs: [{ id: 'out', width: 8 }],
};

/**
 * 第 45 关的程序：一条完全没有跳转的直线。
 *
 * 六条指令：两个常数分别搬进 REG1 和 REG2，一次加法进 REG3，然后输出指令。
 * 到达 ALU 的每个值都经过寄存器，这正是让本关成为"机器在运行程序"而不是计算关的原因：
 * 字节从程序 RAM 中每拍出来一个，其中没有任何一个由测试框架挑选。
 */
export const PROGRAM_45 = [
  '# six instructions, no jumps: the machine walks the image in order',
  'loadi|6', // 0：REG0 = 6
  'move|s0|d1', // 1：REG1 = 6
  'loadi|7', // 2：REG0 = 7
  'move|s0|d2', // 3：REG2 = 7
  'add', // 4：REG3 = 13
  'move|s3|out', // 5：out = 13
].join('\n');

/**
 * 第 45 关的遍历：在输出指令执行之前答案是 0，之后是 13。
 *
 * 节拍 6 是执行第 5 条指令的那个沿，所以这里的断言对"答案留在 out 上"的两种写法都成立——
 * 把计数器冻在该指令上的停机，以及保持字节的输出寄存器。节拍 10 再断言若干沿之后字节仍在，
 * 一个既不停机也不保持字节的机器会在这里失败。
 */
const STEPS_45: readonly ProgramStep[] = [
  { tick: 0, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 3, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 6, inputs: { clk: 1 }, expect: { out: 13 } },
  { tick: 10, inputs: { clk: 1 }, expect: { out: 13 } },
];

/**
 * 第 46 关的程序：立即数字段的两条通路。
 *
 * `loadi|63` 是六位字段能携带的最大值，所以只把其中五位接进寄存器堆的电路、
 * 或对第 5 位做符号扩展的电路，会在这里出现分歧。`loadi|finish` 携带的是"标签"而不是数字：
 * 汇编器把它解析成下一条指令的序号，对一个六指令程序来说就是 6，减法之后 `out` 上是 57。
 * 因此两个操作数都来自指令字本身。
 */
export const PROGRAM_46 = [
  '# the six-bit immediate, at the top of its range and through a label',
  'loadi|63', // 0：REG0 = 63（字段的最大值）
  'move|s0|d1', // 1：REG1 = 63
  'loadi|finish', // 2：REG0 = `finish` 的序号，也就是 6
  'move|s0|d2', // 3：REG2 = 6
  'sub', // 4：REG3 = 63 - 6 = 57
  'move|s3|out', // 5：out = 57
  'label finish',
].join('\n');

/**
 * 第 46 关的遍历：与第 45 关同样的形状，对着另一段程序。
 *
 * 只接了五位的立即数通路会在这里发布 25（31 - 6），而忽略 `loadi` 的通路会发布 250（0 - 6）：
 * 两者都在批次测试里被点名，并由机器自己的选项搭出来。
 */
const STEPS_46: readonly ProgramStep[] = [
  { tick: 0, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 3, inputs: { clk: 1 }, expect: { out: 0 } },
  { tick: 6, inputs: { clk: 1 }, expect: { out: 57 } },
  { tick: 9, inputs: { clk: 1 }, expect: { out: 57 } },
];

/**
 * 第 47 关的程序：把攻略资料 §10.3 的 do-while 倒数改成累加版本。
 *
 * 资料的 §10.3 展示了这个形状——`label loop`、循环体、`loadi|loop`、条件跳回——
 * 本程序保留了它：循环让一个寄存器从 6 开始递减，每步把当前值加进累计总和，
 * 所以它留在 `out` 上的数字既说明循环跑了多少次，也说明它算出了什么。
 * 出口是对递减后的计数器做 `jz`（第 10 条指令的减法把测试值留在 REG3），
 * 而且"两个跳转目标"都承重且互不相同：`done`（16）离开循环，`loop`（2）是第 15 条
 * 无条件 `j` 的回边。
 *
 * 为什么它选择倒计数并累加，而不是像 §10.3 的字面例子那样数到溢出：
 * 那个例子的退出值是 REG3 = 0，而空的 `out` 引脚发布的也是 0，
 * 所以一个把 `out` 硬接成零的电路，会通过"只断言最终字节"的遍历。
 * 本程序的答案是 21——6 + 5 + 4 + 3 + 2 + 1——没有任何常数能产生它；
 * 遍历同时断言循环运行期间 `out` 是 0、退出之后是 21，所以两个常数都通不过。
 * 批次测试会验证这套算术：直线机器循环一遍就停下，发布 6。
 *
 * 循环跑六次、宽 14 条指令，最后一趟少一条：退出的 `jz` 是循环体的第 12 条指令，
 * 所以最后一趟永远走不到回边。输出指令因此是第 85 个沿——2 条准备指令、
 * 五整趟 14 条（70）、最后一趟的 12 条，再加 1 条——下面的步骤在这个边界两侧点名了节拍 83 和 85。
 */
export const PROGRAM_47 = [
  '# do-while: count down from 6, accumulating, until the counter hits zero',
  'loadi|6', // 0：REG0 = 6
  'move|s0|d1', // 1：REG1 = 6，计数器
  'label loop', // -> 2
  'move|s1|d5', // 2：REG5 = 计数器
  'move|s4|d1', // 3：REG1 = 累计总和
  'move|s5|d2', // 4：REG2 = 计数器
  'add', // 5：REG3 = 总和 + 计数器
  'move|s3|d4', // 6：REG4 = 新的总和
  'move|s5|d1', // 7：REG1 = 计数器（再次）
  'loadi|1', // 8：REG0 = 1
  'move|s0|d2', // 9：REG2 = 1
  'sub', // 10：REG3 = 计数器 - 1
  'move|s3|d1', // 11：REG1 = 计数器 - 1，即下一轮的计数器
  'loadi|done', // 12：REG0 = 16，循环的出口地址
  'jz', // 13：计数器到零 -> 跳到 REG0
  'loadi|loop', // 14：REG0 = 2，循环自身的地址
  'j', // 15：回到循环头
  'label done', // -> 16
  'move|s4|out', // 16：out = 总和
].join('\n');

/**
 * 第 47 关的遍历，也是整个阶段验收所依据的那一段。
 *
 * 节拍 0、40、83 在循环内部或准备阶段，三处都要求 0：答案还没上 `out`，
 * 无论循环正在算什么。节拍 85 是执行第 16 条指令的沿，答案是 21；
 * 节拍 95 断言它仍然在。没有条件跳转的机器跑一趟就离开循环，发布 6
 * （如果跳转永远成立，也会同样过早离开）；把 `out` 硬接成常数的电路，
 * 会在遍历的某一端失败。
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
   * ch3-47-immediate-values —— 立即数 / Immediate Values
   *
   * SOURCED：双语名字、位置（第 46 关）、资料的一句话概念——支持直接编码在指令里的值，
   * 以及 §6.3 的字段：立即数模式是 `00` 后跟六位值，所以范围是 0-63，
   * 而 §6.5 把"无法编码大于 63 的值"列为 OVERTURE 的已知限制之一。
   * `loadi|finish` 用的是 §6.6 的标签规则（"标签是它后面那条指令的序号"）。
   *
   * AUTHORED：引脚形状；六指令程序；四步遍历；托盘；以及实测目标，
   * 它与第 45 关是同一台机器，因此数字相同。没有新奖励。
   *
   * 程序被构造来让两种"差一点就对"的机器失败，批次测试会从机器的选项中把两者都搭出来。
   * `loadi|63` 坐在六位字段的顶端，所以一个立即数只经五位到达寄存器堆的机器会发布 25（31 - 6）
   * 而不是 57；`loadi|finish` 是一个标签，所以一个不知怎么把操作码而不是字段传过去的机器，
   * 只能回答错误地址。而一个 `loadi` 写路径根本没接的机器发布 250（0 - 6），
   * 这就是为什么遍历的值是一次减法而不是又一个和：两种失败落在不同的字节上。
   */
  {
    id: 'ch3-47-immediate-values',
    chapter: 3,
    index: 47,
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
    // 实测：与第 45 关同一台机器，所以是同一对数字；节拍取本遍历的最后一步。
    threeStar: { gate: 643, delay: 6, tick: 9 },
  },

  /**
   * ch3-48-program —— 程序 / Program
   *
   * SOURCED：双语名字、位置（第 45 关）、资料的一句话概念——把程序存进 RAM，
   * 并用计数器作为程序计数器。一字节指令及其两位模式来自 §6.1/§6.3；
   * 程序依赖的寄存器角色（`loadi` 用 REG0，计算用 REG1 和 REG2 进 REG3，
   * 输出用 `out`）来自 §6.2。
   *
   * AUTHORED：引脚形状（`clk` 进、`out` 出——阶段计划为本批次准备的表格）、
   * 六指令程序、四步遍历、托盘，以及实测目标。没有新奖励：
   * 第 1-3 章已经交给玩家本关需要的每个元件，这就是为什么这一关是"把它们一起用起来"的关卡，
   * 而不是"又到一个新元件"的关卡。
   *
   * 机器就是关卡，而 45、46、47 三关之间唯一改变的是程序。本关的程序没有跳转：
   * 六条指令的直线，所有值都经译码器与寄存器到达，所以玩家的译码器、寄存器堆、ALU、
   * RAM 与计数器都必须正常工作，遍历才能走到节拍 6。它"没有"练到的是条件跳转，
   * 所以验收关是第 47 关而不是这一关。
   *
   * 遍历把答案断言了两次，相隔四个节拍。这正是本关 brief 用两种语言要求的那条性质：
   * 程序停止执行之后字节必须仍在 `out` 上，所以一个从当前指令组合地发布 `out` 的机器，
   * 要么停机、要么把字节保持在寄存器里。两种写法都通过；检查里没有点名任何一种。
   */
  {
    id: 'ch3-48-program',
    chapter: 3,
    index: 48,
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
    // 实测：`test/fixtures/ch3-references.ts` 里的机器，对着本关的程序评分。
    // 批次三关共用同一张图，所以共享门与延迟数字；节拍取本遍历的最后一步。
    threeStar: { gate: 643, delay: 6, tick: 10 },
  },

  /**
   * ch3-49-turing-complete —— 图灵完备 / Turing Complete
   *
   * SOURCED：双语名字、位置（第 47 关，也是本章最后一关）、资料的一句话概念——
   * 整合条件跳转并成为图灵完备——以及 §6.4 的跳转表：`j` 总成立，`jz` 在被比较值为零时成立，
   * `jnz` 在不为零时成立，目标在 REG0、被比较的值在 REG3。§10.3 是资料展示
   * 这些指令所服务的那种循环的地方，而本关的程序正是那个 do-while 形状。
   *
   * AUTHORED：引脚形状；机器的条件跳转胶水（从 [5:3] 译出的三种条件，
   * 以及计数器的 load/in 对）；程序；五步遍历；托盘；以及实测目标。
   * 没有新奖励：这里是本章六个元件一起使用的地方，也正是阶段计划为整个阶段
   * 点名的验收标准。
   *
   * 这是本阶段的验收关，而它的测试必须证明这一点。一条直线机器也能通过的遍历，
   * 测不出这个关卡名字所指的东西，所以批次测试会用"条件跳转被短路"的同一台机器评分——
   * 永不成立、永远成立——并断言两者都失败在本关的遍历上。
   * 它还会给一台 halt 线接低的机器评分：那种机器只在某一个沿发布正确字节，
   * 计数器一走就把字节丢了。
   *
   * 程序的算术就是答案的证据。循环让一个寄存器从 6 开始递减，边走边累加，
   * 所以 `out` 最终是 21 = 6 + 5 + 4 + 3 + 2 + 1：只跑一趟循环的机器发布 6，
   * 永远不退出循环的机器发布 0；遍历先在循环内部的三处断言 0，再在退出后断言 21。
   * 无论跳转以哪种方式坏掉，五条断言里总有一条抓得住它。
   */
  {
    id: 'ch3-49-turing-complete',
    chapter: 3,
    index: 49,
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
    // 实测：`test/fixtures/ch3-references.ts` 里的机器，对着本关的循环评分。
    // 门与延迟来自共享机器；节拍取遍历最后一步，即循环出口再过一个沿。
    threeStar: { gate: 643, delay: 6, tick: 95 },
  },
];
