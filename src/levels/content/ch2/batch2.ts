import type { FuzzVector, LevelSpec } from '../../spec';
// `LevelIo`——引脚形状——来自 `tables.ts`；`checks.ts` 还导出了一个同名的运行时接口
//（已绑定仿真的接口），两者不能混淆。
import { truthTable, type LevelIo } from '../../tables';

/**
 * 第 2 章第 19、22、25、26、27 关：字节级运算符与加法器——八位算术从这里开始，
 * 也是 `fuzz` 检查器（第 25、26、27 关）独当一面的批次。
 *
 * 托盘规则在这里只详细写一次，因为后面的批次都会继承它。一关的托盘只由三样东西
 * 构成，别无其他：
 *
 *  * 它继承的货架——下面那些具名清单，也就是更早关卡传下来的东西：`GATES_1BIT`、
 *    `BYTE_WIRING`、`WIDE_OPS`，以及第 25、26 关解锁的字节运算符。货架是精选的，
 *    不是「玩家拥有的全部」：`mem1` 这个第 1 章带状态的位元件从第 12 关起就解锁，
 *    但本批没有一关列出它，因为本批没有任何检查推进时钟——而 `delay_line` 却留在
 *    货架上，因为第 1 章的托盘提供过它。
 *  * 加上关卡自己的奖励（在通过前就提供）。第 16 关的位拆分器是命名这条规则的那个
 *    例子；第 25 关提供它发放的四个字节运算符，第 19 关提供它奖励的 `full_adder`。
 *  * 减去任何「不是本关奖励、而且能单独答出本关」的元件。本批有两关用了这条减法，
 *    且都在各自注释里写明：第 27 关不给 `add8`（第 21 关的奖励，与本关 I/O 形状完全
 *    相同，放一颗即可），第 22 关不给 `full_adder`（放一颗就是那关的精确 I/O）。
 *    第 27 关反而提供 `full_adder`，因为那里一颗实例并不是答案——八颗实例以及它们
 *    之间的进位链才是本关要教的级联——这与写减法时的标准是同一条。
 *
 * 注册该定义的那个任务该交代什么，以及每个答案落在哪里：这段注记曾经悬而未决的两个
 * 决定现在都做了，第二个还做了两次。元件在第 19、27 关提供。第 22 关的目标最终确实
 * 按级联重新实测了：`threeStar` 是参考解自身的测量，现在参考解就是级联，而曾经占据
 * 这个名号的「手工接线链」作为记录在案的替代写法保留——120/17 正确，但只拿一星，
 * 因为目标是级联的 72/8。理由正是这段注记当年记录却没有照做的那条：一个被更便宜
 * 合法解击败的已发布目标，不是它自己注释所声称的那个目标。将来若某章想把
 * `full_adder` 放进托盘，那是一个新决定；本批没有任何东西在等它。
 *
 * 这里每一关都是纯组合逻辑，所以每个三星目标的 `tick` 都是 0，理由与批次 1 所说
 * 一样：本批没有任何检查推进时钟，所以该指标确实是 0，其目标永远不会成为玩家拿不到
 * 三星的原因。真正起作用的是 `gate` 和 `delay`，下面每个目标都是参考解自身的实测
 * 分数——测试文件里的「three-star targets are the reference solutions own metrics」
 * 用数字而不是承诺来保证这一点。
 */

/**
 * 本批每一关都从中取材的一比特货架：第 1 章的门、两个常量和延迟线，顺序与第 1 章
 * 发放它们时一致。`delay_line` 之所以提供，是因为第 1 章的托盘提供过它；本批没有
 * 任何检查推进时钟，所以下面没有任何一关用得上它。
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

/** 批次 1 第 16 关解锁的东西：两个字节打包器与字节常量。 */
const BYTE_WIRING = ['splitter', 'maker', 'const8'] as const;

/** 批次 1 第 15~17 关解锁的宽位运算符。它们都不是字节逻辑。 */
const WIDE_OPS = ['less_u', 'equal8', 'add8', 'mul8'] as const;

