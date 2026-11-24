// 第 3 章第 1 批：全局第 39-41 关，AXIS 的前三步——运算引擎、寄存器堆、控制扇出。
// 依赖下层 `spec`（关卡类型）与 `tables`（引脚形状 LevelIo）；本文件只被 `content/ch3/index.ts` 拼接。
// 关键不变量：本文件导出的 `aluOp` 是"运算码 -> 运算结果"的唯一实现，
// 关卡判定、参考电路与奖励元件 `alu8` 都以它为准；选择位按权重解码（op0 个位、op1 二位、op2 四位），
// 6/7 两个空码输出 0，使关卡契约对全部 8 个输入码都有定义。

import type { LevelSpec } from '../../spec';
// 这里的 `LevelIo` 是"引脚形状"，来自 `tables.ts`；`checks.ts` 也导出了一个同名但无关的
// 运行时接口（绑定后的仿真环境），两者不要混用。
import type { LevelIo } from '../../tables';

/**
 * 第 3 章第 39-41 关：AXIS 的最初三步——算术引擎、寄存器背后的寄存器堆、
 * 以及让一条指令同时驱动多个目的地的控制扇出。
 *
 * 指令编码住在 `src/asm/isa.ts`，不在本文件：需要它的关卡（42 关起）读取 ISA 表，
 * 本批次只在关卡的引脚让字段位置"可观测"的地方陈述它们。
 */

const IO_ALU: LevelIo = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
    // 运算码以三根一位引脚到来，而不是一根三位引脚，这是布线事实而不是口味：
    // 实例的 `params.width` 覆盖该实例的所有引脚（课程表 §3.3、`net.ts` 的
    // `effectiveWidth`），所以没有任何元件能把一个三位值拆成它的三位——
    // 宽度 3 的 `splitter` 会发布三位的输出，宽度 1 时它只能读第 0 位。
    // 三根引脚让同一个选择码能用游戏现有元件表达，而且把编码写在关卡自己的接口上，
    // 而不是藏进一个打包器里。
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
 * 每一关都提供、但任何关卡都不作为奖励发放的两个连接器。
 *
 * 在这里声明，而不是在每个关卡的元件托盘里内联（批次 2、3 是那样做的）：
 * 这对连接器不是本章要教的元件，而一个手写清单的关卡离"忘了写"只差一次编辑。
 */
const LEVEL_IO = ['level_input', 'level_output'] as const;

/**
 * `alu8` 实现的六种运算，本批次的关卡与此处的定义对它们保持一致。
 * 写成函数，是为了让关卡数据和测试文件无法对"某个选择码是什么意思"产生分歧。
 *
 * 运算编号就是 ISA 的操作数字段（`src/asm/isa.ts` 中 ruling 5 的 `mnemonics` 表），
 * 而 `alu8` 完全按这个编号实现：
 *
 * | 编号 | 运算 | 说明 |
 * |----|---|---|
 * | 0 | 加 | 只取低八位；没有进位输出引脚 |
 * | 1 | 减 | `a + ~b + 1`，所以 0 - 1 得 255 |
 * | 2 | 与 | |
 * | 3 | 或 | |
 * | 4 | 与非 | |
 * | 5 | 或非 | |
 * | 6 | 0 | 保留 |
 * | 7 | 0 | 保留 |
 *
 * 三根关卡引脚按权重承载这个编号：`op = op0 + 2*op1 + 4*op2`。
 * 因此 `op0` 是个位（类别内的具体运算），`op1` 是二位（类别：0 算术、1 逻辑），
 * `op2` 是四位（对逻辑结果取反）。注意这里早期的英文注释一边给出 `4*op0 + 2*op1 + op2`
 * 的公式、一边又说 `op0` 是类别，两句话互相矛盾；以公式、下面的代码与 `alu8` 为准
 * （即 `op0` 为个位，`op1` 为类别位）。
 * 6、7 号是没有运算支撑的码，`alu8` 对两者都发布 0，
 * 从而让关卡契约是完备的：玩家能驱动的每一个输入都有确定的答案。
 *
 * 顺序很重要，而且曾经在两个地方同时错。旧实现用了另一套位映射（守卫写成
 * `op2 === 1 && op0 === 0`），关卡自己的 `fuzz` 检查也按同一套读法拼接，
 * 于是两者彼此一致、却同时与 `alu8` 不一致：
 * 在判定器失败的那个向量上，关卡期望 NOR（156），而被奖励的元件给出减（29）。
 * 与共享同一错误的生成器比较的期望，永远抓不到错误——抓到它的是参考电路，
 * 那套电路把引脚按 ISA 的方式接了线。
 */
