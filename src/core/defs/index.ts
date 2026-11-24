import type { ComponentDef } from '../registry';
import { CPU_DEFS, CPU_DEF_IDS } from './cpu';
import {
  DECODER_DEFS,
  DECODER_DEF_IDS,
  FULL_ADDER,
  PACKER_DEFS,
  PACKER_DEF_IDS,
  WIDE_DEF_IDS,
  WIDE_STORAGE_DEFS,
  WIDE_STORAGE_DEF_IDS,
  createWideDefs,
} from './wide';

/**
 * 基础元件定义的汇总表：把 1 位门、常量源、关卡 IO、存储元件、宽位家族、
 * 打包器、解码器与 CPU 家族按固定顺序装配成注册表的输入清单。
 *
 * 对外导出 DEF_IDS（全部元件 id 的字面量联合类型）与 BASE_DEFS（对应的定义
 * 数组）；两者顺序一致，各家族测试会核对。宽位 / 存储 / 解码器 / CPU 的定义
 * 本体在 wide.ts 与 cpu.ts，这里只负责展开与排序。
 *
 * 依赖：registry.ts 的类型，以及 wide.ts / cpu.ts；使用者是 main.ts（用
 * BASE_DEFS 建注册表）与测试（用 DEF_IDS 核对 id 清单与注册结果一致）。
 */
// ---------------------------------------------------------------------------
// 门数指标：1 位门的 NAND 等价基准，wide.ts 里的位切片单元也按同一基准计价。
//
// 单位是一个 2 输入与非门（成本口径：展开时每个基础门的贡献 = 1）。cost 是
// 延迟单位，下面每个门都保持 1；gateCost 是标准全与非门实现下该门展开成多少个
// 2 输入与非门：
//
//   门   | NAND 数 | 构造
//   -----|---------|----------------------------------------------------------
//   NAND |   1     | 就是单位本身
//   NOT  |   1     | NAND(a, a)
//   AND  |   2     | NAND(a, b) -> NOT
//   OR   |   3     | NOT a, NOT b, NAND(~a, ~b)            [德摩根]
//   NOR  |   4     | NOT(or) = OR 的三个与非门再加一个反相器
//   XOR  |   4     | 经典的四与非门单元
//   XNOR |   5     | XOR -> NOT
//   AND3 |   4     | AND(a, b)（2 个）再 AND(ab, c)（2 个）。3 个做不到：
//        |         | 第三个与非门会把手上已有两个信号的乘积反相，
//        |         | 而没有任何这种乘积是 ~(abc)
//   OR3  |   6     | NOT a、NOT b、NOT c，再加一个 3 输入与非门（本身算 3 个）
//        |         | = 6；级联的 or(or(a, b), c) 也是 3 + 3 = 6
//
// 第十个 1 位门 full_adder 是这个基准下最大的单元：FULL_ADDER = 9，而 wide.ts
// 把 add8 定为它的八倍（8 x 9 = 72）。它的构造写在下方的 def 处，数量用的是那个
// 文件导出的 FULL_ADDER 常量，而不是再写一个字面量 9。
//
// 这些是有文档记录的构造，不是已证明的最小值——AND3 是其中唯一带最小性论证
// 的（上文已简述）。cost 与 gateCost 只在 NAND 和 NOT 上恰好相同，所以下面每个
// 门都同时写出两个字段：一个"只值一个与非门"的 and 正是这张表要修掉的 bug，
// 因为 and8 的每一位在同一个基准下值 2。
// ---------------------------------------------------------------------------
const NAND = 1;
const NOT = 1;
const AND = 2;
const OR = 3;
const XOR = 4;

/**
 * 造一个 1 位组合逻辑门：从完整真值表生成 evaluate，输出引脚固定叫 out。
 *
 * 参数 table 的下标就是输入向量（第 0 个输入是二进制最低位），长度必须恰好是
 * 2 ** inputs——长度不符会直接抛错，而不是让 evaluate 读到 undefined。
 * gateCost 是该门在标准全与非门实现下的 NAND 数；cost 固定为 1，表示它占一个
 * 延迟单位。
 */
