import type { ComponentDef } from '../registry';
import type { PortValue } from '../signal';
import { FULL_ADDER, toUint } from './wide';

/**
 * CPU 家族（phase 2 任务 2）：第 3 章发放、第 47 关用来搭出 OVERTURE 的六个
 * 元件——alu8、regfile6、instr_decoder、pc8、ram_prog 与 halt。
 *
 * 它们是零件，不是一颗 CPU。全局约束 11 规定 CPU 是玩家要搭出来的东西；一个
 * class Overture，或任何"知道指令含义"的 def，都是这个家族绝不能变成的样子。
 * 因此下面每个 def 都只是一个带引脚和传递函数的数据通路元件：instr_decoder 只
 * 切字段、从不校验；alu8 把 op 字段映射成结果、从来看不到整条指令字；regfile6
 * 是一个寄存器堆，不知道源操作数和目标操作数是什么；ram_prog 是一块只读的
 * 256 字节存储器。哪个字段接到哪个引脚、we 什么时候有效、跳转条件是什么——
 * 全部由关卡自己的接线决定（全局约束 13：指令语义来自玩家的电路，永不来自
 * def）。
 *
 * 引脚 id 与位宽就是契约。instr_decoder 的五个输出名和位宽是字段布局裁决 5
 * 定死的（mode 2、op 3、dst 3、src 3、imm 6），第 3 章的关卡数据逐字寻址它们
 * ——所以这些 id 和引脚表像 wide.ts 的运算符一样字面写出，而不是从某个命名
 * 规则推导；test/core/defs-cpu.test.ts 断言整套表面，而不是抽查某个元件。
 *
 * category 'cpu' 自成一族。现有家族都被测试精确钉死——logic1 就是十个 1 位门、
 * wide 就是宽位模块自己的注册元组、level 就是两个 IO 连接器——而这六个哪个都
 * 不是：五个是宽位模块之外的 8 位元件，halt 是一根不是门的 1 位导线。把它们
 * 归进 wide 还会让 byCategory('wide') 与 wide.ts 声明的家族不一致。下游没有
 * 任何地方按 category 给托盘分组（defs/index.ts 说过，ui/board/render.ts 只检查
 * 'level'），所以这只是一个说明"属于哪个家族"的标签，仅此而已。
 *
 * 代价：两个指标、两个字段，与 wide.ts 记录的划分相同。cost 是延迟单位（存储、
 * 导线和电源轨为 0，本身就是一个门的运算符为 1）；gateCost 是只被
 * levels/grader.ts 读取的 NAND 等价门数指标。凡值一个与非门的 def 都显式写这个
 * 字段，只有三个存储 def 刻意不写，让它读成 cost 的 0——wide.ts 在 reg8 / ram8
 * 处已经记载的存储裁决（门数指标衡量玩家搭出来的东西，而存储是该指标刻意的
 * 例外）。再显式写一个 0 只会给两个 0 制造分头漂移的机会。
 */

// ---------------------------------------------------------------------------
// 门数指标：NAND 等价基准。与 wide.ts、defs/index.ts 用的是同一张表——一个
// 2 输入与非门是单位，于是 NOT = NAND(a, a) = 1，AND = 2，OR = 3，XOR = 4，
// MUX2 = 4；FULL_ADDER = 9 直接 import 自 wide.ts 而不是重述，这样注册为
// full_adder 的 1 位元件与 alu8 加法器的每一位不可能被算出两个不同的价。
//
// 下面没有任何计数需要被"相信"：alu8 的总数是它 def 处逐项相加写出来的，而
// test/core/defs-cpu.test.ts 会用已注册元件自己的 gateCost 重建这个总数。
// ---------------------------------------------------------------------------
const NOT = 1;
const AND = 2;
const OR = 3;
const XOR = 4;
const MUX2 = 4;

/** 家族的数据宽度：八位，下面每个 id 和引脚都是这个宽度。 */
const W = 8;

/** regfile6 的寄存器个数——id 说六个，stateBytes 是每个寄存器一个字节。 */
const REGS = 6;

/** 读一个 1 位端口为 0 或 1（wide.ts 的私有 bit 函数做同样的读取）。 */
const bit = (v: PortValue | undefined): number => toUint(v, 1);

