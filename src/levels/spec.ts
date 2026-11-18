/**
 * 关卡规格的数据类型：一关长什么样，全部由这里的接口描述。
 *
 * 本模块只有类型与一个运行时常量，不依赖任何其它模块，是整个 `levels/`
 * 层的地基：`checks.ts`（执行检查）、`grader.ts`（判定）、`board.ts`
 * （起始电路）、`content/`（具体关卡）与 UI 都读它。
 *
 * 关键约定：关卡数据是纯数据（可序列化），不含函数与类实例；期望值、
 * 断言等“计算”由检查器负责。判定结果的失败原因由
 * `FAILURE_REASONS` 数组统一规定。
 */

/**
 * 一段双语文本：界面按玩家选择的语言取其中一份。
 *
 * 关卡内容（名称、简介、提示）必须同时给出中文与英文，缺一份就编译不过。
 */
export interface LocalizedText {
  readonly zh: string;
  readonly en: string;
}

/**
 * 一个引脚的定义。
 *
 * `id` 在关卡内唯一，判定、读数与界面都以它为准；`width` 是位宽，写到
 * 这个引脚上的数值必须能放进这么多位；`label` 是可选的显示名，缺省时
 * 界面显示 `id`。
 */
export interface PinSpec {
  readonly id: string;
  readonly width: number;
  readonly label?: LocalizedText;
}

/** 真值表的一行：输入引脚的取值，以及期望的输出引脚取值。 */
export interface TruthRow {
  readonly inputs: Readonly<Record<string, number>>;
  readonly outputs: Readonly<Record<string, number>>;
}

/**
 * 穷举式检查：把电路驱动到真值表的每一行，逐行比对输出。
 *
 * 只比较该行声明了的输出引脚；纯组合电路用它最直观。
 */
export interface TruthTableCheck {
  readonly kind: 'truth-table';
  /**
   * 要比对的行，必须显式给出。
   *
   * 省略 `rows` 或传空数组是硬性的 `missing-rows` 失败——它并不表示
   * “穷举所有输入组合”。没有期望的表什么都不比较，于是任何电路都能通过，
   * 所以关卡必须自己提供行。若想用“每个引脚一个函数”的方式生成行，请先用
   * `generateRows` 枚举输入，再把结果赋到这里；枚举只用于“生成行”，绝不
   * 会因为行被省略而发生。
   */
  readonly rows?: readonly TruthRow[];
}

/**
 * 一次 `script` 检查中的一步：在指定节拍施加输入，并可选择断言输出。
 *
 * `tick` 是绝对节拍：检查器会一直时钟到该节拍再读输出，因此步骤的实际
 * 顺序由 `tick` 排序决定，而不是由书写顺序决定。
 */
export interface ScriptStep {
  readonly tick: number;
  readonly inputs?: Readonly<Record<string, number>>;
  readonly expect?: Readonly<Record<string, number>>;
}

/**
 * 按时序驱动的检查：把电路复位后，按步骤逐拍施加输入并断言输出。
 *
 * 它用来测试带状态（寄存器、计数器）的电路；纯组合电路用真值表更直观。
 */
export interface ScriptCheck {
  readonly kind: 'script';
  readonly steps: readonly ScriptStep[];
}

/**
 * `program` 检查的一步，形状与 `ScriptStep` 完全相同。
 *
 * 一步对两种检查含义完全一致，因为检查器用同一段代码驱动它们。两者唯一
 * 的区别在第一步“之前”：`program` 检查会先汇编它的 `source`，把字节装进
 * 电路的程序 RAM；除此之外没有区别。
 */
export interface ProgramStep {
  readonly tick: number;
  readonly inputs?: Readonly<Record<string, number>>;
  readonly expect?: Readonly<Record<string, number>>;
}