const gate = (
  id: string,
  zh: string,
  en: string,
  inputs: number,
  /** 每种输入组合对应的输出；下标就是输入向量。 */
  table: readonly number[],
  /** NAND 等价数：该门标准全与非门单元里的 2 输入与非门个数。 */
  gateCost: number,
): ComponentDef => {
  if (table.length !== 1 << inputs) {
    throw new Error(`${id}: expected ${1 << inputs} truth-table entries, got ${table.length}`);
  }
  return {
    id,
    name: { zh, en },
    category: 'logic1',
    inputs: Array.from({ length: inputs }, (_, i) => ({
      id: String.fromCharCode(97 + i),
      width: 1,
    })),
    outputs: [{ id: 'out', width: 1 }],
    // 延迟单位，一个节点算 1（延迟口径）。门数指标不读它——门数读的是
    // gateCost，其数字在上面的表格和下面每个调用点处。
    cost: 1,
    gateCost,
    sequential: false,
    stateBytes: 0,
    evaluate: (i, o) => {
      let index = 0;
      for (let p = 0; p < inputs; p += 1) index |= (i[p] === 1 ? 1 : 0) << p;
      o[0] = table[index] === 1 ? 1 : 0;
    },
  };
};

/**
 * full_adder：sum = a XOR b XOR cin，cout 是 a、b、cin 的多数（三取二，至少两个
 * 为 1 时输出高）。这是标准的 1 位全加器：第 20 关发放的元件、第 21 关亲手搭的
 * 拼图、第 22 关拿八个级联成字节加法器（一级的进位接下一级的 cin）。
 *
 * 没有用 gate() 来搭。那个辅助函数按单输出真值表生成恰好一个名为 out 的输出
 * 引脚，而这个元件有两个按名字被关卡数据寻址的输出（sum、cout）；输入个数与
 * "把引脚值归一成 0/1"的做法两边完全一样。
 *
 * 该单元在 2 输入与非门下需要 9 个：
 *
 *   x1 = NAND(a, b)        x2 = NAND(a, x1)      x3 = NAND(b, x1)
 *   s1 = NAND(x2, x3)      = a XOR b
 *   s2 = NAND(s1, cin)     s3 = NAND(s1, s2)     s4 = NAND(cin, s2)
 *   sum = NAND(s3, s4)     = s1 XOR cin
 *   cout = NAND(x1, s2)    = ab + cin(a XOR b)
 *
 * 两个四与非门的 XOR（x2/x3/s1 与 s2/s3/s4/sum）共八个，进位是第九个：cout
 * 复用 x1 和 s2 这两个手上已有的乘积，而不是重新搭一遍，所以它是 NAND(x1, s2)
 * 而不是第十个门。正是这次复用让计数是 9，也就是 add8 的八倍。
 *
 * gateCost 用的是从 wide.ts 导入的 FULL_ADDER，而不是再写一个字面量 9：注册的
 * 1 位门与 add8 的每一位是同一个构造，同一个构造写两个数字就是门数指标漂移的
 * 开始。延迟单位两种写法都是 1——1 位元件在最长路径上就是一个节点，无论它展开
 * 成几个门。
 */
const fullAdder: ComponentDef = {
  id: 'full_adder',
  name: { zh: '全加器', en: 'Full Adder' },
  category: 'logic1',
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'cin', width: 1 },
  ],
  outputs: [
    { id: 'sum', width: 1 },
    { id: 'cout', width: 1 },
  ],
  cost: 1,
  gateCost: FULL_ADDER,
  sequential: false,
  stateBytes: 0,
  evaluate: (i, o) => {
    const a = i[0] === 1 ? 1 : 0;
    const b = i[1] === 1 ? 1 : 0;
    const cin = i[2] === 1 ? 1 : 0;
    o[0] = a ^ b ^ cin;
    o[1] = a + b + cin >= 2 ? 1 : 0;
  },
};