/**
 * alu8：第 39 关奖励的八位算术引擎。op 选择功能，a 和 b 是操作数，所有结果都是
 * out 上的无符号字节：
 *
 *   op | 功能     | 说明
 *   ---|----------|--------------------------------------------------------
 *   0  | a + b    | 取低八位；没有进位输出引脚
 *   1  | a - b    | 即 a + ~b + 1，所以 0 - 1 是 255，永远不是负数
 *   2  | a AND b  |
 *   3  | a OR b   |
 *   4  | a NAND b |
 *   5  | a NOR b  |
 *   6  | 0        | 保留（见下方决定）
 *   7  | 0        | 保留（见下方决定）
 *
 * 保留的 op 输出 0，这是决定而不是疏漏。裁决 5 给运算留了六个操作
 * （[5:3] = 000..101），110 / 111 在合法指令里不可达。若留作"无所谓"，这两个
 * 编码就会成为"ALU 发布了值却不作任何承诺"的情形，而第一个在全部八个编码上
 * 断言 out 的关卡，就是在断言一个没有任何构造欠它的值。发布 0 让 op 映射成为
 * 全覆盖且可观察的，而且两个保留码都不会与已实现的操作重名——最省事的"默认"
 * 本来是落到 add，那会把畸形指令变成静默的算术。ISA 关于"calc 的保留位必须为
 * 0"的规则仍归关卡（解码器发布字段，关卡负责检查）；这个 def 只报告 0，不做
 * 陷阱。
 *
 * 该单元在 2 输入与非门下需要 264 个，每一项对应图上的一个部件。op 字段只被
 * 译码成结构需要的四条控制线（c_sub、c_arith、c_or、c_inv，再加 reserved），
 * 从不译成独热码：
 *
 *   项                         | 数量              | 构造
 *   -------------------------- | ----------------- | ---------------------------
 *   行波加法器                 | 8 x 9   =  72     | 8 个 FULL_ADDER，输入 a 与 b
 *   减法用的受控反相           | 8 x 4   =  32     | 每位一个 XOR，b XOR c_sub。
 *                              |                   | 补码的 +1 由加法器 cin 接到
 *                              |                   | 同一条控制线完成——那是电源
 *                              |                   | 轨，不是门
 *   and                        | 8 x 2   =  16     | 每位一个 AND
 *   or                         | 8 x 3   =  24     | 每位一个 OR
 *   and/or 选择                | 8 x 4   =  32     | 每位一个 MUX2，受 op[0] 控制
 *   nand/nor 反相              | 8 x 4   =  32     | x XOR ~op[1]：nand 是 ~and，
 *                              |                   | nor 是 ~or，所以取反的 op 只要
 *                              |                   | 每位一个反相器，而不是再加
 *                              |                   | 两套阵列
 *   算术/逻辑选择              | 8 x 4   =  32     | 每位一个 MUX2，受 ~op[2] 控制
 *   保留 op 清零               | 8 x 2   =  16     | 每位一个 AND，与
 *                              |                   | ~(op[2] & op[1]) 相与——只有
 *                              |                   | op 6(110) 和 7(111) 为真
 *   op 译码                    | 1+1+4+2 =   8     | ~op[1] 与 ~op[2]（各一个
 *                              |                   | NOT），c_sub =
 *                              |                   | AND3(~op2, ~op1, op0)（4 个），
 *                              |                   | reserved = op2 & op1（2 个）
 *   -------------------------- | ----------------- | ---------------------------
 *   合计                                            | 264
 *
 * 三个 op 位只以这些控制线的形式进入，所以上面每一行都能对函数手工核对：000
 * 让 b 保持不变、cin 为低（加），001 反相 b 并拉高 cin（减），010/011 选择 and/or
 * 的结果，100/101 选择同一个结果并取反，110/111 把它清零。让四种逻辑运算共用
 * 同一组 and/or 选择，就是为什么这里没有把 nand8 的 8 和 nor8 的 32 单独列项：
 * 既付它们的钱、又付一个四选一的钱，等于同一个函数用更高的代价实现。
 *
 * test/core/defs-cpu.test.ts 会用已注册元件自己的计数重建 264（add8 72、
 * and8 16、or8 24、mux8 32、switch8 16、xor 4、not 1、and 2），所以钉住这个
 * 数字的是那个恒等式，而不是这段注释里的算术。
 */