export function aluOp(op: number, a: number, b: number): number {
  const x = a & 0xff;
  const y = b & 0xff;
  // 对运算编号做 switch，因为这个编号就是 ISA 的字段。ruling 5 给 `calc` 一个三位操作字段，
  // 并把它线性编号（`src/asm/isa.ts` 里 `mnemonics: { add: 0, sub: 1, and: 2, or: 3, nand: 4, nor: 5 }`），
  // 而 `alu8` 完全实现这套编号——已对每个运算码与操作数组合与注册定义核对过。
  // 所以映射就是一次查表；把编号解码成"类别 / 选择 / 取反"三位不仅没有必要，而且错误：
  // 没有任何一种把这三种角色分配给三位的方案能复现这张表，
  // 这也是本函数每个"字段配方"版本都在某处与 `alu8` 不一致的原因。
  //
  // 对 4、5 号（与非、或非）为真，对 6、7 号（空码）为假——也就是把两半都取反了。
  // 于是关卡把与非/或非清零，却给两个保留码回答或非/取反的与，
  // 在八个码中的四个上与被关卡奖励的元件矛盾。它能存活，是因为关卡自己的 `fuzz` 检查
  // 调用同一个函数构造期望：与共享 bug 的生成器比较的期望不会失败。
  // 抓到它的是 `test/fixtures/ch3-references.ts` 里的参考电路——用门与多路选择器搭出来，
  // 因而不持有任何偏见——这是关卡的契约第一次被"它自己之外"的东西检验。
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
      // 6、7 号：背后没有运算的码。若写成"随便"（don't care），它们就是 ALU 发布却不作承诺的值，
      // 而第一个断言"八个码下 out 都对"的关卡，就会断言一个没有任何构造欠它的值；
      // `alu8` 同样声明这两个码为零。
      return 0;
  }
}

