import type { ComponentCategory, ComponentDef, PinDef } from '../registry';
import { maskOf, type PortValue } from '../signal';

/**
 * 宽位（8 位）家族：按位运算、算术、移位、比较以及两个位打包器——全部是纯组合
 * 逻辑，没有状态、没有时钟沿，而且每一个都是某个生成器的产物，这样 phase 5 能
 * 在 16/32/64 位上注册同一批运算符，而不必再抄一份语义。
 *
 * 任务 4 在文件末尾增加了这个家族的**有状态**一半（mux8、delay8、reg8、
 * counter8、ram8），它们由字面量列表注册而不是生成；那一节的段落说明解释了原因，
 * 以及每个 def 在 state 里保存什么。
 *
 * 任务 10 在运算符与存储元件之间增加了**解码器**家族（decoder1、decoder2、
 * decoder3）。它像运算符一样按位宽生成，但刻意不是 createWideDefs 的产物：
 * 解码器的两个引脚位宽不同（sel 是 w 位、out 是 2 ** w 位），而那个生成器给它
 * 产出的每个 def 的所有引脚都只按一个位宽构建。运算符下方那一节有完整理由。
 *
 * 这个模块确立了三条规则，因为在它之前项目里没有任何位宽不是 1 的东西：
 *
 *  * **id 与引脚名就是契约。** and8.a、add8.cout、splitter.b0、reg8.load 等等
 *    都被第 2 章的关卡数据逐字寻址，所以它们在 createWideDefs（以及存储元件
 *    列表）里字面写出，而不是从某个聪明命名规则推导。
 *  * **值是无符号位模式，永远不是负数。** 8 位端口携带 0..255；补码只存在于
 *    less_s 与 ashr8 的**内部**：它们转成有符号值读符号位，然后重新返回无符号
 *    位模式。assertWidth 在入口不接受其它任何东西。
 *  * **边界行为是决定出来的，不是偶然的**——见每个运算符；存储元件则见每个 def
 *    处的决定：reset 优先于 load/en，counter8 回绕到 0，ram8 组合读、时钟沿写。
 *
 * 参数（splitter / maker）。任务书要求它们的引脚**数量**可配置，而唯一的
 * 每实例旋钮是 params.width。这个旋钮干不了这件事：内核把实例的**每个**引脚位宽
 * 都解析成 inst.params.width ?? pin.width（net.ts 的 effectiveWidth），所以给
 * splitter 设 params.width = 4 不会给它四个输出——而会让它全部八个输出各变成
 * 4 位，那是另一个、错误的元件。因此引脚数是 DEF 的参数，不是实例的参数：
 * createWideDefs(width) 造出恰好 width 个 1 位输出的 splitter 和恰好 width 个
 * 1 位输入的 maker，本阶段注册默认的 8。需要四位的关卡使用已注册 splitter 的
 * b0..b3，其余不接线（未接线引脚读 0）。
 *
 * 已记录的局限（这里仍未解决）：**无法把 splitter / maker 实例化成任意非 8 的
 * 引脚数。** 注册的实例是 8 宽，params.width 不能改变引脚数量，而每实例引脚数
 * 需要在 net.ts 里加 def 级钩子（例如 def.expand(params)）——那个文件不归这个
 * 任务管。4 位关卡通过使用 b0..b3 来配合 8 引脚元件（窄驱动者到达时会零扩展），
 * 这是有文档记录的工作方式而不是特性。唯一的例外是下面的沙盒配对 PACKER_DEFS：
 * 沙盒连接器能到达的、超过八位的位宽（16 与 32）被注册成自己的 def，因为超过
 * 八位时 8 位元件无法恢复高位。
 *
 * 代价：两个指标、两个字段。这里 cost 与 gateCost 刻意是不同的数字，因为规格对
 * 宽位元件在两个指标下的展开方式不同：
 *
 *  * cost 是延迟单位，由 net.ts 的 delayOf 每节点收一次。每个运算符为 1，常量
 *    源为 0（和 const_on 一样），两个打包器为 0（它们是导线，和 level_output
 *    一样）——规格 §3.2 说"宽位组件（如 8 位加法器）同样记为 1"。
 *  * gateCost 是门数指标，由 levels/grader.ts 的 gateCost() 读取：它展开宽位
 *    元件并数 NAND 等价门（规格 §5.4）。一个 and8 是 16 个，一个 add8 是 72 个。
 *
 * 把 NAND 等价数算进 cost，会让宽位元件拥有多个单位的延迟，破坏"每个元件恰好
 * 贡献一个延迟单位"；把两者并成一个数字，正是这个拆分要防止的 bug。下面每个
 * **运算符**都显式写出自己的 gateCost——24 个里没有一个依赖 "?? cost" 回退——
 * 于是整个家族的门数都在这个文件里，一个测试就能钉住全部 24 个。四个**有状态**
 * def 是刻意的例外：delay8、reg8、counter8 和 ram8 不写 gateCost，读成 cost 的
 * 0，因为门数指标衡量玩家搭出来的东西，而存储按裁决在两个指标上都免费，而不是
 * 因为漏写。下面的存储段落记录了论证，grader.ts 也从指标一侧陈述了同一例外；
 * mux8 是那一节里唯一的组合 def，所以像运算符一样写出它的计数。
 */

/** 本阶段所有宽位 def 注册时使用的位宽（规格 §3.3）。 */
export const DEFAULT_WIDE_WIDTH = 8;

/**
 * 生成位宽的硬上限。
 *
 * PortValue 在 32 位以内是 number、超过则是 Uint8Array，而下面每个运算符都用
 * number 承载结果。所以本阶段止步于 32：更高的请求会被夹紧，而不是允许它构建
 * 出这个模块无法合法产出其值的引脚。
 */
export const MAX_WIDE_WIDTH = 32;

/**
 * 把请求的位宽夹到 [1, MAX_WIDE_WIDTH]，未指定时用默认值 8。
 *
 * undefined（没要求位宽）和 NaN（被污染的计算，Math.trunc 会得到 NaN，并让每个
 * 引脚位宽一起变成 NaN）都回退到默认值。其余值先向零截断再夹紧，所以荒谬的请求
 * 在到达信号表之前就被限制住：clampWidth(1e9) 是 32，而不是一张让 alloc 申请几
 * GB 的引脚表。
 */
export function clampWidth(width: number | undefined): number {
  if (width === undefined || Number.isNaN(width)) return DEFAULT_WIDE_WIDTH;
  return Math.min(MAX_WIDE_WIDTH, Math.max(1, Math.trunc(width)));
}