// 常量源用 category: 'io' 而不是 'logic1'：它们没有输入，只是驱动关卡信号，
// 因此不该和逻辑门归在一起。注册表测试会断言 byCategory('logic1') 里不含
// const_on，把这一点固定下来。下游没有任何地方按 category 给托盘分组（由关卡的
// allowedComponents 决定），所以这只会影响分组标题。
//
// 两个指标上都是 0——电源轨不是门——所以这是那些合法地把 gateCost 留给
// "?? cost" 回退的 def 之一。
const source = (id: string, zh: string, en: string, value: 0 | 1): ComponentDef => ({
  id,
  name: { zh, en },
  category: 'io',
  inputs: [],
  outputs: [{ id: 'out', width: 1 }],
  cost: 0,
  sequential: false,
  stateBytes: 0,
  evaluate: (_i, o) => {
    o[0] = value;
  },
});

/**
 * phase 0 发放的元件 id 列表，按注册顺序排列。这张列表与 BASE_DEFS 中对应定义
 * 的顺序必须一致，测试会核对。
 */
const PHASE0_DEF_IDS = [
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
  'level_input',
  'level_output',
] as const;

/**
 * phase 0 之后补充的 1 位门，按注册顺序排列。
 *
 * full_adder 和上面的元件一样是 logic1 门——逐引脚都是 1 位、按同一 NAND 基准
 * 计价——但它是第 2 章的元件（第 20 关的奖励），不属于 phase 0 交付的内容，所以
 * 没有写进 PHASE0_DEF_IDS：那个名字和顺序描述的是另一套集合。
 */
const POST_PHASE0_DEF_IDS = ['full_adder'] as const;

/**
 * 游戏发放的全部元件 id：phase 0 的 1 位元件、之后补的 1 位门，然后是宽位家族
 * ——运算符、16/32 位打包器、存储元件与解码器——最后是第 3 章奖励的 CPU 家族。
 *
 * 宽位 id 不在这里重复：wide.ts 把它们与对应的定义放在一起，并由
 * test/core/defs-wide.test.ts 确保每张列表与它注册的定义一致，这样一个宽位定义
 * 就不会注册到关卡数据拼不出来的 id 上。CPU id 遵循同样的规则：cpu.ts 是它们的
 * 所有者，test/core/defs-cpu.test.ts 负责钉住。
 */
export const DEF_IDS = [
  ...PHASE0_DEF_IDS,
  ...POST_PHASE0_DEF_IDS,
  ...WIDE_DEF_IDS,
  ...PACKER_DEF_IDS,
  ...WIDE_STORAGE_DEF_IDS,
  ...DECODER_DEF_IDS,
  ...CPU_DEF_IDS,
] as const;

/** 所有已注册元件 id 的字面量联合类型；新增元件必须同步进 DEF_IDS，否则类型层面就引用了不存在的 id。 */
export type DefId = (typeof DEF_IDS)[number];

/**
 * 游戏注册的全部基础元件定义，顺序与 DEF_IDS 一致。
 *
 * 宽位家族、打包器、存储、解码器与 CPU 家族由各自模块负责生成或列举，这里只按
 * 顺序展开；因此新增一个元件必须同时进入对应模块的 id 列表与这里的展开处。
 */