function aluOp(a: number, b: number, op: number): number {
  switch (op) {
    case 0:
      return (a + b) & 0xff;
    case 1:
      // 补码减法，即 a + ~b + 1；写成一个表达式，这样中间值永远不是负数：
      // (a - b) & 0xff 得到同一个字节。
      return (a - b) & 0xff;
    case 2:
      return a & b;
    case 3:
      return a | b;
    case 4:
      return ~(a & b) & 0xff;
    case 5:
      return ~(a | b) & 0xff;
    default:
      // op 6 和 7：保留，决定发布 0 而不是落到某个已实现的操作上（见上表）。
      return 0;
  }
}

const alu8: ComponentDef = {
  id: 'alu8',
  name: { zh: '8 位运算器', en: '8-Bit ALU' },
  category: 'cpu',
  inputs: [
    { id: 'a', width: W },
    { id: 'b', width: W },
    { id: 'op', width: 3 },
  ],
  outputs: [{ id: 'out', width: W }],
  // 延迟单位，一个节点算 1（规格 §3.2），与 wide.ts 里每个运算符一样。
  // 上面的门数指标是另一个数字，这是刻意的。
  cost: 1,
  gateCost:
    W * FULL_ADDER + // 行波加法器，72
    W * XOR + // 减法的受控反相，32
    W * AND + // and，16
    W * OR + // or，24
    W * MUX2 + // and/or 选择，32
    W * XOR + // nand/nor 反相，32
    W * MUX2 + // 算术/逻辑选择，32
    W * AND + // 保留 op 清零，16
    (2 * NOT + 2 * AND + AND), // op 译码，8
  sequential: false,
  stateBytes: 0,
  evaluate: (i, o) => {
    // toUint 会把每个引脚值按其字段掩码，所以被污染或未接线的输入读成 0，
    // 与内核读取未接线位的方式完全一致。
    o[0] = aluOp(toUint(i[0], W), toUint(i[1], W), toUint(i[2], 3));
  },
};

/**
 * regfile6：六个八位寄存器、两个组合读端口、一个时钟写端口。a 发布
 * state[addrA]，b 发布 state[addrB]，时钟沿把 data 写进 state[waddr]——但只有
 * we 为高时。
 *
 * 完全没有指令语义。这个元件不知道存在源操作数字段或目标操作数字段，不知道
 * REG0 是什么，也不会根据指令处于哪个模式来门控任何东西：关卡从自己的译码电路
 * 接出 we、waddr 和 data，这正是裁决 3 的全部内容（CPU 是搭出来的，不是提供
 * 的）。关卡唯一没有的耦合是"读是组合的、写是时钟沿的"——同一条指令里读一个
 * 寄存器又覆盖它，这里的定义是"写入从下一条指令起生效，本次读仍然看到旧字节"，
 * 因为读路径从不查询 we 或 data。
 *
 * 两个读地址是存储契约唯一允许的例外被用了两次。这里的 evaluate 读 addrA 和
 * addrB，注册表的规则恰好允许且仅允许这种情况：一个输入只用于在 state 已有的
 * 字节中做选择，而它能选中的每个字节都是某个时钟沿写进去的。任何输入的**值**
 * 都无法经这条路径到达引脚——data、we 和 waddr 全都不会被 evaluate 读取——所以
 * 寄存器堆不可能退化成导线。ram8 在它的 def 处记录了同一条规则；这里有两个
 * 选择器而不是一个，这就是"2 个读端口"的含义。
 *
 * waddr 为 6 和 7 时：什么都不做。寄存器堆只有六个寄存器，而裁决 5 把编码 6 和
 * 7 分给了 inp 和 out——它们不是寄存器，没有状态可写。所以写到 6 或 7 会被
 * 忽略，读 6 或 7 发布 0（一个未写入字节的值，也是未接线引脚读到的同一个值）。
 * 两个被否决的替代方案都会发明一种别名：把地址按 6 取模会让一次越界写落进
 * REG0，而把 state 扩到八个字节则会让 inp/out 拥有 CPU 本应建模为外部端口的
 * 存储。六个字节的状态，越界地址碰不到其中任何一个。
 *
 * 与 reg8 一样两个指标全免费。clockEdge 采样、evaluate 发布；两者都不读对方的
 * 输入，而 cost 为 0 是因为存储元件切断了组合路径，而不是增加一个延迟单位。
 * gateCost 故意不写，读成那个 0：门数指标衡量玩家搭出来的东西，而存储是它刻意
 * 的例外（wide.ts 有详细论证）。
 */