/**
 * 把一段程序编译成镜像，并离线驱动电路跑一遍。
 *
 * 两条通道，一种检查。第 1~3 章用关卡自己写的程序来判定电路：玩家造
 * 机器，关卡自带的 `source` 负责证明它跑得起来。第 4 章反了过来——机器
 * 给定，程序由玩家写——于是 `from: 'player'` 改从 app 交给 `runChecks`
 * 的缓冲区里读文本。镜像装载之后的一切完全相同：同一个 `ram_prog`、
 * 同一组步骤、与 `script` 相同的驱动器。若为玩家程序再设一种检查类型，
 * 就得再维护一套节拍语义，并时刻保证两套一致。
 *
 * 镜像只由这段文本产生——`format: 'bytes'` 时用 `asm/image.ts` 里手写的
 * 机器码读取器——不掺任何别的来源：没有真实时间、没有网络、没有
 * `Math.random()`，所以同一关每次判定的结果都一样。检查器把字节写进
 * 电路的程序 RAM 后再驱动步骤，比较的是电路自己的输出，而不是编译器的
 * 输出。
 *
 * 省略 `steps`、给空数组，或声明的步骤都不做任何断言，都是硬性的
 * `missing-program` 失败——它并不表示“随便跑一下”。什么都不比较的检查
 * 会让任何电路通过，这就是另一种检查里的 `missing-rows` 教训。
 *
 * 空程序在两条通道上都算失败，这是刻意的：对 `from: 'player'` 来说，
 * 空文本正是玩家还没输入的平常状态，报 `missing-program` 才能告诉他这次
 * 检查没有可运行的东西。对电路而言，“关卡忘了带程序”与“你还没写程序”
 * 是同一种缺陷。
 *
 * 解析不了的文本（汇编或机器码）是 `invalid` 失败，并带上拒绝它的解析器
 * 给出的第一处行号与措辞。
 */
export interface ProgramCheck {
  readonly kind: 'program';
  /**
   * 关卡自带程序的文本，由检查器内部负责编译；绝不预编译后放进关卡数据。
   * 除非 `from` 是 `'player'`，否则它是必需项；当 `from: 'player'` 时文本
   * 来自玩家，即使这里写了 `source` 也不会运行。
   */
  readonly source?: string;
  /**
   * 程序从哪来：关卡自己的 `source`，还是玩家的缓冲区。默认 `'level'`，
   * 因此在有这个选项之前写的每一关都只读自己的文本。
   */
  readonly from?: 'level' | 'player';
  /**
   * 文本怎么读：汇编器（`'asm'`，默认），还是编程章节那种手写的一行一字
   * 机器码格式（`'bytes'`，见 `asm/image.ts`）。
   */
  readonly format?: 'asm' | 'bytes';
  readonly steps: readonly ProgramStep[];
  /**
   * 要装载的 `ram_prog` 实例 id。
   *
   * 缺省（或空串）表示“电路里每一个 `ram_prog` 实例”，这正是只有一块程序
   * RAM 的画板想要的效果——不是“哪里都不装”。给出名字则只装那一块，于是
   * 带两块程序 RAM 的关卡可以指定这次检查驱动哪一块。没有给名字、电路里
   * 却连一块 `ram_prog` 都没有时是 `missing-io` 失败；命名了电路里不存在
   * 的 id 则是内核的 `invalid`。
   */
  readonly ram?: string;
}

/**
 * 约束检查的规则类别。
 *
 * `sum-equals`：若该输入之和（对输出引脚位宽取模）等于指定输出；
 * `at-least`：至少 `count` 个输入为 1 时输出为 1，否则为 0。
 */
export type ConstraintRule =
  | { readonly kind: 'sum-equals'; readonly inputs: readonly string[]; readonly output: string }
  | {
      readonly kind: 'at-least';
      readonly inputs: readonly string[];
      readonly count: number;
      readonly output: string;
    };

/**
 * 约束检查：枚举全部输入组合，逐组验证某条算术或计数规则。
 *
 * 它与真值表本质相同，只是期望值由规则算出，不必逐行手写。
 */
