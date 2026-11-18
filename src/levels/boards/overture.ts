import type { BoardInit, BoardPart, BoardWire } from '../spec';

/**
 * OVERTURE 机器，作为关卡数据：既是编程章节开局提供的电路，也是第 3 章的
 * 参考解，来自同一份源码。
 *
 * 一个构造器、两个读者，这正是本文件的意义。第 4 章的关卡写
 * `board: overtureBoard()`，开局就带着接好的机器；
 * `test/fixtures/ch3-references.ts` 则用
 * `graphFromBoard('ref', overtureBoard())` 判定第 3 章那三个机器关。
 * 这套接线从前放在那个 fixture 里，意味着“参考解”和“交给玩家的画板”是
 * 同一张电路的两份拷贝，随时可能漂移——而漂移会被读成“通过”，因为参考解
 * 会继续对着一个关卡早已不再提供的机器判绿。
 *
 * 为什么电路是数据：关卡数据必须可序列化——没有函数、没有类实例，不能有
 * 任何会被存档或 `JSON.stringify` 丢掉的东西（见 `levels/spec.ts` 的
 * `BoardInit`）。把 `() => Graph` 这样的构造器存进关卡，就是关卡对象里的
 * 函数；而把画板直接写成 `Graph`，又是带 id 和参数、没人能靠阅读核对的
 * 文档。元件表加“按下标引用的导线”才是仍然算一张电路的最小表示：
 * `levels/board.ts` 是唯一的读取者。
 *
 * 这台机器：一块由程序计数器寻址的程序 RAM、指令译码器、六寄存器堆、
 * ALU、写回通路、条件跳转的胶合逻辑，以及一条在程序把答案放到 `out`
 * 之后冻结计数器的 halt 线。第 3 章按 643 个门、深度 6 来判定它，这是
 * 第 49 关实测出来的机器，也是第 3 章三星目标引用的数字。第 4 章并不
 * 发布那块板：它的关卡开局用下面带 `inputId` 的形状，其自身实测指标是
 * 675 个门、深度 6——同一台机器加上源值选择器和它的接插件——所以第 4 章
 * 的三星目标必须按 675 衡量。不要把 643 抄进第 4 章的关卡。
 *
 * 指令由“越过它的那个时钟沿”执行。程序 RAM 相对 `PC` 是组合的，所以
 * 一个节拍开始时机器看到的是 `ram[PC]`；所有存储元件在时钟沿上采样同一份
 * 译码结果——寄存器堆写入、计数器取跳转目标或它的后继——随后的结算发布
 * 新状态。一个沿，一条指令。
 *
 * 读端口：`addrA` 是 `move` 的源，`calc` 时读 REG1，`jump` 时读 REG0
 * （跳转目标，见资料汇编的 §6.4）；`addrB` 在 `calc` 时读 REG2，在
 * `jump` 时读 REG3（条件值）。选择器链让同一对端口服务三种模式。
 *
 * 输入端口是第 4 章新增的，第 3 章的机器没有它。第 3 章的程序只是直线与
 * 循环，全在寄存器堆上转，所以在那里 `move|inp|dN` 读到的是 6 号操作数
 * ——ISA 操作数名里的 `inp`，一个六寄存器堆没有的寄存器，它会发布成 0
 * （见 `regfile6`）。第 3 章没有任何断言会注意到这一点。第 4 章每一关
 * 都要读输入，于是 `inputId` 增加一个名为 `IN_<inputId>` 的
 * `level_input` 实例，以及一个把它放到“源值”通路上的选择器：`move`
 * 拷贝的字节来自寄存器堆的 `a`，除非指令的 [5:3] 字段是 6，此时它来自
 * 关卡的输入字节。选择信号用的是条件译码器自己的 `b6` 线——不花钱，而且
 * 已经在那里（见 `srcData` 的导线）——`move` 源的两个读者都读同一个
 * 选择器，于是 `move|inp|dN` 与 `move|inp|out` 拷贝的是同一个字节。
 * 一个构造器、两种形状——第 3 章那块板就是“选项缺省”的这一个，这使
 * 第 3 章的三星目标仍然是在当初测量的地方测量的。
 *
 * `out` 是组合输出，而 `halt` 让这件事诚实。当正在看的指令是
 * `move|sX|out` 时，`out` 发布 `move` 的源；没有 halt，计数器会继续走、
 * `out` 会退回 0，所以 halt 线把计数器冻结在 `out` 那条指令自己的地址
 * 上，答案就留在那里。玩家若改为把 `out` 字节寄存一拍再发布，也能通过
 * 同样的检查（他发布的字节相同），两种写法都接受：关卡断言的是值，
 * 不是写法。
 */