export const CH3_BATCH1: readonly LevelSpec[] = [
  /**
   * ch3-40-alu-1 —— 算术引擎 / Arithmetic Engine
   *
   */
  {
    id: 'ch3-40-alu-1',
    chapter: 3,
    index: 40,
    name: { zh: '逻辑整合', en: 'Arithmetic Logic Unit (ALU) 1' },
    brief: {
      // 三位按权重命名，而这段说明曾经把其中两位写反了。编码是 `op = op0 + 2*op1 + 4*op2`，
      // 所以 `op1` 是二位、是类别位，`op0` 是个位、选类别内的运算（加/减、与/或），
      // `op2` 是四位、请求那步取反（把与变成与非、把或变成或非）。
      // 下面的 hint 一直写对了；brief 曾把 `op2` 与 `op0` 说反，那是一句会把玩家送去错误电路的说明。
      // 本文件的 `aluOp` 与关卡奖励的 `alu8` 才是权威，两者都实现上面的读法。
      //
      // "按权重读成编号"指按权重顺序看三位，也就是 "op2 op1 op0" 想表达的意思——
      // 这里直接写成数字，因为 "op2 op1 op0" 读起来像位序，是另一种常见的出错方式。
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
          // 三个选择位各自独立抽取，因此八个码都会被走到；关卡定义了其中六个，
          // 并把 6、7 折进它自己的"输出零"规则。抽取它们而不是钉死，才让保留码的情形成为测试而不是碰运气。
          op0: (s) => s.op0 ?? 0,
          op1: (s) => s.op1 ?? 0,
          op2: (s) => s.op2 ?? 0,
        },
        outputs: {
          // 引脚 `opN` 就是 ISA 操作字段的第 N 位，所以编号是 `op0 + 2*op1 + 4*op2`——
          // 引脚名就是字段的位位置，不需要任何转置。`test/fixtures/ch3-references.ts` 里的
          // 接好线的参考电路正是这样实现的：它把 `op1` 读作算术/逻辑类别、`op0` 读作类别内的运算、
          // `op2` 读作逻辑取反。（本注释曾把 `op0` 说成类别、`op1` 说成运算，
          // 那正是下面这行代码早已修掉的转置——与所注释的代码相矛盾的散文，就是下一位读者重新引入 bug 的方式。）
          //
          // 这一行就是关卡出错的那一行，它为什么重要值得记下来：期望与喂给它 `fuzz` 生成器
          // 是同一个函数，所以它们共享的任何编码都无法通过"拿电路去评分"抓出来。
          // 参考电路与 `alu8` 元件才是编码真正被钉住的地方，而这里的拼接必须与两者都一致。
          out: (v) =>
            aluOp((v.op0 ?? 0) | ((v.op1 ?? 0) << 1) | ((v.op2 ?? 0) << 2), v.a ?? 0, v.b ?? 0),
        },
      },
    ],
    threeStar: { gate: 273, delay: 5, tick: 0 },
    rewards: { components: ['alu8'] },
  },

  /**
   * ch3-41-registers —— 寄存器之间 / Registers
   *
   * 八份存储是这一关真正的课程：寄存器堆不是六个寄存器，而是每个地址一份存储，
   * 外加一个译码器决定使能落到哪一份。`mem1` 是唯一已经这样工作的元件，
   * 而托盘里没有八地址的 `decoder3` 式的捷径——这是有意的，好让玩家自己搭那棵树。
   *
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
          // 关于 `driveSteps`（src/levels/checks.ts）的两个事实决定了这段脚本的形状，
          // 二者从外部都容易弄错：
          //
          //  1. 每一步没有点名的输入都会被写成 ZERO。输入不在步骤之间保持，
          //     所以"什么都不变、只打一拍"的步骤必须把它想保持的每根引脚都重写一遍。
          //  2. `tick` 是本次运行节拍计数器上的绝对目标，不是每步的相对计数：
          //     循环是 `while (io.sim.tickCount < step.tick) io.tick()`。
          //     因此一串都写 `tick: 1` 的步骤只会产生一个时钟沿，后面的都不产生；
          //     写成连续 `tick: 1` 的脚本会悄悄停止走时钟。下面的步骤是递增计数的。
          //
          // 一次写入对应一个时钟沿，也是电路本身的要求。`reg8.load` 是
          // `we AND decoder[addr]`，组合逻辑，所以只有在输入先被写入并结算之后它才是稳定的——
          // 这正是 `driveSteps` 做的。于是"应当落下一个字节"的沿，是带 `we = 1` 的那一步的沿，
          // 而读取必须发生在更晚的节拍、且 `we` 回到 0（未写 `we` 的步骤会写 0，这正是读取步安全的原因）。
          { tick: 1, inputs: { clk: 1, we: 0, addr: 3, data: 0xa5 }, expect: { out: 0 } },
          { tick: 2, inputs: { clk: 1, we: 1, addr: 3, data: 0xa5 } },
          { tick: 3, inputs: { clk: 1, we: 0, addr: 3, data: 0xa5 }, expect: { out: 0xa5 } },
          // 把另一个字节停在别的地址上什么也不会改变：使能为低，没有任何寄存器的 load 线被拉高。
          { tick: 4, inputs: { clk: 1, we: 0, addr: 0, data: 0x11 }, expect: { out: 0 } },
          // 保持：在 `data` 携带别的值时回头读地址 3。一个"只要 data 变化就锁存"的寄存器堆，这里会读到 0x11。
          { tick: 5, inputs: { clk: 1, we: 0, addr: 3, data: 0x11 }, expect: { out: 0xa5 } },
          // 第二次写入，写到最高地址，前面的字节不受影响。
          { tick: 6, inputs: { clk: 1, we: 1, addr: 7, data: 0x5a } },
          { tick: 7, inputs: { clk: 1, we: 0, addr: 7, data: 0x5a }, expect: { out: 0x5a } },
          { tick: 8, inputs: { clk: 1, we: 0, addr: 3, data: 0x5a }, expect: { out: 0xa5 } },
        ],
      },
    ],
    // 重建的参考电路实测出的指标。`tick: 8` 是脚本的最后一步：八次写入/读取，一次一个沿。
    threeStar: { gate: 267, delay: 3, tick: 8 },
    rewards: { components: ['regfile6'] },
  },

  /**
   * ch3-42-alu-2 —— 算术逻辑单元 / Arithmetic Logic Unit (ALU) 2
   *
   * 选择器就是 ISA 的操作字段，读法与 ALU 1、计算单元完全一致：
   * `op0` 是个位、`op1` 二位、`op2` 四位，所以编号是 `op0 + 2*op1 + 4*op2`，
   * 0 加、1 减、2 与、3 或、4 与非、5 或非。这张表的唯一权威是本文件的 `aluOp`——
   * 正是上一关期望调用的同一个函数，也是 `alu8` 实现的函数——所以本关期望、上一关期望、
   * 注册元件三者不可能对"某个码是什么意思"产生分歧。这种耦合是刻意的：
   * 上一关出的缺陷正是"期望与自己的生成器共享误读"，而解药是让这张表只有一个家，而不是两个。
   *
   * 与 `ch3-40-alu-1` 的重叠，记录在案。设计把机器的运算集拆到两关：
   * ALU 1 是四个逻辑运算，ALU 2 加上 ADD 与 SUB。本项目的 ALU 1 早于这个拆分——
   * 它是作为本章的算术引擎编写的，会回答全部八个码——所以按两关今天的写法，
   * 它们在同一个接口上陈述同一个函数，读者有权得到这句话，而不是自己去发现。
   * ALU 2 拥有的是整张表（四个逻辑运算加上加、减），这也是 `alu8` 的契约：
   * 那个元件是本关奖励的、由计算单元消费的；把 ALU 1 收窄到它那四个逻辑运算，
   * 是对"那一关"的检查、参考与目标的修改，本关无论如何不依赖它。
   * 两关的 `threeStar` 目标相等，理由与两份托盘相同：同一套构造是两关各自允许的最便宜电路，
   * 而 `test/fixtures/ch3-references.ts` 为两关各存了一份图，于是测量结果被写了两遍而不是共享。
   *
   * 为什么这里不发放 `alu8`——这是托盘规则，而不是疏忽。它是上一关的奖励，玩家现在已经有它；
   * 它的引脚是 `a:8 b:8 op:3 -> out:8`，也就是本关接口把三根选择引脚用一个
   * 注册宽度为 8 位的 `maker` 打包、五个空闲输入补上常量轨（译码器参考电路也这样补；
   * `params.width = 3` 不是办法，因为实例参数会一次性加宽该实例的所有引脚，
   * 打包器随后会错误地读自己的输入）。打包在两个指标上都是免费的，
   * 所以一个实例就能用一次放置回答本关，实测 264 门、1 级延迟，
   * 而本关存在的目的是教那套 273 门、五级深的电路。这与第 22 关对 `add8`、
   * 第 20 关对 `full_adder` 做的是同一种减法：不是本关自己奖励的、
   * 又能独自回答本关的元件会被扣下，本注释就是记录代价的地方。
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
        // 一个固定字面量，而且属于本关：运行时没有任何东西抽取它，
        // 所以每次运行、每次改板之后驱动的都是同一批向量。
        // 高半部分读起来像本关的全局编号；低半部分与上一关的 `0x3915_00aa` 不同，
        // 因此两关永远不会评同一串输入。
        seed: 0x4215_00ab,
        rounds: 64,
        inputs: {
          a: (s) => s.a ?? 0,
          b: (s) => s.b ?? 0,
          // 三个选择位各自独立抽取，因此八个码都会被走到；其中六个是运算，
          // 两个是保留对，关卡把它们折进自己的"输出零"规则。
          // 抽取它们而不是钉死，才让保留码的情形成为测试而不是碰运气，与上一关完全一样。
          op0: (s) => s.op0 ?? 0,
          op1: (s) => s.op1 ?? 0,
          op2: (s) => s.op2 ?? 0,
        },
        outputs: {
          // 引脚 `opN` 就是 ISA 操作字段的第 N 位，所以编号是 `op0 + 2*op1 + 4*op2`，
          // 没有任何转置，而 `aluOp` 就是那张表。`test/fixtures/ch3-references.ts` 里
          // 接好线的参考电路也按同样方式读同样三根引脚。
          out: (v) =>
            aluOp((v.op0 ?? 0) | ((v.op1 ?? 0) << 1) | ((v.op2 ?? 0) << 2), v.a ?? 0, v.b ?? 0),
        },
      },
    ],
    // 实测：参考电路自己的指标，与上一关相同，因为两份托盘允许的最便宜电路是同一套构造——
    // 一个 `not8` 和一个 `mux8` 选加法器的被加数（`b` 或 `~b`，同一位兼作进位），
    // 一个 `add8` 和一对 `and8`/`or8` 各自用 `mux8` 选择，一个 `not8` 做与非/或非取反，
    // 一个由 `~op2` 门控的 `switch8` 处理保留码，再用两个 `mux8` 先选半步、再选运算：
    // 8 + 32 + 72 + 16 + 24 + 32 + 8 + 1 + 16 + 32 + 32 = 273 个与非门当量，
    // 路径五级元件深。重叠写在上面的注释里，而不是靠换一个测量方式藏起来。
    threeStar: { gate: 273, delay: 5, tick: 0 },
    // 但 `src/core/defs/` 里根本没有 `alu2`——它从来不是元件，只是关卡的名字。
    // 奖励里写一个未注册的 id 永远不会出现在托盘中，`registry.test.ts` 会因此失败，
    // 所以这一行现在只发放真实存在的元件。AXIS 自己的 ALU 仍然是 `alu8`，
    // 而本关不列出它：测量依据见上面的注释。
    //
    // 第 2 章过去在那个压轴关发放移位与旋转家族，而幸存的第 2 章关卡里没有需要它们的谜题。
    // 它们是注册元件，在沙盒里也有自己的用途，所以选择是在这里发放，还是让它们成为死内容；
    // 课程表 §3.3 的表格也跟着它们移动了。
    rewards: { components: ['ashr8', 'rot_l8', 'rot_r8'] },
  },

  /**
   * ch3-43-the-foundry —— 元件工坊 / Component Factory
   *
   * 这堂课正是模块边界无论如何都要做对的事：一个发布两个端口的元件，
   * 必须从它需要的字段推导每个端口，而不是从交到它手里的整个字推导。
   * `sel` 为 0 和 1 时都把 `data` 放到 `a` 上；为 2 和 3 时放到 `b` 上。
   * 所以 `a` 是 `data AND NOT sel[1]`，`b` 是 `data AND sel[1]`，
   * 而把 `sel` 整个转发的玩家会把低位那半做错。
   *
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