// ---------------------------------------------------------------------------
// 门数指标：NAND 等价基准。
//
// 一个 2 输入与非门是单位（规格 §5.4：展开时每个基础门的贡献 = 1）。下面每个
// 常量都是标准全与非门构造里 2 输入与非门的个数，起这些名字是为了让每个 def 的
// gateCost 读起来就是它所组合出来的东西（例如 and8 = 8 x AND）。这些是有文档
// 记录的构造，不是已证明的最小值：每一个都被写出来，好让评审者可以核对这些
// 算术，而不必相信一个数字。
//
//   1 位元件  | NAND 数 | 构造
//   ----------|---------|----------------------------------------------------
//   NAND      |   1     | 单位本身
//   NOT       |   1     | NAND(a, a)
//   AND       |   2     | NAND(a, b) -> NOT
//   OR        |   3     | NOT a, NOT b, NAND(~a, ~b)   [德摩根]
//   NOR       |   4     | NOT a, NOT b, NAND(a, b)     [两个取反的与]
//   XOR       |   4     | 经典的四与非门 XOR
//   XNOR      |   5     | XOR -> NOT
//   MUX2      |   4     | NOT s, NAND(a, ~s), NAND(b, s), 再把两者与非
//   FULL_ADDER|   9     | 下面的 FULL_ADDER 常量
//
// XOR/MUX2 的计数用的是标准单元，而 equal8 无论按 (XNOR x 8 -> 与树) 还是按
// (XOR x 8 -> 或树 -> NOT) 搭，总数都是 54——这是一个有用的迹象，说明 54 不是
// 某一种画法产生的偶然数字。
//
// 同一基准也为 defs/index.ts 里注册的 1 位门定价——NAND 1、NOT 1、AND 2、OR 3、
// NOR 4、XOR 4、XNOR 5、AND3 4、OR3 6，以及 full_adder 本身的 FULL_ADDER 9
// （它 import 这个常量）。test/core/defs-wide.test.ts 会把本文件的逐位单元与那些
// def 交叉核对，所以 and8 的某一位与内置 and 不可能再被算出两个不同的价。
//
// 这是为游戏注册的位宽记录的——现在是 8，phase 5 是 16/32/64：全是 2 的幂，
// 这正是让 shiftStages(w) 级桶形移位器成为正确形状的原因。clampWidth 也接受其它
// 位宽；那种情况下推导出的计数是同一构造的算术，而不是"该构造最优"的声明。
// ---------------------------------------------------------------------------

const NAND = 1;
const NOT = 1;
const AND = 2;
const OR = 3;
const NOR = 4;
const XOR = 4;
const XNOR = 5;
const MUX2 = 4;

/**
 * 一个全加器（和与进位输出）在 2 输入与非门下需要 **9** 个。
 *
 *   x1 = NAND(a, b)            x2 = NAND(a, x1)       x3 = NAND(b, x1)
 *   s1 = NAND(x2, x3)          = a XOR b
 *   s2 = NAND(s1, cin)         s3 = NAND(s1, s2)      s4 = NAND(cin, s2)
 *   sum = NAND(s3, s4)         = s1 XOR cin
 *   cout = NAND(x1, s2)        = a·b + cin·(a XOR b)
 *
 * 八个这样的单元串成行波链就是 add8，cin 与 cout 都包含在内。
 *
 * 之所以导出：同一个 1 位元件在 defs/index.ts 里注册为 full_adder——第 20 关奖励
 * 的 id，也是第 22 关级联电路所用的元件。那个 def import 这个常量而不是重述 9，
 * 所以注册的门与 add8 的每一位不可能被算出两个不同的价。
 */
export const FULL_ADDER = 9;

/** 桶形移位器按每个 amount 位选一级 2:1 多路选择器：位数就是级数。 */
function shiftStages(w: number): number {
  return Math.ceil(Math.log2(w));
}

/**
 * w 位桶形移位器/循环移位器的 NAND 数：shiftStages(w) 级，每级 w 个独立的
 * 2:1 多路选择器。w = 8 时是 3 x 8 x 4 = 96。
 *
 * 移位与循环移位共用同一结构；不同的只是每个多路选择器空闲输入接什么
 * （0、符号位，还是循环进来的位）。
 */
function barrelNand(w: number): number {
  return shiftStages(w) * w * MUX2;
}

/**
 * 把桶形移位器无法处理的 amount 位（即区间 [shiftStages(w), w)）或归约所需的
 * NAND 数，含义是"移位量大于等于 w"。w = 8 时是 amount 的第 7..3 位，所以是
 * 4 个或门 = 12 个 NAND。
 *
 * 循环移位器完全不需要这些：按构造它就是模 w 的，所以高 amount 位干脆不接线。
 */
function overShiftNand(w: number): number {
  const highBits = Math.max(1, w - shiftStages(w));
  return (highBits - 1) * OR;
}

/** 无符号 a < b 的 NAND 数：把 b 取反、相加、再取反进位输出。 */
function lessUnsignedNand(w: number): number {
  return w * NOT + w * FULL_ADDER + NOT;
}

/**
 * 只保留低 w 位的移位相加阵列乘法器：对乘数的 w 个位各做一次 w 宽 AND（得到
 * 部分积，w * AND）和一次 w 位加法器把它累加进来（w * FULL_ADDER）。w = 8 时是
 * 8 x (16 + 72) = 704。
 *
 * 只保留低 w 位，也就是运算符唯一 out 引脚发布的内容；被丢弃的高半部分乘积不
 * 搭建，所以这不是 2w 位乘法器的计数。
 */
function multiplyNand(w: number): number {
  return w * (w * AND + w * FULL_ADDER);
}

/**
 * 恢复式长除法，循环 w 次。每次迭代从移位后的余数里减去除数——用取反再加
 * （w * NOT + w * FULL_ADDER），而不是真减法——并在借位发生时用一个 w 宽 2:1
 * 多路选择器（w * MUX2）恢复上一个余数。商的这一位就是同一个借位，而移位只是
 * 接线，两者都不花门。
 *
 * 已决定的除零规则（b = 0 -> 全 1）增加了对 b 的或归约加一个反相器
 * （(w - 1) * OR + NOT，即零检测）以及多一次 w 宽的条件选择（w * MUX2；全 1
 * 操作数是电源轨，不是门）。w = 8 时：8 x 112 + 22 + 32 = 950。
 */
function divideNand(w: number): number {
  const iteration = w * NOT + w * FULL_ADDER + w * MUX2;
  const divideByZero = (w - 1) * OR + NOT + w * MUX2;
  return w * iteration + divideByZero;
}

/**
 * 把 value 截到 w 位并返回**非负**整数。
 *
 * 一旦第 31 位被置上，只做 & mask 是不够的：按位运算符会经 int32 转换，所以
 * 0xffff_ffff & 0xffff_ffff 是 -1。负数随后会在进入端口时被 assertWidth 拒绝，
 * 而那正是任务书禁止的"负数读数"——所以每个结果都要经过这里。
 */
function u(value: number, w: number): number {
  return (value & maskOf(w)) >>> 0;
}

/**
 * 把一个端口值读成无符号 w 位整数。
 *
 * 两种载体都接受，因为两种都会出现：signal.ts 对不超过 8 位的引脚给 def 一个
 * number，更宽时给一个小端 Uint8Array，而同一个 evaluate 要能在两种位宽下运行。
 * 缺失的输入读 0，与内核自己的"没有驱动者的位读 0"一致。
 *
 * 之所以导出：读取宽位引脚也是后面每个 def 的问题（reg8、mux8、counter8、
 * delay8），而再抄一份"number/字节数组"分支就是再留一个出错的地方。
 */
export function toUint(v: PortValue | undefined, w: number): number {
  if (v === undefined) return 0;
  if (typeof v === 'number') return u(v, w);
  // 最多只读四个字节，因为这个模块发布的载体上限是 32 位（MAX_WIDE_WIDTH）
  // ——不是因为 number 类型，它精确范围远在那之上。更宽的引脚是 phase 5 的事。
  let out = 0;
  for (let i = Math.min(v.length, 4) - 1; i >= 0; i -= 1) out = out * 256 + (v[i] ?? 0);
  return u(out, w);
}