const regfile6: ComponentDef = {
  id: 'regfile6',
  name: { zh: '六级寄存器堆', en: '6-Register File' },
  category: 'cpu',
  inputs: [
    { id: 'addrA', width: 3 },
    { id: 'addrB', width: 3 },
    { id: 'waddr', width: 3 },
    { id: 'data', width: W },
    { id: 'we', width: 1 },
  ],
  outputs: [
    { id: 'a', width: W },
    { id: 'b', width: W },
  ],
  cost: 0,
  sequential: true,
  // 每个寄存器一个字节：REG0..REG5，没有第七个字节可别名（见上文）。
  stateBytes: REGS,
  evaluate: (i, o, state) => {
    // addrA / addrB 是 state 的下标；waddr、data 和 we 刻意不在这里读取，
    // 因此写路径上的任何东西都不可能泄露到读端口。地址 6 或 7 索引到六个寄存器
    // 之外，由 ?? 0 给出那个从未写入过的字节值。
    o[0] = state?.[toUint(i[0], 3)] ?? 0;
    o[1] = state?.[toUint(i[1], 3)] ?? 0;
  },
  clockEdge: (i, _o, state) => {
    // we 控制写入：为低时这个时钟沿什么都不改，无论 data 和 waddr 在做什么
    // ——测试会用"we 为低时 data 变化"来钉住这条性质。
    if (bit(i[4]) !== 1) return;
    const target = toUint(i[2], 3);
    // 编码 6 / 7 表示 inp / out，不是寄存器：没有字节可写。
    if (target >= REGS) return;
    state[target] = toUint(i[3], W);
  },
};

/**
 * instr_decoder：把八位指令字切成裁决 5 规定的字段——
 *
 *   mode = instr[7:6]   op = instr[5:3]   dst = instr[2:0]
 *   src  = instr[5:3]   imm = instr[5:0]
 *
 * 纯接线，所以是 0 个 NAND 等价门、0 个延迟单位——与 splitter 和 maker 的定价
 * 完全一样，理由也相同：每个输出位都是 instr 的某一位搬到另一个名字的引脚上，
 * 这个元件里没有门可数。cost 是 0 而不是 1，因为本身就是导线的元件不能增加
 * 延迟单位（规格 §3.2 把电源与导线定价为 0）。被否决的替代方案是用比较器或独热
 * 最小项树搭一个"真正的"解码器：那是另一个元件、有另一套引脚（独热线而不是打包
 * 的字段），按那种构造给这个元件定价，就是在让玩家为它并不包含的门付费。第 42
 * 关的门数目标因此由 delay 而不是 gate 承担——这是预期行为，不是 bug。
 *
 * op 和 src 是同样的三位，故意发布两次。裁决 5 给 [5:3] 两种含义：calc 里的
 * 操作（模式 01）和 move 里的来源（模式 10）。把两者分别发布在各自引脚上，才能
 * 让关卡用自己的接线取它需要的那一个，而不必让解码器按 mode 分支——分支就是
 * 指令语义，正是全局约束 13 要挡在引擎之外的东西。重复的切片不花任何代价：它是
 * 同一根导线有两个名字。
 *
 * 不校验保留位。裁决 5 把 calc 和 jump 的 [2:0] 标为"保留，必须为 0"，而这个
 * def 不检查——它把那些位原样作为 dst 发布。在这里校验既属于语义，又会毁掉关卡
 * 需要的信息：第 42 关的检查正是通过这个引脚断言保留字段，而一个把它强制成 0
 * 的解码器会让该检查对任何输入都通过。顺序是刻意的——元件报告，关卡裁决。
 */