export interface ConstraintCheck {
  readonly kind: 'constraint';
  readonly rule: ConstraintRule;
}

/**
 * 一轮 fuzz 为关卡输入引脚“抽出来”的值：每个引脚一项，且已经落在该引脚
 * 的位宽内，由检查自己的种子化 PRNG 产生。
 *
 * 它只作为 `FuzzCheck.inputs` 的入参使用，绝不会被原样驱动进电路：某个
 * 引脚实际写入什么，由该引脚的输入函数决定。
 */
export type FuzzSample = Readonly<Record<string, number>>;

/** 一轮 fuzz 实际驱动进关卡输入引脚的取值。 */
export type FuzzVector = Readonly<Record<string, number>>;

/**
 * 用固定种子反复抽随机向量，重复 `rounds` 轮。
 *
 * 两个映射都以关卡自己的引脚 id 为键，并且必须恰好覆盖关卡的全部引脚
 * （`spec.io.inputs` / `spec.io.outputs`）：漏掉或多出名字都是 `invalid`
 * 失败，和 `truthTable` 不肯漏掉一个输出引脚是同一个道理。这些函数必须
 * 是纯函数：不联网、不读真实时间、不用 `Math.random()`——内核的 PRNG
 * 是唯一的随机来源，同一个 `seed` 永远产生同一串向量。
 */
export interface FuzzCheck {
  readonly kind: 'fuzz';
  /** PRNG 种子，使用前会被 `>>> 0` 转成无符号 32 位整数；必须是整数。 */
  readonly seed: number;
  /**
   * 要跑多少组随机向量。默认 `DEFAULT_FUZZ_ROUNDS`，并被夹到
   * `FUZZ_ROUNDS_CAP`（两者都在 `levels/checks.ts`）。
   *
   * 不写没问题；写 0、负数、小数或 `NaN` 则是硬性的 `missing-vectors`
   * 失败。一轮都不跑的检查什么都不比较，会让任何电路通过——又是
   * `missing-rows` 的教训。
   */
  readonly rounds?: number;
  /** 每个输入引脚一个纯函数：输入抽到的样本，输出要驱动的值。 */
  readonly inputs: Readonly<Record<string, (sample: FuzzSample) => number>>;
  /**
   * 每个输出引脚一个纯函数：输入实际驱动的向量，输出期望值。
   *
   * 值是每个引脚一个整数，与引脚位宽无关：超过八位的引脚按
   * `LevelIo.readOutput` 读回的数值比较（最大 2^53），所以 8 位加法要写成
   * `(a + b) & 0xff`。这里不会替作者做掩码——放不进引脚的值是 `invalid`
   * 失败并点名该引脚，而不是悄悄截断后再比较。
   */
  readonly outputs: Readonly<Record<string, (inputs: FuzzVector) => number>>;
}

/**
 * 关卡专用的检查钩子，按 id 到 `levels/custom/index.ts` 的注册表里查。
 *
 * 关卡数据里只存 id。把实现直接内联进关卡既不可序列化、也无法评审，
 * 所以内核拒绝调用内联函数。
 */
export interface CustomCheck {
  readonly kind: 'custom';
  /** 自定义检查注册表的键；未注册的 id 会报 `missing-check`。 */
  readonly id: string;
  /**
   * 交给关卡专用检查器的纯数据：数字、字符串，以及它们的数组。谜题不需要
   * 数据时省略。
   *
   * 它必须保持可序列化，这正是“检查器按 id 查表而不是写进关卡”的全部
   * 理由：检查器需要知道的关于“谜题”的信息——某个秘密字节、迷宫网格、
   * 预算——应该放在关卡文件里、紧挨着题目说明；而检查器需要知道的关于
   * “电路”的信息，它从 `io` 读。因此函数与类实例不在这个类型里；检查器
   * 若确实需要它们，只能放在代码里，不能放在关卡数据里。
   */
  readonly params?: Readonly<Record<string, number | string | readonly number[] | readonly string[]>>;
}