/** 一个 1 位端口，读成 0 或 1。 */
function bit(v: PortValue | undefined): number {
  return toUint(v, 1);
}

/**
 * 无符号 w 位模式对应的补码值。
 *
 * 只用于读取符号——less_s 里的比较与 ashr8 里的符号位。结果从不离开这个模块：
 * 两个运算符返回的都是无符号模式。
 */
function toSigned(v: number, w: number): number {
  const x = u(v, w);
  return x >= 2 ** (w - 1) ? x - 2 ** w : x;
}

// ---------------------------------------------------------------------------
// 运算符。每个都是它那套语义的唯一实现；下面的 def 只是薄包装：读引脚、调用其中
// 一个、写引脚。
// ---------------------------------------------------------------------------

/**
 * 带进位的加法。out 是低 w 位，cout 是第 w 位——最高位产生的进位，这让 add8 将来
 * 能级联成 16 位加法器。
 *
 * out 与 cout 由同一个整数和算出，所以两个引脚不可能对"这次加法是否溢出"给出
 * 不一致的答案。
 */
function addOp(a: number, b: number, cin: number, w: number): { out: number; cout: number } {
  const sum = u(a, w) + u(b, w) + (cin & 1);
  // 用 Math.floor(sum / 2 ** w)，而不是 sum >> w：>> 会把移位量按 32 取模，
  // 于是 w = 32 时它会把和的第 0 位当作进位报出去。
  return { out: u(sum, w), cout: Math.floor(sum / 2 ** w) & 1 };
}

/** 补码取负。neg(0) 是 0，而 neg(0x80) 是 0x80。 */
function negOp(a: number, w: number): number {
  // 2 ** w - a 再掩码，等于 (2 ** w - a) mod 2 ** w，所以任何时刻都不存在负数
  // 中间值——连 neg(0) 也不会。
  return u(2 ** w - u(a, w), w);
}

function lessSignedOp(a: number, b: number, w: number): number {
  return toSigned(a, w) < toSigned(b, w) ? 1 : 0;
}

function lessUnsignedOp(a: number, b: number, w: number): number {
  return u(a, w) < u(b, w) ? 1 : 0;
}

function equalOp(a: number, b: number, w: number): number {
  return u(a, w) === u(b, w) ? 1 : 0;
}

/** 逻辑左移。已决定：移位量大于等于 w 时结果为 0。 */
function shiftLeftOp(a: number, amount: number, w: number): number {
  const s = u(amount, w);
  if (s >= w) return 0;
  return u(u(a, w) << s, w);
}

/**
 * 逻辑右移：从高位补零。移位量大于等于 w 时结果为 0。
 *
 * ashr8 是算术移位，它刻意不遵守这条规则——见 shiftRightArithmeticOp。
 */
function shiftRightOp(a: number, amount: number, w: number): number {
  const s = u(amount, w);
  if (s >= w) return 0;
  return u(u(a, w) >>> s, w);
}

/**
 * 算术右移：符号位复制，所以负的位模式仍然是负的。
 *
 * 刻意排除在 shift_* "移位量 >= w 时结果为 0"的规则之外，而 shiftLeftOp /
 * shiftRightOp 遵守那条规则。那条规则是**逻辑**移位的边界行为；套用到这里会让
 * ashr8 在"符号填充本来要处理"的那些输入上恰好退化成 shift_r8。ashr8 做的是
 * 算术移位，所以移位量大于等于 w 时用符号位填充（负数字节得 0xff，正数得 0）
 * ——这是敲定的行为，不是疏漏。不要把它"修"成 0。
 */
function shiftRightArithmeticOp(a: number, amount: number, w: number): number {
  const s = u(amount, w);
  const signed = toSigned(a, w);
  if (s >= w) return signed < 0 ? maskOf(w) : 0;
  return u(signed >> s, w);
}

/** 循环左移。已决定：移位量 >= w 时按 amount % w 处理。 */
function rotateLeftOp(a: number, amount: number, w: number): number {
  const v = u(a, w);
  const s = u(amount, w) % w;
  if (s === 0) return v;
  return u((v << s) | (v >>> (w - s)), w);
}

/** 循环右移。已决定：移位量 >= w 时按 amount % w 处理。 */
function rotateRightOp(a: number, amount: number, w: number): number {
  const v = u(a, w);
  const s = u(amount, w) % w;
  if (s === 0) return v;
  return u((v >>> s) | (v << (w - s)), w);
}

/**
 * 乘法，只保留低 w 位——mul8(16, 16) 是 0，正好是 8 位乘法器 out 引脚会给出的
 * 结果。高半部分被丢弃而不是报告出来：mul8 没有高位输出引脚。
 */
function multiplyOp(a: number, b: number, w: number): number {
  const x = u(a, w);
  const y = u(b, w);
  // 把 x 对半拆开，保证没有中间值超过 2 ** 53。w = 32 时单独算 x * y 会越界，
  // 而丢失低位的 double 会悄悄弄坏这个运算符要保留的那些位。先把高半部分对
  // 2 ** w 取模是安全的：被丢掉的部分是 2 ** w 的整数倍。
  const half = Math.ceil(w / 2);
  const base = 2 ** half;
  const lo = x % base;
  const hi = (x - lo) / base;
  return u(((hi * y) % 2 ** w) * base + lo * y, w);
}

/**
 * 整数除法，向零截断（操作数无符号，所以也就是向下取整）。
 *
 * 已决定，而不是未定义行为：除以零返回全 1——位宽 8 时是 0xff。任何被除数都得到
 * 同一个答案，所以关卡可以依赖它；而且由此搭出的除法器永远不会产生端口装不下
 * 的值：返回的全 1 就是 maskOf(w)，恰好 w 位且永不为负（见 maskOf——这个返回值
 * 与 ashr{w} 的符号填充是两个"把掩码交给端口而不是与掩码相与"的地方，所以
 * maskOf 的符号就是这里的全部契约）。
 */
function divideOp(a: number, b: number, w: number): number {
  const divisor = u(b, w);
  if (divisor === 0) return maskOf(w);
  return Math.floor(u(a, w) / divisor);
}

/** b0..b{w-1}，最低位在前：splitter 的传递函数。 */
function splitOp(value: number, w: number): number[] {
  const v = u(value, w);
  return Array.from({ length: w }, (_, b) => (v >>> b) & 1);
}

/** splitOp 的逆运算：makeOp(splitOp(x, w), w) === x。 */
function makeOp(bits: readonly number[], w: number): number {
  let out = 0;
  for (let b = 0; b < w; b += 1) out += bit(bits[b]) << b;
  return u(out, w);
}

// ---------------------------------------------------------------------------
// def 构建器
// ---------------------------------------------------------------------------

const combinational = (
  id: string,
  name: { zh: string; en: string },
  category: ComponentCategory,
  inputs: readonly PinDef[],
  outputs: readonly PinDef[],
  cost: number,
  gateCost: number,
  evaluate: (inputs: readonly PortValue[], outputs: PortValue[]) => void,
): ComponentDef => ({
  id,
  name,
  category,
  inputs,
  outputs,
  cost,
  gateCost,
  sequential: false,
  stateBytes: 0,
  evaluate,
});

