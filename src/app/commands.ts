/**
 * 可撤销的编辑：命令栈，以及"命令 + 与它一起移动的元件库"这一对概念。
 *
 * 本模块只依赖 `core` 的图类型与 `levels` 的元件库类型，不碰 DOM、不碰 store：
 * 撤销栈是纯数据结构，重放与历史由调用方（`main.ts` 与面板层）驱动。
 *
 * 关键不变量：栈本身不保存图的副本。每次调用都把当前的图传进来，命令只记录
 * "怎么改"，因此同一份历史可以对着活文档重放，命令对图而言保持纯粹。
 */
import { cloneGraph, type CustomComponentDef, type Graph } from '../core/graph';
import type { BlueprintLibrary } from '../levels/blueprints';

/**
 * 对图的一次可逆编辑。
 *
 * `do` 必须可重复执行：命令入栈时它运行一次，之后每次重做都会再运行一次，
 * 所以它必须"从图当前所处的状态出发建立这次编辑"，而不能假设图是空的
 * （id 由调用方分配，不在 `do` 内部生成）。
 */
export interface Command {
  readonly label: string;
  do(graph: Graph): void;
  undo(graph: Graph): void;
  /**
   * 本命令执行后留下的元件库；只改变电路的命令为 `undefined`。
   *
   * 为什么命令可以携带元件库：把选中区域封装成自定义元件是"一个动作改两处"
   * （电路失去选中区域、获得该元件的一个实例；元件库获得定义），如果只撤销
   * 电路、把元件留在库里，玩家会得到一个叫不出名字的"撤销了一半"的状态。
   * 于是元件库跟着命令一起移动——见 `CommandStack.push`。
   *
   * 携带整份库而不是增量：库里装着图，`cloneGraph` 才是让它成为快照的关键；
   * 若用增量，还得为它写一份逆操作。封装是玩家偶发、有意的动作，克隆不在
   * 任何热路径上，多复制一份可以接受。
   */
  readonly blueprints?: BlueprintLibrary;
  /**
   * 撤销时要恢复的元件库；仅当命令携带了库时才存在。
   *
   * 只有栈会读它，`do` 永远不读：命令声明的是"我留下哪份库"，另外单独声明
   * "我替换掉的是哪份库"——栈需要后者，才能让撤销把文档恢复到与执行前完全
   * 一致的位置，而不是恢复到"上一条命令的库"（重做覆盖了分支后，那个值已经
   * 不存在了）。
   */
  readonly blueprintsBefore?: BlueprintLibrary;
}

/**
 * 把元件库深拷贝到"改一侧不会影响另一侧"的程度。
 *
 * 需要拷贝的层级是被数据形状决定的：元件名、定义本身与其名字、输入/输出引脚
 * 数组、绑定表里的每个端点对象，以及元件体内的图。少拷哪一层，撤销后对旧库
 * 的原地修改就会穿透到新库，两段历史共享同一批对象。
 */
export function cloneLibrary(library: BlueprintLibrary): BlueprintLibrary {
  const copy: Record<string, { name: { zh: string; en: string }; def: CustomComponentDef }> = {};
  for (const [id, entry] of Object.entries(library)) {
    copy[id] = {
      name: { ...entry.name },
      def: {
        ...entry.def,
        name: { ...entry.def.name },
        inputs: entry.def.inputs.map((pin) => ({ ...pin })),
        outputs: entry.def.outputs.map((pin) => ({ ...pin })),
        binds: {
          inputs: copyEnds(entry.def.binds.inputs),
          outputs: copyEnds(entry.def.binds.outputs),
        },
        body: cloneGraph(entry.def.body),
      },
    };
  }
  return copy;
}

/** 逐个引脚复制一张端点表；端点本身是对象，必须新建而不是共享引用。 */
function copyEnds(
  ends: Readonly<Record<string, { inst: string; port: string }>>,
): Record<string, { inst: string; port: string }> {
  const copy: Record<string, { inst: string; port: string }> = {};
  for (const [pin, end] of Object.entries(ends)) copy[pin] = { ...end };
  return copy;
}

/**
 * 一张图的撤销 / 重做历史，以及它旁边那份元件库的历史。
 *
 * 栈不持有图的任何副本：每次调用都传入 `graph`，因此同一份历史既能对活文档
 * 重放，命令对它也保持纯粹。（`core/graph.ts` 混用了"原地 push"与"重新赋值
 * 数组"两种改法，所以这里任何逻辑都不能把数组引用当成身份。）
 *
 * 元件库则不同：携带库的命令会整体替换它，因为元件是一个值（它的体是一张图），
 * 而不是对共享文档的一次改动。`current()` 是应用订阅的东西——它是最后一条命令
 * 留下的库，`main.ts` 把它复制进 store 和存档。
 */
export class CommandStack {
  readonly #limit: number;
  #undo: Command[] = [];
  #redo: Command[] = [];
  /** 历史把元件库留在了什么状态；还没有任何命令设置过时为 `undefined`。 */
  #blueprints: BlueprintLibrary | undefined;

  /** `limit` 是可撤销步数；超出后丢弃最旧的一步（而不是整段历史）。 */
  constructor(limit = 200) {
    this.#limit = limit;
  }

  /** 当前持有的可撤销步数。 */
  get depth(): number {
    return this.#undo.length;
  }

  canUndo(): boolean {
    return this.#undo.length > 0;
  }

  canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** 历史留下的元件库；没有历史改过它时为 `undefined`，表示"未改变"。 */
  current(): BlueprintLibrary | undefined {
    return this.#blueprints;
  }

  /**
   * 应用 `command` 并记录它：入栈就是这次编辑。
   *
   * 新命令会让重做分支失效——历史是一条线，不是一棵树，所以被放弃的"未来"
   * 直接丢掉，而不是留给一个并不存在的分支选择器。若 `do` 抛出异常，则不记录
   * 任何东西、重做分支也保留：图没有被一条我们能够撤销的命令改动过。
   *
   * 携带元件库的命令会把库的安装算作同一步，因此 `current()` 给出的就是这次
   * push 之后文档所持有的库。
   */
  push(command: Command, graph: Graph): void {
    command.do(graph);
    if (command.blueprints !== undefined) this.#blueprints = command.blueprints;
    this.#undo.push(command);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo = [];
  }

  /** 撤销最新的命令；没有可撤销的命令时返回 false。 */
  undo(graph: Graph): boolean {
    const command = this.#undo.pop();
    if (!command) return false;
    command.undo(graph);
    if (command.blueprints !== undefined) {
      // 往回走就是要回到命令"替换掉"的那份库，所以逆操作自己也带着 "before" 库。
      this.#blueprints = command.blueprintsBefore ?? this.#blueprints;
    }
    this.#redo.push(command);
    return true;
  }

  /** 重做最近撤销的命令；没有可重做的命令时返回 false。 */
  redo(graph: Graph): boolean {
    const command = this.#redo.pop();
    if (!command) return false;
    command.do(graph);
    if (command.blueprints !== undefined) this.#blueprints = command.blueprints;
    this.#undo.push(command);
    return true;
  }

  /**
   * 丢弃两个分支（撤销与重做），例如编辑器载入另一关时。
   *
   * 只清历史，不动当前的元件库：库是"文档现在是什么"的一部分，不是历史的一
   * 部分；它由调用方在需要时整体替换，而不是随着历史一起被清空。
   */
  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}