/**
 * 一台坏掉的机器可能由哪些“差一点”的接法构成：同一块板，恰好短路一处。
 *
 * 默认值就是正式发布的机器。下面每个选项的存在，都是为了让
 * `test/levels/ch3-batch3.test.ts` 能构造一台“以指名方式出错”的机器，
 * 并断言对应关卡自己的遍历能抓住它——选项放在这里、紧挨着接线，因为用
 * 第二份该电路的拷贝做出来的反例，对这电路并不构成反例。批量测试会逐一
 * 注明：哪个选项由关卡数据里的哪条断言抓住。
 */
export interface OvertureBoardOptions {
  /**
   * 计数器的装载信号遇到跳转时怎么做：接入本机自己的条件胶合逻辑、永远
   * 不跳（把跳转通路短路为低），或永远跳（不管条件如何都取跳转）。
   */
  readonly jump?: 'conditional' | 'never' | 'always';
  /**
   * 立即数怎么到达寄存器堆：完整的六位字段、它的五位切片（丢掉第 5 位，
   * 经典的多接/少接一根线），或根本不到（把 `loadi` 的选择信号接低，于是
   * 写回数据永远是 move 的源）。
   */
  readonly immediate?: 'sixBits' | 'fiveBits' | 'never';
  /**
   * 写 `out` 是否冻结计数器。`false` 把 halt 线接低，这就是玩家忘了 `out`
   * 是组合输出时会造出的机器：字节在某个沿上是对的，下一个沿就没了。
   */
  readonly halt?: boolean;
  /**
   * 关卡输入引脚的 id：给定时，画板带一个 8 位的 `level_input` 实例
   * `IN_<inputId>`，并把它接进 CPU 的源值通路，于是 `move|inp|dN` 与
   * `move|inp|out` 拷贝关卡的输入。缺省即第 3 章的机器，与今天完全一样。
   */
  readonly inputId?: string;
}

/**
 * 画板上的一个元件，外加本文件给它起的名字。
 *
 * 这个名字只是源码里的写法，永远不会进入图：`graphFromBoard` 只读坐标、
 * 显式 id 与元件列表，而 `BoardWire` 按数组下标指认元件。在这里给它们
 * 命名，是为了让下面的导线表可读——`wire('RF', 'a', 'd1', 'a')` 而不是
 * 一堵数字墙，而“两个下标写反了”恰恰只有在这种写法里才肉眼可见。
 */
interface Placed extends BoardPart {
  readonly role: string;
}

/**
 * 元件在画布世界坐标里的位置：每个流水级一列，同一级内每个元件一行。
 *
 * 间距取自 UI 自己的元件尺寸，并留出连线的空间（宽 72；八引脚的 `maker`
 * 最高到 192，所以三个寄存器常量之间隔三行而不是一行）。
 */
const ORIGIN = 40;
const COLUMN = 152;
const ROW = 88;

const at = (col: number, row: number): { x: number; y: number } => ({
  x: ORIGIN + col * COLUMN,
  y: ORIGIN + row * ROW,
});

/**
 * 机器的元件，按构造顺序排列。
 *
 * 这个顺序就是电路的搭建顺序，也是自动生成的实例 id 所依据的顺序：关卡
 * 的时钟接插件有名字（关卡按 `IN_clk` 绑定它），其余依次是 `i1`、`i2`
 * ……与编辑器会给出的命名完全一致。
 *
 * `inputId` 是唯一会改变这张表的东西：要求带关卡输入的画板会多出接插件
 * 与选择器，把输入放到源值通路上，机器的其余部分不变。缺省时，下面的
 * 元件就是第 3 章的机器，顺序也相同。
 */
