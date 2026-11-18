import { truthTable } from '../../tables';
import type { LevelSpec } from '../../spec';

/**
 * 第 1 章第 7~13 关。
 *
 * 第 7 关是这半边唯一发放存储元件的关卡：第 8 关的谜题离不开 `delay_line`，
 * 而一关只能提供「更早关卡已经奖励过」的元件，所以解锁必须在这里发生。
 * 本章最后一关发放另一个存储元件，理由在下一章同样成立：`mem1` 是第 2 章锁存器关卡的
 * 基础，必须在第 2 章开始前就交到玩家手里。
 *
 * 两个收尾关卡是 2.x 结构新增的，两者都在补漏洞，而不是增加谜题：
 * `ch1-12-xnor-gate` 是发放 `xnor` 的地方；这个奖励原本挂在 `ch1-10-bigger-or-gate`
 *（三输入或门）上，可那一关根本没让玩家搭同或门。`ch1-13-logic-exam` 携带 `mem1`，
 * 它原本是第 2 章第一关的奖励——对于消费它的关卡来说晚了一整章。
 *
 * `and3` 做了同样的调整，理由相同：它原本是第 8 关的奖励，于是三输入与门在
 * `ch1-11-bigger-and-gate`（整关就是用两个二输入与门搭出它）之前三关就进了托盘。
 * 现在它是第 11 关的奖励，跟在「搭建」之后而不是提前给出答案，第 9~11 关也不再提供它。
 *
 * 所有文案均为本项目原创。
 */