/**
 * 一条关卡检查。联合体的每个成员对应一种判定方式。
 *
 * 新增一种检查时，必须同时更新 `levels/checks.ts` 的驱动逻辑与
 * `runChecks` 的“未知 kind”兜底；否则旧数据里出现新的 kind 会被判成
 * `invalid`。
 */
export type LevelCheck =
  | TruthTableCheck
  | ScriptCheck
  | ProgramCheck
  | ConstraintCheck
  | FuzzCheck
  | CustomCheck;

/**
 * 关卡随附画板上的一个元件。
 *
 * `x`、`y` 是 Canvas 世界坐标——与画板读进图之后 `Instance` 携带的坐标
 * 相同；`width` 是该实例的 `params.width`，关卡的接插件需要它，因为
 * `level_input` 与 `level_output` 无论关卡给多宽，定义里声明的都是一位
 * 引脚。
 */
export interface BoardPart {
  readonly def: string;
  readonly x: number;
  readonly y: number;
  /**
   * 显式指定的实例 id。通常只有关卡的接插件需要，因为 `levels/checks.ts`
   * 按实例 id（`IN_<pin>` 与 `OUT`）绑定关卡引脚；其余元件在画板被读取时
   * 会依次命名为 `i1`、`i2`……，与编辑器的命名一致。
   */
  readonly id?: string;
  readonly width?: number;
}

/**
 * 画板上的一条导线。两端都按“元件在 `BoardInit.parts` 里的下标”指认
 * 元件，再加该元件上的引脚 id。
 *
 * 用下标而不是实例 id，是因为 id 此刻还不存在：它们要等画板被读成图时
 * 才生成，写画板的关卡作者没有名字可用。下标的稳定性就等同于它指向的
 * 那份元件列表的稳定性，这也是画板写成“一个扁平列表 + 下标引用”而不是
 * “互相引用的元件”的同一个原因。
 */
export interface BoardWire {
  readonly from: { readonly part: number; readonly port: string };
  readonly to: { readonly part: number; readonly port: string };
}

/**
 * 关卡开局时打开的一张电路，以纯数据表示。
 *
 * 它是为编程章节存在的：那里的机器是玩家早就造好的，若每关都先重接一遍
 * 再写第一行汇编，就变成了把同样的接线重复一遍的章节。它是起点，而不是
 * 内建 CPU（全局约束 11）——`graphFromBoard` 产出的是一张普通的可编辑
 * `Graph`，其中每个元件、每条导线都能移动或删除。
 *
 * 刻意保持可序列化。只有数字、字符串和数组，没有函数、没有类实例，因为
 * 它活在 `LevelSpec` 里，而关卡数据就是数据：这个类型甚至不引用
 * `core/graph`，于是画板可以在不先建立文档的情况下被写出、比较和存储。
 * `levels/board.ts` 的 `graphFromBoard` 是唯一的读取者。
 */
export interface BoardInit {
  readonly parts: readonly BoardPart[];
  readonly wires: readonly BoardWire[];
}

/**
 * 一关的全部数据：身份、文案、可用元件、引脚、检查、可选起始画板与三星
 * 目标。
 *
 * 它是纯数据（可序列化），关卡实现在 `content/` 下，由 `campaign.ts`
 * 规定它在战役里的位置。判定器只读它，不写它。
 */
