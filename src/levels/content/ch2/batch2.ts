import type { FuzzVector, LevelSpec } from '../../spec';
// `LevelIo`——引脚形状——来自 `tables.ts`；`checks.ts` 还导出了一个同名的运行时接口
//（已绑定仿真的接口），两者不能混淆。
import { truthTable, type LevelIo } from '../../tables';

/**
 * 第 2 章第 19、22、25、26、27 关：字节级运算符与加法器——八位算术从这里开始，
 * 也是 `fuzz` 检查器（第 25、26、27 关）独当一面的批次。
 *
 * 本批次重新编号，并新增了一关。2.x 改版把这些关卡挪到它们的全局位置
 *（19、22、25、26、27），淘汰了原本打头的 8 位或门关卡，并在批次头部补上了
 * `ch2-25-byte-nand`。那一新关卡不完全是新谜题，更像是旧奖励的新落点：四个字节
 * 运算符 `and8` / `or8` / `nand8` / `nor8` 原本是被淘汰关卡发放的，而没有任何关卡
 * 奖励的元件永远进不了托盘，所以这一族搬到了字节与非关卡，由之后需要它们的每一关
 * 提供。
 *
 * 源资料固定了什么、没有固定什么。与批次 1 相同：资料集对这几关只给三样东西——
 * 名称（中英文）、在本章中的位置、以及一行教学概念。它没有端口、位宽、通过条件、
 * 目标和奖励。下面其余内容都是本项目的设计，由名称和那一行概念推导而来——所以
 * 每一关都带一段分成 `SOURCED` 与 `AUTHORED` 的数据注释，
 * `test/levels/ch2-batch2.test.ts` 在缺少任一标记时失败。本文件里的任何数字都不能
 * 被说成是源资料自己的。
 *
 * 本批次有两条源资料注记是「成就」而不是通过条件，两者都作为记录保留、未被当成
 * 目标：
 *
 *  * 第 22 关的是「仅用 5 个蓝色元件」。本项目没有蓝色元件体系——「蓝色」元件是玩家
 *    自造的自定义/蓝图元件，要到后续阶段才出现——所以这条成就被映射成一个实测的
 *    `threeStar.gate` 阈值，参考解就是成就描述的五元件电路。映射写在该关注释里，
 *    并由测试文件实测。
 *  * 第 27 关的是「延迟 ≤ 35」。35 作为源资料的参考值记录在该关注释里；`threeStar`
 *    是本项目对自身参考解的实测——八个 `full_adder` 级联，72 门、8 层延迟——注释里
 *    说清了这一点。
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
 * `full_adder`：历史，以及仍然有效的事实。这段注记曾经说「这个 id 没有任何注册的
 * 定义」，在本批次编写时是真的，从 `523a7b9` 起变成假的——那个提交注册了这个定义。
 * 当时确实不存在：奖励是数据，所以第 19 关可以发放一个无人实现的 id，元件只是不可见
 * 而不是非法（`paletteDefsFor` 会把托盘与已解锁集合求交，`ui/palette.ts` 会丢弃
 * `registry.has` 拒绝的 id）。`523a7b9`「feat(defs): register the full_adder that
 * level 20 rewards」把它加进 `src/core/defs/index.ts`：一个 `logic1` 门，引脚
 * `a:1 b:1 cin:1 -> sum:1 cout:1`，定价 `gateCost: FULL_ADDER`——折合 9 个 NAND
 * 等价门，也就是 `wide.ts` 导出的常量，`add8` 也按它的八倍定价——并由 `DEF_IDS`
 * 收录。它在哪里提供也已经定案，两关正好是上面规则的两半：第 19 关（它自己的奖励，
 * 把 `cin` 接低时是 9 门的一星替代解，对应该关的 6 门）和第 27 关（消费它的级联，
 * 八颗实例实测 72 门、8 层延迟，正是该关 `threeStar` 现在的测量来源；旧值是手工接线
 * 链的 120/17，现在作为该关记录在案的替代写法，只拿一星）。第 22 关是唯一扣下它的
 * 关卡，其注释说明了原因：那里一颗实例就是该关的精确 I/O，会拿到源资料「五元件」
 * 成就映射出的 15 门目标。
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
 * 它们原本是 `ch2-18-byte-or` 的奖励，直到 2.x 改版淘汰了那一关。奖励是数据，
 * 所以这一族本可以随关卡一起被删掉——而这恰恰是绝不能发生的：`and8`、`or8`、
 * `nand8`、`nor8` 都已注册、定价，并被设计规格的第 2 章解锁行点名，而没有任何关卡
 * 发放的元件永远进不了托盘。`ch2-25-byte-nand` 就是它们现在被发放的地方。
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
   * SOURCED（有出处）：两种语言的名称、位置（第 20 关），以及概念——和与进位，即两个一位值
   * 相加产生的两个信号。
   *
   * AUTHORED（自创）：`a:1 b:1 -> sum:1 carry:1` 形状（两个输出引脚，所以输出绑定为
   * `OUT_sum` / `OUT_carry`）；四行表，由 `truthTable` 构建，它会拒绝留下未比较
   * 声明输出引脚的表；实测三星目标；以及 `full_adder` 奖励。检查类型来自任务书，
   * 行由本文件编写。
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
   * SOURCED（有出处）：两种语言的名称、位置（第 21 关）、概念（接受进位输入的一位加法器），
   * 以及本批次里源资料唯一给出的数字注记——成就「仅用 5 个蓝色元件」。
   *
   * AUTHORED（自创）：`a:1 b:1 cin:1 -> sum:1 cout:1` 形状；八行表；实测三星目标；`neg8` 奖励；
   * 以及托盘。
   *
   * 这条成就如何映射，写在这里，因为源资料注记不是通过条件，而本项目也没有蓝色
   * 元件体系：源资料里的「蓝色元件」是玩家自造的自定义/蓝图元件，在本项目里要到
   * 后续阶段才出现。因此注记被重新表达成它所描述的五元件电路的实测
   * `threeStar.gate` 阈值——两个 XOR、两个 AND 和一个 OR，也就是经典全加器：
   * 4 + 2 + 4 + 2 + 3 = 15 个 NAND 等价门，路径三层。测试文件里的参考解就是那个
   * 电路，并断言它恰好是这五个元件，所以映射是测量而不是声称。
   * 注意这个映射值是什么、不是什么：源资料的 5 是元件数，15 是 NAND 等价门数，
   * 目标统计的是后者——所以它不会因为多了第六个元件就扣分。六个元件合计 6 个
   * NAND 等价门仍在 15 以内，照样通过；目标区分的是标准单元的 15 与同一函数的
   * 任何 NAND 等价门更多的正确写法。
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
    // 最长路径是进位：XOR、AND、OR = 深度 3。门数是上面描述的源资料五元件
    // 成就的映射结果。
    threeStar: { gate: 15, delay: 3, tick: 0 },
    rewards: { components: ['neg8'] },
  },

  /**
   * ch2-25-byte-nand —— 单字节与非 / Byte NAND
   *
   * SOURCED（有出处）：两种语言的名称、位置（第 25 关，本章第 12 关），以及资料的一句话概念——
   * 8 位位运算，即字节宽度下的位运算符。如同本批其他关卡：端口、位宽、通过条件与
   * 奖励都不来自源资料。
   *
   * AUTHORED（自创）：`a:8 b:8 -> out:8` 形状；fuzz 检查（种子、256 轮、带掩码的期望值）；
   * 托盘；实测三星目标；以及四个奖励——它们来自被淘汰的 `ch2-18-byte-or`，
   * 原因见上面的模块注记和 `BYTE_AND_OR` 辅助常量。
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
   * SOURCED（有出处）：两种语言的名称、位置（第 19 关），以及概念——把字节的每一位取反。
   *
   * AUTHORED（自创）：`a:8 -> out:8` 形状；fuzz 检查（种子、256 轮，以及带掩码的期望值——
   * 这里的掩码是必需的而不是装饰，因为 `~a` 是负的 int32，而内核会拒绝不符合引脚
   * 位宽的期望值，不会替它掩码，所以作者自己写的 `& 0xff` 才是这个检查能跑起来的
   * 原因）；实测三星目标；以及三个奖励。
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
   * SOURCED（有出处）：两种语言的名称、位置（第 22 关）、概念（把一位加法器级联成字节加法器），
   * 以及它的成就注记——「延迟 ≤ 35」，源资料自己的参考值：延迟不超过 35。
   *
   * AUTHORED（自创）：`a:8 b:8 cin:1 -> out:8 cout:1` 形状；fuzz 检查（种子、256 轮以及两个
   * 期望函数，它们由同一个和算出，所以两个引脚不会对溢出给出不同说法）；参考解与
   * 实测三星目标；两个奖励；以及托盘。
   *
   * 参考解是八颗 `full_adder` 实例组成的行波链，目标就是它自身的测量。每一位一级，
   * 每级的 `cout` 接到下一级的 `cin`，八个 `sum` 引脚由位合并器打包：
   * 8 x 9 = 72 个 NAND 等价门，进位路径八个元件深——按注册元件自身的基准
   *（`wide.ts` 里的 `FULL_ADDER`，也就是给 `add8` 按八倍定价的同一个 9），
   * 实测为 `gate: 72, delay: 8, tick: 0`。位拆分器、位合并器和关卡引脚在两个指标上
   * 都免费。源资料的注记是成就，所以这里不把 35 当成通过条件或目标：35 只作为源资料
   * 的参考值记录，别无他用，而实测的 8 低于它——这是精神上的一致，而不是同一把尺子，
   * 因为源资料的「延迟」是它自己的仿真对自身电路的度量，而本项目的长组合路径按每个
   * 元件一个单位计费。如果测量结果高于 35，这段文字会如实说明，而
   * `threeStar.delay` 仍然携带测量值——目标不允许被掰向另一个度量体系里的数字。
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
   *  * `add8`（第 21 关解锁）与本关的 I/O 形状完全相同，一颗实例实测 72 门、1 层延迟。
   *    它一步就能答出本关，让本关教的级联变得没有意义，也会让源资料自己的成就值
   *    变得空洞（任何单颗元件的电路都在延迟 35 之内）。所以扣下，而且一直扣着——
   *    但要注意这让目标付出了什么，而不是把它藏起来：`add8` 与已发布参考解的 72 门
   *    打平，并击败它的延迟（72 和 1，测试文件实测），所以仍然能击败本参考解的电路，
   *    只有本关托盘不提供的这一个。它在这里是「不可用」而不是「被击败」，这段注释就是
   *    把这件事记录在案的地方。
   *  * `full_adder`（第 19 关奖励）则被提供，因为在这里八颗实例和它们之间的进位链
   *    正是本关要求的级联。这是把扣留规则反过来用，而不是与它矛盾：一颗实例是一位
   *    元件，答不出八位加法器，所以级联是本关目标测量所用的参考解，而不是它的替代解。
   *    直接放入会毁掉的那一课属于第 21 关，第 22 关正是为此扣下该元件。
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
    // 源资料的成就值（35）记录在上面的注释里；目标是测量值，不是那个值。
    // 本关过去引用的手工接线五元件链实测 120 和 17，现在是记录在案的替代写法：
    // 正确、满足通过条件，但只拿一星，因为目标是 72/8。
    threeStar: { gate: 72, delay: 8, tick: 0 },
    rewards: { components: ['switch8'] },
  },
];
