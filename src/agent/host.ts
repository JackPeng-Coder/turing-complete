/**
 * 智能体层向应用层索取的东西。
 *
 * 这里用接口而不是直接 import。工具要做的每一件事——把命令压进撤销栈、
 * 驱动时钟、跑本关的测试用例、写电路文件——在 main.ts 和
 * ui/board/interact.ts 里都已经存在，智能体必须走同样的路径，不能自己重造一套。
 * 如果它自建命令、自己改一份图，那么智能体的一步就不再是「按一次撤销就能消失」，
 * 测量结果会与画板对不上，而且只要任一方改动，两边立刻开始漂移。
 *
 * 依赖方向才是重点。main.ts 是组装根，由它把实现交给智能体层；
 * 智能体层绝不向上伸手去碰 UI。正因如此，尽管 agent/ 会驱动整个应用，
 * 它在层级顺序里仍然是 app/ 的平级（AGENTS.md 第 2 条规则）。
 *
 * 这里每个方法都对应「一只手」能做的事：apply 是画板编辑，
 * run/stepOnce 是工具栏按钮，test 是「测试」，
 * circuitText 与 loadCircuit 是「导出 / 导入」。
 * 刻意没有任何「手做不到」的方法。
 */
import type { Command } from '../app/commands';
import type { Graph } from '../core/graph';
import type { PinDef } from '../core/registry';

/** 元件托盘此刻提供的一个元件，含它的引脚。 */
export interface PartInfo {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly category: string;
  /** 关卡的连接件对托盘隐藏，也必须对智能体隐藏。 */
  readonly hidden: boolean;
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
}

/** 画板上一个元件的快照：id、类型、名字、位置与参数。 */
export interface PartSnapshot {
  readonly id: string;
  readonly def: string;
  readonly nameZh: string;
  readonly x: number;
  readonly y: number;
  readonly params: Readonly<Record<string, number>>;
}

/** 画板上一根导线的快照：从哪个实例的哪个端口，连到哪个实例的哪个端口。 */
export interface WireSnapshot {
  readonly id: string;
  readonly from: { readonly inst: string; readonly port: string };
  readonly to: { readonly inst: string; readonly port: string };
}