function placedParts(fiveBits: boolean, inputId: string | undefined): readonly Placed[] {
  return [
    { role: 'clk', def: 'level_input', id: 'IN_clk', ...at(0, 0) },
    // 关卡的输入引脚，紧挨着时钟：两者都是关卡自己的引脚，而不是机器的
    // 一部分，并且 `levels/checks.ts` 按 `IN_<pin>` / `OUT` 这样的 id
    // 绑定它们。
    ...(inputId === undefined
      ? []
      : [{ role: 'IN', def: 'level_input', id: `IN_${inputId}`, width: 8, ...at(0, 1) }]),
    { role: 'on', def: 'const_on', ...at(0, 2) },
    { role: 'off', def: 'const_off', ...at(0, 3) },

    // 取指：计数器为程序 RAM 提供地址，RAM 输出的字节正是译码器要切片的。
    // 计数器自己的两个引脚也属于这个环——驱动它们的是机器另一端。
    { role: 'RAM', def: 'ram_prog', ...at(1, 2) },
    { role: 'PC', def: 'pc8', ...at(1, 5) },
    { role: 'DEC', def: 'instr_decoder', ...at(2, 3) },

    // 模式：00 loadi、01 calc、10 move、11 jump。`we` 是“非 11”，
    // `is_loadi` 是“两位都不为高”，两者合起来把四种模式分完。
    { role: 'MODE', def: 'splitter', ...at(3, 0) },
    { role: 'n_m1', def: 'not', ...at(4, 0) },
    { role: 'n_m0', def: 'not', ...at(4, 1) },
    { role: 'is_loadi', def: 'nor', ...at(5, 0) },
    { role: 'is_calc', def: 'and', ...at(5, 1) },
    { role: 'is_move', def: 'and', ...at(5, 2) },
    { role: 'is_jump', def: 'and', ...at(5, 3) },
    { role: 'we', def: 'nand', ...at(5, 4) },

    // 每个寄存器字段一个三位译码器。条件字段是 [5:3]，与译码器称为 `op`
    // 的是同一段切片。
    { role: 'DST', def: 'decoder3', ...at(3, 2) },
    { role: 'DST_BITS', def: 'splitter', ...at(4, 2) },
    { role: 'COND', def: 'decoder3', ...at(3, 4) },
    { role: 'COND_BITS', def: 'splitter', ...at(4, 4) },

    // REG1 / REG2 / REG3 用 8 位 maker 表示：只有低三位会到达
    // `addrA` 与 `addrB` 这两个读地址。
    { role: 'ONE', def: 'maker', ...at(4, 6) },
    { role: 'TWO', def: 'maker', ...at(4, 9) },
    { role: 'THREE', def: 'maker', ...at(4, 12) },

    // 两个读地址、一个写地址，以及它们寻址的寄存器堆。
    { role: 'addrA1', def: 'mux8', ...at(6, 2) },
    { role: 'addrA', def: 'switch8', ...at(7, 2) },
    { role: 'addrB', def: 'mux8', ...at(6, 3) },
    { role: 'RF', def: 'regfile6', ...at(8, 2) },

    // ALU 与写回数据：d1 是“calc 时取 ALU 的字节、move 时取源字节”，
    // `data` 则取该字节或立即数。
    { role: 'ALU', def: 'alu8', ...at(9, 2) },
    // `move` 要拷贝的源字节，以及让它成为“寄存器堆的字节，或在指令要求时
    // 换成关卡输入”的选择器。选择器位于 `RF` 与发布 move 源的两个引脚之间
    // ——写回通路上的 `d1.a` 与 `out` 通路上的 `out_pin.a`——也就是它要
    // 打断的那条路径。选择信号来自机器自己的字段译码，因此它本身不额外花
    // 一个元件（见 `srcData` 的导线）。
    ...(inputId === undefined ? [] : [{ role: 'srcData', def: 'mux8', ...at(9, 3) }]),
    { role: 'd1', def: 'mux8', ...at(10, 2) },
    // 五位变体在立即数到达选择器前先切一刀：第 47 关的反例，63 会变成 31。
    ...(fiveBits
      ? [
          { role: 'SPIMM', def: 'splitter', ...at(10, 4) },
          { role: 'IMM5', def: 'maker', ...at(11, 4) },
        ]
      : []),
    { role: 'data', def: 'mux8', ...at(11, 2) },

    // 一条指令写到哪里，并不是同一个字段：`loadi` 写 REG0（它的六位就是
    // 值本身），`calc` 写 REG3——它的 [2:0] 切片是保留的，汇编器会留零——
    // `move` 写它携带的目标字段。
    { role: 'waddr', def: 'switch8', ...at(6, 4) },
    { role: 'waddr_final', def: 'mux8', ...at(7, 4) },

    // 跳转的条件：j（000）必跳、jz（001）在 REG3 为零时跳、jnz（010）在
    // 它非零时跳。
    { role: 'ZERO', def: 'equal8', ...at(6, 6) },
    { role: 'g_jz', def: 'and', ...at(6, 8) },
    { role: 'n_zero', def: 'not', ...at(6, 9) },
    { role: 'g_jnz', def: 'and', ...at(6, 10) },
    { role: 'inner', def: 'or3', ...at(7, 9) },
    { role: 'taken', def: 'and', ...at(7, 11) },

    // halt 线，以及它驱动的两个选择器：计数器的下一个值、它的装载信号。
    { role: 'out_load', def: 'and', ...at(6, 12) },
    { role: 'HALT', def: 'halt', ...at(8, 11) },
    { role: 'pc_in', def: 'mux8', ...at(8, 13) },
    { role: 'pc_load', def: 'or', ...at(9, 12) },

    // 答案：在计数器被按住期间以组合方式发布。
    { role: 'out_pin', def: 'switch8', ...at(12, 2) },
    { role: 'OUT', def: 'level_output', id: 'OUT', width: 8, ...at(13, 2) },
  ];
}

