/**
 * 极简的可观察状态容器。
 *
 * 这是应用层全部的状态机制：没有状态库，没有不可变数据工具（第一阶段零运行时
 * 依赖）。容器保持泛型；本应用唯一的具体状态 `AppState` 在下面声明，再作为类型
 * 参数传进来：
 *
 * ```ts
 * const store = createStore<AppState>(appState);
 * ```
 *
 * 状态是"替换"而不是"编辑"：`set` 构造一个新的顶层对象。嵌套值由调用方自己
 * 负责——`core/graph.ts` 会通过 `addInstance` / `connect` 原地修改 `g.instances`
 * 与 `g.wires`，又通过 `removeInstance` / `disconnect` 重新赋值数组，所以通知是
 * "无条件"的。若在引用没变时压掉通知，就等于把一次原地编辑后的重绘悄悄吞掉；
 * 多渲染一次是代价更小的错误。
 *
 * 依赖方向：本模块的 import 全是类型 import，因此不会把下层拉进运行时依赖图，
 * 也不存在反向依赖。
 */
import type { Graph } from '../core/graph';
import type { Registry } from '../core/registry';
import type { GradeResult, Metrics } from '../levels/grader';
import type { BlueprintLibrary } from '../levels/blueprints';
import type { LevelSpec } from '../levels/spec';
import type { Progress } from './progress';
import type { Camera, Point } from './viewport';

/** 指针此刻在画板上做什么。 */
export type DragState =
  | { kind: 'instance'; ids: string[]; offsetX: number; offsetY: number }
  /**
   * 正从某个输出引脚拉出的导线。
   *
   * `to` 是指针当前所在的世界坐标；指针还没动过时为 `null`。它放在这里而不是
   * 输入模块里，因为画板要"画"它：一条松开鼠标才出现的导线，无法告诉玩家他
   * 正要连到哪里，而"看到自己在连什么"正是拖出一条导线的全部意义。
   */
  | { kind: 'wire'; fromInst: string; fromPort: string; to: Point | null }
  | { kind: 'pan'; lastX: number; lastY: number }
  /**
   * 按住 Ctrl 在画板上拉出的框选矩形。
   *
   * 它放在这里，同样是因为画板要画它：一个松手才出现的选择框，无法告诉玩家
   * 他正要选中什么，而"看到自己在选什么"正是框选的全部意义。
   */
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number };

/** 应用全部的可观察状态。 */
export interface AppState {
  level: LevelSpec;
  graph: Graph;
  registry: Registry;
  progress: Progress;
  camera: Camera;
  selected: string[];
  dragging: DragState | null;
  /**
   * `?dev=1` 是否要求了开发者模式：所有关卡可达，并且关卡列出的每个元件都
   * 出现在它的托盘里。它从不写进度。`app/dev.ts` 拥有这条规则；两个闸门在
   * `app/progress.ts` 里。
   */
  dev: boolean;
  /**
   * 元件托盘里已拿起、等待放到画板上的元件；没有则为 `null`。
   *
   * 这是应用状态，而不是画布上的一个标志：拿起会改变"点击画板"的含义、点亮
   * 托盘里对应的格子，并在指针下方显示元件的半透明副本。它曾放在
   * `canvas.dataset.pendingDef` 里，而那里只有画板能读——于是托盘无法显示
   * 自己哪个按钮处于激活状态。
   */
  armed: string | null;
  /**
   * 玩家写的程序文本，以关卡 id 为键。从未输入过的关卡为 `''`。
   *
   * 它是应用状态，而不是图上的字段，因为程序不是电路的一部分：它是玩家正在
   * 写的东西，在每次画板编辑后都保留，并且按关卡保存（`Progress.programs`），
   * 于是重开关卡会恢复它。之所以在这里读、而不是在每个调用点传参，是因为有
   * 两条路径会给电路评分——测试运行（`finishTest`）与每次编辑后的测量
   * （`measure`）——两者必须把同一段文本交给程序通道，否则同一关会出现一条
   * 路径通过、另一条路径失败。
   *
   * 用 `Record` 加 `''` 表示未输入，而不是可选条目：检查器本来就把空文本读作
   * `missing-program`，所以"从未在这里输入过"不需要另一种表示；而每个关卡 id
   * 只对应一段文本，映射也不可能自相矛盾。
   */
  programs: Record<string, string>;
  /**
   * 玩家自造的元件，按元件托盘和内核看到的样子。
   *
   * 放在 store 里而不只放在 `Progress` 里，是因为托盘是它的一种"视图"，而视图
   * 需要被通知它的对象变了：把选中区域封装会新增条目、重命名会替换条目，两者
   * 都在渲染时从 `store.get()` 读出。`Progress.blueprints` 是它所镜像的持久
   * 副本（与 `programs` 镜像 `Progress.programs` 完全一样），`main.ts` 在一个
   * 地方让两者保持同步。
   */
  blueprints: BlueprintLibrary;
  /**
   * 正打开其"内部"的元件 id；正在看画板本身时为 `null`。
   *
   * 编辑一个元件就是编辑一张图，而画板本来就在编辑图——相机、框选、撤销栈、
   * 元件托盘全都作用于 `graph` 当前持有的东西。所以"打开一个元件"是一次图的
   * 切换，而不是第二个编辑器；这个字段就是每个面板用来知道"当前是哪张图"的：
   * 面包屑显示它，工具栏往它里面封装，离开时恢复玩家来时的画板。
   */
  editing: string | null;
  /**
   * 画板上电路的成本，随编辑实时测量。
   *
   * 这是"测量"，不是"判定"，它和 `lastGrade` 分成两个字段正是因为这个缘故。
   * 顶栏在玩家搭建时一直显示门数与延迟——那是原作自己的读数，也是让三星目标
   * 成为"可以瞄准的靶子"、而不是"事后才揭晓的惊喜"的原因——但一个每接一根
   * 导线就宣布"未通过"的关卡，是在对一个尚在绘制中的电路下判决。测量是连续
   * 的；判定要等测试运行。
   */
  metrics: Metrics | null;
  /**
   * 最近一次"测试运行"的结果；玩家还没请求过测试时为 `null`。
   *
   * 每次编辑都会清空它，因为在最后一根导线移动之前得出的判决，描述的是已经
   * 不在画板上的电路。
   */
  lastGrade: GradeResult | null;
  status: { zh: string; en: string } | null;
}

export interface Store<S extends object> {
  /** 当前状态；请把它当作只读。 */
  get(): S;
  /** 浅合并 `patch` 并通知订阅者。 */
  set(patch: Partial<S>): void;
  /** 用 `fn` 的结果替换状态并通知订阅者。 */
  update(fn: (state: S) => S): void;
  /** 返回一个幂等的取消订阅函数。 */
  subscribe(listener: (state: S) => void): () => void;
}

/**
 * 创建一个最小可观察容器。
 *
 * `initial` 是初始状态；容器不深拷贝、也不冻结它，只是持有引用。返回的 `Store`
 * 不依赖任何全局状态，因此同一个页面里可以并存多个 store（测试中常见）。
 */
export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<(state: S) => void>();

  /**
   * 同步通知，按订阅顺序。遍历的是快照，并对每个监听者检查它是否仍在集合里，
   * 这意味着监听者可以在通知过程中取消订阅自己或别人，而不会打乱这一轮遍历。
   */
  const emit = (): void => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener(state);
    }
  };

  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      emit();
    },
    update(fn) {
      state = fn(state);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