/**
 * 本批开头要教的四个字节运算符，第 25、26、27 关都会提供。
 *
 */
const BYTE_AND_OR = ['and8', 'or8', 'nand8', 'nor8'] as const;

/**
 * 本批用到的五种引脚形状，这样一关的 io 就是一个有名字的常量，
 * 而不是写在 spec 中间的两行字面量。
 */
const IO_A8_B8_OUT8: LevelIo = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_A8_OUT8: LevelIo = {
  inputs: [{ id: 'a', width: 8 }],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_A1_B1_SUM1_CARRY1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
  ],
  outputs: [
    { id: 'sum', width: 1 },
    { id: 'carry', width: 1 },
  ],
};
const IO_A1_B1_CIN1_SUM1_COUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'cin', width: 1 },
  ],
  outputs: [
    { id: 'sum', width: 1 },
    { id: 'cout', width: 1 },
  ],
};
const IO_A8_B8_CIN1_OUT8_COUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
    { id: 'cin', width: 1 },
  ],
  outputs: [
    { id: 'out', width: 8 },
    { id: 'cout', width: 1 },
  ],
};

/**
 * 每关一个 fuzz 种子：高字节是关卡序号，低字节是字节宽度。
 *
 * 用固定字面量而不是随机抽取：同一个种子在每次运行、每次修改画板后都产生同样的
 * 向量，这才让 fuzz 关卡的覆盖范围成为「关卡的事实」而不是「本次运行的事实」。
 * 取值互不相同，所以一关的序列绝不会是另一关的。
 *
 * `SEED_25` 是新关卡的种子，它字面照搬了约定：第 25 关、八位引脚。另外两个保留了
 * 编写时的值，即使改版重新编号了它们的关卡（`ch2-26-byte-not` 仍取 0x1908，
 * `ch2-27-adding-bytes` 仍取 0x2208），这是刻意而非疏忽：种子是一个序列而不是
 * 标签，按新序号重新推导会悄悄改变关卡覆盖的向量。被淘汰的 8 位或门关卡的
 * `SEED_18` 随关卡一起消失——未使用的字面量在这里是编译错误（`noUnusedLocals`），
 * 等于编译器替这次清理把活干了。
 */
const SEED_19 = 0x1908;
const SEED_22 = 0x2208;
const SEED_25 = 0x2508;

/**
 * 第 22 关的期望值，之所以命名，是因为两个引脚由同一个和算出：低字节与第九位
 * 不可能对「这次加法是否溢出」给出不一致的说法，正如 `add8` 的两个引脚不会那样。
 *
 * 两个值都不靠掩码掩盖编写错误——内核会拒绝不符合引脚位宽的期望值，而不是把它
 * 缩减。移位是让「第九位」塞进 1 位引脚的手段：向量都在 8 位和 1 位引脚范围内，
 * 所以 `a + b + cin` 最大 511，`>> 8` 恰好是第 8 位，上面没有东西需要丢弃。
 */
const SUM_LOW_BYTE = (v: FuzzVector): number => ((v.a ?? 0) + (v.b ?? 0) + (v.cin ?? 0)) & 0xff;
const SUM_CARRY_OUT = (v: FuzzVector): number => ((v.a ?? 0) + (v.b ?? 0) + (v.cin ?? 0)) >> 8;