const wideOut = (w: number): PinDef[] => [{ id: 'out', width: w }];
const bitOut = (): PinDef[] => [{ id: 'out', width: 1 }];

/**
 * 每位一个门；fn 收到的值已经掩到 w 位。调用方传入逐位门的 NAND 数，所以 and8 是
 * w * AND、nand8 是 w * NAND——位切片运算符正好就是 1 位单元的 w 份拷贝。
 */
function bitwise2(
  id: string,
  name: { zh: string; en: string },
  w: number,
  gateCost: number,
  fn: (a: number, b: number) => number,
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'b', width: w },
    ],
    wideOut(w),
    1,
    gateCost,
    (i, o) => {
      o[0] = u(fn(toUint(i[0], w), toUint(i[1], w)), w);
    },
  );
}

/** 每位一个单元；not8 是 w * NOT。 */
function bitwise1(
  id: string,
  name: { zh: string; en: string },
  w: number,
  gateCost: number,
  fn: (a: number) => number,
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [{ id: 'a', width: w }],
    wideOut(w),
    1,
    gateCost,
    (i, o) => {
      o[0] = u(fn(toUint(i[0], w)), w);
    },
  );
}

/** 行波进位加法器：w 个全加器，cin 进、cout 出都包含在内。 */
function addDef(w: number): ComponentDef {
  return combinational(
    `add${w}`,
    { zh: `${w} 位加法器`, en: `${w}-Bit Adder` },
    'wide',
    [
      { id: 'a', width: w },
      { id: 'b', width: w },
      { id: 'cin', width: 1 },
    ],
    [{ id: 'out', width: w }, { id: 'cout', width: 1 }],
    1,
    w * FULL_ADDER,
    (i, o) => {
      const sum = addOp(toUint(i[0], w), toUint(i[1], w), bit(i[2]), w);
      o[0] = sum.out;
      o[1] = sum.cout;
    },
  );
}

/**
 * 以 0 - a 形式的补码取负：把 a 取反（这是一个免费的"操作数对调"，因为
 * 0 - a = ~a + 1）再送进 w 位加法器，cin 接高电平。进位不需要多路选择器：常量 1
 * 就是一根导线，所以 neg8 = NOT8 + add8。
 */
function negDef(w: number): ComponentDef {
  return bitwise1(
    `neg${w}`,
    { zh: `${w} 位取负`, en: `${w}-Bit Negate` },
    w,
    w * NOT + w * FULL_ADDER,
    (a) => negOp(a, w),
  );
}

/** 比较器：它的构造、因此它的门数，由调用方决定。 */
function compareDef(
  id: string,
  name: { zh: string; en: string },
  w: number,
  gateCost: number,
  fn: (a: number, b: number, w: number) => number,
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'b', width: w },
    ],
    bitOut(),
    1,
    gateCost,
    (i, o) => {
      o[0] = fn(toUint(i[0], w), toUint(i[1], w), w);
    },
  );
}

/** 桶形移位器：barrelNand(w) 个多路选择器，加上边界规则需要的东西。 */
function shiftDef(
  id: string,
  name: { zh: string; en: string },
  w: number,
  gateCost: number,
  fn: (a: number, amount: number, w: number) => number,
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'amount', width: w },
    ],
    wideOut(w),
    1,
    gateCost,
    (i, o) => {
      o[0] = fn(toUint(i[0], w), toUint(i[1], w), w);
    },
  );
}

/** 乘法器或除法器：阵列式/迭代式，所以计数由调用方负责。 */
function binaryDef(
  id: string,
  name: { zh: string; en: string },
  w: number,
  gateCost: number,
  fn: (a: number, b: number, w: number) => number,
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'b', width: w },
    ],
    wideOut(w),
    1,
    gateCost,
    (i, o) => {
      o[0] = fn(toUint(i[0], w), toUint(i[1], w), w);
    },
  );
}

/**
 * 条件直通（switch / switch{w}）：on = 1 时把 a 透传，on = 0 时把输出强制为 0。
 * 这是决定下来的形式——强制为 0 而不是自由悬空，正是它们能安全级联的原因。
 *
 * 它恰好就是 a AND on，每位一个 AND，所以 switch 是一个 AND、switch8 是八个。
 * 把空闲输入接地会免费，但那是另一个元件（断开的开关读 0，而不是邻居的信号）。
 */
function switchDef(id: string, name: { zh: string; en: string }, w: number): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'on', width: 1 },
    ],
    wideOut(w),
    1,
    w * AND,
    (i, o) => {
      o[0] = bit(i[1]) === 1 ? toUint(i[0], w) : 0;
    },
  );
}

/**
 * 8 位常量源。
 *
 * 它没有取值参数——params 只能带数字，而内核只读 params.width——所以它的值是
 * 模块常量：全 1。全 0 根本不需要元件（未接线输入已经读 0，内核还用
 * dangling-input 警告说明这一点），所以值得占用一个托盘槽位的常量，是电路无法
 * 免费合成的那个。
 */
const CONST_VALUE = 0xff;

function constDef(w: number): ComponentDef {
  return combinational(
    `const${w}`,
    { zh: `${w} 位常量`, en: `${w}-Bit Constant` },
    // 它是源而不是门：const_on / const_off 出于同样理由归为 io，而且没有地方按
    // category 给托盘分组。
    'io',
    [],
    wideOut(w),
    // 没有延迟单位也没有 NAND：源就是接到电源轨的导线。
    0,
    0,
    (_i, o) => {
      o[0] = u(CONST_VALUE, w);
    },
  );
}

/**
 * splitter：一个 w 位输入、w 个 1 位输出 b0..b{w-1}，最低位在前。纯接线，所以
 * 不花门也不花延迟。
 *
 * id 与 name 做成参数，是因为超过八位的位宽被注册成自己的 id（下面的
 * PACKER_DEFS）；已注册的 8 位配对保留关卡数据拼写的裸 id splitter / maker。
 */
function splitterDef(
  w: number,
  id: string = 'splitter',
  name: { zh: string; en: string } = { zh: '位拆分器', en: 'Splitter' },
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [{ id: 'in', width: w }],
    Array.from({ length: w }, (_, b) => ({ id: `b${b}`, width: 1 })),
    0,
    0,
    (i, o) => {
      const bits = splitOp(toUint(i[0], w), w);
      for (let b = 0; b < w; b += 1) o[b] = bits[b]!;
    },
  );
}

/** maker：w 个 1 位输入 b0..b{w-1} 进，一个 w 位值出。也是纯接线。 */
function makerDef(
  w: number,
  id: string = 'maker',
  name: { zh: string; en: string } = { zh: '位合并器', en: 'Maker' },
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    Array.from({ length: w }, (_, b) => ({ id: `b${b}`, width: 1 })),
    wideOut(w),
    0,
    0,
    (i, o) => {
      o[0] = makeOp(
        Array.from({ length: w }, (_, b) => bit(i[b])),
        w,
      );
    },
  );
}

