import type { LevelSpec, ScriptStep, TruthRow } from '../../spec';
// `LevelIo`——引脚形状——来自 `tables.ts`；`checks.ts` 还导出了一个同名的运行时接口
//（已绑定仿真的接口），两者不能混淆。
import { truthTable, type LevelIo } from '../../tables';

/**
 * 第 2 章第 28~38 关：本章的存储与时序那一半——锁存器、延迟、时钟源、选择器、
 * 寄存器、RAM 和计数器。它也是 `script` 检查器在第 2 章里第一个挑大梁的批次。
 *
 * 源资料固定了什么、没有固定什么。与批次 1~3 相同：资料集对这几关只给三样东西——
 * 名称（中英文）、在本章中的位置、以及一行教学概念。它没有端口、位宽、通过条件、
 * 目标和奖励。下面其余内容都是本复刻的设计，由名称和那一行概念推导而来——所以
 * 每一关都带一段分成 `SOURCED` 与 `AUTHORED` 的数据注释，
 * `test/levels/ch2-batch4.test.ts` 在缺少任一标记时失败。本文件里的任何数字都不能
 * 被说成是源资料自己的。
 *
 * `script` 检查器的节拍语义至关重要，而且不是显而易见的读法——下面每个脚本都是按它
 * 写的。`runChecks` 按节拍顺序遍历检查的步骤，对每一步先写入该步的输入并调用
 * `settle()`，然后才把时钟推进到该步的节拍（`levels/checks.ts` 的 script 分支：
 * `while (io.sim.tickCount < step.tick) io.tick()`）。两个后果：
 *
 *  * `tick` 是绝对目标（ABSOLUTE），一步实际执行的边沿数是它与上一步节拍之差。节拍 0 的步骤
 *    一个边沿都不执行，所以它的 `expect` 读到的是 `reset` 之后的状态——这就是下面
 *    每个遍历都从 tick 0 步骤开始、并且从第 1 拍才写起的原因。
 *  * 一步的输入驱动的是「到达该步节拍」的那些边沿，所以第 T 拍的 `expect` 读到的是
 *    进入 T 的那个边沿刚采到的值。于是当输入每步都在变时，延迟线的读数与导线完全
 *    一样；脚本要证明一个值被「保持」，唯一办法是在同一个节拍再放一步（SAME tick）：不执行边沿、
 *    输入改变，而输出上必须仍是旧值。第 28、29、35、36、38 关各带这样一对步骤，
 *    测试文件实测它们确实如此——导线、两拍延迟、以及忽略 load 使能的寄存器都会
 *    恰好在这两步上失败。
 *
 * 与内核分工，因为关卡是纯数据（全局约束 7），无法自己要求下面任何一件事：
 *
 *  * 稳定性是 `settle()` 的结果，而不是一种检查类型。纯组合回路会耗尽 `SETTLE_LIMIT`
 *    并抛出 `UnstableCircuitError`，`runChecks` 把它记成 `unstable` 失败；被存储
 *    元件打断的回路则能结算。第 28 关就是讲这件事的关卡，它在自己的 brief 里写明，
 *    因为没有 `stable` 这种检查可写。
 *  * 周期性是一个期望序列的性质，而不是单个节拍的性质。第 30 关的检查断言十六个
 *    交替节拍和四个保持节拍；只断言一个节拍的检查会让一个恒为高的电路通过。
 *
 * 本批次有四件事需要向读者交代，且各自写在自己的关卡注释里，而不仅在这里：
 *
 *  * 第 30 关在源资料里完全没有可计算的规格——「构建振荡电路（时钟信号发生器）」
 *    没有周期、没有占空比、也没有门控规则——所以周期、禁用时保持的规则以及十六拍
 *    的运行都是本复刻的设计，而检查对这些的断言就是这一关。
 *  * 第 34 关改变了源资料关卡的类型。源资料只说「共享数据传输线路的概念」，
 *    而规格 3.1 禁止总线协议（「不做总线协议（多驱动仲裁）」），所以在本引擎里，
 *    字面意义上的共享/三态总线按设计就是不可实现的；这一关改为教驱动选择，
 *    它的注释和 brief 都直说了这一点。
 *  * 第 37 关的「装满」有一个自创定义。源资料只给一行字，没有容量、没有地址位宽、
 *    也没有「满」的定义；本复刻把它定义成：`ram8` 的 256 个字节全部可寻址、可写入，
 *    且每个地址都能读回写进去的内容；这个定义写进 brief，并在整个范围上断言。
 *  * 第 38 关携带源资料的成就，作为记录而不是通过条件：「成就：≤ 65 个门」。
 *    映射方式以及为什么 65 不是本关 `threeStar.gate`，见该关注释。
 *
 * 托盘规则继承自批次 2，这里再写一次，因为本批次用了它两次：一关提供在它之前或当时
 * 已解锁、且引脚能接到本关某处的元件，加上它自己的奖励，再减去任何「不是本关奖励、
 * 而且能单独答出本关」的元件。第 28 关扣下 `mem1`（它的引脚就是本关的引脚，而且它会
 * 藏起本关要教的回路），第 38 关扣下 `counter8`（同理，一颗直接放入的计数器）。
 * 两者都在测试文件里实测，都没有出现在任何会答出本关的清单里，两处注释都写明用的是
 * 哪条规则。「加上自己的奖励」这一半同样有边界：一关只列出那些引脚能接得上的自己
 * 的奖励——这就是第 28 关（从头到尾一位宽）发放 `ram8` 却不列出它的原因（批次 1
 * 第 14 关的理由），与第 1 章收尾关奖励 `mem1` 却不列出它完全一致。
 *
 * 按裁决，存储在两个指标上都是免费的，这决定了本批几个目标能取什么值。`delay8`、
 * `reg8`、`counter8` 和 `ram8` 不声明 `gateCost`，也不计延迟单位（`core/defs/wide.ts`
 * 存储一节的注记：门指标衡量的是玩家搭建了什么，而存储元件从两个方向切断组合路径）。
 * 所以对于答案是某个已解锁存储元件的关卡，下限就是该元件自身的 0/0，本文件陈述这个
 * 下限，而不是用门重建该元件的价格——第 29、35、36、37 关正是这样做的，它们的注释
 * 各自说明了手工搭建的替代写法的实测值，因为选择搭回路而不是直接放入元件的玩家，
 * 应当知道它为什么只拿一星。
 *
 * 任务书自己的表造成了两处巧合，记录在这里，免得评审误读成笔误：
 *
 *  * 第 28 关与第 35 关用不同的引脚名要求同一条存储规则（`set`/`value` 对
 *    `d`/`load`）。它们的框法不同——28 是搭回路的地方，其托盘扣下封装好的元件；
 *    35 是使用封装元件的地方——而且它们的检查断言的是不同的事。
 *  * 第 33、34 关形状相同、行为相同。33 是用 256 个 fuzz 向量评分的字节选择器；
 *    34 是用四行真值表评分的共享线路。批次 1 为第 15、16 关记录过同样的巧合。
 *
 * 接入方式：本批次是 `CH2_LEVELS`（`ch2/index.ts`）的第四段也是最后一段，
 * `content/index.ts` 把它接在第 1 章之后，所以这十一关以游戏 `LEVELS` 的第 28~38 关
 * 发布。四个批次全部接入，才使第 2 章成为索引 13~38 的 26 关；
 * `test/levels/unlock-chain.test.ts` 用数字钉住这一点。每个批次测试各自 import 自己的
 * 批次和更早的每个批次，两个横切测试——`level-buildability.test.ts` 和
 * `unlock-chain.test.ts`——则通过 `ch2/index.ts`（汇合四个批次的模块）到达整章。
 */

/**
 * 这里每一关都从中取材的一比特货架：第 1 章的门、两个常量和延迟线，顺序与第 1 章
 * 发放它们时一致。`delay_line` 是第 28 关的存储元件——唯一能在不成为该关答案的
 * 前提下打断一位回路的元件。
 */
const GATES_1BIT = [
  'nand',
  'not',
  'and',
  'or',
  'nor',
  'xor',
  'xnor',
  'and3',
  'or3',
  'const_on',
  'const_off',
  'delay_line',
] as const;

/** 关卡自己的接线：始终在托盘里，从不属于解锁（`defs/index.ts`）。 */
const LEVEL_IO = ['level_input', 'level_output'] as const;