const instrDecoder: ComponentDef = {
  id: 'instr_decoder',
  name: { zh: '指令解码器', en: 'Instruction Decoder' },
  category: 'cpu',
  inputs: [{ id: 'instr', width: W }],
  outputs: [
    { id: 'mode', width: 2 },
    { id: 'op', width: 3 },
    { id: 'dst', width: 3 },
    { id: 'src', width: 3 },
    { id: 'imm', width: 6 },
  ],
  // 两个指标上都是导线：见文件头。这里显式写 gateCost: 0，因为 0 就是这个
  // 元件真实的计数，而不是回退值——与 splitter / maker 的那两个 0 相同。
  cost: 0,
  gateCost: 0,
  sequential: false,
  stateBytes: 0,
  evaluate: (i, o) => {
    const instr = toUint(i[0], W);
    // 一个输入的五段切片，顺序与上面的引脚表一致。用移位和掩码，不用门：
    // 这就是整个传递函数。
    o[0] = (instr >> 6) & 0b11;
    o[1] = (instr >> 3) & 0b111;
    o[2] = instr & 0b111;
    o[3] = (instr >> 3) & 0b111;
    o[4] = instr & 0b111111;
  },
};

/**
 * pc8：程序计数器。out 发布保持的地址；时钟沿到来时，load 为高就让
 * state = in，load 为低就让 state = state + 1。
 *
 * 决定：计数在 256 处回绕到 0（255 + 1 = 0），而不是饱和。程序计数器是一个八位
 * 地址寄存器，所以它的后继就是"下一条指令地址对地址空间取模"——这也让 ram_prog
 * 的 256 个字节和这个计数器在构造上同宽，而不是碰巧同宽。饱和会让 CPU 在程序
 * 顶部冻住，而不是跑出程序末尾，而回绕是关卡的 program 驱动能预测的行为。
 *
 * 决定：load 优先于自增。跳转和其它指令一样：执行它的那个时钟沿，PC 取跳转
 * 目标；若 load 为低，同一个沿只是自增。不存在第三种状态——每个沿要么装载要么
 * 自增——这才让计数器成为 (load, in, state) 的全函数，也才让关卡的胶合逻辑只要
 * 把"是否跳转"和"是否执行"用一个或门合起来。
 *
 * 是存储元件，所以两个指标全免费，且 evaluate 只发布。一个字节的状态保存地址；
 * evaluate 读 state，绝不能读 in 或 load（发布输入的计数器就是导线），clockEdge
 * 采样它们两个且不写输出。gateCost 不写，读成 cost 的 0——wide.ts 里的存储
 * 裁决。
 */
const pc8: ComponentDef = {
  id: 'pc8',
  name: { zh: '程序计数器', en: 'Program Counter' },
  category: 'cpu',
  inputs: [
    { id: 'load', width: 1 },
    { id: 'in', width: W },
  ],
  outputs: [{ id: 'out', width: W }],
  cost: 0,
  sequential: true,
  stateBytes: 1,
  evaluate: (_i, o, state) => {
    // 只发布保持的地址，别的什么都不做：i 是因为内核会传进来才接收的，
    // 并刻意从不读取。
    o[0] = state?.[0] ?? 0;
  },
  clockEdge: (i, _o, state) => {
    if (bit(i[0]) === 1) state[0] = toUint(i[1], W);
    else state[0] = ((state[0] ?? 0) + 1) & 0xff;
  },
};

/**
 * ram_prog：OVERTURE 读取指令的那块 256 字节程序存储器。addr:8 -> out:8，
 * 每个地址一个字节，组合读取。
 *
 * 读路径是组合的，并且把 addr 当下标读——存储契约唯一允许的例外，与 ram8 记录
 * 的是同一条：addr 只能**选择** state 里的一个字节，而它选中的字节只会是装载器
 * 放进去的，所以任何输入的值都无法到达引脚。它根本没有写引脚：镜像不是电路能
 * 改变的东西，而是关卡交给这台机器的程序。
 *
 * 镜像经 Simulation.loadImage 到达，而不是经 params。phase 2 计划的可交付项第 7
 * 行写成 params.image，而任务 1 的调研记录
 * （.superpowers/sdd/2026-09-29-turing-complete-phase2/recon-kernel.md）说明了
 * 那种写法为什么行不通：compile() 从不碰实例状态（状态在 Simulation 构造函数里
 * 按零分配，net.ts），它只读一个参数键（params.width），而 reset() 会清掉每个
 * 状态字节——并且每个驱动电路的检查都在编译之后调用 reset()。所以镜像是在 reset
 * 之后由 Simulation.loadImage 拷进这个 def 的 state，evaluate 随后像任何读取一样
 * 发布 state[addr]。装载是内核操作，不是引脚：在这里加 data/load 写端口会变成
 * 另一个元件（那是 ram8），并让程序能改写自己。
 *
 * clockEdge 是空的，这是对只读元件最诚实的陈述：没有任何时钟沿能改变镜像，因为
 * 没有任何输入能描述一次写。它之所以存在，是因为只有 sequential 为 true 时内核
 * 才会把 state 交给 def（net.ts 的 settle 与 #publishState）——整个内容都是状态
 * 的元件必须是 sequential 才能发布它——而存储契约的另一半是每个 sequential def
 * 都要有 clockEdge。
 *
 * 与其它存储元件一样两个指标全免费：gateCost 不写，读成 cost 的 0（wide.ts 里
 * 论证过的存储例外）。
 */