/**
 * 打包器配对，用于**沙盒连接器**在八位之上能到达的位宽。
 *
 * 一句话说明为什么存在：沙盒连接器的位宽由玩家决定（main.ts 的 PIN_WIDTHS 循环
 * 1、8、16、32、2、3、4、6），而当时注册的打包器只有八位宽，于是 16 位引脚接到
 * splitter 时——compile 只复制 min(from, to) 位，其余读零——高位一半会被悄悄
 * 丢弃，且无从看见。这就是被报告的缺陷："没有对应的位拆分器和位合并器来处理
 * 16 位输入输出元件"。
 *
 * 为什么只有 16 和 32。八位及以下不需要变体：较窄的驱动者进入 8 位 splitter 时
 * 会以零扩展到达，于是 b0..b{w-1} 就是该值、高位引脚读 0；而较窄的接收端会把
 * 打包字截回自己的位宽——maker 的输出接到 4 位连接器时传递低四位，就是该值。
 * 超过八位时 8 位元件完全无法恢复高位，所以连接器芯片能到达的两种位宽
 * （PIN_WIDTHS）各得一个自己的元件。64 位不在其中，即使在其中也不会免费：那么宽
 * 的引脚由 Uint8Array 承载，而不是 splitOp / makeOp 所读的 number
 * （MAX_WIDE_WIDTH 是本模块的上限）——那是 phase 6a 的位宽工作，不是托盘修复。
 *
 * 命名。已注册的配对保留裸 id（WIDE_DEF_IDS 的说明记录了关卡数据拼写它们时不带
 * 后缀）；这些则像 and8 / decoder2 / switch8 一样带位宽后缀，所以 splitter16 从
 * 名字上就是 16 位拆分器。它们不是通过 createWideDefs 生成的：那个生成器按一个
 * 位宽构建整个家族，它的打包器会与已注册的裸 id 冲突，所以这里只做这一对。
 *
 * 代价与那一对相同：纯接线，两个指标全免费。
 */
export const PACKER_WIDTHS = [16, 32] as const;

/** PACKER_DEFS 注册的全部 id，按顺序排列，供 DEF_IDS 展开。 */
export const PACKER_DEF_IDS = ['splitter16', 'maker16', 'splitter32', 'maker32'] as const;

export const PACKER_DEFS: readonly ComponentDef[] = [
  splitterDef(16, 'splitter16', { zh: '16 位拆分器', en: '16-Bit Splitter' }),
  makerDef(16, 'maker16', { zh: '16 位合并器', en: '16-Bit Maker' }),
  splitterDef(32, 'splitter32', { zh: '32 位拆分器', en: '32-Bit Splitter' }),
  makerDef(32, 'maker32', { zh: '32 位合并器', en: '32-Bit Maker' }),
];

/**
 * createWideDefs(8) 产出的 id，按顺序排列，写成字面量元组，好让 DEF_IDS 展开它、
 * 并让 DefId 仍然收窄到单个字符串。
 *
 * 带位宽后缀的运算符按"词干 + 位宽"命名；less_s、less_u、splitter、maker 和 1 位
 * 的 switch 在契约里不带后缀，所以它们保持本阶段能生成的每个位宽下的名字。为
 * 16/32/64 位改名是 phase 5 的决定，而 test/core/defs-wide.test.ts 会钉住这张
 * 列表与生成的定义在注册位宽上一致。
 */
export const WIDE_DEF_IDS = [
  'and8',
  'or8',
  'nand8',
  'nor8',
  'xor8',
  'xnor8',
  'not8',
  'add8',
  'neg8',
  'less_s',
  'less_u',
  'equal8',
  'shift_l8',
  'shift_r8',
  'ashr8',
  'rot_l8',
  'rot_r8',
  'mul8',
  'div8',
  'const8',
  'splitter',
  'maker',
  'switch',
  'switch8',
] as const;

/**
 * 整个家族在 width 位下的全部定义，按 WIDE_DEF_IDS 的顺序排列。
 *
 * width 默认 8，也就是本阶段唯一注册的位宽；参数存在的意义是让 phase 5 能用
 * 16、32 或 64 调用它，而不必在这个家族旁边再长出一个定义家族。它会被夹紧
 * （见 clampWidth），从不被信任：否则 1e9 的位宽会造出一个带十亿个 1 位输出
 * 引脚的 splitter。
 *
 * 每个 def 都显式写出自己的 gateCost（该位宽下的 NAND 等价数）；下面的注释说明
 * 每个数字背后的构造。每个运算符的 cost 都保持 1——延迟指标不能看到这些数字。
 */
export function createWideDefs(width: number = DEFAULT_WIDE_WIDTH): readonly ComponentDef[] {
  const w = clampWidth(width);
  return [
    // 位切片：每位一个 1 位单元，所以是 w 份该单元的计数。
    bitwise2(`and${w}`, { zh: `${w} 位与门`, en: `${w}-Bit AND` }, w, w * AND, (a, b) => a & b),
    bitwise2(`or${w}`, { zh: `${w} 位或门`, en: `${w}-Bit OR` }, w, w * OR, (a, b) => a | b),
    bitwise2(`nand${w}`, { zh: `${w} 位与非门`, en: `${w}-Bit NAND` }, w, w * NAND, (a, b) => ~(a & b)),
    bitwise2(`nor${w}`, { zh: `${w} 位或非门`, en: `${w}-Bit NOR` }, w, w * NOR, (a, b) => ~(a | b)),
    bitwise2(`xor${w}`, { zh: `${w} 位异或门`, en: `${w}-Bit XOR` }, w, w * XOR, (a, b) => a ^ b),
    bitwise2(`xnor${w}`, { zh: `${w} 位同或门`, en: `${w}-Bit XNOR` }, w, w * XNOR, (a, b) => ~(a ^ b)),
    bitwise1(`not${w}`, { zh: `${w} 位非门`, en: `${w}-Bit NOT` }, w, w * NOT, (a) => ~a),
    // w 个全加器串成行波链（见 FULL_ADDER）。
    addDef(w),
    negDef(w),
    // less_s 是唯一把操作数按补码读的运算符，而且这个读法止于返回值：输出引脚
    // 只有一位，所以没有任何有符号数会到达端口。
    //
    // less_u = 用加补码的方式做减法并读借位：NOT b -> 加 -> NOT cout。less_s 在
    // 此之上加符号修正：两个符号位异或（4），再用一个 2:1 多路选择器（4）——符号
    // 不同时取 a 的符号位（a 为负、b 非负是唯一会被无符号比较弄反的情形），否则
    // 取无符号结果。
    compareDef('less_s', { zh: '有符号小于', en: 'Signed Less Than' }, w, lessUnsignedNand(w) + XOR + MUX2, lessSignedOp),
    compareDef('less_u', { zh: '无符号小于', en: 'Unsigned Less Than' }, w, lessUnsignedNand(w), lessUnsignedOp),
    // 逐位 XNOR 进与树：8 个 XNOR（40）+ 7 个 AND（14）。镜像构造（逐位 XOR、
    // 或树、一个反相器）总数也是 54。
    compareDef(`equal${w}`, { zh: `${w} 位相等`, en: `${w}-Bit Equal` }, w, w * XNOR + (w - 1) * AND, equalOp),
    // 桶形移位器用零填充，所以移位量大于等于 w 时要在事后强制成 0：把桶形看不到
    // 的 amount 位或起来、取反，再与 w 个输出相与。
    shiftDef(`shift_l${w}`, { zh: `${w} 位左移`, en: `${w}-Bit Shift Left` }, w, barrelNand(w) + overShiftNand(w) + NOT + w * AND, shiftLeftOp),
    shiftDef(`shift_r${w}`, { zh: `${w} 位右移`, en: `${w}-Bit Shift Right` }, w, barrelNand(w) + overShiftNand(w) + NOT + w * AND, shiftRightOp),
    // 同一个桶形结构，但移位量大于等于 w 时每个输出都选择符号位而不是零：把高位
    // amount 或归约（不需要反相器——或本身就是要的选择信号），再加一个 w 宽 2:1
    // 多路选择器。
    shiftDef(`ashr${w}`, { zh: `${w} 位算术右移`, en: `${w}-Bit Arithmetic Shift Right` }, w, barrelNand(w) + overShiftNand(w) + w * MUX2, shiftRightArithmeticOp),
    // 循环移位器完全不需要边界逻辑：它只作用于低 shiftStages(w) 个 amount 位，
    // 所以 amount % w 是这个结构自然给出的结果。
    shiftDef(`rot_l${w}`, { zh: `${w} 位循环左移`, en: `${w}-Bit Rotate Left` }, w, barrelNand(w), rotateLeftOp),
    shiftDef(`rot_r${w}`, { zh: `${w} 位循环右移`, en: `${w}-Bit Rotate Right` }, w, barrelNand(w), rotateRightOp),
    binaryDef(`mul${w}`, { zh: `${w} 位乘法器`, en: `${w}-Bit Multiplier` }, w, multiplyNand(w), multiplyOp),
    binaryDef(`div${w}`, { zh: `${w} 位除法器`, en: `${w}-Bit Divider` }, w, divideNand(w), divideOp),
    constDef(w),
    splitterDef(w),
    makerDef(w),
    // 1 位条件直通与位宽无关，保留裸 id，所以 createWideDefs(8) 产出的正是契约
    // 要求的 switch / switch8 配对。
    switchDef('switch', { zh: '开关', en: 'Switch' }, 1),
    switchDef(`switch${w}`, { zh: `${w} 位开关`, en: `${w}-Bit Switch` }, w),
  ];
}

