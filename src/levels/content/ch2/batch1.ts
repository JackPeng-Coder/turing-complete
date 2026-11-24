import { generateRows } from '../../checks';
import type { LevelSpec, TruthRow } from '../../spec';
// `LevelIo`——引脚形状——来自 `tables.ts`；`checks.ts` 还导出了一个同名的运行时接口
//（已绑定仿真的接口），两者不能混淆。
import { truthTable, type LevelIo } from '../../tables';

/**
 * 第 2 章第 13~17 关：标量逻辑与计数——本章第一批，也是游戏中第一批带多位引脚的
 * 关卡数据。
 *
 * 这里每一关都是纯组合逻辑，所以每个三星目标的 `tick` 都是 0，理由与第 1 章的
 * 组合关卡所说的一样：本批没有任何检查推进时钟，所以该指标确实是 0，其目标永远
 * 不会成为玩家拿不到三星的原因。真正起作用的是 `gate` 和 `delay`，下面每个目标
 * 都是参考解自身的实测分数——测试文件里的
 *「three-star targets are the reference solutions own metrics」用数字而不是承诺
 * 来保证这一点。
 */

/**
 * 本批用到的五种引脚形状，这样一关的 io 就是一个有名字的常量，
 * 而不是写在 spec 中间的一堆字面量。
 */
const IO_A4_OUT1: LevelIo = { inputs: [{ id: 'a', width: 4 }], outputs: [{ id: 'out', width: 1 }] };
const IO_ABCD_OUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'c', width: 1 },
    { id: 'd', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_ABCD_OUT3: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'c', width: 1 },
    { id: 'd', width: 1 },
  ],
  outputs: [{ id: 'out', width: 3 }],
};
const IO_A8_OUT8: LevelIo = { inputs: [{ id: 'a', width: 8 }], outputs: [{ id: 'out', width: 8 }] };

/**
 * 四位读取器的形状：四个 1 位输入进，四个 1 位输出出。
 *
 */
const IO_NIBBLE: LevelIo = {
  inputs: [
    { id: 'b3', width: 1 },
    { id: 'b2', width: 1 },
    { id: 'b1', width: 1 },
    { id: 'b0', width: 1 },
  ],
  outputs: [
    { id: 'out3', width: 1 },
    { id: 'out2', width: 1 },
    { id: 'out1', width: 1 },
    { id: 'out0', width: 1 },
  ],
};

/**
 * 为一个「发布单个数值」的关卡生成行，由内核自己的生成器枚举。
 *
 * `generateRows(spec, expected)` 遍历 `spec.io` 的每种输入组合，并把一个整数按
 * 低引脚在前切进 `spec.io.outputs`；`truthTable(io, perPin)` 是同样的遍历，
 * 只是每个引脚一个函数。关卡的 `checks` 写在 spec 对象存在之前，所以这里把
 * `generateRows` 唯一读取的字段交给它——形状的其余部分存在但为空，这就是
 * `checks` 在这里是 `[]`、而在关卡上永远不会是 `[]` 的原因。
 *
 * 行必须显式构建，不能省略：`rows` 缺失或为空是硬性的 `missing-rows` 失败，
 * 而不是「帮我枚举所有组合」。
 */
function valueRows(io: LevelIo, expected: (inputs: Record<string, number>) => number): TruthRow[] {
  return generateRows(
    {
      id: '',
      chapter: 2,
      index: 0,
      name: { zh: '', en: '' },
      brief: { zh: '', en: '' },
      hint: { zh: '', en: '' },
      allowedComponents: [],
      io,
      checks: [],
    },
    expected,
  );
}

/**
 * `value` 的低 `bits` 位里有多少位为高：`ch2-18-counting-signals` 发布的就是这个
 * 计数。
 *
 */
function onesIn(value: number, bits: number): number {
  let count = 0;
  for (let bit = 0; bit < bits; bit += 1) if ((value >>> bit) & 1) count += 1;
  return count;
}