/** 电路结构检查给出的一条问题。 */
export interface IssueSnapshot {
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/** 智能体做下一步之前看到的完整画板状态。 */
export interface BoardSnapshot {
  /** 智能体工作在哪里：普通关卡，还是自由建造的沙盒。 */
  readonly mode: 'level' | 'sandbox';
  /** 开发者模式（?dev=1）：所有关卡可达、列出的元件全部可选。 */
  readonly dev: boolean;
  /** 当前关卡的身份；在沙盒里是 null。 */
  readonly level: { readonly id: string; readonly nameZh: string; readonly nameEn: string } | null;
  /** 画板上正打开内部电路的那个元件；null 表示看的是画板本身。 */
  readonly editing: string | null;
  readonly parts: readonly PartSnapshot[];
  readonly wires: readonly WireSnapshot[];
  /** 当前选中的实例 id。 */
  readonly selected: readonly string[];
  /** 时钟是否正在运行。 */
  readonly running: boolean;
  /** 是否正在跑测试。 */
  readonly testing: boolean;
  /** 实时门数与延迟；还没有测量结果时为 null。 */
  readonly metrics: { readonly gates: number; readonly delay: number } | null;
  /** 上一次测试的判定；还没跑过时为 null。 */
  readonly grade: { readonly passed: boolean; readonly summary: string } | null;
  /** 电路结构检查发现的问题。 */
  readonly issues: readonly IssueSnapshot[];
  /** 状态栏那句话（中英各一份）；没有时为 null。 */
  readonly status: { readonly zh: string; readonly en: string } | null;
  /** 关卡自己的说明（如果有），让智能体知道目标是什么。 */
  readonly briefZh: string | null;
  /** 自定义元件库：元件托盘在基础目录之外额外提供的元件。 */
  readonly components: readonly {
    readonly id: string;
    readonly nameZh: string;
    readonly nameEn: string;
    readonly inputs: readonly string[];
    readonly outputs: readonly string[];
    /** 这个元件现在在画板上有几个实例。 */
    readonly instances: number;
  }[];
  /** 关卡的输入引脚，以及每个引脚当前被驱动的值。 */
  readonly inputs: readonly { readonly id: string; readonly width: number; readonly value: number }[];
  /** 关卡的输出引脚：电路要驱动的东西，以及它当前读到的值。 */
  readonly outputs: readonly {
    readonly id: string;
    readonly width: number;
    readonly value: number | null;
  }[];
  /** 玩家为这一关写的程序文本；没有就是空字符串。 */
  readonly program: string;
  /** 这一关是否给程序判分，从而智能体是否需要写程序。 */
  readonly expectsProgram: boolean;
}

/** 一次测试跑出来的结果。ran: false 表示这一关没有可玩的用例。 */
export interface TestOutcome {
  /** 是否有用例跑过。 */
  readonly ran: boolean;
  /** 全部通过为 true，未通过为 false，没跑为 null。 */
  readonly passed: boolean | null;
  /** 给玩家看的一行：「未通过：第 2 拍期望 out=1…」。 */
  readonly summary: string;
  /**
   * 哪些用例失败，以及它们的期望值对实际值。
   *
   * 这就是整个反馈闭环。「未通过：2 个用例不符」只告诉模型「你错了」，
   * 别的什么也没有，于是它唯一能做的动作就是再猜一次——
   * 一次真实会话正是这样耗了十六步：放一个元件、测试、读到「2 个不符」、再放一个。
   * 给出期望与实际，就把这一步变成了编辑：
   * 答案就是它看得见的两个数字之差。
   */
  readonly failures: readonly {
    readonly inputs: Readonly<Record<string, number>>;
    readonly expected: Readonly<Record<string, number>>;
    readonly actual: Readonly<Record<string, number>>;
    readonly tick: number;
    readonly detail?: string;
  }[];
}

/** 导入电路的结果。 */
export interface ImportOutcome {
  /** 文件是否被接受。 */
  readonly ok: boolean;
  /** ok 为 false 时存在：文件为什么被拒绝。 */
  readonly error?: string;
  /** 导入后的元件数。 */
  readonly parts?: number;
  /** 导入后的导线数。 */
  readonly wires?: number;
}

/**
 * 应用在智能体眼里的样子。
 *
 * graph() 返回的是正在使用的文档本身，不是副本；任何会改动它的操作
 * 都必须经过 apply——直接读它，是为了让工具校验自己的参数
 * （这个引脚存在吗？这个输入已经被驱动了吗？），
 * 而不必再维护第二份会漂移的电路模型。
 */
export interface AgentHost {
  /** 画板上正在使用的图。可以读；绝不要在命令之外改它。 */
  graph(): Graph;
  /** 元件托盘提供什么，也就是智能体被允许放置什么。 */
  parts(): readonly PartInfo[];
  /** 模型规划下一步需要看到的全部内容。 */
  snapshot(): BoardSnapshot;
  /** 把坐标对齐到画板的网格；网格尺寸由主题决定。 */
  snap(x: number, y: number): { x: number; y: number };
  /**
   * 关卡连接件必须使用的 id 与位宽；没有可放的连接件时返回 null。
   *
   * 关卡按实例 id 绑定电路——IN_a、OUT——所以一个用图自己的分配器起名（如 i7）
   * 放下的连接件永远不会被绑定，这一关也就无法通过。
   * 这条规则住在 ui/board/interact.ts 里，这里用的是同一个函数：
   * 智能体放连接件的方式和一只手完全一样，id 与位宽一起给，要么都给、要么都不放。
   *
   * null 既表示「这是一个普通元件，名字你自己起」，
   * 也表示「这一关的引脚已经全放好了」——这与手放置时得到的是同一个答案。
   */
  connectorFor(defId: string): { id: string; width: number } | null;
  /**
   * 应用一条命令，作为一次看得见的步骤。
   *
   * 实现会把它压进玩家用的同一个撤销栈，重绘；
   * 给了 focus 时还会选中刚刚变化的东西，让品红色的选中框指出该看哪里。
   * 它在重绘之后才返回，所以调用方在两次调用之间等待一下，
   * 就能做到一步一帧（需求 A5）。
   */
  apply(command: Command, focus?: readonly string[]): void;
  /** 撤销 / 重做，也就是玩家自己的历史。 */
  undo(): boolean;
  redo(): boolean;
  /**
   * 「选择」：把 ids 变成当前选区，效果等同框选或点击。
   *
   * 它不是编辑，也不进撤销栈——「封装为元件」操作的就是选区，
   * 而操作者的品红色选中框也因此套在智能体正在谈论的元件上。
   */
  select(ids: readonly string[]): void;
  /**
   * 「封装为元件」：把选区变成一个命名元件，并返回它的 id。
   *
   * 选区无法成为元件时返回 null（少于两个元件、没有导线跨过边界、
   * 名字已经被占用）：拒绝的理由由 planWrap 给出，这个方法不做二次判断。
   */
  wrapSelection(name: { zh: string; en: string }): string | null;
  /** 编辑内部 / 返回：在画板上打开某个元件的电路，或离开它。 */
  enterComponent(id: string): boolean;
  leaveComponent(): void;
  /** 重命名一个元件；没有这个元件时返回 false。 */
  renameComponent(id: string, name: { zh: string; en: string }): boolean;
  /** 删除一个元件；画板还在用它的实例时会被拒绝。 */
  deleteComponent(id: string): boolean;
  /** 驱动关卡的一个输入引脚，效果等同于点击它的位格。 */
  setInput(pinId: string, value: number): void;
  /** 玩家为这一关写的程序文本，与编辑器写入的是同一份。 */
  setProgram(text: string): void;
  /** 运行 / 暂停 / 单步 / 停止并复位。 */
  run(): void;
  pause(): void;
  stepOnce(): void;
  reset(): void;
  /**
   * 「测试」：跑这一关的用例，跑完后以判定结果 resolve。
   *
   * 运行是有动画的，所以它要等到结束才 resolve；
   * 对于没有用例可跑的界面（沙盒），报 ran: false，
   * 而不是去等一个永远不会到来的判定。
   */
  test(): Promise<TestOutcome>;
  /** 导出电路：画板上内容的 tc-circuit 文本。 */
  circuitText(): string;
  /** 导入电路：解析并装入一份 tc-circuit 文件，或说明为什么不行。 */
  loadCircuit(text: string): ImportOutcome;
}