// ---------------------------------------------------------------------------
// 解码器家族（任务 10）
//
// decoder1 和 decoder3 是第 2 章第 25、26 关奖励并放进各自托盘的元件；decoder2
// 是同一个定义在更高一档位宽下的产物——2.x 资料集里的"2-Bit Decoder"，没有关卡
// 名字引入它，所以它不是第二个手写元件，而是这个生成器在位宽 2 下的结果，注册
// 它是为了让以后的章节能用。
//
// 为什么它不是 createWideDefs 的一部分。那个生成器给它产出的每个 def 的所有引脚
// 都用一个位宽，而解码器的两个引脚刻意不同：sel 是 w 位、out 是 2 ** w 位。id
// 说明它是哪个位宽（decoder3 = 3 位选择、8 位输出），而位宽是 DEF 的参数而不是
// 实例的参数，理由正是模块开头为 splitter / maker 给出的那条：
// params.width 会加宽一个实例的**每个**引脚（net.ts 的 effectiveWidth），所以
// 没有任何实例旋钮能让一个引脚三位、另一个八位。由 createWideDefs(8) 搭出的
// 解码器会有一个 2 ** 8 = 256 位的 out 引脚——这个项目没有承载它的载体——这就是
// 为什么注册的位宽来自下面的字面量列表，而 createWideDefs 永远不生成解码器。
//
// 独热输出。发布的值是 2 ** sel：第 sel 位为高、其余位为低。这正是解码器的
// 用途——把地址变成 N 选 1 的选择线——而关卡数据在两个位宽下都用
// truthTable(io, { out: ({ sel }) => 1 << (sel ?? 0) }) 陈述同一契约。两种写法
// 对关卡数据能到达的每个 sel 都一致，只在 << 出问题的地方分道扬镳：def 发布
// 2 ** sel，因为 5 位选择会到达第 31 位，而 << 会经 int32 转换（见下面的
// createDecoderDef）。改为发布 sel 那会是一个披着解码器引脚的导线：它在 sel 为
// 0 和 1 时与独热读法一致，再往上全都不同，那就是第 26 关测试文件判为失败的
// "直通解码器"。不要把它"简化"成选择值。
//
// 代价。cost 是 1——每个运算符都付的延迟单位（规格 §3.2），因为元件无论展开成
// 多少个最小项都只是一个节点。gateCost 是最小项树的 NAND 数，在下面的
// decoderNand 处推导，并在每个 def 上显式写出，永不从 cost 继承。
// ---------------------------------------------------------------------------

/**
 * 这个生成器愿意构建的最宽选择字段：out 是 2 ** w 位，所以 w = 5 就是 32 位输出
 * ——上限是这个项目的端口载体，而不是 number 类型。JavaScript 整数精确到
 * 2 ** 53，所以更宽的解码器在算术上并非不可能；挡住它的是上面的 MAX_WIDE_WIDTH，
 * 也就是这里每个运算符用 number 承载的 32 位，与 createWideDefs 不生成解码器的
 * 理由相同（见段落说明）。输出引脚超出本项目载体能力的元件，不是本阶段能注册的
 * 元件。
 *
 * 超出 [1, DECODER_MAX_WIDTH] 的位宽会被**拒绝**而不是夹紧，这与 clampWidth
 * 相反而且是有意的：把一个 6 位解码器的请求夹紧，会在沉默中交给调用方一个引脚
 * 形状与所求不同的元件，而任何关卡名本来也到不了这种位宽。
 */
export const DECODER_MAX_WIDTH = 5;

/**
 * w 到 2 ** w 解码器的 NAND 数：**w 个反相器，加 2 ** (w + 1) - 4 个与门**，
 * 与这个文件里其它计数使用同一基准（一个 2 输入与非门是单位，所以 NOT = 1、
 * AND = 2）。
 *
 * 构造就是第 26 关教的共享最小项树——不要为每条输出线重建一次低位译码：
 *
 *  * 把每个选择位取反：w 个 NOT，为树提供每一位的两个字面量。
 *  * 一次一个地长大最小项。第 2 层把第 1 位的两个字面量分别与第 0 位的两个字面量
 *    相与：4 个 AND，得到低两位的四个最小项。第 j 层对已有的 2 ** (j - 1) 个
 *    最小项做同样的事、乘上前一位的两个字面量：2 ** j 个 AND。最后一层就是那
 *    2 ** w 条输出线，所以没有任何最小项被译码两次，树的深度是 w。
 *  * AND 总数 = sum(2 ** j for j in 2..w) = 2 ** (w + 1) - 4。
 *
 *   w | NOT | AND | NAND | 关卡数据里的同一个数字
 *   --|-----|-----|------|-----------------------------------------------------
 *   1 |  1  |  0  |   1  | 第 25 关的参考：一个 not，maker 免费
 *   2 |  2  |  4  |  10  | 2 个 NOT + 4 个两字面量 AND
 *   3 |  3  | 12  |  27  | 第 26 关的参考：3 个 NOT + 4 个 AND + 8 个 AND
 *
 * 两个关卡目标都是这棵树自己的算术，这正好验证了这些数字描述的是关卡作者所依据
 * 的构造，而不是这里发明的画法。这是有文档记录的构造，不是已证明的最小值：共享
 * 低位译码正是它比 2 ** w 个扁平的 w 输入与门便宜的原因（w = 3 时是 27 而不是
 * 35 个 NAND）。
 */