const IO_CONST = { inputs: [], outputs: [{ id: 'out', width: 1 }] };
const IO_AB = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_ABC = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'c', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
/** 第 1 章第 7~13 关的关卡数据，按 `index` 顺序排列。 */
export const CH1_PART2: readonly LevelSpec[] = [
  {
    id: 'ch1-07-always-on',
    chapter: 1,
    index: 7,
    name: { zh: '长明灯', en: 'Always On' },
    brief: {
      zh: '永远为高。听起来简单——但这是你和电源之间的第一次握手。',
      en: 'Always high. Trivial, except it is your first handshake with the power rail.',
    },
    hint: { zh: '一个「高电平」元件就够了。', en: 'One Constant On part is enough.' },
    allowedComponents: ['const_on', 'level_input', 'level_output'],
    io: IO_CONST,
    checks: [truthTable(IO_CONST, { out: () => 1 })],
    threeStar: { gate: 0, delay: 0, tick: 0 },
    // `delay_line` 是第 8 关的全部内容，而本关是第 8 关唯一的前置关卡，
    // 所以解锁必须在这里发放——一关不能提供没有任何更早关卡奖励过的元件。
    rewards: { components: ['delay_line', 'xor'] },
  },
  {
    id: 'ch1-08-second-cycle',
    chapter: 1,
    index: 8,
    name: { zh: '第二周期', en: 'Second Cycle' },
    brief: {
      zh: '输出必须在第 0 拍为低，第 1 拍为低，从第 2 拍起为高。信号需要时间。',
      en: 'The output must read low at ticks 0 and 1, and high from tick 2 onward.',
    },
    hint: {
      zh: '延迟线在时钟沿把输入存下来再输出。串两条延迟线就是两拍。',
      en: 'A Delay Line latches its input on the clock edge. Two in series is two ticks.',
    },
    allowedComponents: ['const_on', 'delay_line', 'level_input', 'level_output'],
    io: IO_CONST,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, expect: { out: 0 } },
          { tick: 1, expect: { out: 0 } },
          { tick: 2, expect: { out: 1 } },
          { tick: 3, expect: { out: 1 } },
        ],
      },
    ],
    // `tick` 是检查所驱动到的最高节拍，不是电路的延迟：
    // 最后一步断言第 3 拍输出仍为高，所以每个通过检查的电路都会报 tick 3。
    // 真正钉住「两拍延迟」的是检查本身——单条延迟线在第 2 拍仍为低、会失败
    //（见错误电路测试）——因此目标必须写 3 才仍然可达成。
    threeStar: { gate: 0, delay: 0, tick: 3 },
    // 不发放奖励：`and3` 原本在这里发放，那正是这条注释要记录（而不是重复）的缺陷。
    // 本关的内容是两条延迟线；三输入与门在 `ch1-11-bigger-and-gate` 之前三关就进了
    // 托盘，而那一关正是要求玩家亲手搭出这个门。
    // 现在它是第 11 关的奖励，所以「获得」发生在「搭建」之后；第 9、10 关不再提供
    // 它们的谜题根本用不到的元件，第 11 关则故意不提供它，因为它就是那一关的答案。
  },
  {
    id: 'ch1-09-xor-gate',
    chapter: 1,
    index: 9,
    name: { zh: '异或门', en: 'XOR Gate' },
    brief: {
      zh: '两个输入不同时输出高。四个与非门就够了——考核者显然知道这件事。',
      en: 'High when the inputs differ. Four NANDs are enough, and the Assessor knows it.',
    },
    hint: {
      zh: 'NAND(a,b) 的结果再分别和 a、b 各与非一次，最后把两个结果与非起来。',
      en: 'Feed NAND(a,b) into two more NANDs with a and b, then NAND those two results.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'level_input',
      'level_output',
    ],
    io: IO_AB,
    // 「两个输入不同时输出高」，按本关 brief 的说法写。
    //（计划里曾写作 `a ^ b`，在这里无法通过类型检查：开启 `noUncheckedIndexedAccess`
    // 时，输入记录的下标访问类型是 `number | undefined`，位运算会拒绝它。）
    checks: [truthTable(IO_AB, { out: ({ a, b }) => (a === b ? 0 : 1) })],
    threeStar: { gate: 4, delay: 3, tick: 0 },
    rewards: { components: ['or3'] },
  },
  {
    id: 'ch1-10-bigger-or-gate',
    chapter: 1,
    index: 10,
    name: { zh: '三路或门', en: 'Bigger OR Gate' },
    brief: {
      zh: '三个输入里任意一个为高，输出就为高。',
      en: 'High when any of the three inputs is high.',
    },
    hint: {
      zh: '先用两个输入做一个或，再把结果和第三个或一次。级联是这一关的全部内容。',
      en: 'OR two of them, then OR the result with the third. Cascading is the whole lesson.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'xor',
      'level_input',
      'level_output',
    ],
    io: IO_ABC,
    checks: [truthTable(IO_ABC, { out: ({ a, b, c }) => (a || b || c ? 1 : 0) })],
    // 三星目标 = 参考解自身的指标；参考解恰好得到这个分数。
    // 门数 = 6 而不是 2：参考解把两个 OR 级联，每个 OR 折合 3 个 NAND 等价门。
    threeStar: { gate: 6, delay: 2, tick: 0 },
    // `xnor` 以前在这里发放，那正是这条注释要记录（而不是重复）的缺陷：
    // 三输入或门关卡用不到同或门，玩家根本没有搭过它，元件就进了托盘。
    // 2.x 结构给这个门单独设了一关（`ch1-12-xnor-gate`），现在在那里发放，
    // 本关不再发放任何奖励。
  },
  {
    id: 'ch1-11-bigger-and-gate',
    chapter: 1,
    index: 11,
    name: { zh: '三路与门', en: 'Bigger AND Gate' },
    brief: {
      zh: '三个输入都为高，输出才为高。',
      en: 'High only when all three inputs are high.',
    },
    hint: { zh: '与门可以级联，就像或门一样。', en: 'AND cascades exactly like OR does.' },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'xor',
      'or3',
      'level_input',
      'level_output',
    ],
    io: IO_ABC,
    checks: [truthTable(IO_ABC, { out: ({ a, b, c }) => (a && b && c ? 1 : 0) })],
    // 三星目标 = 参考解自身的指标；参考解恰好得到这个分数。
    // 门数 = 4 而不是 2：参考解把两个 AND 级联，每个 AND 折合 2 个 NAND 等价门。
    threeStar: { gate: 4, delay: 2, tick: 0 },
    // `and3` 是本关的奖励，而本关的托盘故意不提供它；这条规则与
    // `ch1-10-bigger-or-gate` 对 `or3` 的处理、以及 `ch1-12-xnor-gate` 的明文说明一致：
    // 一个「就是全部答案」的元件会让这一课变得毫无意义。
    // 本关的代价在指标上看得见——直接放一个 `and3` 相当于 4 个 NAND 等价门挂在同一
    // 节点上，于是它以 4 门 / 1 层延迟通过真值表并拿到三星，在延迟上压过两个 AND 级联。
    // `grade()` 无法区分两者（任何合法电路都会被评分），所以托盘是唯一能把这个元件挡在
    // 画板外的东西；`test/levels/ch1-part2.test.ts` 同时钉住两件事：托盘不含它，
    // 且直接放进去确实拿三星。
    rewards: { components: ['and3'] },
  },

  /**
   * ch1-12-xnor-gate —— 同或门 / XNOR Gate
   *
   * 有出处：两种语言的名称、位置（第 12 关，本章倒数第二关）。资料 §5 的表格完全没有
   * 给这一关概念行，所以下面的内容不是对它的翻译。
   *
   * 自创：`a b -> out` 的形状；四行真值表；托盘；实测的三星目标；以及 `xnor` 奖励——
   * 2.x 改版把它从 `ch1-10-bigger-or-gate` 挪到这里，原来那一关的内容是三输入或门，
   * 奖励会在玩家从未搭出所命名的门时送达。
   *
   * 本关谜题是异或门关卡的补集，托盘也说明了这一点：它等于 `ch1-09-xor-gate` 的清单
   * 加上 `and3`（第 11 关奖励）、`xor` 和 `nor`，再无其他。
   * 两种写法都合法且都能通过：用玩家已有的 NAND/AND/OR/NOT 家族搭出同或门，
   * 或者先 `xor` 再取反——提示里先写的是后者，目标也是按后者实测的。
   * 两者在深度上并不等价，下面的实测说明谁是谁。
   * `xnor` 本身不提供：关卡通过前，`paletteDefsFor` 会把关卡自己的奖励加回托盘，
   * 而「教这个门的关卡里直接放这个门」会让这一课变得毫无意义。
   * 本章这条规则的记录位置是 `ch1-10` 原来的奖励注释。
   */
  {
    id: 'ch1-12-xnor-gate',
    chapter: 1,
    index: 12,
    name: { zh: '同或门', en: 'XNOR Gate' },
    brief: {
      zh: '两个输入相同时输出高，不同时输出低。它和异或门只差一次取反。',
      en: 'High when the two inputs agree, low when they differ. It is the XOR gate with one inversion to spare.',
    },
    hint: {
      zh: '异或门的输出再取反就是同或门；也可以直接从与非门搭起：先把 a、b 各自与 NAND(a,b) 与非，再把这两个结果与非起来，最后取反。',
      en: 'Put a NOT after the XOR. Or build it from NANDs directly: NAND each input with NAND(a, b), NAND those two results together, and invert what comes out.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'nor',
      'const_on',
      'delay_line',
      'and3',
      'xor',
      'level_input',
      'level_output',
    ],
    io: IO_AB,
    // 「两个输入相同时输出高、不同时输出低」，按兄弟关卡 XOR 的写法写
    //（见那一关关于 `?? 0` 和 `noUncheckedIndexedAccess` 的说明）：
    // 用一次比较，而不是位运算符。
    checks: [truthTable(IO_AB, { out: ({ a, b }) => (a === b ? 1 : 0) })],
    // 实测：`xor`（经典四与非单元，折合 4 个 NAND 等价门）接一个 `not`（1 门）
    // ——5 门、路径两个元件深。只用与非门的写法实测同样是 5 门，但四个元件深
    //（NAND(a,b)；把它折回 a 和 b 的两个 NAND；这两个结果的 NAND；最后的反相器），
    // 所以它是「正确但只拿一星」的电路——两者都是 5 个 NAND 等价门，
    // 而目标区分的是深度：本章交给玩家的单元，对比玩家用与非门手工重建的单元。
    threeStar: { gate: 5, delay: 2, tick: 0 },
    rewards: { components: ['xnor'] },
  },

  /**
   * ch1-13-logic-exam —— 逻辑试炼 / Logic Exam
   *
   * 有出处：两种语言的名称、位置（第 13 关，第 1 章最后一关），以及资料里的一句话概念——
   * 综合测验，覆盖整章。这就是源资料固定的全部内容：没有指定函数、端口和奖励。
   *
   * 自创：测验要求的函数（三输入多数表决：`a`、`b`、`c` 中至少两个为高时输出高）、
   * `a b c -> out` 的形状、八行真值表、托盘、实测三星目标，以及 2.x 改版从
   * `ch2-14-binary-racer` 挪来的 `mem1` 奖励。
   * 源资料的「测验」只是一种形式，不是函数：这一关之所以是测验而不是又一个门，
   * 是因为托盘里没有任何单个元件能给出答案。AND、OR、NAND、NOR、XOR、XNOR、AND3、OR3
   * 每一个都至少不满足八行中的一行，所以玩家必须组合；而多数表决函数正是
   * 「一整章门电路搭建」收尾用的经典组合。
   *
   * 托盘就是整章，减去「会直接给出答案的元件」，再减去「本关要发放的元件」。
   * 这是刻意的，也正是它成为收尾关的原因：到第 13 关时玩家已经拥有第 1 章的全部元件，
   * 限制清单反而会把测验变成提示。`mem1` 被排除不只是因为它用不上——
   * 第 1 章自己的规则是「关卡不列出自己的奖励」
   *（`test/levels/level-buildability.test.ts` 会遍历检查），而且这关没有任何检查推进
   * 时钟，这个元件在这里也确实帮不上忙。
   *
   * 目标取「共享项」的搭法，而不是最小门数：三个两两相与各接一个 `or3`，
   * 即 3 x 2 + 6 = 12 个 NAND 等价门、路径两层深；同样三个项用两个 OR 级联也是 12 门，
   * 但路径三层深，所以实测目标区分的是共享 OR3 这种搭法。
   * 10 门、三层的 ((a AND b) OR (c AND (a OR b))) 写法门数更小，却只拿一星：
   * 它是记录在案的替代写法，不是目标的漏洞；而目标本身就是参考解的实测值。
   */
  {
    id: 'ch1-13-logic-exam',
    chapter: 1,
    index: 13,
    name: { zh: '逻辑试炼', en: 'Logic Exam' },
    brief: {
      zh: '三个输入 a、b、c。其中至少两个为高时输出为高，只有一个或一个都没有时为低——这是一次覆盖整章的试炼：没有任何一颗元件能单独给出答案。',
      en: 'Three inputs, a, b and c. The output is high when at least two of them are high, and low when only one is -- or none. It is an exam over the whole chapter: no single part in the palette is the answer.',
    },
    hint: {
      zh: '先两两相与，得到 a·b、a·c、b·c 三个「有一对为高」的信号，再把三者或起来。三个与门加一个三路或门就够；用两个二路或门级联也行，只是深一层。',
      en: 'AND the inputs in pairs first -- ab, ac and bc are the three "a pair agreed" signals -- then OR all three together. Three ANDs and one 3-input OR is enough; two cascaded 2-input ORs do the same job one level deeper.',
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
    io: IO_ABC,
    // 多数表决函数，按它的定义写，而不是写成位技巧：三个输入里至少两个为高。
    // 所有行都被枚举（2^3 行，没有抽样），所以把「多数」与「或」区分开的那一行
    //（恰好一个输入为高）和与「与」区分开的那一行（恰好两个）都在表里。
    checks: [
      truthTable(IO_ABC, { out: ({ a, b, c }) => ((a ?? 0) + (b ?? 0) + (c ?? 0) >= 2 ? 1 : 0) }),
    ],
    // 实测：三个两两相与（各 2 门）接一个 `or3`（6 门）= 12 个 NAND 等价门，
    // 路径两层深。同样三项用两个 OR 级联实测 12 门、3 层，所以目标区分了托盘邀请的
    // 两种搭法；上面提到的「三元件但更深」的替代写法是 10 门、3 层。
    threeStar: { gate: 12, delay: 2, tick: 0 },
    // `mem1` 是第 1 章最后一次发放，因为第 2 章的锁存器关卡是第一个需要它的电路，
    // 而一关只能提供更早关卡已经奖励过的元件。
    // 在 2.x 改版之前，这个奖励挂在 `ch2-14-binary-racer` 上——那是第 2 章第一关，
    // 于是元件在「需要它的关卡」之后一关才进入托盘。
    rewards: { components: ['mem1'] },
  },
];
