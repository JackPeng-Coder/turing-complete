import type { FuzzVector, LevelSpec } from '../../spec';
// `LevelIo`——引脚形状——来自 `tables.ts`；`checks.ts` 还导出了一个同名的运行时接口
//（已绑定仿真的接口），两者不能混淆。
import { truthTable, type LevelIo } from '../../tables';

/**
 * 第 2 章第 29~37 关：补码与解码器家族——字节不再只是八根线、开始被当作有符号数，
 * 并且有一种元件按位宽分档。
 *
 * 本批次有两件事需要向读者交代，且各自写在自己的关卡注释里，而不仅在这里：
 *
 * 托盘规则继承自批次 2，这里再用一次：一关提供货架上、玩家已在该关之前或当时解锁的
 * 元件，加上它自己的奖励，再减去任何「不是本关奖励、而且能单独答出本关」的元件。
 * 第 31 关对 `neg8` 用了这条减法——它是一颗与本关 I/O 形状完全相同的元件，其记录在案
 * 的单元就是本关要教的电路——并在自己的注释里写明。`full_adder`（第 19 关奖励，
 * 已注册，由第 20、22 关提供）在本批每一个托盘里都不出现，而且本批没有一关需要它：
 * 第 23、24、27 关都是字节宽，两个解码器关卡做的是选择而不是加法，所以本批没有任何
 * 目标是从「某关宁愿用元件答出」的元件上测出来的。
 *
 * 本批的三个解码器关卡都由自己的奖励答出，彼此只差一个位宽，而且各自在注释里写明，
 * 而不是留给读者去发现：`ch2-35` 提供 `decoder1`（放一颗恰好达成目标——1 门、1 层
 * 延迟、三星），`ch2-36` 提供 `decoder2`（实测 10 门、1 层延迟，对应该关 10 门 2 层
 * 的目标：打平门数、击败深度），`ch2-37` 提供 `decoder3`（实测 27 门、1 层延迟，
 * 对应该关 27 门 3 层的目标，同样打平、同样理由——注册元件的 minterm 树就是每一关
 * 要教的树）。在通过前把一关自己的奖励交给它，是批次 2 规则的「自己的奖励」那一半
 *——第 13 关的位拆分器和第 19 关的 `full_adder` 是同一类——而不是例外，所以这些是
 * 记录在案的价格，不是漏洞：直接放入是已经拥有该元件的玩家可以选择的，而每一关仍然
 * 教它发放的电路。没有任何奖励被收回，`ch2-37` 的注释给出了理由：在那里收回解码器会
 * 留下一个没有任何关卡提供的已注册元件，而那正是第 27 关 `full_adder` 决定要避免的
 * 死内容缺陷。
 *
 * 这里每一关都是纯组合逻辑，所以每个三星目标的 `tick` 都是 0，理由与批次 1、2 所说
 * 一样：本批没有任何检查推进时钟，所以该指标确实是 0，其目标永远不会成为玩家拿不到
 * 三星的原因。真正起作用的是 `gate` 和 `delay`，下面每个目标都是参考解自身的实测
 * 分数——测试文件里的「three-star targets are the reference solutions own metrics」
 * 用数字而不是承诺来保证这一点。
 *
 * 只通过一个地方接入：本章在 `ch2/index.ts` 组装，那里是 `src/` 下唯一 import 批次
 * 文件的模块，所以本文件只通过那个列表到达游戏；它自己的测试直接对它评分。
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

/** 批次 1 第 13 关解锁的东西：两个字节打包器与字节常量。 */
const BYTE_WIRING = ['splitter', 'maker', 'const8'] as const;

/** 批次 1 第 15~17 关解锁的宽位运算符。 */
const WIDE_OPS = ['less_u', 'equal8', 'add8', 'mul8'] as const;

/** 批次 2 第 18、19 关解锁的位切片字节运算符。 */
const BYTE_OPS = ['and8', 'or8', 'nand8', 'nor8', 'xor8', 'xnor8', 'not8'] as const;

/** 第 22 关的奖励：条件通断，一位宽和字节宽各一颗。 */
const SWITCHES = ['switch', 'switch8'] as const;