function decoderNand(w: number): number {
  return w * NOT + (2 ** (w + 1) - 4) * AND;
}

/**
 * 一个 w 位选择的解码器：sel: w 进，out: 2 ** w 出，独热。
 *
 * 生成器就是位宽机制，与 createWideDefs(width) 对运算符一样：createDecoderDef(3)
 * 就是 decoder3（sel:3 -> out:8），引脚按该位宽重建，而不是按实例重新计数
 * （内核做不到这一点——见段落说明）。
 *
 * sel 经 toUint 读取，所以被污染、超宽或未接线的选择值会先被掩进选择字段，然后
 * 才可能用于索引；发布的值随后是 2 ** sel，最多为 2 ** (2 ** w - 1)，按构造装得
 * 进引脚。用 2 ** sel 而不是 1 << sel：<< 会经 int32 转换，于是 5 位选择时第 31
 * 位会变成负数——这个文件里每个 def 都在避免的"负数读数"。
 */
export function createDecoderDef(width: number): ComponentDef {
  if (!Number.isInteger(width) || width < 1 || width > DECODER_MAX_WIDTH) {
    throw new Error(`decoder width must be an integer in 1..${DECODER_MAX_WIDTH}, got ${width}`);
  }
  const w = width;
  const lines = 2 ** w;
  return combinational(
    `decoder${w}`,
    { zh: `${w} 位解码器`, en: `${w}-Bit Decoder` },
    'wide',
    [{ id: 'sel', width: w }],
    [{ id: 'out', width: lines }],
    // 延迟单位，一个节点算 1；门数指标是下面那棵树。
    1,
    decoderNand(w),
    (i, o) => {
      o[0] = u(2 ** toUint(i[0], w), lines);
    },
  );
}

/**
 * 本阶段注册的选择位宽，按顺序排列。
 *
 * 1 和 3 是关卡名引入的位宽；2 是 2.x 资料集里的 2 位解码器，没有关卡名引入它，
 * 因此它绝不能变成自己手写的元件——它就是 createDecoderDef(2)。
 */
export const DECODER_WIDTHS = [1, 2, 3] as const;

/**
 * DECODER_DEFS 注册的 id，按顺序排列，写成字面量元组，好让 DEF_IDS 展开它、并让
 * DefId 仍然收窄到单个字符串。
 *
 * id 是 decoder 加上**选择**位宽，这是关卡数据拼写的契约
 * （ch2-35-1-bit-decoder 奖励 decoder1，第 26 关奖励 decoder3）；输出位宽是
 * 2 ** w，刻意不放进名字里。
 */
export const DECODER_DEF_IDS = ['decoder1', 'decoder2', 'decoder3'] as const;

/**
 * 解码器家族，按 DECODER_DEF_IDS 的顺序排列。
 *
 * 从这张列表注册而不是调用 createWideDefs 的理由见段落说明：输出引脚是 2 ** w
 * 位，所以这些位宽是这个家族自己拥有的决定。
 */
export const DECODER_DEFS: readonly ComponentDef[] = DECODER_WIDTHS.map((w) => createDecoderDef(w));

// ---------------------------------------------------------------------------
// 存储家族（任务 4）
//
// 八位家族的有状态一半：多路选择器、延迟线、寄存器、计数器和按字节寻址的存储器。
// id 与引脚名是第 2 章关卡数据书写时所依据的契约，和上面的运算符完全一样；每条
// 边界规则都在这里**决定**，而不是继承而来——每个 def 都说明它遵守哪一条。
//
// 为什么不做位宽生成。createWideDefs(width) 的存在是为了让 phase 5 不必写第二个
// 家族就能注册 16/32/64 位运算符；这五个只在八位注册，来自本节末尾的字面量列表。
// 原因是 stateBytes：它是每实例的分配量，而一个 ram{w} 要存 2 ** w 个字节——按
// 生成器自己的 MAX_WIDE_WIDTH 32 算，单个 RAM 实例就要向堆申请 4 GiB。phase 5
// 可以在想清楚宽位 RAM 意味着什么之后为这些存储元件加生成器；这里的任何东西都
// 不该从默认参数继承那个决定。
//
// 状态布局：每个 def 自己的。存储 def 把它保存的东西放在自己的 stateBytes 个字节
// 里，并在自己的 evaluate 里读回来。单字节保存者在 state[0] 里放那个字节；ram8
// 保存 256 个字节并发布 addr 选中的那个。内核已经没有自己的布局需要与谁保持一致
// 了：Simulation.#publishState 曾经把 state[p] 写到第 p 个输出引脚、每引脚一位，
// 那只对 1 位值正确——八位寄存器会被写成 0b00000001 输出到引脚上，之所以看不出来
// 只是因为紧随其后的结算会通过 evaluate 重新发布，而对那个没有 evaluate 的 def
// 来说则是致命的。所以"状态到引脚"的映射只在这里、在它所描述的状态旁边陈述一次。
//
// 代价：两个指标全免费，而这是裁决而不是疏漏。门数指标衡量玩家**搭出来**的东西，
// 而不是平台**提供**的东西；而且"内置"并不是一个 def 免费的原因：gateCost() 对
// 每个放置的实例收取它 def 声明的计数，内置原语也像别的东西一样声明计数——nand
// 1、not 1、and 2、or 3（defs/index.ts 的基准表）、and8 16、add8 72（见上）。
// 免费的是 "?? def.cost" 这条回退，而这条回退对恰好四种 def 是 0：电源轨、关卡
// 连接器、导线性质的打包器（splitter、maker），以及**存储元件**。存储是第四个
// 例外，不是一般意义上的内置元件。正是这个存储例外，让直接放下已解锁元件比用门
// 重新搭建得分更好；也正是它让一块 256 字节的 ram8 是 0 个 NAND 等价门，而不是
// 它的展开量——2,048 个存储位，每个锁存单元几个 NAND，还没算地址译码——那会盖过
// 一个关卡的全部门数预算，让任何涉及存储的门数目标失去意义。想让存储**花门数**
// 的玩家改为用托盘里的门自己搭锁存器——交叉耦合对就是两个 nand 或两个 nor，
// 再加上使能与写逻辑所需的全部门——然后为每一个门付费。所以 delay8、reg8、
// counter8 和 ram8 的 gateCost 保持**不写**；给它们定价不是以后要做的改进。
//
// 对 cost（延迟指标）来说，同一个答案有自己的理由：存储元件在两个方向上都切断
// 组合路径，不贡献延迟单位（全局约束 4：delayOf 不收它的钱；它的代价体现在节拍
// 指标里）。"?? cost" 回退保留不动，理由与 phase 0 在 delay_line 和 mem1 上保留
// 它相同：存储在两个指标上都是 0，再显式写一个 0 只会给两个 0 制造分头漂移的
// 机会。mux8 是本节里唯一的组合元件，它的计数——8 x MUX2——与上面的运算符一样
// 显式写出。
// ---------------------------------------------------------------------------

/**
 * 存储家族的位宽：八位，与下面每个 id 里的那个 8 一起硬编码在这里。
 *
 * DEFAULT_WIDE_WIDTH 恰好是同一个数，而这里刻意不用它：id 是与关卡数据之间的
 * 契约，所以它们命名的位宽与引脚构建所用的位宽不能有机会漂开。
 */
const W = 8;