export interface LevelSpec {
  readonly id: string;
  readonly chapter: number;
  readonly index: number;
  readonly name: LocalizedText;
  readonly brief: LocalizedText;
  readonly hint: LocalizedText;
  readonly allowedComponents: readonly string[];
  readonly io: {
    readonly inputs: readonly PinSpec[];
    readonly outputs: readonly PinSpec[];
  };
  readonly checks: readonly LevelCheck[];
  /**
   * 关卡开局时打开的电路。缺省——第 1 到 3 章的每一关都是如此——表示空
   * 画板，也就是玩家亲手搭建机器的那一关。
   */
  readonly board?: BoardInit;
  readonly threeStar?: {
    readonly gate?: number;
    readonly delay?: number;
    readonly tick?: number;
  };
  readonly rewards?: { readonly components?: readonly string[] };
  /**
   * 沙盒（自由建造屏幕）为 `true`；它不是挑战。
   *
   * 这个字段的存在，是为了让“这一关没有声明检查”与“这一关就是沙盒”在
   * 数据上可区分。两者都有空的 `checks`，否则面板只能靠 id 猜，或者会在
   * 沙盒里告诉玩家“这一关缺少测试用例”。
   *
   * 它不是一个章节，也不在战役里：沙盒不在 `content/index.ts`、
   * `ALL_LEVELS` 或 `LEVEL_ORDER` 中，所以任何遍历已发布关卡的地方
   * （campaign-shape、unlock-chain、level-buildability）都看不到它。
   */
  readonly sandbox?: true;
}

/**
 * 检查失败可能携带的全部原因，以运行时数组的形式给出。
 *
 * 这个数组是唯一权威：`FailureReason` 类型由它推导，自定义检查器返回的
 * 失败记录也在 `levels/checks.ts` 里按这个数组校验。因此不可能出现“类型
 * 里加了一个原因、数组里没加”的情况——这很重要，因为类型声明了而数组
 * 没有的原因，会让所有使用它的检查器都被判成“格式错误”。
 */
export const FAILURE_REASONS = [
  'mismatch',
  'unstable',
  'invalid',
  'missing-io',
  'missing-rows',
  /**
   * 一次 `fuzz` 检查什么都不会做：没有可用的 `rounds`、没有可变化的输入
   * 引脚，或没有可比较的期望函数。相当于 `fuzz` 版的 `missing-rows`。
   */
  'missing-vectors',
  /**
   * 一次 `program` 检查什么都不会执行：没有步骤、没有任何一步断言，或源码
   * 汇编出零字节。什么都不做的程序镜像，和没有行的真值表一样空洞——检查
   * 会让任何电路通过——所以直接拒绝，而不是运行它。
   */
  'missing-program',
  /** id 不在注册表里的 `custom` 检查。 */
  'missing-check',
] as const;

/** 一条检查失败被记录的原因：取自 `FAILURE_REASONS` 之一。 */
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * 一条失败的记录：哪个检查、哪组输入、期望什么、实际什么、发生在第几拍。
 *
 * 数值字段是机器可读部分（面板逐引脚渲染），`detail` 是给人看的一句话。
 */
export interface CheckFailure {
  readonly check: LevelCheck['kind'];
  readonly inputs: Readonly<Record<string, number>>;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>>;
  readonly tick: number;
  /**
   * 这条失败来自第几轮 fuzz（从 0 开始）；其他检查类型没有这个字段。
   *
   * 单独设一个字段，而不是把它塞进 `inputs`：`inputs` 是电路实际被驱动的
   * 向量，失败表格要逐引脚渲染它，两者含义不同。
   */
  readonly round?: number;
  /**
   * 一句话说明具体细节——第几轮共几轮、哪个引脚、哪个未注册的 id。不做
   * 本地化：它面向日志、测试与未来的 UI；上面的数值记录才是机器可读的
   * 部分。
   */
  readonly detail?: string;
  readonly reason?: FailureReason;
}

/**
 * 一次 `runChecks` 的汇总：是否全部通过、失败清单，以及用掉的节拍数。
 *
 * `ticksUsed` 取各检查用掉节拍的最大值，用作 TICK 指标。
 */
export interface CheckOutcome {
  readonly passed: boolean;
  readonly failures: readonly CheckFailure[];
  readonly ticksUsed: number;
}