/**
 * 本批用到的引脚形状，这样一关的 io 就是一个有名字的常量，而不是写在 spec 中间的
 * 两行字面量。
 *
 * 解码器家族每位宽占一行，而且位宽是相邻、递增的：1 -> 2、2 -> 4、3 -> 8。
 * 输出宽度是 `2 ** sel`，所以任意两者都不能共用常量，这也是这些元件是各自独立的
 * 定义（`core/defs/wide.ts` 里的 `createDecoderDef(w)`）而不是一个带位宽参数的元件
 * 的原因。
 */
const IO_A8_OUT8: LevelIo = { inputs: [{ id: 'a', width: 8 }], outputs: [{ id: 'out', width: 8 }] };
const IO_SEL1_OUT2: LevelIo = {
  inputs: [{ id: 'sel', width: 1 }],
  outputs: [{ id: 'out', width: 2 }],
};
const IO_SEL2_OUT4: LevelIo = {
  inputs: [{ id: 'sel', width: 2 }],
  outputs: [{ id: 'out', width: 4 }],
};
const IO_SEL3_OUT8: LevelIo = {
  inputs: [{ id: 'sel', width: 3 }],
  outputs: [{ id: 'out', width: 8 }],
};
/**
 * 每关一个 fuzz 种子：高字节是关卡序号，低字节是字节宽度，与批次 2 给它的三关
 * 播种的方式完全一样。
 *
 * 用固定字面量而不是随机抽取：同一个种子在每次运行、每次修改画板后都产生同样的
 * 向量，这才让 fuzz 关卡的覆盖范围成为「关卡的事实」而不是「本次运行的事实」。
 * 取值互不相同，所以一关的序列绝不会是另一关的。
 *
 */
const SEED_23 = 0x2308;
const SEED_24 = 0x2408;
/**
 * 八位补码模式对应的有符号值。
 *
 * 第 23、24 关要教的全部内容，在这里写一次：最高位是符号位，所以 128 及以上的模式
 * 就是该模式减 256。符号从不离开这个函数——两关发布的仍然是八位模式，这是内核每个
 * 端口都遵守的契约（端口携带 0..255，`assertWidth` 不接受其他值）。
 */
function signedByte(pattern: number): number {
  const byte = pattern & 0xff;
  return byte < 0x80 ? byte : byte - 0x100;
}

/**
 * 第 29 关的期望值：字节距离零有多远。
 *
 * `0x01 -> 1`、`0xff -> 1`、`0x80 -> 128`。需要留意的模式是 `0x80`：最负的字节，
 * 也是其绝对值需要占用符号位本身位置的那一个，而它装得下（128 可表示）——这正是
 * 这一关能发布绝对值的原因。
 */
const MAGNITUDE_OF_SIGNED_BYTE = (v: FuzzVector): number => Math.abs(signedByte(v.a ?? 0));

/**
 * 第 31 关的期望值：`-a` 的低八位。
 *
 * `0x80` 取负之后还是 `0x80`——这是补码唯一无法反映的模式——而掩码把这件事写成
 * 算术，而不是让读者自己去推的环绕。
 */
const NEGATED_BYTE = (v: FuzzVector): number => (-signedByte(v.a ?? 0)) & 0xff;