/**
 * 发布单字节保存者存放在 state[0] 里的那个字节。
 *
 * 由 delay8、reg8 和 counter8 共用，所以存储契约的发布规则只写一次：inputs 参数
 * 被接受（内核会传）并刻意从不读取，因为发布输入的存储元件就是导线。缺失的状态
 * 字节读 0，与 delay_line 一致。
 */
const publishByte = (
  _i: readonly PortValue[],
  o: PortValue[],
  state: Uint8Array | undefined,
): void => {
  o[0] = state?.[0] ?? 0;
};

/**
 * mux8：sel = 0 时透传 a，sel = 1 时透传 b。
 *
 * 纯组合——没有状态、没有时钟沿——所以像其它运算符一样花一个延迟单位，而门数
 * 指标是 8 x MUX2 = 32：字节宽的 2:1 多路选择器就是每位一个 2:1 选择器，与这个
 * 文件其余部分使用同一个 NAND 基准。
 */
const mux8: ComponentDef = combinational(
  'mux8',
  { zh: '8 位多路选择器', en: '8-Bit Multiplexer' },
  'wide',
  [
    { id: 'a', width: W },
    { id: 'b', width: W },
    { id: 'sel', width: 1 },
  ],
  wideOut(W),
  1,
  W * MUX2,
  (i, o) => {
    o[0] = bit(i[2]) === 1 ? toUint(i[1], W) : toUint(i[0], W);
  },
);

/**
 * delay8：上一个时钟沿时 a 上的那个字节。
 *
 * clockEdge 采样，evaluate 发布采样到的内容；两半都不碰对方的职责。正是这个
 * 拆分让它成为延迟线而不是导线，也是 phase 0 用两个 bug 换来的契约。
 */
const delay8: ComponentDef = {
  id: 'delay8',
  name: { zh: '8 位延迟线', en: '8-Bit Delay Line' },
  category: 'wide',
  inputs: [{ id: 'a', width: W }],
  outputs: wideOut(W),
  cost: 0,
  sequential: true,
  stateBytes: 1,
  evaluate: publishByte,
  clockEdge: (i, _o, state) => {
    state[0] = toUint(i[0], W);
  },
};

/**
 * reg8：带载入使能与清零的八位寄存器。
 *
 * 时钟沿上：reset = 1 就清零；否则 load = 1 采样 d；否则保持。**已决定：
 * reset 优先于 load**——两个同时断言时，清零是无条件的，所以关卡要求清零的那个
 * 沿不能由 d 胜出。两个输入都是被**采样**的，不是电平触发：在两次时钟沿之间断言
 * reset 不会影响输出，直到下一个沿。
 */
const reg8: ComponentDef = {
  id: 'reg8',
  name: { zh: '8 位寄存器', en: '8-Bit Register' },
  category: 'wide',
  inputs: [
    { id: 'd', width: W },
    { id: 'load', width: 1 },
    { id: 'reset', width: 1 },
  ],
  outputs: wideOut(W),
  cost: 0,
  sequential: true,
  stateBytes: 1,
  // 只发布保持的字节：在这里读 d、load 或 reset 会让寄存器变成导线，而且根本
  // 没有必要读它们。
  evaluate: publishByte,
  clockEdge: (i, _o, state) => {
    if (bit(i[2]) === 1) state[0] = 0;
    else if (bit(i[1]) === 1) state[0] = toUint(i[0], W);
  },
};

/**
 * counter8：en = 1 时对时钟沿计数。
 *
 * **已决定：计数在 256 处回绕到 0**（255 + 1 = 0），而不是饱和，所以计数器是一个
 * 持续转动的周期 256 时基。**已决定：同一沿上 reset 优先于 en**，规则与 reg8
 * 相同：已断言的清零不是使能能覆盖的东西。en 为低时任意多个沿都保持计数不变。
 */
const counter8: ComponentDef = {
  id: 'counter8',
  name: { zh: '8 位计数器', en: '8-Bit Counter' },
  category: 'wide',
  inputs: [
    { id: 'en', width: 1 },
    { id: 'reset', width: 1 },
  ],
  outputs: wideOut(W),
  cost: 0,
  sequential: true,
  stateBytes: 1,
  evaluate: publishByte,
  clockEdge: (i, _o, state) => {
    if (bit(i[1]) === 1) state[0] = 0;
    else if (bit(i[0]) === 1) state[0] = ((state[0] ?? 0) + 1) & 0xff;
  },
};

/**
 * ram8：256 字节存储，按 addr 读取。
 *
 * 读路径是组合的，写路径不是。load = 1 时在时钟沿把 d 写到 addr；读取跟随 addr、
 * 完全不需要时钟沿，这就是为什么这个 evaluate——在项目所有存储 def 里独一无二
 * ——会读取一个输入。
 *
 * 全局约束 5 禁止 evaluate 读输入，理由它已经给出：镜像输入的存储元件是导线。
 * 读 addr 没有这么做，区别是精确的：addr 只能**选择** state 里的一个字节，而发布
 * 的值永远是某个时钟沿放进去的，所以任何输入的**值**都无法经这条路径到达引脚。
 * d（i[0]）和 load（i[2]）在这里刻意从不读取，所以写路径上的任何东西也不会泄露
 * 到读路径。一个发布 d 的版本恰恰就是这条契约要防止的导线，测试把两半都钉住。
 *
 * stateBytes 是诚实的 256：每个地址一个字节（2 ** W），内核为每个实例分配一个
 * 这样的数组——状态不存在信号表里，信号表的容量是按引脚算的。
 */
const ram8: ComponentDef = {
  id: 'ram8',
  name: { zh: '8 位存储器', en: '8-Bit RAM' },
  category: 'wide',
  inputs: [
    { id: 'd', width: W },
    { id: 'addr', width: W },
    { id: 'load', width: 1 },
  ],
  outputs: wideOut(W),
  cost: 0,
  sequential: true,
  stateBytes: 2 ** W,
  evaluate: (i, o, state) => {
    o[0] = state?.[toUint(i[1], W)] ?? 0;
  },
  clockEdge: (i, _o, state) => {
    if (bit(i[2]) === 1) state[toUint(i[1], W)] = toUint(i[0], W);
  },
};

/**
 * WIDE_STORAGE_DEFS 注册的 id，按顺序排列，写成字面量元组，好让 DEF_IDS 展开它、
 * 并让 DefId 仍然收窄到单个字符串。
 *
 * 这五个是任务 4 的任务书固定在八位的元件；它们不是从位宽参数推导的（见上面的
 * 段落说明），所以这张列表与上面的 def 由 test/core/defs-wide.test.ts 互相钉住。
 */
export const WIDE_STORAGE_DEF_IDS = [
  'mux8',
  'delay8',
  'reg8',
  'counter8',
  'ram8',
] as const;

/**
 * 存储家族，八位，按 WIDE_STORAGE_DEFS 的顺序排列。
 *
 * 以普通列表而不是 createStorageDefs(width) 生成器提供，是有意的：id 写着八位、
 * ram8 的状态是 2 ** 8 个字节，而想要 16 位寄存器的阶段应当先决定 ram16 是什么，
 * 再让某个默认参数替它决定。
 */
export const WIDE_STORAGE_DEFS: readonly ComponentDef[] = [
  mux8,
  delay8,
  reg8,
  counter8,
  ram8,
];