/** 第 2 章本批次的关卡数据，按 `index` 顺序排列；章节顺序由 `ch2/index.ts` 汇合、`content/index.ts` 统一排序。 */
export const CH2_BATCH1: readonly LevelSpec[] = [
  /**
   * ch2-14-binary-racer —— 二进制速算 / Binary Racer
   *
   */
  {
    id: 'ch2-14-binary-racer',
    chapter: 2,
    index: 14,
    name: { zh: '二进制速算', en: 'Binary Racer' },
    brief: {
      zh: '四个输入位 b3 b2 b1 b0 组成一个数。一眼读出它——然后原样送到四个输出位。',
      en: 'Bits b3..b0 form one number. Read it at a glance, then forward it to the four outputs.',
    },
    hint: {
      zh: 'b3 是最高位（权 8），b0 是最低位（权 1）。把每一位直连到同名输出。',
      en: 'b3 is the most significant bit (weight 8), b0 the least (weight 1). Wire each straight through.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'and3',
      'xor',
      'or3',
      'xnor',
      'level_input',
      'level_output',
    ],
    io: IO_NIBBLE,
    checks: [
      truthTable(IO_NIBBLE, {
        // 运行时 `?? 0` 是多余的——枚举器总会填满每个声明的输入——
        // 但在 `noUncheckedIndexedAccess` 下，记录的下标访问类型是 `number | undefined`，
        // 而「缺失的位读作低电平」是对它最诚实的解释。
        out3: ({ b3 }) => b3 ?? 0,
        out2: ({ b2 }) => b2 ?? 0,
        out1: ({ b1 }) => b1 ?? 0,
        out0: ({ b0 }) => b0 ?? 0,
      }),
    ],
    threeStar: { gate: 0, delay: 0, tick: 0 },
    // `mem1` 是第 1 章最后一次发放，而这里正是它必须发生的位置：第 2 章的锁存器
    // 关卡（「Circular Dependency」）用一位存储器搭建，而更早关卡的谜题都用不到它。
    // 在这个奖励存在之前，`mem1` 定义在 `core/defs/index.ts` 里，却没有任何关卡奖励它，
    // 于是它永远不会出现在任何托盘里，那一关也根本搭不出来。
    //
    // 第一次出现存储器放在收尾关是合理的：「一眼读出 nibble 再原样转发」距离
    //「记住一位」只差一根线，而且本关托盘不变——它不列出 `mem1`，关卡的托盘始终受
    // `allowedComponents` 限制。奖励也不参与评分（`grade()` 只读检查和 `threeStar` 指标，
    // 从不读 `rewards`），所以第 1 章的任何分数或目标都不会因这一行而移动。
    rewards: { components: ['less_u'] },
  },
  /**
   * ch2-15-double-detection —— 成双成对 / Double Trouble
   *
   * 本关不发放任何元件，这是任务书的决定。
   */
  {
    id: 'ch2-15-double-detection',
    chapter: 2,
    index: 15,
    name: { zh: '成双成对', en: 'Double Detection' },
    brief: {
      zh: '四个一位信号 a b c d。其中同时为高的至少有 2 个时输出为高，只有 0 个或 1 个时为低。',
      en: 'Four one-bit signals a, b, c, d. Output high when at least two of them are high at once, low when none or only one is.',
    },
    hint: {
      zh: '「至少两个为高」等于三组两两组合的或：a&b、c&d，还有 (a|b)&(c|d)——最后一组管的是跨过分组的那些组合。',
      en: '"At least two high" is the OR of three pair-terms: a&b, c&d, and (a|b)&(c|d) -- the last one covers every pair that crosses the two groups.',
    },
    allowedComponents: [
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
      'level_input',
      'level_output',
    ],
    io: IO_ABCD_OUT1,
    checks: [
      { kind: 'constraint', rule: { kind: 'at-least', inputs: ['a', 'b', 'c', 'd'], count: 2, output: 'out' } },
    ],
    // 实测：参考解是 (a&b)|(c&d)|((a|b)&(c|d))——两个 AND、两个 OR、一个 AND 和一个
    // 三输入 OR = 2+2+3+3+2+6 = 18 个 NAND 等价门——其中 OR-AND-OR3 这条路径
    // 把深度定在 3。
    threeStar: { gate: 18, delay: 3, tick: 0 },
  },

  /**
   * ch2-16-odd-number-of-signals —— 奇数计数技术 / ODD Number of Signals
   *
   * 本关自己的奖励就是它搭建时用的东西，这已经是应用的规则而不是接缝：
   * `paletteDefsFor`（`src/app/progress.ts`）在按 `allowedComponents` 过滤之前，
   * 会把关卡自己的奖励加进已解锁集合，因为一关发放的元件正是它谜题设计时依赖的元件。
   * 这里必须如此：`splitter`、`maker` 和 `const8` 是本关自己的奖励，而首次游玩时
   * 没有位拆分器就根本搭不出这一关——位拆分器是唯一能取出 `a` 第 1~3 位的元件
   *（第 1 章的所有元件都是一位引脚，从 4 位输出接到 1 位输入的导线只会复制第 0 位）。
   * 当辅助函数只提供「已通过关卡」的奖励时，这一关在第一次尝试时无法游玩；
   * `test/levels/level-buildability.test.ts` 现在会逐个遍历所有已发布关卡检查这一点，
   * `test/app/progress.test.ts` 也明确写下了这条规则的两半（自己的奖励会提供；
   * 不在 `allowedComponents` 里的奖励仍然不提供）。
   */
  {
    id: 'ch2-16-odd-number-of-signals',
    chapter: 2,
    index: 16,
    name: { zh: '奇数计数技术', en: 'Odd Number of Signals' },
    brief: {
      zh: '四位输入 a 上挂着四个信号位。为高的位有奇数个时输出为高，偶数个（一个都没有也算偶数）时为低。',
      en: 'Input a carries four signal bits. Output high when an odd number of them are high, and low when the count is even -- none at all counts as even.',
    },
    hint: {
      zh: '位拆分器把 a 拆成 b0..b3；先两两异或，再把两个结果异或起来，剩下的就是奇偶性。',
      en: 'A Splitter breaks a into b0..b3. XOR them in pairs, then XOR the two results together: what is left is the parity.',
    },
    allowedComponents: [
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
      'splitter',
      'maker',
      'const8',
      'level_input',
      'level_output',
    ],
    io: IO_A4_OUT1,
    checks: [truthTable(IO_A4_OUT1, { out: ({ a }) => onesIn(a ?? 0, 4) % 2 })],
    // 实测而非估算：参考解是一个位拆分器加三个异或——3 x 四与非异或单元
    // = 12 个 NAND 等价门——最长路径两层，因为两个成对异或都在第 1 层，合并异或
    // 在第 2 层，而位拆分器在两个指标上都是免费的。
    threeStar: { gate: 12, delay: 2, tick: 0 },
    rewards: { components: ['splitter', 'maker', 'const8'] },
  },

  /**
   * ch2-18-counting-signals —— 信号计数 / Counting Signals
   *
   */
  {
    id: 'ch2-18-counting-signals',
    chapter: 2,
    index: 18,
    name: { zh: '信号计数', en: 'Counting Signals' },
    brief: {
      zh: '四个彼此独立的一位信号。数出其中为高的个数，用三位二进制输出。',
      en: 'Four separate one-bit signals. Count how many are high and publish that count in three-bit binary.',
    },
    hint: {
      zh: '先半加 a 和 b、再半加 c 和 d。第 0 位是两个「和」的异或；第 1 位要把两个进位与「两个和的与」加在一起；第 2 位只在两个进位同时为高时才为高。',
      en: 'Half-add a with b, and c with d. Bit 0 is the XOR of the two sums; bit 1 adds the two carries together with the AND of the two sums; bit 2 is high only when both carries are.',
    },
    allowedComponents: [
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
      'splitter',
      'maker',
      'const8',
      'less_u',
      'equal8',
      'level_input',
      'level_output',
    ],
    io: IO_ABCD_OUT3,
    checks: [
      {
        kind: 'truth-table',
        rows: valueRows(IO_ABCD_OUT3, ({ a, b, c, d }) => (a ?? 0) + (b ?? 0) + (c ?? 0) + (d ?? 0)),
      },
    ],
    // 实测：第 16 关的树去掉位拆分器——五个 XOR（20 门）与四个 AND（8 门）
    // = 28 个 NAND 等价门、深度 3，位合并器免费。
    threeStar: { gate: 28, delay: 3, tick: 0 },
    rewards: { components: ['equal8'] },
  },

  /**
   * ch2-21-double-the-number —— 超级加倍 / Double the Number
   *
   * 目标测量所用的参考解是「接线」而不是「算术」：一个 `splitter` 加一个 `maker`
   * 把字节各重新编号到高一格，所以这关是 0 门 0 延迟，目标要说明的正是这一课——
   * 移位是免费的，加法不是（`add8(a, a)` 也能加倍，但要 72 门 1 延迟，只得一星）。
   * 移位元件是显而易见的工具，本项目故意把它留到第 2 章更晚的关卡才解锁。
   */
  {
    id: 'ch2-21-double-the-number',
    chapter: 2,
    index: 21,
    name: { zh: '超级加倍', en: 'Double the Number' },
    brief: {
      zh: '八位输入 a。输出它的两倍：整个字节左移一位，最低位补 0，最高位丢掉——溢出就溢出。',
      en: 'Eight-bit input a. Output twice its value: shift the whole byte one place left, fill the low bit with 0, drop the top bit. Overflow is overflow.',
    },
    hint: {
      zh: '左移是接线，不是算术：位拆分器拆开 a，位合并器把 b0..b6 接到第 1..7 位，第 0 位接低电平。',
      en: 'A left shift is wiring, not arithmetic: split a, feed b0..b6 into maker positions 1..7, and hold position 0 low.',
    },
    allowedComponents: [
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
      'splitter',
      'maker',
      'const8',
      'less_u',
      'equal8',
      'add8',
      'mul8',
      'level_input',
      'level_output',
    ],
    io: IO_A8_OUT8,
    checks: [{ kind: 'truth-table', rows: valueRows(IO_A8_OUT8, ({ a }) => ((a ?? 0) * 2) & 0xff) }],
    // 实测：接线参考解是 0 个 NAND 等价门、0 延迟——位拆分器、位合并器和常量在
    // 两个指标上都是免费的——所以这个目标就是下限；`add8(a, a)`（72 门、1 延迟）
    // 是本关奖励让它成为可能的一星替代解。
    threeStar: { gate: 0, delay: 0, tick: 0 },
    rewards: { components: ['add8', 'mul8'] },
  },
];