export const BASE_DEFS: readonly ComponentDef[] = [
  source('const_on', '高电平', 'Constant On', 1),
  source('const_off', '低电平', 'Constant Off', 0),

  // 真值表完整写出。下标是输入向量，输入 a 是最低位，所以下标 0b10 表示
  // a=0、b=1。写全表让每个门一眼可审计，而不需要读者在脑子里求值一个布尔
  // 表达式。
  //
  // 最后一个参数是门数指标（按上面表格的 NAND 等价数）；每行注释就是这个数字
  // 的构造，所以这里没有任何计数需要被"相信"。
  gate('nand', '与非门', 'NAND', 2, [1, 1, 1, 0], NAND),
  gate('not', '非门', 'NOT', 1, [1, 0], NOT), // 即 NAND(a, a)
  gate('and', '与门', 'AND', 2, [0, 0, 0, 1], AND), // NAND(a, b) 再接一个 NOT
  gate('or', '或门', 'OR', 2, [0, 1, 1, 1], OR), // NOT a、NOT b，再 NAND(~a, ~b)
  gate('nor', '或非门', 'NOR', 2, [1, 0, 0, 0], OR + NOT), // 即 NOT(or)
  gate('xor', '异或门', 'XOR', 2, [0, 1, 1, 0], XOR), // 经典四与非门单元
  gate('xnor', '同或门', 'XNOR', 2, [1, 0, 0, 1], XOR + NOT), // 即 NOT(xor)
  // 两个 AND：先 AND(a, b)，再 AND(ab, c)。AND3 的最小值是 4（见表格）。
  gate('and3', '三路与门', '3-Pin AND', 3, [0, 0, 0, 0, 0, 0, 0, 1], 2 * AND),
  // NOT a、NOT b、NOT c，再加一个 3 输入与非门；级联的 or 结构总数也是 6。
  gate('or3', '三路或门', '3-Pin OR', 3, [0, 1, 1, 1, 1, 1, 1, 1], 2 * OR),
  // 这个元件有两个具名输出，所以手写而不是用 gate() 生成；它的 9 与非门单元
  // 以及该计数的构造写在该 def 处。
  fullAdder,

  // 关卡 IO 管线元件。在托盘中始终可用，不通过解锁获得。
  {
    id: 'level_input',
    name: { zh: '关卡输入', en: 'Level Input' },
    category: 'level',
    inputs: [],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: false,
    stateBytes: 0,
    evaluate: () => {
      // 由关卡检查器直接通过信号表驱动，这里不需要求值。
    },
    hidden: true,
  },
  {
    id: 'level_output',
    name: { zh: '关卡输出', en: 'Level Output' },
    category: 'level',
    inputs: [{ id: 'in', width: 1 }],
    outputs: [{ id: 'mirror', width: 1 }],
    cost: 0,
    sequential: false,
    stateBytes: 0,
    evaluate: (i, o) => {
      o[0] = i[0] ?? 0;
    },
    hidden: true,
  },

  // 存储元件。evaluate 发布 state 中保持的值，绝不能读它的输入；clockEdge 把
  // 输入采样进 state，绝不能写输出。内核在 reset() / tick() 时发布状态，其它
  // 所有结算轮次都走通用的 evaluate 路径——所以延迟线会保持整整一个节拍，而不会
  // 变成一根导线。
  {
    id: 'delay_line',
    name: { zh: '延迟线', en: 'Delay Line' },
    category: 'memory1',
    inputs: [{ id: 'in', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: true,
    stateBytes: 1,
    evaluate: (_i, o, state) => {
      // 发布保持的值。注意：这里绝不能读 i——一根镜像输入的延迟线就是导线。
      o[0] = state?.[0] === 1 ? 1 : 0;
    },
    clockEdge: (i, _o, state) => {
      // 只采样，别的什么都不做：在状态被发布之前，输出保持时钟沿之前的值。
      state[0] = i[0] === 1 ? 1 : 0;
    },
  },

  {
    id: 'mem1',
    name: { zh: '1 位存储器', en: '1-Bit Memory' },
    category: 'memory1',
    inputs: [
      { id: 'set', width: 1 },
      { id: 'value', width: 1 },
    ],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: true,
    stateBytes: 1,
    evaluate: (_i, o, state) => {
      // 保持：发布已存的那一位，忽略两个输入。
      o[0] = state?.[0] === 1 ? 1 : 0;
    },
    clockEdge: (i, _o, state) => {
      if (i[0] === 1) state[0] = i[1] === 1 ? 1 : 0;
    },
  },

  // 宽位（8 位）家族。按默认位宽注册——8 是本阶段唯一开放的位宽；
  // createWideDefs(width) 是留给 16/32/64 位的挂载点。
  //
  // 与上面的门使用同一个 NAND 基准，并按位宽缩放：and8 = 8 x AND = 16，
  // add8 = 8 个全加器 = 72。构造写在 wide.ts 每个 def 旁边，
  // test/core/defs-wide.test.ts 会把它的逐位单元与这些 1 位门交叉核对，两张表
  // 因此不会漂成两种基准。
  ...createWideDefs(),

  // 16 位与 32 位的打包器配对，注册在它们所加宽的 8 位配对旁边。沙盒的连接器
  // 芯片允许玩家把引脚开到 16 或 32 位，而 8 位的 splitter 无法恢复更宽值的高位
  // ——compile 只会复制其中八位、其余读零——于是 16 位沙盒电路没法看到自己的输入
  // 被拆开。wide.ts 的 PACKER_DEFS 说明了范围（16/32 正好是连接器能到达的、超过
  // 八位的位宽；64 位需要字节数组载体，那是 phase 6a 的工作）以及为什么它们用
  // 独立 id 而不是实例位宽。它们是普通的基础 def，所以沙盒托盘会提供它们，关卡
  // 仍须自行列出——目前没有关卡列出。
  ...PACKER_DEFS,

  // 8 位存储家族（任务 4）：字节多路选择器、字节延迟线、寄存器、计数器和
  // 256 字节 RAM。用字面量列表注册而不是位宽生成器——32 位 RAM 每个实例就要
  // 4 GiB 状态；理由见 wide.ts 的段落说明。
  //
  // 它们每一个都通过自己的 evaluate 发布自己保存的值，和结算扫描调用的是同一个
  // 函数，这正是内核能正确发布八位寄存器的原因（见 Simulation.#publishState）。
  // 它们在两个指标上都是免费的，和上面两个 1 位存储器一样：同时断言清零时清零
  // 优先于 load/en，计数器在 256 处回绕到 0。
  ...WIDE_STORAGE_DEFS,

  // 解码器家族（任务 10）：decoder1（sel:1 -> out:2）和 decoder3
  // （sel:3 -> out:8）是第 2 章第 25、26 关奖励并放进各自托盘的元件；decoder2
  // 是同一个生成器在位宽 2 下的产物。按 id 里写的位宽注册，而不是家族的默认
  // 位宽，因为解码器的 out 引脚是 2 ** w 位——id 说明它是哪个元件，
  // createDecoderDef(w) 负责生成。它们的论证记录在 wide.ts：生成器、独热约定，
  // 以及给它们定价的最小项树（w = 1 / 2 / 3 时为 1 / 10 / 27 个 NAND 等价门）。
  ...DECODER_DEFS,

  // CPU 家族（phase 2 任务 2）：第 3 章奖励、第 47 关用它们搭出 AXIS 的
  // 六个元件——alu8、regfile6、instr_decoder、pc8、ram_prog、halt。像存储家族与
  // 解码器家族一样从 cpu.ts 自己的字面量 id 列表注册：没有任何位宽参数能生成
  // 它们，所以列表与它所命名的 def 放在一起，并由 test/core/defs-cpu.test.ts 把
  // 两者互相钉住。它们带有 category: 'cpu'，自成一族——logic1、wide 和 level
  // 各自被测试精确钉在自己命名的那一族上，而这六个哪个都不属于。cpu.ts 的文件头
  // 说明了它们每一个的代价，以及它们是"零件"而不是一颗 CPU（全局约束 11）。
  ...CPU_DEFS,
];