/**
 * OVERTURE 机器，可直接读成一张图。
 *
 * 纯函数且确定：没有时钟、没有计数器、没有随机数，所以两次调用得到同一
 * 张电路，发布它的关卡每次打开都判定得一样。
 *
 * @param options 反例开关；缺省即正式发布的机器，详见
 *   `OvertureBoardOptions` 的说明。
 * @returns 画板的纯数据：元件表与按元件下标引用的导线表。
 */
export function overtureBoard(options: OvertureBoardOptions = {}): BoardInit {
  const fiveBits = options.immediate === 'fiveBits';
  /** 关卡自己的输入引脚（当画板被要求带一个时）。 */
  const inputId = options.inputId;
  /** 把立即数送进写回数据的东西：完整字段，或它的五位切片。 */
  const immediate = fiveBits ? { part: 'IMM5', port: 'out' } : { part: 'DEC', port: 'imm' };
  /**
   * `move` 源字节从哪里来：寄存器堆的 `a` 端口，或在带输入的画板上换成
   * 关卡输入的、位于其间的选择器。
   *
   * 它的两个读者共用一个常量——写回通路的 `d1.a` 与 `out` 通路的
   * `out_pin.a`——因为 `move|inp|dN` 与 `move|inp|out` 是同一次拷贝，
   * 只是中间隔不隔一个寄存器；关卡的答案不能取决于玩家选了哪种写法。
   */
  const moveSource =
    inputId === undefined ? { part: 'RF', port: 'a' } : { part: 'srcData', port: 'out' };
  /** 除了 halt 线，计数器装载引脚还听谁：跳转胶合逻辑。 */
  const jumpSignal =
    options.jump === 'never' ? 'off' : options.jump === 'always' ? 'is_jump' : 'taken';
  const layout = placedParts(fiveBits, inputId);
  const index = new Map(layout.map((part, position) => [part.role, position]));

  const part = (role: string): number => {
    const position = index.get(role);
    if (position === undefined) {
      // 导线点名了不在布局里的元件，是本文件的 bug，而不是关卡的：这些
      // 角色名是文件私有的。直接报错，好过把一个下标猜着交给
      // `graphFromBoard` 去解析。
      throw new Error(`overture: no part named ${role}`);
    }
    return position;
  };
  const wire = (from: string, fromPort: string, to: string, toPort: string): BoardWire => ({
    from: { part: part(from), port: fromPort },
    to: { part: part(to), port: toPort },
  });
  /**
   * 一个 `maker` 的八个引脚，最低位在前：这台机器需要的常量字节——
   * REG1 / REG2 / REG3，它们的低三位为寄存器堆提供地址。无论值是什么，
   * 八个引脚都接：没接的输入也照样读 0，而接出来能让人在纸面上看出常量
   * 的哪几位是零。
   */
  const byte = (role: string, value: number): readonly BoardWire[] =>
    Array.from({ length: 8 }, (_, bit) =>
      wire((value >> bit) & 1 ? 'on' : 'off', 'out', role, `b${bit}`),
    );

  const parts: readonly BoardPart[] = layout.map((placed) => ({
    def: placed.def,
    x: placed.x,
    y: placed.y,
    ...(placed.id === undefined ? {} : { id: placed.id }),
    ...(placed.width === undefined ? {} : { width: placed.width }),
  }));

  const wires: readonly BoardWire[] = [
    // 取指。`pc_load` 与 `pc_in` 和计数器一起在这里接线，虽然驱动它们的是
    // 机器另一端——它们正是这整张电路存在的目的所要闭合的那个环。
    wire('PC', 'out', 'RAM', 'addr'),
    wire('pc_load', 'out', 'PC', 'load'),
    wire('pc_in', 'out', 'PC', 'in'),
    wire('RAM', 'out', 'DEC', 'instr'),

    // 先接模式，再把它派生出的每一个信号接出来。
    wire('DEC', 'mode', 'MODE', 'in'),
    wire('MODE', 'b1', 'n_m1', 'a'),
    wire('MODE', 'b0', 'n_m0', 'a'),
    wire('MODE', 'b1', 'is_loadi', 'a'),
    wire('MODE', 'b0', 'is_loadi', 'b'),
    wire('n_m1', 'out', 'is_calc', 'a'),
    wire('MODE', 'b0', 'is_calc', 'b'),
    wire('MODE', 'b1', 'is_move', 'a'),
    wire('n_m0', 'out', 'is_move', 'b'),
    wire('MODE', 'b1', 'is_jump', 'a'),
    wire('MODE', 'b0', 'is_jump', 'b'),
    wire('MODE', 'b1', 'we', 'a'),
    wire('MODE', 'b0', 'we', 'b'),

    // 两个寄存器字段，拆成跳转胶合逻辑读取的一热编码线。
    wire('DEC', 'dst', 'DST', 'sel'),
    wire('DST', 'out', 'DST_BITS', 'in'),
    wire('DEC', 'op', 'COND', 'sel'),
    wire('COND', 'out', 'COND_BITS', 'in'),

    // 三个常量寄存器编号，以及它们构成的读地址。
    ...byte('ONE', 1),
    ...byte('TWO', 2),
    ...byte('THREE', 3),
    // addrA = move ? src : REG1；跳转时读 REG0，因为此时 `we` 为低，
    // 开关会把一热的 REG1 选择清零。
    wire('ONE', 'out', 'addrA1', 'a'),
    wire('DEC', 'src', 'addrA1', 'b'),
    wire('is_move', 'out', 'addrA1', 'sel'),
    wire('addrA1', 'out', 'addrA', 'a'),
    wire('we', 'out', 'addrA', 'on'),
    // addrB = jump ? REG3 : REG2：条件值，或 ALU 的操作数。
    wire('TWO', 'out', 'addrB', 'a'),
    wire('THREE', 'out', 'addrB', 'b'),
    wire('is_jump', 'out', 'addrB', 'sel'),

    // 寄存器堆、ALU，以及 move / calc 的写回通路。
    wire('addrA', 'out', 'RF', 'addrA'),
    wire('addrB', 'out', 'RF', 'addrB'),
    wire('waddr_final', 'out', 'RF', 'waddr'),
    wire('data', 'out', 'RF', 'data'),
    wire('we', 'out', 'RF', 'we'),
    wire('RF', 'a', 'ALU', 'a'),
    wire('RF', 'b', 'ALU', 'b'),
    wire('DEC', 'op', 'ALU', 'op'),
    // 源值通路，以及为什么关卡输入要接在这里而不是接进 `addrA`。
    // `move` 拷贝的是“值”：寄存器堆 `a` 端口发布、由 `d1` 与 `out` 开关
    // 传递下去的那个字节。若把关卡输入接进 `addrA`，它就会被当成寄存器
    // 编号来读——关卡的数据被当作地址花掉——于是 `move|inp|dN` 会拷贝
    // 那个编号碰巧指到的寄存器。所以选择器站在 `d1` 前面，在那里字节就是
    // 字节，而寄存器堆仍保留它的两个读端口。
    //
    // 选择信号的计算不花成本，而这个选项只花一个选择器。`COND_BITS.b6`
    // 是跳转胶合逻辑已经在读的那个译码器里、字段值为 6 的一热线：`COND`
    // 译 `DEC.op`，而 `DEC.op` 正是 `DEC.src` 所指的 [5:3] 切片——
    // `instr_decoder` 把一个字段以两个名字发布——所以那条线“就是”指令的
    // 源字段等于 6。它本来就算好了，并经引脚以导线送过来：选择信号本身
    // 0 个门、0 延迟。这个选项真正买来的是它插入的元件：`mux8` 是 32 个
    // NAND 等价门（`level_input` 接插件是 0 个），这正好是普通板的 643 个
    // 门与带输入板的 675 个门的全部差额，`test/levels/boards.test.ts` 把
    // 两个数字都钉住了。用一个“与常量字节比较”的元件也能表达同样的意思，
    // 但那要多花 54 个门——八个 XNOR 加一棵七输入与树——它曾在板上时实测
    // 是 729 个门；它被撤掉了，而不是留在译码旁边作伴。（延迟指标两种写法
    // 都是 6，因为那个比较器与它重复的译码处在同一深度。）机器不该为一条
    // 它已经拥有的信号线花 54 个门。
    //
    // 而且这个选择信号在每种模式下都安全，因为每种模式本来就决定了那个
    // 字节。`calc` 的 [5:3] 是它的操作码，6 与 7 是保留值、`alu8` 发布 0；
    // 而 `d1` 无论字段是什么都照传那个字节。`loadi` 的 [5:3] 位是它立即数
    // 的一部分，而立即数在下游 `data` 处才被选中，在这个选择器之后。
    // `jump` 的 [5:3] 是条件码，ISA 只定义了 0、1、2，所以对每一种存在的
    // 分支这条线都是低；何况跳转根本不写东西，`we` 为低。所以这个选择
    // 信号能改变的“被写或被发布的字节”，只属于 `move`——而它正是为 move
    // 准备的。
    ...(inputId === undefined
      ? []
      : [
          // 值通路本身：寄存器堆的字节，或关卡的字节。
          wire('RF', 'a', 'srcData', 'a'),
          wire('IN', 'out', 'srcData', 'b'),
          wire('COND_BITS', 'b6', 'srcData', 'sel'),
        ]),
    // move 的源从这里唯一的 `moveSource` 常量送抵机器的两个读者：写回通路
    // 上的 `d1.a`（下一条导线）与 `out` 通路上的 `out_pin.a`（本表末尾）。
    // 不带关卡输入的画板没有这个选择器，那两条导线照旧直接接寄存器堆的
    // `a` 端口。
    wire(moveSource.part, moveSource.port, 'd1', 'a'),
    wire('ALU', 'out', 'd1', 'b'),
    wire('is_calc', 'out', 'd1', 'sel'),

    // 写回数据：d1 的字节，或 loadi 的立即数。五位变体是同一条路径，只是
    // 把字段的第 5 位扔掉了。
    wire('d1', 'out', 'data', 'a'),
    ...(fiveBits
      ? [
          wire('DEC', 'imm', 'SPIMM', 'in'),
          wire('SPIMM', 'b0', 'IMM5', 'b0'),
          wire('SPIMM', 'b1', 'IMM5', 'b1'),
          wire('SPIMM', 'b2', 'IMM5', 'b2'),
          wire('SPIMM', 'b3', 'IMM5', 'b3'),
          wire('SPIMM', 'b4', 'IMM5', 'b4'),
          wire('off', 'out', 'IMM5', 'b5'),
          wire('off', 'out', 'IMM5', 'b6'),
          wire('off', 'out', 'IMM5', 'b7'),
        ]
      : []),
    wire(immediate.part, immediate.port, 'data', 'b'),
    // `never` 把 `loadi` 的选择信号接低，于是写回数据永远是 move 的源：
    // 即“立即数通路从未被接上”的那台机器。
    wire(options.immediate === 'never' ? 'off' : 'is_loadi', 'out', 'data', 'sel'),

    // 写地址：move 用目标字段，calc 用 REG3，loadi 用 REG0（它的开关把
    // 字段里的零传下去）。
    wire('DEC', 'dst', 'waddr', 'a'),
    wire('is_move', 'out', 'waddr', 'on'),
    wire('waddr', 'out', 'waddr_final', 'a'),
    wire('THREE', 'out', 'waddr_final', 'b'),
    wire('is_calc', 'out', 'waddr_final', 'sel'),

    // 条件值是 REG3，跳转期间由 `addrB` 发布。
    wire('RF', 'b', 'ZERO', 'a'),
    wire('off', 'out', 'ZERO', 'b'),
    wire('COND_BITS', 'b1', 'g_jz', 'a'),
    wire('ZERO', 'out', 'g_jz', 'b'),
    wire('ZERO', 'out', 'n_zero', 'a'),
    wire('COND_BITS', 'b2', 'g_jnz', 'a'),
    wire('n_zero', 'out', 'g_jnz', 'b'),
    wire('COND_BITS', 'b0', 'inner', 'a'),
    wire('g_jz', 'out', 'inner', 'b'),
    wire('g_jnz', 'out', 'inner', 'c'),
    wire('is_jump', 'out', 'taken', 'a'),
    wire('inner', 'out', 'taken', 'b'),

    // 写 `out` 就是程序的结束：halt 线把计数器冻结在那条指令上，被按住
    // 期间 `pc_in` 把计数器自己的值喂回给它，答案经开关一直留在 `out` 上。
    wire('is_move', 'out', 'out_load', 'a'),
    wire('DST_BITS', 'b7', 'out_load', 'b'),
    wire(options.halt === false ? 'off' : 'out_load', 'out', 'HALT', 'in'),
    // `pc_in` 直接读寄存器堆，刻意不读 `moveSource`。跳转目标来自 REG0，
    // 而字段 6 指不到 REG0——跳转的 [5:3] 是 0~2 的条件码，所以选择器反正
    // 会传寄存器字节——但“跳转目标”和“move 的源”是两个不同的问题，一块
    // 画板若用关卡输入引脚回答其中之一，就把 ISA 刻意分开的两件事混为一谈。
    wire('RF', 'a', 'pc_in', 'a'),
    wire('PC', 'out', 'pc_in', 'b'),
    wire('HALT', 'out', 'pc_in', 'sel'),
    wire(jumpSignal, 'out', 'pc_load', 'a'),
    wire('HALT', 'out', 'pc_load', 'b'),
    // `out` 发布 move 的源，并且与写回通路读的是同一个 `moveSource`。
    // `out_load` 已经表明这条指令是 `move|…|out`，所以这个开关永远不会为
    // calc、loadi 或 jump 发布；它回答的问题只是“move 拷贝哪个字节”，而
    // 这个答案不能取决于玩家有没有把字节绕经寄存器——`move|inp|out` 正是
    // 玩家在“回显输入”这一关写的第一个程序，从前这里读 `RF.a` 会让那个
    // 看起来正确的程序发布 0。
    wire(moveSource.part, moveSource.port, 'out_pin', 'a'),
    wire('out_load', 'out', 'out_pin', 'on'),
    wire('out_pin', 'out', 'OUT', 'in'),
  ];

  return { parts, wires };
}