/** 批次 1 第 13 关解锁的东西：两个字节打包器与字节常量。 */
const BYTE_WIRING = ['splitter', 'maker', 'const8'] as const;

/**
 * 第 22 关的一位条件通断。它是一颗 1 位引脚的一比特元件，所以在本批每个一位关卡上
 * 都接得上；本文件在「取这个还是留那个」的选择属于关卡内容时提供它
 *（28、30、31、32、35），在字节宽的关卡上则不列，因为那里的玩家反正会用门。
 */
const SWITCH_1 = ['switch'] as const;

/**
 * 本批用到的五种引脚形状，这样一关的 io 就是一个有名字的常量，
 * 而不是写在 spec 中间的六行字面量。
 */
const IO_SET_VALUE_OUT: LevelIo = {
  inputs: [
    { id: 'set', width: 1 },
    { id: 'value', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_A8_OUT8: LevelIo = { inputs: [{ id: 'a', width: 8 }], outputs: [{ id: 'out', width: 8 }] };
const IO_ENABLE_OUT: LevelIo = {
  inputs: [{ id: 'enable', width: 1 }],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_A1_INV1_OUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'inv', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_A1_ON1_OUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'on', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_A8_B8_SEL1_OUT8: LevelIo = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
    { id: 'sel', width: 1 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_D1_LOAD1_OUT1: LevelIo = {
  inputs: [
    { id: 'd', width: 1 },
    { id: 'load', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_D8_LOAD1_OUT8: LevelIo = {
  inputs: [
    { id: 'd', width: 8 },
    { id: 'load', width: 1 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_D8_ADDR8_LOAD1_OUT8: LevelIo = {
  inputs: [
    { id: 'd', width: 8 },
    { id: 'addr', width: 8 },
    { id: 'load', width: 1 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_EN1_RESET1_OUT8: LevelIo = {
  inputs: [
    { id: 'en', width: 1 },
    { id: 'reset', width: 1 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};

/**
 * 第 33 关的 fuzz 种子：高字节是关卡序号，低字节是字节宽度，与批次 2、3 给它们的
 * 关卡播种的方式完全一样。
 *
 * 用固定字面量而不是随机抽取：同一个种子在每次运行、每次修改画板后都产生同样的
 * 256 个向量，这才让本关的覆盖范围——两个 `sel` 取值都被驱动、而且各被驱动很多次
 * ——成为「关卡的事实」而不是「本次运行的事实」。测试文件拿这个字面量来实测。
 */
const SEED_33 = 0x3308;

/**
 * 第 34 关的表所陈述的四个向量，以及它们发布的规则。
 *
 * 用四行而不是 2^17 种组合，这是任务书为这一关规定的形状：它以读者肉眼可核对的
 * 小规模陈述「谁在驱动这条线」，而字节宽的覆盖属于第 33 关的 fuzz 检查。两个 `sel`
 * 取值出现在同一对操作数上，所以这张表把「被选中的那条线」与「总是第一条」「总是
 * 第二条」区分开；两对操作数又是不对称的模式，所以打乱字节内位序的电路会在其中
 * 一行上失败。
 */
const BUS_VECTORS: readonly { readonly a: number; readonly b: number; readonly sel: number }[] = [
  { a: 0x00, b: 0xff, sel: 0 },
  { a: 0x0f, b: 0xf0, sel: 0 },
  { a: 0x00, b: 0xff, sel: 1 },
  { a: 0x0f, b: 0xf0, sel: 1 },
];

/** 本关要教的「总线」规则：恰好是被选中的那条线到达 `out`。 */
function selectedLine(a: number, b: number, sel: number): number {
  return sel === 1 ? b : a;
}

/** 第 34 关的四行，每行输出由上面的规则给出。 */
const BUS_ROWS: readonly TruthRow[] = BUS_VECTORS.map(({ a, b, sel }) => ({
  inputs: { a, b, sel },
  outputs: { out: selectedLine(a, b, sel) },
}));

/**
 * 第 37 关写入地址 `k` 的那个字节。
 *
 * 模 256 的 `k * 7 + 1` 是一个双射（7 是奇数，所以可逆），因此没有两个地址存放
 * 相同的字节。这正是让「把两个单元混叠」或「干脆忽略 `addr`」的地址译码暴露出来的
 * 原因：回读阶段一次判定一个地址，而它期望的字节没有任何其他地址写过。
 * `k = 73` 是这个函数唯一存入 0 的地址，它只是 256 个期望之一，而不是整个测试。
 */
function boxByte(k: number): number {
  return (k * 7 + 1) & 0xff;
}

/**
 * 第 37 关的脚本：写满全部 256 个地址，再把 256 个全部读回。
 *
 * 这个检查让「装满」有了意义，也是它要生成而不是手写出来的原因。第 `k + 1` 步
 *（每步一个时钟沿，从第 1 拍开始，因为节拍 0 的步骤不执行边沿）在 `load` 为高时
 * 把 `boxByte(k)` 写进地址 `k`，并在同一步断言输出上的字节。第 257..512 步则在
 * 256 次写入全部发生之后，以 `load` 为低、`d` 接所存字节的补码，重新读取每个地址
 * ——所以通过证明的是盒子同时装着 256 个字节，而不是最近一次写入能被读出；
 * 而且如果 `d` 到 `out` 之间有导线，每一次读都会读到 `~stored`，一步都过不了。
 */
function littleBoxSteps(): ScriptStep[] {
  const steps: ScriptStep[] = [
    { tick: 0, inputs: { d: 0, addr: 0, load: 0 }, expect: { out: 0 } },
  ];
  for (let addr = 0; addr < 256; addr += 1) {
    steps.push({
      tick: addr + 1,
      inputs: { d: boxByte(addr), addr, load: 1 },
      expect: { out: boxByte(addr) },
    });
  }
  for (let addr = 0; addr < 256; addr += 1) {
    steps.push({
      tick: 257 + addr,
      inputs: { d: ~boxByte(addr) & 0xff, addr, load: 0 },
      expect: { out: boxByte(addr) },
    });
  }
  return steps;
}

/**
 * 第 38 关的脚本：复位、256 个使能的边沿、回绕，以及 `reset` 对 `en` 的优先级。
 *
 * 265 步。从第 2 拍到第 257 拍是 256 个连续边沿，其期望值就是计数本身，所以检查
 * 走遍每个字节并在恰好 256 时回到 0：在 128 处回绕、或在 255 处饱和的计数器，
 * 会在这 256 个期望中的某一个上失败，而不是在某个挑出来的值上失败。
 * 第 260 拍随后在一个两者都为高、计数为 2 的边沿上断言 `reset` 压过 `en`——
 * 如果使能赢了，输出会是 3。最后两步都落在第 263 拍：第一步执行恢复计数的边沿，
 * 第二步一个边沿都不执行，却必须仍读到 1——组合式计数的电路会在这里失败。
 */
function counterSteps(): ScriptStep[] {
  const steps: ScriptStep[] = [
    { tick: 0, inputs: { en: 0, reset: 1 }, expect: { out: 0 } },
    // 一个 `reset` 和 `en` 同时为高的边沿：清零获胜，所以这里读到 0。
    { tick: 1, inputs: { en: 1, reset: 1 }, expect: { out: 0 } },
  ];
  for (let edge = 1; edge <= 256; edge += 1) {
    steps.push({ tick: edge + 1, inputs: { en: 1, reset: 0 }, expect: { out: edge & 0xff } });
  }
  steps.push({ tick: 258, inputs: { en: 1, reset: 0 }, expect: { out: 1 } });
  steps.push({ tick: 259, inputs: { en: 1, reset: 0 }, expect: { out: 2 } });
  steps.push({ tick: 260, inputs: { en: 1, reset: 1 }, expect: { out: 0 } });
  steps.push({ tick: 261, inputs: { en: 0, reset: 0 }, expect: { out: 0 } });
  steps.push({ tick: 262, inputs: { en: 0, reset: 0 }, expect: { out: 0 } });
  steps.push({ tick: 263, inputs: { en: 1, reset: 0 }, expect: { out: 1 } });
  steps.push({ tick: 263, inputs: { en: 0, reset: 0 }, expect: { out: 1 } });
  return steps;
}

/**
 * 第 30 关的两个脚本：节拍、保持与恢复；然后单独测保持低电平的情况。
 *
 * 十六个使能节拍，其期望交替为 0/1/0/1——八个完整周期，因为「输出有周期」无法从
 * 单个节拍测出——随后是四个 `enable` 为低的节拍，必须都读到最后一个使能节拍留下的
 * 1，再四个节拍从那保持值恢复节拍（先是一个下降沿：`1 XOR 1` 是 0）。第二个脚本
 * 让 `enable` 从复位起一直为低八拍，并要求全程为 0，这是时钟源失败的另一种方式：
 * 没有门控的振荡器满足第一个脚本的前十六拍，却在第 16 拍失败；它也在本脚本的
 * 第 1 拍就失败。
 */
const OSCILLATOR_STEPS: readonly ScriptStep[] = [
  ...Array.from({ length: 16 }, (_, tick) => ({
    tick,
    inputs: { enable: 1 },
    expect: { out: tick % 2 },
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    tick: 16 + i,
    inputs: { enable: 0 },
    expect: { out: 1 },
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    tick: 20 + i,
    inputs: { enable: 1 },
    expect: { out: i % 2 },
  })),
];

/** 保持低电平的那一半：`enable` 从复位起为低，所以带门控的时钟源永远不动。 */
const HELD_LOW_STEPS: readonly ScriptStep[] = Array.from({ length: 8 }, (_, tick) => ({
  tick,
  inputs: { enable: 0 },
  expect: { out: 0 },
}));

/** 第 2 章本批次的关卡数据，按 `index` 顺序排列；章节顺序由 `ch2/index.ts` 汇合、`content/index.ts` 统一排序。 */
export const CH2_BATCH4: readonly LevelSpec[] = [
  /**
   * ch2-17-circular-dependency —— 循环依赖 / Circular Dependency
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 28 关，本章存储那一半的第一关），以及源资料的
   * 一行概念——「引入反馈回路概念，构建基本锁存器」。它没有端口、位宽、通过条件、
   * 目标和奖励。
   *
   * AUTHORED（本复刻的设计）：`set:1 value:1 -> out:1` 形状；九步脚本；实测三星目标；
   * `ram8` 奖励；以及托盘。检查的形状由 `runChecks` 的节拍语义决定（模块注记）：
   * 一步的输入在节拍推进前写入并结算，所以第 1 拍的步骤读到的正是进入第 1 拍的
   * 边沿刚采到的位；四对同拍步骤才证明这个位是被保持的，而不是透传的——一个发布
   * `set ? value : 0` 的电路会在节拍 0 就失败，远早于回路被测试。
   *
   * 稳定性是这一关的核心断言，而它没有自己的检查类型。纯组合回路永远到不了不动点：
   * `settle()` 耗尽 `SETTLE_LIMIT` 并抛出 `UnstableCircuitError`，`runChecks` 把它
   * 记为 `unstable` 失败，所以只用门搭成的锁存器无论怎么接都过不了这一关。
   * 参考解确实含有一个回路——`validateGraph` 会报 `feedback-loop`（只是警告，因为
   * 只有仿真器才能判断含存储的回路是否会结算）——而它能结算。测试文件直接对
   * `settle()` 断言两边，而不是通过「关卡通过了」来断言：参考解能结算，而交叉耦合的
   * NOR 锁存器、自己喂自己的 NOT、以及两个 NOT 组成的环都抛出
   * `UnstableCircuitError`。只断言参考解通过，根本无法证明关于回路的任何事。
   *
   * 为什么托盘扣下 `mem1`——唯一能一步答出本关的元件。`mem1` 已解锁（第 1 章收尾关
   * 奖励它），它不是本关自己的奖励，而它的引脚就是本关的引脚——`set`/`value` 进、
   * `out` 出——所以批次 2 的规则完全适用（第 22 关的 `add8`、第 24 关的 `neg8`）：
   * 不是本关奖励、却能单独答出本关的元件，在它上面任何地方都不提供。直接放入会藏起
   * 源资料那句话要求玩家搭建的回路，而那就是整关。这一点在测试文件里实测而不是争论：
   * 它能通过，0 门 0 延迟，而第 35 关（概念是封装好的条件写入）提供它。
   *
   * 目标是参考解自身的实测指标：8 个 NAND 等价门、3 个延迟单位、tick 4（脚本驱动的
   * 最后一个节拍）。参考解用两个 `switch` 和一个 `or` 搭出这个选择，而不是 AND/NOT/AND
   * 多路器：`switch` 正是本关提示点名的元件。它并不是更便宜的单元——注册的 `and` 是
   * `cost: 1` / `gateCost: 2`，恰好等于 `switch` 的那一对（`core/defs/index.ts`、
   * `core/defs/wide.ts`），所以 AND/NOT/AND 多路器实测同样是 8/3；只有手工搭的 AND
   *（一个 NAND 接一个 NOT）会多花两个延迟单位。经过 `set` 的那条路径决定了本关的延迟。
   *
   * `ram8` 是本关的奖励，且故意不在托盘中：这里每个引脚都是一位宽，八位元件没有东西
   * 可接（批次 1 第 14 关的理由），与第 1 章收尾关奖励 `mem1` 却不列出它完全一致。
   * 奖励仍然发放——第 37 关的小盒子就是用它的字节搭的。
   */
  {
    id: 'ch2-17-circular-dependency',
    chapter: 2,
    index: 17,
    name: { zh: '循环依赖', en: 'Circular Dependency' },
    brief: {
      zh: '这一关要做的是一块会记住一位的电路。时钟沿到来时：set 为高就把 value 存下来，set 为低就保持原来那一位，无论 value 在这一拍是什么。输出从 0 开始。注意：只用逻辑门绕成的回路在本引擎里永远不会稳定（会报「不稳定回路」），回路里必须有一个存储元件。',
      en: 'This level is a circuit that remembers one bit. On a clock edge: set high stores value, set low keeps the bit it already had whatever value says. The output starts at 0. Note: a loop made only of gates never settles in this engine -- it is reported as an unstable loop -- so the loop has to contain a storage element.',
    },
    hint: {
      zh: '把输出接回自己的输入，中间放一条延迟线：回路经过存储元件就稳定了。「set 为高时取 value，否则取输出自己」是一次二选一——一个非门把 set 取反，两个开关分别送出 value 与输出自己，再用一个或门合起来，接进延迟线的输入。',
      en: 'Close the loop from the output back into its own input through a Delay Line: a loop that passes through a storage element settles. "Take value while set is high, otherwise take the output" is one two-way choice -- invert set with a NOT, pass value and the output through two Switches, OR the two results and feed that into the Delay Line.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, ...LEVEL_IO],
    io: IO_SET_VALUE_OUT,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, inputs: { set: 0, value: 0 }, expect: { out: 0 } },
          // 还没有执行过边沿，所以一个把 set/value 直接透传的电路会在这里显示 1：
          // 这一步就是「它是存储，不是逻辑」的断言。
          { tick: 0, inputs: { set: 1, value: 1 }, expect: { out: 0 } },
          { tick: 1, inputs: { set: 1, value: 1 }, expect: { out: 1 } },
          { tick: 1, inputs: { set: 0, value: 0 }, expect: { out: 1 } },
          { tick: 2, inputs: { set: 0, value: 0 }, expect: { out: 1 } },
          { tick: 2, inputs: { set: 1, value: 0 }, expect: { out: 1 } },
          { tick: 3, inputs: { set: 1, value: 0 }, expect: { out: 0 } },
          { tick: 3, inputs: { set: 0, value: 1 }, expect: { out: 0 } },
          { tick: 4, inputs: { set: 0, value: 1 }, expect: { out: 0 } },
        ],
      },
    ],
    // 实测：`not`（1）+ 两个 `switch`（各 2）+ `or`（3）= 8 个 NAND 等价门，
    // 延迟线在两个指标上免费，路径三个元件深（NOT -> switch -> OR）。
    // 上面的注释说明了这个构造和托盘扣留的用意。
    threeStar: { gate: 8, delay: 3, tick: 4 },
    // `switch` 在这里发放，而不是在原来发放它的关卡（字节加法器，现在是第 27 关），
    // 因为 2.x 改版把本关放到了前面：本关自己的提示就用两个 switch 搭出二选一，
    // 而托盘不能提供玩家还没获得的元件。这让第 24 关（Bit Switch，以该元件命名的
    // 关卡）变成一次再教学而不是初次介绍——设计规格 §3.3 记录了这个裁定。
    rewards: { components: ['ram8', 'switch'] },
  },

  /**
   * ch2-20-delayed-lines —— 晚点到站 / Delayed Lines
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 29 关），以及概念——「信号延迟一拍输出」：
   * 一个晚一个节拍才出来的信号。没有端口、位宽、通过条件、目标和奖励。
   *
   * AUTHORED（自创）：`a:8 -> out:8` 形状；十步脚本；实测目标；`reg8`/`delay8` 奖励；以及托盘。
   *
   * 同拍步骤对是这一关的全部测试，它们的存在源于模块注记里的节拍语义。第 T 拍的
   * 步骤先驱动 `a` 再推进到 T，所以那个边沿采到的字节就是同一步驱动的字节——这意味
   * 着如果每一步输入都在变，延迟线的读数与导线完全一样。真正区分它们的是「重复第 T
   * 拍、在 `a` 上给一个新字节、却仍要求旧字节」的那一步：两步之间不执行边沿，所以导线
   * 显示新字节，而延迟线显示存下的字节。测试文件用这个脚本给三种形状评分——导线在
   * 节拍 0 失败，一拍延迟通过，两拍延迟在节拍 1 失败。
   *
   * 三种写法在两个指标上打平，这一点在测试文件里实测而不是在这里声称：本关发放的
   * `delay8`、位拆分器加位合并器后面的八条 1 位 `delay_line`、以及把 `load` 接高的
   * `reg8`，都实测 0 门 / 0 延迟 / tick 4。按本章裁决（模块注记），存储在两个指标上
   * 免费，所以本关的目标就是下限，而本关教的是这一拍，而不是某个特定元件。
   */
  {
    id: 'ch2-20-delayed-lines',
    chapter: 2,
    index: 20,
    name: { zh: '晚点到站', en: 'Delayed Lines' },
    brief: {
      zh: '八位输入 a。每一个时钟沿把当时 a 上的字节存下来，输出就变成它；两个时钟沿之间无论 a 怎么变，输出都不动。输出从 0 开始。',
      en: 'Eight-bit input a. Each clock edge stores the byte that is on a, and the output becomes it; between two edges the output does not move, however a changes. It starts at 0.',
    },
    hint: {
      zh: '一颗 8 位延迟线就是答案：它的输出永远是上一个时钟沿采到的字节。也可以用八条一位延迟线并排——位拆分器拆开 a、八条各存一位、位合并器拼回一个字节——或者把 8 位寄存器的 load 接成高电平。',
      en: 'One 8-Bit Delay Line is the answer: its output is always the byte the last clock edge sampled. Eight 1-bit Delay Lines side by side do the same (split a, store one bit each, pack them back), and so does the 8-Bit Register with its load pin tied high.',
    },
    allowedComponents: [...GATES_1BIT, ...BYTE_WIRING, 'delay8', 'reg8', ...LEVEL_IO],
    io: IO_A8_OUT8,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, inputs: { a: 0x00 }, expect: { out: 0x00 } },
          { tick: 0, inputs: { a: 0x5a }, expect: { out: 0x00 } },
          { tick: 1, inputs: { a: 0x5a }, expect: { out: 0x5a } },
          { tick: 1, inputs: { a: 0xa5 }, expect: { out: 0x5a } },
          { tick: 2, inputs: { a: 0xa5 }, expect: { out: 0xa5 } },
          { tick: 2, inputs: { a: 0x00 }, expect: { out: 0xa5 } },
          { tick: 3, inputs: { a: 0x00 }, expect: { out: 0x00 } },
          { tick: 3, inputs: { a: 0xff }, expect: { out: 0x00 } },
          { tick: 4, inputs: { a: 0xff }, expect: { out: 0xff } },
          { tick: 4, inputs: { a: 0x00 }, expect: { out: 0xff } },
        ],
      },
    ],
    // 实测：`delay8` 参考解是 0 个 NAND 等价门、0 延迟单位（存储元件在两者上都免费），
    // 而 tick 指标是脚本驱动的最后一个节拍。八条延迟线与寄存器两种写法实测同一对
    // 数字——见上面的注释。
    threeStar: { gate: 0, delay: 0, tick: 4 },
    rewards: { components: ['reg8', 'delay8'] },
  },

  /**
   * ch2-23-odd-cycles —— 奇变偶不变 / Odd Ticks
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 30 关），以及概念，而这就是源资料的全部：
   *「构建振荡电路（时钟信号发生器）」——搭一个振荡电路，也就是时钟信号发生器。
   * 它没有给周期、占空比，也没有规定禁用时时钟该怎样。
   *
   * AUTHORED（自创），而且这里每个可计算的量都因此是自创的：`enable:1 -> out:1` 形状；周期
   *（两个节拍：高一拍、低一拍）；`enable` 为低时保持输出而不是清零的规则（源资料
   * 根本没有门控时钟，而「保持」才让时钟源可以停下、再重新启动而不丢相位）；
   * 第一个脚本陈述的十六拍交替、四个保持拍与四个恢复拍，以及第二个脚本陈述的八拍
   * 保持低电平；实测目标；以及托盘。
   *
   * 周期性（periodicity）才是断言，一个节拍什么也证明不了。单说「第 1 拍为高」，一根接到电源的
   * 导线就满足了；检查陈述的是规律的交替——周期性，周期为两拍——跨越十六个连续
   * 节拍：八个完整周期，每对相邻节拍都不同。随后四个 `enable` 为低的节拍必须都读到
   * 最后一个使能拍留下的值，再四个节拍从它恢复节拍。测试文件从检查数据里量出这个
   * 形状，并用它给三个电路评分：参考解通过；从不翻转的时钟在第 1 拍失败；而一个
   * 没有门控的振荡器——不管 `enable` 说什么都翻转——满足全部十六拍，却在第 16 拍
   *（第一个保持拍）失败，报 `expected 1, actual 0`。
   *
   * `out XOR enable` 用一个门同时做好两半：与 1 异或是取反（节拍），与 0 异或是保持
   *（保持），而 enable 就是那个 0 或 1，也是门控。参考解就是那个 XOR 加一颗 `set`
   * 接高的 1 位存储器，让它每个边沿都采样——实测 4 个 NAND 等价门、路径一个延迟
   * 单位。`mem1` 在这里被提供，尽管第 28 关扣下了它：本关的答案是 XOR 与存储合在
   * 一起，两个元件单独都答不出它。
   */
  {
    id: 'ch2-23-odd-cycles',
    chapter: 2,
    index: 23,
    name: { zh: '奇变偶不变', en: 'Odd Cycles' },
    brief: {
      zh: '这是本章的时钟源：电路自己产生节拍。enable 为高时，每来一个时钟沿输出就翻转一次（0、1、0、1……一直交替）；enable 为低时输出停在当时的值上，不再翻转，enable 回来之后从停下的地方接着走。输出从 0 开始。',
      en: "This is the chapter's clock source: a circuit that makes its own beat. While enable is high the output flips on every clock edge (0, 1, 0, 1, ... alternating); while enable is low the output stops where it is instead of flipping, and when enable comes back the beat resumes from the value it held. It starts at 0.",
    },
    hint: {
      zh: '「翻转」是与 1 异或，「保持」是与 0 异或，而 enable 正好就是那个 0 或 1：把输出与 enable 异或，一次运算两件事都做好了。再让延迟线或 1 位存储器在每个时钟沿采样这个结果即可——存储元件发布的是自己保存的值而不是输入，所以这个回路是稳定的。',
      en: 'Flipping is XOR with 1, holding is XOR with 0, and enable is that 0 or 1: XOR the output with enable and one gate does both jobs. Let a Delay Line or a 1-Bit Memory sample the result on every clock edge -- the storage element publishes what it holds rather than its input, so the loop settles.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, 'mem1', ...LEVEL_IO],
    io: IO_ENABLE_OUT,
    checks: [
      { kind: 'script', steps: OSCILLATOR_STEPS },
      { kind: 'script', steps: HELD_LOW_STEPS },
    ],
    // 实测：一个 `xor`（4 个 NAND 等价门）、路径一个延迟单位深，1 位存储器与常量在
    // 两个指标上都免费。tick 指标是较长那个脚本驱动的最后一个节拍。
    threeStar: { gate: 4, delay: 1, tick: 23 },
  },

  /**
   * ch2-24-bit-switch —— 二进制开关 / 1 位开关
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 32 关），以及概念——
   *「条件通断信号（类似与门但可级联省或门）」：一种条件通断，像与门，但级联方式
   * 能省掉或门。
   *
   * AUTHORED（自创）：`a:1 on:1 -> out:1` 形状；四行表；实测目标；以及托盘。
   *
   * 这一关到来时，该元件早已不是新东西，而这段注释就是把这件事记录下来的地方。
   * 源资料在这里教 `switch`——它自己的第 32 关就直叫 Bit Switch——但本复刻把该元件
   * 从第 1 章挪进了第 2 章（规格 3.3），关卡数据在第 22 关连同 `switch8` 一起解锁它：
   * 第 22 关是八位加法器，它的行波进位链需要这个条件通断；第 28 关的参考解就用了
   * 两颗。所以本关开放时，玩家已经持有 `switch` 十关了，第 32 关是一次再教学而不是
   * 初次介绍：它验证的是玩家能不能把行为落到引脚上（`on` 为高放行 `a`，为低保持 0），
   * 而不是能不能认识新元件。关卡其他方面没有为此改变——四行表、2/1 目标和托盘都
   * 保持原样，`test/levels/unlock-chain.test.ts` 把解锁钉在第 22 关。
   *
   * 源资料说它「类似与门」，这句话是被实测而不是被断言的，这也正是本关可以放心提供
   * 它名字所指元件的原因：`and(a, on)` 是 2 个 NAND 等价门、一个延迟单位，而注册的
   * `switch` 元件恰好也是同样的 2/1，所以测试文件给两者评分并断言打平。读了关卡名就
   * 直接放入 Switch 的玩家，与亲手搭与门的玩家得到同一个电路、同一个分数——这是教
   * 「两者是同一件事」最诚实的方式。托盘里不需要别的东西：一个与门就是整关。
   */
  {
    id: 'ch2-24-bit-switch',
    chapter: 2,
    index: 24,
    name: { zh: '二进制开关', en: 'Bit Switch' },
    brief: {
      zh: 'on 为 1 时把 a 放过去，on 为 0 时输出被按住为 0——不管 a 是什么。这就是条件通断，四种组合都要对。',
      en: 'While on is 1 the value of a passes through; while on is 0 the output is held at 0 whatever a says. That is a conditional pass, and all four combinations have to be right.',
    },
    hint: {
      zh: '与门的真值表就是它：两个输入都为高才输出高，所以 on 为 0 时输出必然是 0。开关元件（switch）就是同一个电路、同一个价格。',
      en: 'The AND truth table is exactly that: high only when both inputs are high, so on = 0 forces the output to 0. The Switch part is the same circuit at the same price.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, ...LEVEL_IO],
    io: IO_A1_ON1_OUT1,
    checks: [truthTable(IO_A1_ON1_OUT1, { out: ({ a, on }) => (a ?? 0) & (on ?? 0) })],
    // 实测：一个 `and`（2 个 NAND 等价门）、路径一个门深。`switch` 元件实测同一对
    // 数字——见上面的注释。
    threeStar: { gate: 2, delay: 1, tick: 0 },
  },

  /**
   * ch2-28-bit-inverter —— 可控反相器 / 1 位取反器
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 31 关），以及概念——「使用 XOR 进行位翻转」：
   * 用异或翻转一位。
   *
   * AUTHORED（自创）：`a:1 inv:1 -> out:1` 形状——源资料只点名了门、没点名引脚，所以哪个是控制、
   * 哪个是数据是本文件的选择，而 `inv` 是控制；四行表，由 `truthTable` 构建，它拒绝
   * 留下未比较声明输出引脚的表；实测目标；以及托盘（只有一位元件：这里每个引脚都是
   * 一位宽，第 9~27 关解锁的宽位元件没有东西可接——批次 1 第 14 关的理由）。
   *
   * 目标区分一种正确解法与另一种，这一点在测试文件里实测而不是在这里断言：
   * `xor(a, inv)` 是 4 个 NAND 等价门——经典的四与非单元——路径一个门深；而同一函数
   * 的积之和写法 `(a AND NOT inv) OR (NOT a AND inv)` 是 9 个 NAND 等价门、路径三个
   * 元件深：正确，但只拿一星。提供 `xor` 元件，是因为它是这里每一关都已经拥有的
   * 第 1 章元件；它与本目标打平而不是击败它，所以提供它对本关没有代价。
   *
   * `switch` 也被提供，但在这里没什么用：它是一位条件通断，属于第 32 关的功能而
   * 不是本关的，而批次 1、2 提供过大量一关用不上的元件。
   */
  {
    id: 'ch2-28-bit-inverter',
    chapter: 2,
    index: 28,
    name: { zh: '可控反相器', en: 'Bit Inverter' },
    brief: {
      zh: 'inv 是一位控制信号：inv 为 1 时把 a 取反，inv 为 0 时把 a 原样送出去。四种输入组合都要对。',
      en: 'inv is a one-bit control: when it is 1 the output is a inverted, when it is 0 the output is a unchanged. All four input combinations have to be right.',
    },
    hint: {
      zh: '异或就是「可以选择要不要取反」：a 异或 inv，inv 为 1 时结果翻过来，为 0 时结果就等于 a。四个与非门就能拼出一个异或。',
      en: 'XOR is exactly "invert, or not, as you choose": a XOR inv flips when inv is 1 and equals a when inv is 0. Four NANDs make an XOR.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, ...LEVEL_IO],
    io: IO_A1_INV1_OUT1,
    checks: [truthTable(IO_A1_INV1_OUT1, { out: ({ a, inv }) => (a ?? 0) ^ (inv ?? 0) })],
    // 实测：一个 `xor`（4 个 NAND 等价门）、路径一个门深，两个关卡引脚作为源。
    // 积之和写法是 9 和 3，一星——见上面的注释。
    threeStar: { gate: 4, delay: 1, tick: 0 },
  },

  /**
   * ch2-30-multiplexer —— 数据选择器 / Input Selector
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 33 关），以及概念——
   *「2-to-1 多路复用器（MUX）」：一个二选一多路器。没有端口、位宽、通过条件、
   * 目标和奖励。
   *
   * AUTHORED（自创）：`a:8 b:8 sel:1 -> out:8` 形状；fuzz 检查（任务书固定其类型、256 轮与固定
   * 种子纪律；种子、引脚映射和期望函数写在这里）；实测目标；`mux8` 奖励；以及托盘。
   *
   * 为什么这一关用 fuzz 而第 34 关用表：2^17 个输入向量没法写成行，而字节选择器
   * 恰好是那种「接错一位就丢掉一半向量」的电路。种子是固定字面量（`0x3308`：
   * 高字节是关卡序号、低字节是字节宽度，与批次 2、3 的播种方式一致），所以覆盖范围
   * 是关卡的事实。测试文件实测它：256 轮里多少轮驱动 `sel` 为低、多少轮为高
   *（两者都远超五十——只测其中一个分支会让半个电路不被评分）、序列在第二次运行时
   * 完全重复，以及 `out <- a` 在第一个 `sel` 为高的轮次失败。
   *
   * 参考解就是本关发放的元件。`mux8` 是 8 个四与非 2:1 多路器 = 32 个 NAND 等价门、
   * 路径一个延迟单位深；按应用自己的奖励规则（`paletteDefsFor` 会提供关卡自己的
   * 奖励），它在本关托盘里。
   *
   * 目标实际区分了什么，对本关和第 34 关都在测试文件里实测而不是在这里断言，答案
   * 并不显然：手工搭的选择器——`sel` 的一个 NOT 由全部八位共享，然后每位三个 NAND
   *（一个 NAND 就是一个 NAND 等价门，所以共享的反相器确实是共享的）——实测 25 门、
   * 路径三个元件深。因此它在门数上比元件自身记录在案的单元（按每位一个反相器定价）
   * 更便宜，却仍只拿一星：拒绝它的是延迟那一列，因为 `mux8` 是一个节点，而手工版
   * 是三个。本关的目标是元件自身的指标，而元件在分数上（32 + 4 = 36 对 25 + 12 = 37）
   * 和星数上都赢。这里没有任何东西会拒绝一个同时满足两个上限的构造拿三星。
   */
  {
    id: 'ch2-30-multiplexer',
    chapter: 2,
    index: 30,
    name: { zh: '数据选择器', en: 'Multiplexer' },
    brief: {
      zh: '两路八位数据 a 和 b，一位选择信号 sel。sel 为 0 时输出 a，sel 为 1 时输出 b——整字节一起选，没被选中的那一路一位都不许漏过去。',
      en: 'Two eight-bit data inputs a and b and one select bit sel. sel 0 publishes a and sel 1 publishes b, all eight bits at once, and not one bit of the unselected line may leak through.',
    },
    hint: {
      zh: '每一位都是一次二选一：sel 为 0 取 a 的那一位，为 1 取 b 的那一位。位拆分器把两个字节各拆成八位，八组各选一次，再用位合并器拼回一个字节；本关奖励的 8 位多路选择器（mux8）正是这个电路。',
      en: 'Every bit is one two-way choice: bit i of a when sel is 0, bit i of b when sel is 1. Split both bytes, choose eight times, and pack the eight results back into a byte; the 8-Bit Multiplexer this level hands out is exactly that circuit.',
    },
    allowedComponents: [...GATES_1BIT, ...BYTE_WIRING, ...SWITCH_1, 'mux8', ...LEVEL_IO],
    io: IO_A8_B8_SEL1_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_33,
        rounds: 256,
        inputs: {
          a: (sample) => sample.a ?? 0,
          b: (sample) => sample.b ?? 0,
          sel: (sample) => sample.sel ?? 0,
        },
        // 不需要掩码，也没有写掩码：结果就是两个操作数之一，而两者本来就在引脚
        // 范围内。
        outputs: { out: (v) => ((v.sel ?? 0) === 1 ? (v.b ?? 0) : (v.a ?? 0)) },
      },
    ],
    // 实测：`mux8` 是 8 x MUX2 = 32 个 NAND 等价门，路径一个延迟单位深。
    // 手工搭的 25/3 选择器同样一星——见注释。
    threeStar: { gate: 32, delay: 1, tick: 0 },
    rewards: { components: ['mux8'] },
  },

  /**
   * ch2-32-the-bus —— 总线 / The bus
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 34 关），以及源资料的概念，只有一行、别无其他：
   *「共享数据传输线路的概念」——多个源共享一条数据线的想法。没有端口、位宽、
   * 仲裁规则、通过条件、目标和奖励。
   *
   * AUTHORED（自创），而它记录的第一件事是类型的改变（kind）。源资料的概念按字面在本引擎里不可计算，
   * 而且不是本复刻跳过了它。规格 3.1 禁止总线协议，原话是「不做总线协议
   *（多驱动仲裁）」。`validateGraph` 把同一输入引脚上的第二根导线报成 `multiple-drivers`
   * 错误，内核中没有任何东西会裁定几个驱动里谁拥有这条线。所以字面意义上的共享/
   * 三态总线「按设计」不可实现。关卡被重新框定为总线的另一半：任何时刻恰好一个
   * 驱动有效，所以 `out` 等于 `sel` 选中的那条线。换言之，本关教驱动选择（driver selection），它的 brief
   * 用两种语言告诉玩家同一件事，而不是假装源资料那句话是电路规格。这是本阶段三个
   * 有意改变关卡类型的地方之一，并照此记录。
   *
   * AUTHORED（其余部分）：`a:8 b:8 sel:1 -> out:8` 形状；四行表及其向量；实测目标；
   * 以及托盘。
   *
   * 这张表只有四行，是任务书的决定，而不是缺一个生成器：本关以读者肉眼可核对的规模
   * 陈述规则，而字节宽的覆盖属于第 33 关的 fuzz 检查。两个 `sel` 取值都出现在同一对
   * 操作数上（所以表把「被选中的线」与「总是第一条」「总是第二条」区分开），两对
   * 操作数又是不对称的字节模式，所以打乱字节内位序的电路会在四行中的某一行失败。
   *
   * 函数与第 33 关相同，这是任务书自己的表而不是笔误：一个形状、一种行为、两种框法
   * ——33 是用 256 个随机向量评分的字节选择器，34 是用四行真值表评分的共享线路。
   *（批次 1 为第 15、16 关记录过同样的巧合。）参考解是 `mux8`（第 33 关解锁，这里
   * 提供），它实测的指标与第 33 关目标陈述的完全相同，因为它是同一个电路；手工搭的
   * 选择器在这里与在那里实测同样 25 门 / 3 个延迟单位 / 一星，而第 33 关的注释就是
   * 把这个测量写出来的地方。
   */
  {
    id: 'ch2-32-the-bus',
    chapter: 2,
    index: 32,
    name: { zh: '总线', en: 'The Bus' },
    brief: {
      zh: '总线是多路信号共享的一条数据线。本引擎没有总线协议，也不做多驱动仲裁：一个输入引脚只能被一根线驱动，几路信号同时抢一条线在这里是不允许的。所以这一关教的是总线的另一半——任何时刻只有一路驱动有效。sel 为 0 时总线上是 a，sel 为 1 时是 b，没被选中的那一路完全不出现。',
      en: 'A bus is one data line that several sources share. This engine has no bus protocol and does no multi-driver arbitration: one input pin is driven by exactly one wire, so several sources fighting over a single line is not something this engine can run. This level therefore teaches the other half of a bus -- exactly one driver is active at any moment. With sel 0 the line carries a, with sel 1 it carries b, and the unselected line does not appear at all.',
    },
    hint: {
      zh: '每一位都是一次二选一：被选中的那一路到达输出，另一路一位也不许混进来。8 位多路选择器（mux8）就是一次字节级的二选一；也可以自己用与非门搭，只是更贵。',
      en: 'Every bit is one two-way choice: the selected line reaches the output and the other may not mix in a single bit. The 8-Bit Multiplexer is that choice at byte scale; it can also be built from NANDs, at a higher price.',
    },
    allowedComponents: [...GATES_1BIT, ...BYTE_WIRING, ...SWITCH_1, 'mux8', ...LEVEL_IO],
    io: IO_A8_B8_SEL1_OUT8,
    checks: [{ kind: 'truth-table', rows: BUS_ROWS }],
    // 实测：与第 33 关相同的 `mux8`——32 个 NAND 等价门、一个延迟单位、无节拍
    //（纯组合关卡）。见上面的注释。
    threeStar: { gate: 32, delay: 1, tick: 0 },
  },

  /**
   * ch2-33-saving-gracefully —— 优雅存储 / Saving Gracefully
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 35 关），以及概念——
   *「1 位锁存器/寄存器（条件写入）」：一位锁存器或寄存器，条件性写入。
   *
   * AUTHORED（自创）：`d:1 load:1 -> out:1` 形状；十一步脚本及其同拍步骤对；实测目标；以及托盘。
   *
   * 与第 28 关相同的存储规则，只是引脚名不同，这是任务书自己的表而不是笔误：
   * 28 读的是 `set`/`value`，本关读的是 `d`/`load`，两者都要求「使能为高时存下数据位，
   * 否则保持不变」。它们的框法不同，检查断言的东西也不同——28 是搭回路的地方，其检查
   * 断言回路能结算，托盘扣下封装元件；本关是使用封装元件的地方，脚本在六个节拍里走
   * load 低/高/低，每一拍同时陈述它的边沿和其后的无边沿重读。测试文件也用手工搭的
   * 回路对本关评分，它正确，但只值一星。
   *
   * `mem1` 在这里被提供，而且它就是参考解。它的 `set` 引脚是写使能、`value` 引脚是
   * 数据，所以 `load` 和 `d` 直接接进去——这正是源资料的概念：一颗带条件写入的一位
   * 寄存器。因此实测目标（0 门 / 0 延迟 / tick 5）就是那颗元件自身的指标，而按本章
   * 裁决（模块注记），存储在两个指标上免费：已解锁的元件就是下限，用门重建它是正确
   * 答案但只值一星。测试文件也实测了手工版（一条延迟线、两个 switch、一个 NOT 和一个
   * OR：8 门、3 个延迟单位），所以选择搭回路而不是直接放入元件的代价，在本批里是一个
   * 数字而不是一句话。
   */
  {
    id: 'ch2-33-saving-gracefully',
    chapter: 2,
    index: 33,
    name: { zh: '优雅存储', en: 'Saving Gracefully' },
    brief: {
      zh: '一位的条件写入。load 为高时，时钟沿把 d 存下来；load 为低时输出保持不动，d 在这一拍说什么都不算。输出从 0 开始。',
      en: 'A one-bit conditional write. While load is high a clock edge stores d; while load is low the output keeps its bit and d has no say. It starts at 0.',
    },
    hint: {
      zh: '1 位存储器（mem1）就是这块东西：set 是写入使能、value 是数据，把 load 接到 set、d 接到 value 即可。也可以自己搭——输出经过一条延迟线回到输入，「load 为高取 d、否则取输出自己」用两个开关加一个或门——只是门多一些。',
      en: 'The 1-Bit Memory is exactly this part: its set pin is the write enable and its value pin is the data, so wire load to set and d to value. It can be built by hand as well -- the output returns through a Delay Line and two Switches plus an OR choose between d and the output -- for more gates.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, 'mem1', ...LEVEL_IO],
    io: IO_D1_LOAD1_OUT1,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, inputs: { d: 0, load: 0 }, expect: { out: 0 } },
          // 还没有执行过边沿：一个发布 `load ? d : 0` 的锁存器会显示 1。
          { tick: 0, inputs: { d: 1, load: 0 }, expect: { out: 0 } },
          { tick: 1, inputs: { d: 1, load: 0 }, expect: { out: 0 } },
          { tick: 1, inputs: { d: 1, load: 1 }, expect: { out: 0 } },
          { tick: 2, inputs: { d: 1, load: 1 }, expect: { out: 1 } },
          { tick: 2, inputs: { d: 0, load: 0 }, expect: { out: 1 } },
          { tick: 3, inputs: { d: 0, load: 0 }, expect: { out: 1 } },
          { tick: 3, inputs: { d: 0, load: 1 }, expect: { out: 1 } },
          { tick: 4, inputs: { d: 0, load: 1 }, expect: { out: 0 } },
          { tick: 4, inputs: { d: 1, load: 0 }, expect: { out: 0 } },
          { tick: 5, inputs: { d: 1, load: 0 }, expect: { out: 0 } },
        ],
      },
    ],
    // 实测：`mem1` 参考解是 0 个 NAND 等价门、0 延迟单位（存储元件在两者上都免费），
    // tick 5 是脚本的最后一个节拍。手工搭的回路是 8 门、3 个延迟单位，一星
    //——见注释。
    threeStar: { gate: 0, delay: 0, tick: 5 },
  },

  /**
   * ch2-34-saving-bytes —— 整存整取 / Saving Bytes
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 36 关），以及概念——「8 位寄存器」：
   * 一个八位寄存器。没有端口、位宽、通过条件、目标和奖励。
   *
   * AUTHORED（自创）：`d:8 load:1 -> out:8` 形状；十四步脚本及其同拍步骤对；实测目标；
   * `counter8` 奖励；以及托盘。
   *
   * 参考解就是本关奖励清单点名的那颗寄存器：把 `reset` 接低的 `reg8` 按本章裁决是
   * 0 门 0 延迟，而目标就是它自身的实测指标。位切片替代写法——八颗 1 位存储器，
   * `load` 接到全部八个 `set` 引脚，前面是位拆分器、后面是位合并器——实测恰好同一对
   * 数字，测试文件给两者评分并断言打平，而不是挑一个出来称之为答案。
   *
   * `counter8` 在这里被发放，并且在本关自己的托盘里被提供。它答不出本关——它没有
   * 办法把一个字节「读进来」，而这是本关的全部要求——所以提供它是应用自己的奖励规则，
   * 而不是抄近路。第 38 关的答案确实是它，但那一关不提供它；那一关的注释记录了原因。
   *
   * 脚本的同拍步骤对就是本关对「保持」的测试（模块注记）：重复一个节拍、在 `d` 上
   * 换一个字节、却仍要求存下的那个字节——导线会失败，寄存器会通过，而本关在测试
   * 文件里的反例正是那根导线。
   */
  {
    id: 'ch2-34-saving-bytes',
    chapter: 2,
    index: 34,
    name: { zh: '整存整取', en: 'Saving Bytes' },
    brief: {
      zh: '把一位的条件写入扩到八位：load 为高时，时钟沿把整个字节 d 存下来；load 为低时输出保持上一个存入的字节。输出从 0 开始。',
      en: 'The same conditional write one byte wide: while load is high a clock edge stores all eight bits of d; while load is low the output keeps the byte it stored. It starts at 0.',
    },
    hint: {
      zh: '8 位寄存器（reg8）的 d 和 load 就是这两个引脚，把 reset 接低电平即可。也可以用八颗 1 位存储器并排：load 同时接到八颗的 set 上，每颗存 d 的一位。两条路在本关的评分上一模一样。',
      en: 'The 8-Bit Register has exactly these pins -- d and load, with reset tied low. Eight 1-Bit Memories side by side do the same job: wire load to all eight set pins and each stores one bit of d. Both routes score the same on this level.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      'delay8',
      'mem1',
      'reg8',
      'counter8',
      ...LEVEL_IO,
    ],
    io: IO_D8_LOAD1_OUT8,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, inputs: { d: 0x00, load: 0 }, expect: { out: 0x00 } },
          { tick: 0, inputs: { d: 0xa5, load: 0 }, expect: { out: 0x00 } },
          { tick: 1, inputs: { d: 0xa5, load: 0 }, expect: { out: 0x00 } },
          { tick: 1, inputs: { d: 0xa5, load: 1 }, expect: { out: 0x00 } },
          { tick: 2, inputs: { d: 0xa5, load: 1 }, expect: { out: 0xa5 } },
          { tick: 2, inputs: { d: 0x00, load: 0 }, expect: { out: 0xa5 } },
          { tick: 3, inputs: { d: 0x00, load: 0 }, expect: { out: 0xa5 } },
          { tick: 3, inputs: { d: 0x00, load: 1 }, expect: { out: 0xa5 } },
          { tick: 4, inputs: { d: 0x00, load: 1 }, expect: { out: 0x00 } },
          { tick: 4, inputs: { d: 0xff, load: 0 }, expect: { out: 0x00 } },
          { tick: 5, inputs: { d: 0xff, load: 0 }, expect: { out: 0x00 } },
          { tick: 5, inputs: { d: 0xff, load: 1 }, expect: { out: 0x00 } },
          { tick: 6, inputs: { d: 0xff, load: 1 }, expect: { out: 0xff } },
          { tick: 6, inputs: { d: 0x5a, load: 0 }, expect: { out: 0xff } },
        ],
      },
    ],
    // 实测：`reg8` 参考解是 0 个 NAND 等价门（存储元件与常量在门指标上都免费）、
    // 0 个延迟单位，tick 6 是脚本的最后一个节拍。八颗 1 位存储器实测同一对数字
    //——见上面的注释。
    threeStar: { gate: 0, delay: 0, tick: 6 },
    rewards: { components: ['counter8'] },
  },

  /**
   * ch2-38-little-box —— 方寸之间 / Little Box
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 37 关），以及源资料的概念，只有一行、别无其他：
   *「刚好装满存储空间的电路设计」——一个恰好填满其存储空间的电路设计。源资料没有给
   * 容量、没有地址位宽，也没有定义「满」是什么意思。
   *
   * AUTHORED（自创），而它所定义的东西就是这一关。本复刻把关卡定义为 `d:8 addr:8 load:1 -> out:8`
   * 作用在 `ram8` 的 256 个字节上，并把「装满」定义为：全部 256 个地址都可寻址（addressable）、
   * 可写入，且每个地址都能读回写进去的内容。这个定义（defines）就是本关的契约，用两种语言写进
   * brief，检查在整个范围上断言它而不是抽样。
   *
   * 检查覆盖整个范围，而这正是定义的意义：513 步。前 256 步把一个互不相同的字节写进
   * 地址 0~255 的每一个，每步一个时钟沿（`boxByte` 是 0..255 的双射，所以没有两个
   * 单元存相同值），并在同一步断言输出上的字节；后 256 步在 256 次写入全部发生之后，
   * 以 `load` 为低、`d` 接所存字节的补码，重新读取每个地址。所以通过证明的是盒子
   * 同时装着全部 256 个字节，而不是最近一次写入能被读出；把 `d` 透传到 `out` 的电路
   * 会在 256 个读步骤的每一个上失败。只碰两个地址的检查测不出「装满」，而测试文件给
   * 两种错误形状都评分：忽略 `addr` 的单颗寄存器在第一次回读时失败（`expected` 是
   * 地址 0 被写入的字节），而从 `d` 接来的导线在同一步失败，因为 `d` 是本关期望字节的
   * 补码。
   *
   * 参考解是 `ram8`（第 28 关解锁）：0 门、0 延迟、tick 512——脚本的最后一个节拍。
   * 按模块注记，存储在两个指标上免费，256 字节的存储器是唯一能「成为」256 字节盒子的
   * 元件，而 brief 也诚实地说了另一条路：256 个一位锁存器也能用，但那会是一块画板
   * 大小的电路。这就是本关没有门数目标要争的原因：本关讲的是地址范围，而范围正是
   * 检查所测量的东西。
   */
  {
    id: 'ch2-38-little-box',
    chapter: 2,
    index: 38,
    name: { zh: '方寸之间', en: 'Little Box' },
    brief: {
      zh: '一个装得满满的小盒子：256 个格子，每格一个字节。addr 是格子号（0 到 255）；load 为高时，时钟沿把 d 写进 addr 指定的那一格；输出永远显示 addr 指定的那一格里的字节，不需要时钟沿。本关要的就是「装满」：256 个地址每一个都能写进去、都能原样读回来。',
      en: 'A little box that is completely full: 256 cells, one byte each. addr is the cell number (0 through 255); while load is high a clock edge writes d into the cell addr names, and the output always shows the byte in the cell addr names, with no clock edge needed. What this level asks for is "full": every one of the 256 addresses can be written and read back unchanged.',
    },
    hint: {
      zh: '8 位存储器（ram8）就是这 256 个格子：d、addr、load 三个引脚的名字与本关完全一致，输出直接接到 out。用别的元件凑出 256 个字节的存储倒也不是不行，只是要在这块板子上放非常多的东西。',
      en: 'The 8-Bit RAM is this box: its d, addr and load pins are named exactly as this level names them, and its output wires straight to out. Building 256 bytes of storage out of smaller parts is not impossible, but it takes a great many components on this board.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      'delay8',
      'mem1',
      'reg8',
      'ram8',
      ...LEVEL_IO,
    ],
    io: IO_D8_ADDR8_LOAD1_OUT8,
    checks: [{ kind: 'script', steps: littleBoxSteps() }],
    // 实测：`ram8` 参考解是 0 个 NAND 等价门、0 个延迟单位（存储元件在两者上都免费；
    // 跟随 `addr` 的读取路径在延迟图上仍是时序元件自身的输出），而 tick 指标是脚本的
    // 最后一个节拍——256 次写入与 256 次回读。
    threeStar: { gate: 0, delay: 0, tick: 512 },
  },

  /**
   * ch2-39-counter —— 计数器 / Counter
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 38 关，本章最后一关）、概念——「自增寄存器」：
   * 一个会自己加一的寄存器——以及源资料自己的成就注记，全文引用：「成就：≤ 65 个门」
   *（成就：不超过 65 个门）。
   *
   * AUTHORED（自创）：`en:1 reset:1 -> out:8` 形状；265 步脚本；实测目标；以及托盘。
   *
   * 成就如何记录、以及它不是什么。源资料这条注记是成就，不是通过条件（achievement, not a pass condition）：它在这里不给
   * 任何电路评分，本文件里也没有任何东西把 65 当作本关的 `threeStar.gate`。它统计的
   * 还是源资料自己度量下的「基本逻辑门」数，而本复刻的 `gate` 指标统计 NAND 等价门
   *（规格 5.4；基准表在 `core/defs/index.ts`），两者不是同一个量——批次 2 曾为第 21 关
   * 的五个元件和第 22 关的延迟 35 做过同样的区分。`threeStar.gate` 携带的是本复刻自身
   * 参考解「实测的」NAND 等价门数：41，按任何读法都在源资料的 65 以内。所以 65 作为
   * 源资料的成就在此记录——是成就，不是通过条件——它既不是本关的 `threeStar.gate`，
   * 也不是本关给任何电路评分的数字。
   *
   * 托盘扣下 `counter8`——唯一能一步答出本关的元件：它由第 36 关解锁，不是本关自己的
   * 奖励，而它的引脚（`en`/`reset` -> `out`）恰好就是本关的引脚——批次 2 的规则
   *（第 22 关的 `add8`、第 24 关的 `neg8`，以及本批更早的第 28 关 `mem1`）在这里
   * 再用一次。提供它的话，一颗元件就能拿 0 门 0 延迟（存储在两个指标上都免费），
   * 既答出本关，又让源资料自己的成就变得空洞。测试文件实测了那个直接放入——它能通过，
   * 0/0/tick 263——并断言它不在托盘里。加法必须在这里亲手搭。
   *
   * 参考解是寄存器加一个手工搭的增量器：`bit0 = NOT x0`、`bit_i = x_i XOR c_i`、
   * `c_(i+1) = x_i AND c_i`，其中 `c_1 = x0`；最后一个进位从不搭建，因为没有进位输出
   * 引脚——一个 NOT、七个 XOR、六个 AND，实测 41 个 NAND 等价门、路径七个元件深。
   * `en` 接寄存器的 `load`、关卡的 `reset` 接它的 `reset`，所以已定的优先级
   *（reset 压过 load/en，`core/defs/wide.ts`）由寄存器自己提供，不花门。托盘确实提供
   * 的替代解是 `add8(x, 0, 1)`：正确、72 门、一个延迟单位深、一星——目标同时陈述两个
   * 指标，测试文件也实测它。
   *
   * 回绕与优先级都在检查里被断言。256 个连续使能边沿让计数走遍每个字节并在恰好 256
   * 时回到 0（在 128 处回绕、或在 255 处饱和的计数器，会在这 256 个期望中的某一个上
   * 失败，而不是在某个挑出来的值上失败）；被丢弃的进位就是回绕，因为九位装不进八位
   * 寄存器；而 `reset` 与 `en` 同时为高、计数为 2 的那一步期望 0——让使能赢的寄存器
   * 会读到 3。最后两步落在同一节拍，以证明没有边沿时计数不动。
   */
  {
    id: 'ch2-39-counter',
    chapter: 2,
    index: 39,
    name: { zh: '计数器', en: 'Counter' },
    brief: {
      zh: '一个自己会数数的寄存器。reset 为高时，时钟沿把它清成 0——reset 比 en 优先，两者同时为高时清零；否则 en 为高时加一，en 为低时保持不动。加到 255 之后再走一拍就回到 0：八位装不下 256，于是绕回来。输出从 0 开始。',
      en: 'A register that counts by itself. While reset is high a clock edge clears it to 0 -- reset beats en, so both high means a clear; otherwise en high adds one and en low holds. One edge past 255 it comes back to 0: eight bits cannot hold 256, so the count wraps. It starts at 0.',
    },
    hint: {
      zh: '「加一」就是把当前值加 1：第 0 位取反；往上每一位是「本位与下面传来的进位异或」，而进位是「本位与下面的进位相与」。把这个结果接回 8 位寄存器的 d，en 接 load、reset 接 reset，寄存器自己就成了计数器——清零与使能的优先级由寄存器本身的引脚决定，不需要额外的门。',
      en: "Adding one means: bit 0 is the inverse of the old bit 0, every higher bit is the old bit XOR the carry coming from below, and that carry is the old bit AND the carry below it. Feed the result back into the register's d, wire en to load and reset to reset, and the register counts by itself -- the register's own pins already give reset priority over the enable, with no extra gate.",
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      'add8',
      'delay8',
      'mem1',
      'mux8',
      'reg8',
      'ram8',
      ...LEVEL_IO,
    ],
    io: IO_EN1_RESET1_OUT8,
    checks: [{ kind: 'script', steps: counterSteps() }],
    // 实测：一个 `not`（1）+ 七个 `xor`（28）+ 六个 `and`（12）= 41 个 NAND 等价门，
    // 寄存器、位拆分器和位合并器免费，路径七个元件深（进位链），tick 263 是脚本的
    // 最后一个节拍。源资料的「≤ 65 个门」作为成就在上面的注释里记录，而不是这个
    // 数字。
    threeStar: { gate: 41, delay: 7, tick: 263 },
  },
];