/** 第 2 章本批次的关卡数据，按 `index` 顺序排列；章节顺序由 `ch2/index.ts` 汇合、`content/index.ts` 统一排序。 */
export const CH2_BATCH2: readonly LevelSpec[] = [
  /**
   * ch2-19-half-adder —— 半加器 / Half Adder
   *
   * id 叫 `half-adder` 而奖励不是，这是任务书的决定，也是规格 3.3 的第 2 章清单：
   * 没有 `half_adder` 元件，本关发放的元件，正好是它自己这一课「差一个进位」的那颗。
   *
   * `full_adder` 的定义在本关编写时缺失，现在不再缺失。当时这个 id 只是没有任何
   * 实现支撑的奖励数据，所以没有托盘能显示它；`523a7b9` 在 `src/core/defs/index.ts`
   * 注册了该定义，定价 9 个 NAND 等价门，基准是 `FULL_ADDER`——`wide.ts` 也用同一
   * 基准给 `add8` 定价。哪些关卡提供它也已确定——本关（它自己的奖励）与第 22 关
   *（为它而存在的级联）；模块注记记录了来龙去脉并指向测量。在这里提供它不会放宽
   * 目标：把 `cin` 接低的全加器是 9 个 NAND 等价门，而本关是 6 门，所以它与批次 1
   * 为第 21 关 `add8(a, a)` 记录的一星替代解同类。第 22 关是唯一扣下它的关卡，
   * 其注释说明了原因。
   */
  {
    id: 'ch2-19-half-adder',
    chapter: 2,
    index: 19,
    name: { zh: '半加器', en: 'Half Adder' },
    brief: {
      zh: '两个一位输入 a 和 b。把它们相加：和放在 sum 上，进位放在 carry 上——两个 1 相加得 0，并向高位进 1。',
      en: 'Two one-bit inputs, a and b. Add them: the sum goes on sum and the carry on carry -- one plus one is zero and carries one.',
    },
    hint: {
      zh: '和就是异或：两个输入不同时才为 1。进位是与：两个都为 1 才为 1。两条线各算各的，别让进位混进和里。',
      en: 'The sum is XOR -- 1 only when the two inputs differ. The carry is AND -- 1 only when both are. Compute them separately, and keep the carry out of the sum.',
    },
    allowedComponents: [...GATES_1BIT, 'full_adder', ...LEVEL_IO],
    io: IO_A1_B1_SUM1_CARRY1,
    checks: [
      truthTable(IO_A1_B1_SUM1_CARRY1, {
        sum: ({ a, b }) => (a ?? 0) ^ (b ?? 0),
        carry: ({ a, b }) => (a ?? 0) & (b ?? 0),
      }),
    ],
    // 实测：两个关卡引脚各接一个 XOR（4 门）与一个 AND（2 门），两者并行
    // ——6 个 NAND 等价门、一层深。两者在记录在案的基准上都是标准单元，
    // 所以 6 是任何纯与非半加器的下限。
    threeStar: { gate: 6, delay: 1, tick: 0 },
    rewards: { components: ['full_adder'] },
  },

  /**
   * ch2-22-full-adder —— 全加器 / Full Adder
   *
   * 为什么这里不提供 `full_adder`——已定案，此前曾有过把它同时给第 21、22 关的
   * 裁定，后来改成去掉第 21 关。从未落到本关的那条理由是「第 27 关的课是级联」：
   * 第 27 关的级联在本关下游，不构成对本关的论据。真正决定的是本关自己的成就。
   * 该元件的一颗实例恰好就是本关的 I/O（`a:1 b:1 cin:1 -> sum:1 cout:1`），所以
   * 直接放一颗就能得分，却跳过了它存在的目的——五个元件的教学；而且按注册的
   * 9-NAND 单元计算，它实测 9 门、1 层延迟，对比 15 门 3 层的目标，等于玩家没搭过的
   * 元件拿三星，这会让五元件这一课变得空洞，而不只是变简单。所以元件在第 19 关
   *（它自己的奖励）和第 22 关提供——那里八颗实例正是该关要求的级联——并在本关
   * 扣下，这是它唯一能独自答出谜题的地方。`neg8` 按批次 1 第 14 关的理由排除：
   * 本关每个引脚都是一位宽，八位元件没有东西可接。
   */
  {
    id: 'ch2-22-full-adder',
    chapter: 2,
    index: 22,
    name: { zh: '全加器', en: 'Full Adder' },
    brief: {
      zh: '三个一位输入 a、b、cin。先把 a 和 b 相加，再把 cin 加进来：和放 sum，向高位的进位放 cout。',
      en: 'Three one-bit inputs: a, b and cin. Add a to b, then add cin to that. The sum goes on sum and the carry out on cout.',
    },
    hint: {
      zh: '两个半加器接起来：a 与 b 半加得到中间和，中间和再与 cin 半加就是 sum；两个半加器的进位相或就是 cout。五个元件就够。',
      en: 'Two half adders in a row: half-add a with b, then half-add that result with cin to get sum; OR the two carries together for cout. Five components are enough.',
    },
    allowedComponents: [...GATES_1BIT, ...LEVEL_IO],
    io: IO_A1_B1_CIN1_SUM1_COUT1,
    checks: [
      truthTable(IO_A1_B1_CIN1_SUM1_COUT1, {
        sum: ({ a, b, cin }) => (a ?? 0) ^ (b ?? 0) ^ (cin ?? 0),
        // 与参考解相同的构造，写成它计算的函数：进位是「两个输入相与，
        // 或者两个输入不同时，由输入差异放行的进位输入」。
        cout: ({ a, b, cin }) =>
          ((a ?? 0) & (b ?? 0)) | ((cin ?? 0) & ((a ?? 0) ^ (b ?? 0))),
      }),
    ],
    // 实测：五元件参考解——xor、and、xor、and、or——是 15 个 NAND 等价门，
    // 成就的映射结果。
    threeStar: { gate: 15, delay: 3, tick: 0 },
    rewards: { components: ['neg8'] },
  },

  /**
   * ch2-25-byte-nand —— 单字节与非 / Byte NAND
   *
   * 这个函数就是「每位一个与非门」，所以它是这一族的头部而不是成员之一：
   * `and8` / `or8` / `nand8` / `nor8` 是同一个位切片思想的四种写法，而与非门正是
   * 整个游戏成本基准计价所用的门。参考解是每个操作数一个位拆分器、八个 `nand`
   * 和一个位合并器：8 个 NAND 等价门、路径一个元件深，打包器与关卡引脚在两个指标上
   * 都免费。
   *
   * 四个字节运算符会被提供，这是「自己的奖励」规则而不是意外。`paletteDefsFor` 会在
   * 关卡通过前把它的奖励交给它，所以玩家可以直接放入 `nand8`——而它恰好与参考解
   * 打平，因为按记录在案的基准，一颗字节宽与非单元就是每位一个与非门：实测
   * `gate: 8, delay: 1`，与八门电路得分相同。提供另外三个对本关没有代价
   *（它们没有一个能单独算出与非门，而货架本来是按获得情况提供的），目标仍然能
   * 区分的是同一个字节「正确但更贵」的写法——`nor8(a, a)` 是四与非单元，
   * 同一个答案要 32 门，正是第 26 关为自己那份单元记录的价格。这与本批第 27 关对
   * `full_adder` 的交易相同：当元件就是关卡自己的奖励时，直接放入是被提供的；
   * 即便打平也不会让这一课空洞，因为这一课是它以简写代表的位切片构造。
   */
  {
    id: 'ch2-25-byte-nand',
    chapter: 2,
    index: 25,
    name: { zh: '单字节与非', en: 'Byte NAND' },
    brief: {
      zh: '两个八位输入 a、b，一个八位输出 out。把两个字节逐位与非：只有当某一位上 a 和 b 同时为 1 时，out 的该位才是 0，其余各位都是 1。',
      en: 'Two eight-bit inputs a and b, one eight-bit output. NAND them bit by bit: a bit of out is 0 only where both a and b are 1 at that position, and 1 everywhere else.',
    },
    hint: {
      zh: '用位拆分器把 a 和 b 各拆成八位，每一位配一个与非门，八个结果再用位合并器拼回一个字节。也可以直接用这一关发给你的 nand8：一颗就是那八个与非门。',
      en: 'Split both bytes with a Splitter, NAND each pair of bits, and pack the eight results back with a Maker. Or drop in the nand8 this level hands out: one instance is exactly those eight NANDs.',
    },
    allowedComponents: [...GATES_1BIT, ...BYTE_WIRING, ...WIDE_OPS, ...BYTE_AND_OR, ...LEVEL_IO],
    io: IO_A8_B8_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_25,
        rounds: 256,
        inputs: {
          a: (sample) => sample.a ?? 0,
          b: (sample) => sample.b ?? 0,
        },
        // 单独的 `~(a & b)` 是负的 int32，而内核会拒绝不符合引脚位宽的期望值，
        // 不会替它缩减，所以作者自己写的 `& 0xff` 才是这个检查能跑起来的原因——
        // 与第 26 关在 `~a` 前面携带的掩码一样，是必不可少的。
        outputs: { out: (v) => ~((v.a ?? 0) & (v.b ?? 0)) & 0xff },
      },
    ],
    // 实测：每位一个与非门——8 x 1 = 8 个 NAND 等价门——前面是每个操作数一个免费
    // 位拆分器和一个免费位合并器，路径一层深。`nand8`（本关自己的奖励）恰好打平；
    // 四与非单元的那些写法才是目标区分出来的，上面的注释说明了是哪些。
    threeStar: { gate: 8, delay: 1, tick: 0 },
    rewards: { components: ['and8', 'or8', 'nand8', 'nor8'] },
  },

  /**
   * ch2-26-byte-not —— 单字节非门 / Byte NOT
   *
   * 目标会区分一部分正确解法，也会放过另一部分正确解法，这段注释说明是哪些。
   * 八个 NOT 实测 8 个 NAND 等价门、深度 1，本关发放的 `not8` 也一样，`nand8(a, a)`
   * 也一样——后者是第 18 关的奖励，也是刚接触宽位家族的玩家最可能想到的答案，
   * 因为按同一份记录在案的基准，一颗与非单元就是每位一个与非门。这三种写法在这个
   * 指标上是同一个电路，所以目标把三者都算三星；它不放过的是用四与非单元搭出的
   * 同一函数——`nor8(a, a)` 是 `~(a | a)`，一个正确的字节非门，但要 32 门，只得一星。
   * 两半都在测试文件里被断言，因为一个所有正确解法都能满足的目标就测不出这一课。
   */
  {
    id: 'ch2-26-byte-not',
    chapter: 2,
    index: 26,
    name: { zh: '单字节非门', en: 'Byte NOT' },
    brief: {
      zh: '一个八位输入 a。把它的每一位取反：0 变 1，1 变 0，八位一起翻过来。',
      en: 'One eight-bit input a. Invert every bit: 0 becomes 1 and 1 becomes 0, all eight at once.',
    },
    hint: {
      zh: '位拆分器拆开后，每一位各接一个非门，再合并回一个字节。也可以让每一位与 1 异或——两条路都要记得第 7 位。',
      en: 'Split it, invert each bit with its own NOT, then pack the eight results back. XORing each bit with 1 does the same job; either way, do not lose bit 7.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      ...WIDE_OPS,
      ...BYTE_AND_OR,
      'xor8',
      'xnor8',
      'not8',
      ...LEVEL_IO,
    ],
    io: IO_A8_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_19,
        rounds: 256,
        inputs: { a: (sample) => sample.a ?? 0 },
        // 单独的 `~a` 在 a=0 时是 -1，塞不进 8 位引脚，所以这个掩码是期望值的定义
        // 而不是顺手写的便利。
        outputs: { out: (v) => ~(v.a ?? 0) & 0xff },
      },
    ],
    // 实测：每位一个 NOT——8 x 1 = 8 个 NAND 等价门——前面是免费的位拆分器与
    // 位合并器，路径一层深。`not8` 打平，`nand8(a, a)` 也打平（按记录在案的基准，
    // 一颗与非单元就是每位一个与非门，所以三种写法在这个指标上是同一个电路）；
    // 上面的段落和测试文件说明了目标区分什么、不区分什么。
    threeStar: { gate: 8, delay: 1, tick: 0 },
    rewards: { components: ['xor8', 'xnor8', 'not8'] },
  },

  /**
   * ch2-27-adding-bytes —— 单字节加法 / Adding Bytes
   *
   * 本关过去引用的手工接线链，现在成了记录在案的替代写法。旧参考解是八个手工搭建的
   * 全加器——即第 22 关教的五元件构造，8 x (4 + 2 + 4 + 2 + 3) = 120 个 NAND 等价门、
   * 路径 3 + 2 x 7 = 17 层——而 `threeStar` 过去就是 120/17。注册 `full_adder`
   *（`523a7b9`）并在这里提供它之后，已发布的参考解被一个更便宜的合法解「支配」了：
   * 八颗该实例实测 72/8，在两个计分指标上都严格更好，所以 120/17 的目标不可能再是
   * 这段注释所声称的东西——`threeStar` 是参考解的测量，而参考解不再是本关托盘能搭出
   * 的最优电路。现在参考解是级联，`threeStar` 是它的测量；手工接线链留在参考解夹具里
   *（`test/fixtures/ch2-references.ts`，`handWiredAdderReference`），仍参与评分，
   * 现在只拿一星而不是三星（120 > 72 且 17 > 8），这是一个区分两种正确构造的目标，
   * 而不是形式主义。本关教的内容不变：两种写法里的八级进位链和第九位，接法相同。
   *
   * 为什么托盘扣下一个元件、提供另一个，这是设计决定而不是疏忽：
   *
   * 玩家宽位货架上的其余元件即使组合起来也加不了两个字节，仍然照常提供：第 18、19 关
   * 解锁的七个字节运算符（`and8`、`or8`、`nand8`、`nor8`、`xor8`、`xnor8`、`not8`）、
   * `mul8`、`less_u`、`equal8`、`neg8`，以及本关自己发放的两个开关。这也是批次 1 的
   * 规则——它在用不上 `less_u` 和 `equal8` 的关卡上照样提供它们——字节运算符列在这里
   * 出于同一理由而不是被省略：它们的引脚能接上，没有一个能做加法，而货架是按获得
   * 情况提供的。
   */
  {
    id: 'ch2-27-adding-bytes',
    chapter: 2,
    index: 27,
    name: { zh: '单字节加法', en: 'Adding Bytes' },
    brief: {
      zh: '两个八位输入 a、b 和一个一位输入 cin。把三者全部相加：结果的低八位放在 out 上，第九位（也就是进位）放在 cout 上。',
      en: 'Two eight-bit inputs a and b, plus a one-bit cin. Add all three: the low eight bits of the result go on out, and the ninth bit -- the carry -- goes on cout.',
    },
    hint: {
      zh: '把前面两个加法器排成一行：第 0 位吃 cin，每一位算出的进位接给下一位的 cin，最高位剩下的进位就是 cout。',
      en: 'Line the adders up in a row: bit 0 takes cin, each bit hands its carry to the next bit, and the carry left over at the top is cout.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      ...BYTE_AND_OR,
      'xor8',
      'xnor8',
      'not8',
      'less_u',
      'equal8',
      'mul8',
      'full_adder',
      'neg8',
      'switch',
      'switch8',
      ...LEVEL_IO,
    ],
    io: IO_A8_B8_CIN1_OUT8_COUT1,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_22,
        rounds: 256,
        inputs: {
          a: (sample) => sample.a ?? 0,
          b: (sample) => sample.b ?? 0,
          cin: (sample) => sample.cin ?? 0,
        },
        outputs: { out: SUM_LOW_BYTE, cout: SUM_CARRY_OUT },
      },
    ],
    // 实测：参考解是八颗 `full_adder` 组成的行波链——8 x 9 = 72 个 NAND 等价门，
    // 进位路径上每位一个元件，所以延迟是 8——位拆分器、位合并器和关卡引脚免费。
    // 本关过去引用的手工接线五元件链实测 120 和 17，现在是记录在案的替代写法：
    // 正确、满足通过条件，但只拿一星，因为目标是 72/8。
    threeStar: { gate: 72, delay: 8, tick: 0 },
    rewards: { components: ['switch8'] },
  },
];