const ramProg: ComponentDef = {
  id: 'ram_prog',
  name: { zh: '程序存储器', en: 'Program RAM' },
  category: 'cpu',
  inputs: [{ id: 'addr', width: W }],
  outputs: [{ id: 'out', width: W }],
  cost: 0,
  sequential: true,
  // 每个地址一个字节，共 2 ** 8 个——与 ram8 一样诚实地持有 256 字节。
  stateBytes: 2 ** W,
  evaluate: (i, o, state) => {
    // addr 只做选择；没有其它输入，也没有任何输入被读取。
    o[0] = state?.[toUint(i[0], W)] ?? 0;
  },
  clockEdge: () => {
    // 没有东西要采样：引脚表里没有写端口（见文件头）。程序由
    // Simulation.loadImage 带外装载，从电路内部看是只读的。
  },
};

/**
 * halt：一位直通（out = in），它存在的理由是关卡的检查可以点名 CPU 的停机线并
 * 对它断言。
 *
 * 决定：组合、cost: 0、gateCost: 0——它是一根带引脚名的导线，与 level_output
 * 同样的定价，第 3 章的预期目标不会因为放置它而改变。被否决的替代方案是锁存型
 * 停机（时钟沿置位、保持到复位）：那是一个存储元件，需要清零信号（否则关卡永远
 * 没法跑第二个程序），还会让停机线的值依赖节拍历史而不是玩家电路产生的信号。
 * 导线也是关卡可以在自己的参考电路任意位置探测的元件。
 *
 * out = in 而不是 out = 0：关卡断言的是停机线**拉高**，所以元件必须携带它命名的
 * 那根信号；恒 0 就是一根永远无法被断言的电源轨。
 */
const halt: ComponentDef = {
  id: 'halt',
  name: { zh: '停机', en: 'Halt' },
  category: 'cpu',
  inputs: [{ id: 'in', width: 1 }],
  outputs: [{ id: 'out', width: 1 }],
  // 一根导线：没有延迟单位也没有 NAND，与 level_output 和 splitter 一样。
  cost: 0,
  gateCost: 0,
  sequential: false,
  stateBytes: 0,
  evaluate: (i, o) => {
    o[0] = bit(i[0]);
  },
};

/**
 * CPU_DEFS 注册的 id，按顺序排列，写成字面量元组，好让 defs/index.ts 展开它、
 * 并让 DefId 仍然收窄到单个字符串。
 *
 * 顺序就是计划任务 2 表格里的顺序。这六个不是由位宽参数生成的——id 说明每个是
 * 哪个元件，而 instr_decoder 的五个引脚有四种不同位宽——所以这张列表与上面的 def
 * 由 test/core/defs-cpu.test.ts 互相钉住，就像 WIDE_STORAGE_DEF_IDS 与存储家族
 * 互相钉住那样。
 */
export const CPU_DEF_IDS = [
  'alu8',
  'regfile6',
  'instr_decoder',
  'pc8',
  'ram_prog',
  'halt',
] as const;

/**
 * CPU 家族，按 CPU_DEF_IDS 的顺序排列。
 *
 * 从这张列表注册、与它所命名的 def 放在一起，而不是在 defs/index.ts 里调用某个
 * 生成器：没有任何参数能产出这六个（见 id 元组），而把列表放在这里，才能让
 * test/core/registry.test.ts 里的家族边界测试按家族自己的声明排除它，而不是靠
 * 手工抄一份 id 列表。
 */
export const CPU_DEFS: readonly ComponentDef[] = [
  alu8,
  regfile6,
  instrDecoder,
  pc8,
  ramProg,
  halt,
];