/** 第 2 章本批次的关卡数据，按 `index` 顺序排列；章节顺序由 `ch2/index.ts` 汇合、`content/index.ts` 统一排序。 */
export const CH2_BATCH3: readonly LevelSpec[] = [
  /**
   * ch2-29-negative-numbers —— 负数 / Negative Numbers
   *
   * 目标测量所用的参考解是 `add8(xor8(a, m), 0, m0)`，其中 `m` 是铺满整个字节的符号位，
   * `m0` 是同一个位作为进位输入：`a XOR m` 就是 `a` 或 `~a`，再加 `m` 就完成了工作，
   * 因为在八位里减 255 和加 1 是同一个操作。那是一个 `xor8`（32 门）加一个 `add8`
   *（72 门）= 104 个 NAND 等价门、路径两层，而铺开符号的位合并器和位拆分器属于接线，
   * 在两个指标上都不计成本。
   *
   * 目标区分了什么，在测试文件里实测而不是在这里断言：教科书式的 `(a XOR m) - m`，
   * 用字节非门取掩码来写（112 门，仍是两层，一星），以及位串行写法——八个异或铺开
   * 符号，然后是不含加法器的纯进位行波——它更小（78 门）但有九层深（一星）。
   * 本关自己的答案是又便宜又浅的那个，这就是三星在这里的含义：字节加法器是两个元件，
   * 而行波是十五个，而且深度只有它的四分之一多一点。
   */
  {
    id: 'ch2-29-negative-numbers',
    chapter: 2,
    index: 29,
    name: { zh: '负数', en: 'Negative Numbers' },
    brief: {
      zh: '八位输入 a 是一个二进制补码数：最高位是符号位，a 小于 128 时它就是这个数本身，否则它的值是 a−256（0xFF 就是 −1）。输出这个数到 0 的距离：0x01→1，0xFF→1，0x80→128。',
      en: "Eight-bit input a is a two's-complement number: the top bit is the sign, so a below 128 is that number itself and anything else is a − 256 (0xFF is −1). Publish how far it is from zero: 0x01 gives 1, 0xFF gives 1, 0x80 gives 128.",
    },
    hint: {
      zh: '符号位就是第 7 位。把它铺满整个字节当作掩码 m：a 异或 m 得到 a 或 ~a，再把符号位本身当作进位加进去——在 8 位里减 255 和加 1 是一回事。',
      en: "The sign is bit 7. Spread it over the whole byte as a mask m: a XOR m is either a or ~a, and feeding the sign bit itself in as the carry finishes it, because subtracting 255 and adding 1 are the same thing in eight bits.",
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      ...WIDE_OPS,
      ...BYTE_OPS,
      'neg8',
      ...SWITCHES,
      'div8',
      ...LEVEL_IO,
    ],
    io: IO_A8_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_23,
        rounds: 256,
        inputs: { a: (sample) => sample.a ?? 0 },
        outputs: { out: MAGNITUDE_OF_SIGNED_BYTE },
      },
    ],
    // 实测：`xor8`（32 门）加 `add8`（72 门）= 104 个 NAND 等价门、两层深
    // ——上面的段落说明了这两个数字区分了什么。
    threeStar: { gate: 104, delay: 2, tick: 0 },
    rewards: { components: ['div8'] },
  },

  /**
   * ch2-31-signed-negator —— 数值反转 / Signed Negator
   *
   * 为什么托盘扣下 `neg8`，这是批次 2 托盘规则再用一次：`neg8` 不是本关自己的奖励，
   * 它恰好就是本关的 I/O 形状，而且它记录在案的单元就是本关要教的电路——非门（8）加
   * 字节加法器（72）= 同样的 80 个 NAND 等价门，但只需要一个延迟单位而不是两个。
   * 提供它的话，一步就能在门数上打平参考解、在延迟上击败它，而「取反加一」这一课
   * 就失去意义了。批次 2 的第 27 关正是以同样的理由扣下 `add8`；第 29 关提供 `neg8`，
   * 因为在那里它答不出关卡（绝对值不是取负）。
   *
   * 目标就是这一课自己的电路：`add8(not8(a), 0, 1)`——8 + 72 = 80 个 NAND 等价门、
   * 两层深。`nand8(a, a)` 恰好打平（按同一基准，每位一个与非门就是每位一个非门）。
   * 目标区分什么在测试文件里实测：同一函数用字节异或对 `const8` 写（104 门，一星），
   * 以及位串行增量器——八个非门加纯进位行波，54 门、九层深——它比这个电路小，
   * 却因为深了四倍多而只拿一星。
   */
  {
    id: 'ch2-31-signed-negator',
    chapter: 2,
    index: 31,
    name: { zh: '数值反转', en: 'Signed Negator' },
    brief: {
      zh: '八位输入 a。输出它的相反数：按补码的规则取反再加一，也就是 −a 的低八位。0x01 变成 0xFF；0x80 取负之后还是 0x80——−128 的相反数溢出回了它自己。',
      en: "Eight-bit input a. Publish its opposite: invert and add one, the two's-complement rule, which is the low eight bits of −a. 0x01 becomes 0xFF, and 0x80 stays 0x80 -- negating −128 overflows back onto itself.",
    },
    hint: {
      zh: '取反加一：先用 8 位非门把每一位翻过来，再用 8 位加法器加 1——另一个操作数接低电平，进位端接高电平。',
      en: 'Invert and add one: flip every bit with an 8-bit NOT, then add 1 with the 8-bit adder -- the other operand tied low, the carry-in tied high.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      ...WIDE_OPS,
      ...BYTE_OPS,
      ...SWITCHES,
      'div8',
      'less_s',
      'shift_l8',
      'shift_r8',
      ...LEVEL_IO,
    ],
    io: IO_A8_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_24,
        rounds: 256,
        inputs: { a: (sample) => sample.a ?? 0 },
        outputs: { out: NEGATED_BYTE },
      },
    ],
    // 实测：`not8`（8 门）加 `add8`（72 门）= 80 个 NAND 等价门、路径两层深。
    // 上面的注释说明了托盘扣下的元件，以及测试文件测量的那些替代写法。
    threeStar: { gate: 80, delay: 2, tick: 0 },
    rewards: { components: ['less_s', 'shift_l8', 'shift_r8'] },
  },

  /**
   * ch2-35-1-bit-decoder —— 二进制译码 / 1 Bit Decoder
   *
   * 位宽问题，已解决——记录下来是因为评审会问，也因为本文件早期版本答错过。注册的
   * 家族是逐位宽生成的：`createDecoderDef(w)` 生成一颗元件，输入 `sel: w`、输出
   * `out: 2 ** w`，`DECODER_WIDTHS` 注册 w = 1、2、3，产出的 id 就是 `decoder1`、
   * `decoder2`、`decoder3`。brief 说的正是这个：解码器按位宽分档，一位宽一颗元件，
   * 想要 4 路输出的玩家放入 `decoder2`。
   *
   * 为什么 `params.width` 不是、也不可能是这个机制——留在这里，免得有人再试。
   * `params.width` 是内核唯一的逐实例旋钮，它对实例的每一个引脚按
   * `inst.params.width ?? pin.width` 解析（`src/core/net.ts`，`effectiveWidth`）：
   * 一个字面量位宽覆盖整个元件。于是声明 `sel: 1 / out: 2` 的定义在
   * `params.width = 2` 下编译后，两个引脚都变成两位——`sel: 2 / out: 2`，这不是目录里
   * 的 2 位解码器（2-Bit Decoder，`sel: 2 / out: 4`）。解码器的两个引脚必须不同（输出数是 `2 ** width`），
   * 所以没有任何实例旋钮能表达它；位宽必须是定义本身的参数，这也正是
   * `createWideDefs(width)` 构造运算符、`createDecoderDef(width)` 构造这一族的方式。
   * `params.width` 把一颗元件的引脚一起移动；它永远无法把它们分开。
   *
   * `decoder1` 在这里被提供，这是「自己的奖励」规则，而不是对上一段的否定。批次 2 的
   * 托盘规则只减去「不是本关奖励」的元件，而 `paletteDefsFor` 会在关卡通过前把本关
   * 奖励交给它（第 16 关的 `splitter` 和第 19 关的 `full_adder` 是同一类）——所以玩家
   * 确实可以直接放入 `decoder1` 并恰好达成目标：实测 `gate: 1, delay: 1, tick: 0`，
   * 三星，与 NOT-and-Maker 参考解得分相同，因为一个与非树和它由之搭出的那个非门就是
   * 同一个门。这是规则的代价而不是疏忽，也是奖励继续列出的原因：本关教它发放的元件，
   * 已经拥有它的玩家用直接放入来重玩。`decoder2` 是另一种情况——它根本不是本关的
   * 奖励——整个区别就在于此。第 37 关是往上一位宽的同一情况（`decoder3` 一步答出该关，
   * 27 门、1 层延迟，记录在它自己的注释里，并在测试文件中实测），模块头部把两者都
   * 点名。
   */
  {
    id: 'ch2-35-1-bit-decoder',
    chapter: 2,
    index: 35,
    name: { zh: '二进制译码', en: '1 Bit Decoder' },
    brief: {
      zh: '解码器把一个选择值变成一条为高的输出线，而且是按宽度分档的：一档一颗元件。这一关要做的是 decoder1，也就是 1 位选择、2 路输出的那一颗——sel 为 0 时第 0 位为高（out 读作 1），sel 为 1 时第 1 位为高（out 读作 2）。2 位选择、4 路输出的那一颗是 decoder2，也就是元件目录里的「2 位解码器」：它是下一关的题目，这一关的 sel 只有一位，还用不上它。',
      en: 'A decoder turns a select value into one high output line, and it comes in widths: one part per width. This level asks for decoder1, the 1-to-2 form -- sel 0 lights bit 0 (out reads 1) and sel 1 lights bit 1 (out reads 2). The 2-to-4 form is decoder2, the catalog\'s 2-bit decoder: the next level builds it, and this level\'s sel is only one bit wide, so it has no use for the part yet.',
    },
    hint: {
      zh: '两个输出位里，第 0 位就是 sel 取反，第 1 位就是 sel 本身；用位合并器把这两条线拼成 2 位，一个非门就够了。',
      en: 'Of the two output bits, bit 0 is sel inverted and bit 1 is sel itself. Pack those two wires into two bits with a Maker: one NOT gate is the whole circuit.',
    },
    allowedComponents: [...GATES_1BIT, 'maker', 'decoder1', ...LEVEL_IO],
    io: IO_SEL1_OUT2,
    checks: [truthTable(IO_SEL1_OUT2, { out: ({ sel }) => 1 << (sel ?? 0) })],
    // 实测：一个 `not`（1 个 NAND 等价门）、路径一层深，位合并器免费——这是任何需要
    // 取反一位的电路的下限。
    threeStar: { gate: 1, delay: 1, tick: 0 },
    rewards: { components: ['decoder1'] },
  },

  /**
   * ch2-36-2-bit-decoder —— 2-4 译码器 / 2 Bit Decoder
   *
   * 参考解是位宽 2 的共享 minterm 树：每个选择位一个 NOT、四个两字面量 AND、一个位
   * 合并器——2 x 1 + 4 x 2 = 10 个 NAND 等价门、路径两个元件深，位拆分器、位合并器与
   * 关卡引脚在两个指标上都免费。它就是 3 位关卡的树往下一位宽，这正是这一族要教的：
   * 把选择值一次性解码成 minterm，不要为每条输出线重建字面量。
   *
   * `decoder2` 在这里被提供，而且它一步就能答出本关——与两个兄弟位宽付出的、
   * 同样的记录在案的价格。一颗实例恰好达成门数目标，因为注册元件的 minterm 树就是
   * 本关要教的树：实测 `gate: 10, delay: 1`，对本关 10 门 2 层的目标，所以它打平门数，
   * 击败深度（手工搭的树是两个元件深，元件在一个节点内发布）。收回它是备选方案，
   * 但被拒绝，理由与 3 位关卡往上一位宽的注释相同：提供一关自己的奖励是批次 2 的规则，
   * 而一个已注册、已定价却没有任何关卡提供的元件，正是那条规则另一侧要避免的
   * 死内容缺陷。
   */
  {
    id: 'ch2-36-2-bit-decoder',
    chapter: 2,
    index: 36,
    name: { zh: '2-4 译码器', en: '2 Bit Decoder' },
    brief: {
      zh: '两位选择输入 sel，四位输出 out。sel 的取值决定 out 的哪一位为高：sel=0 点亮第 0 位（out 读作 1），sel=1 点亮第 1 位（读作 2），sel=2 点亮第 2 位（读作 4），sel=3 点亮第 3 位（读作 8）；其余三位都是 0。',
      en: 'Two select bits, four output bits. The value of sel decides which bit of out goes high: sel 0 lights bit 0 (out reads 1), sel 1 lights bit 1 (2), sel 2 lights bit 2 (4) and sel 3 lights bit 3 (8). The other three bits stay 0.',
    },
    hint: {
      zh: '把 sel 拆成 b0、b1 两位，各自取反得到四条字面量线，再用四个与门拼出四种组合（每个与门恰好对应一个 sel 取值），最后用位合并器拼成四位。两个非门加四个与门，10 个 NAND 等价门。',
      en: 'Split sel into b0 and b1 and invert each, giving four literal wires. Four ANDs then produce the four minterms -- one per select value -- and a Maker packs them into four bits. Two NOTs and four ANDs, 10 NAND equivalents in all.',
    },
    allowedComponents: [...GATES_1BIT, 'splitter', 'maker', 'decoder2', ...LEVEL_IO],
    io: IO_SEL2_OUT4,
    checks: [truthTable(IO_SEL2_OUT4, { out: ({ sel }) => 1 << (sel ?? 0) })],
    // 实测：2 个 NOT（各 1 门）+ 4 个 AND（各 2 门）= 10 个 NAND 等价门，路径两个
    // 元件深，位拆分器、位合并器与关卡引脚在两个指标上都免费。`decoder2`（本关自己的
    // 奖励）打平门数、击败深度——这是上面注释里记录的价格。
    threeStar: { gate: 10, delay: 2, tick: 0 },
    rewards: { components: ['decoder2'] },
  },

  /**
   * ch2-37-3-bit-decoder —— 3-8 译码器 / 3 Bit Decoder
   *
   * 参考解是两级树，这也是本关的课：先把低两位选择解成四个 minterm（两个 NOT 和四个
   * AND），再把每个 minterm 与最高选择位或其反相组合（再一个 NOT 和八个 AND）——
   * 3 + 8 + 16 = 27 个 NAND 等价门、路径三层。显而易见的扁平替代写法是八个三输入
   * AND，每个各取三个字面量，为 3 + 8 x 4 = 35 门、路径两层；它正确、在测试文件里
   * 实测，而门数目标让它只拿一星。所以目标说明了这一关教什么：共享低位解码，
   * 不要重建八次。
   *
   * `decoder3` 在这里被提供，它一步就能答出本关——与第 25 关为 `decoder1` 付出的
   * 同样的记录在案的价格，往上一位宽，并且是作为测量而不是担忧来陈述：一颗本关自己
   * 奖励的实例，直接从 `sel` 接到关卡输出，实测 `gate: 27, delay: 1, tick: 0`，
   * 对本关 27 门 3 层的目标拿到三星。那个 27 不是巧合，值得读两遍：注册元件的
   * `gateCost` 就是本关要教的共享 minterm 树（3 个 NOT、4 个 AND、8 个 AND），所以
   * 直接放入恰好打平门数目标，并击败其深度，因为目标里的 3 是手工接线树的路径，
   * 而元件在一个节点内发布。
   *
   * 收回该元件是备选方案，但被有意拒绝。一关提供自己的奖励是批次 2 的规则而不是后门
   *（第 13 关的 `splitter` 没有它就搭不出自己那关，第 19 关也提供它发放的
   * `full_adder`），所以元件保留——而收回的代价比保留更糟：本章没有其他关卡列出
   * `decoder3`，从本关移除它会让一个已注册、已定价的元件没有任何关卡提供，
   * 那正是第 22 关 `full_adder` 决定要避免的死内容缺陷。本关仍然教它发放的树；
   * 直接放入买到的是已经能在托盘里看到该元件的玩家的一次重玩，这是奖励规则在每一关
   * 都接受的代价，第 35 关的注释对此有详细说明。
   */
  {
    id: 'ch2-37-3-bit-decoder',
    chapter: 2,
    index: 37,
    name: { zh: '3-8 译码器', en: '3 Bit Decoder' },
    brief: {
      zh: '三位选择输入 sel，八位输出 out。sel 的取值决定 out 的哪一位为高：sel=0 点亮第 0 位，sel=1 点亮第 1 位，……sel=7 点亮第 7 位；其余七位都是 0。',
      en: 'Three select bits, eight output bits. The value of sel decides which bit of out goes high: sel 0 lights bit 0, sel 1 lights bit 1, and so on to sel 7 lighting bit 7. The other seven bits stay 0.',
    },
    hint: {
      zh: '先把低两位解成 4 路（两级深度），再让每一路按最高位分成上下两半——8 路输出共用同一次低位解码，一共 27 个 NAND 等价门。八个人手一个三路与门直接展开要 35 个，门更多。',
      en: 'Decode the low two bits into four lines first, then split each of those into two by the top bit: one shared low decode for all eight outputs, 27 NAND equivalents in all. Eight flat 3-input ANDs cost 35, which is more.',
    },
    allowedComponents: [...GATES_1BIT, 'splitter', 'maker', 'decoder3', ...LEVEL_IO],
    io: IO_SEL3_OUT8,
    checks: [truthTable(IO_SEL3_OUT8, { out: ({ sel }) => 1 << (sel ?? 0) })],
    // 实测：两级树——3 个 NOT + 4 个 AND + 8 个 AND = 27 个 NAND 等价门——路径三层。
    // 扁平的三个二输入 AND 解码是 35 门、2 层，就是测试文件测量的一星替代写法。
    threeStar: { gate: 27, delay: 3, tick: 0 },
    rewards: { components: ['decoder3'] },
  },

];
