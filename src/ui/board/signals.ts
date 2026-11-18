/**
 * 画板上的实时数值：每个引脚此刻承载着什么。
 *
 * 编辑器过去只画电路、从不运行：所有导线同一种灰色，所有引脚同一个点，
 * 玩家只能按“运行”再读一张数字表，才知道电路做对没有。原作正相反：
 * 画板本身就是读数器——1 位为 1 时发亮，字节在流动时是蓝色总线，点一下输入位就能驱动它。
 *
 * 本模块就是这件事的全部实现；它和 `render.ts` 分开，好让画笔保持为
 * “store 加一份传进来的快照”的纯函数。这里不做任何判定：
 * `levels/grader.ts` 会自己编译一份仿真，并且只有它能决定关卡是否通过。
 * 如果显示用的仿真和判定用的仿真对不上，就会画出一个“看起来对、考试却不过”的电路，
 * 所以两者都走 `compile` 和 `bindLevelIo`。
 *
 * 电路不收敛、或 `compile` 拒绝接受当前图时，返回 `null` 而不是抛异常：
 * 画板同时也是编辑器，玩家在做出能跑的电路之前，中途状态通常本来就跑不起来。
 */
import { Simulation, compile } from '../../core/net';
import { bindLevelIo, bindSandboxIo, type LevelIo } from '../../levels/checks';
import { boardPins, isSandbox } from '../../levels/sandbox';
import type { LevelSpec } from '../../levels/spec';
import type { ProgramMachine } from '../../levels/run';
import type { Graph } from '../../core/graph';
import type { Registry } from '../../core/registry';
import { maskInto, portValueToNumber } from '../../core/signal';

/** 画板与读数面板需要的全部数值，一次遍历读完。 */
export interface SignalSnapshot {
  /** 已编译输出引脚的值，键为 `${instanceId}.${portId}`。 */
  readonly outputs: ReadonlyMap<string, number>;
  /** 关卡输出引脚的值，键为关卡自己的引脚 id。 */
  readonly levelOutputs: ReadonlyMap<string, number>;
  /** 电路没有到达不动点时为 false：此时任何数值都不可信。 */
  readonly stable: boolean;
  /** 自上次 reset 以来施加的时钟边沿数。 */
  readonly tick: number;
}

const UNSTABLE: SignalSnapshot = {
  outputs: new Map(),
  levelOutputs: new Map(),
  stable: false,
  tick: 0,
};

/** 一个正在运行的电路显示，自带时钟。 */
export interface DisplaySimulation {
  /** 上一次结算后的数值：开销很小，可以每帧调用。 */
  read(): SignalSnapshot;
  /** 施加一个时钟边沿并结算。 */
  tick(): void;
  /** 驱动一组新的输入向量并结算。 */
  drive(vector: Readonly<Record<string, number>>): void;
  /** 清空所有存储元件，重新驱动输入向量并结算。 */
  reset(): void;
  /** 与关卡引脚绑定的读写接口。 */
  readonly io: LevelIo;
}

/** 某个实例的一个已编译输出引脚；缓存起来，让 `read` 不必反复查映射表。 */
interface OutputRegion {
  readonly key: string;
  readonly base: number;
  readonly width: number;
}

/**
 * 编译 `graph` 并返回它的实时视图；无法运行时返回 `null`。
 *
 * 返回对象持有一个 `Simulation`，因而持有存储状态：调用方每块画板保留一个，
 * 每次编辑后调用 `drive`。`vector` 是初始输入向量；它没有点名的引脚一律按 0 驱动——
 * 输入不会“记住”上一次被驱动成什么，这与关卡检查遵循的规则相同。
 *
 * `machine` 是让画板与“运行程序”保持一致的关键。关卡判定玩家写的程序时，
 * 程序已经装在一台由 `ProgramRun` 掌管的机器里；若显示层自己再编译一份，
 * 就会画出第二个电路，其中的 `ram_prog` 是 256 个零，于是画板上的时钟卡和 `out` 行
 * 描述的是另一台机器，而不是调试器里那台。给定了 machine 就精确地画这一台：
 * 网表不可变、仿真对象共享，所以在这里走一步，就是运行过程所报告的那一步；
 * 对输入的写入，程序也看得见。机器归调用方所有，因此这里不重置它——
 * 运行过程自己的 `reset` 才会把它置回 tick 0 并重新装入镜像。
 * 没有 machine 时显示层自行编译：第 1 到第 3 章的所有画板都是这种情况，
 * 程序关卡的电路暂时编译不过时也是一块这样的空画板。
 *
 * @param graph 当前电路图
 * @param registry 元件定义注册表
 * @param level 关卡规格（用于读取声明的引脚和判定 IO 绑定）
 * @param vector 初始输入向量，按键为关卡引脚 id；未列出的引脚驱动为 0
 * @param machine 可选：运行过程已准备好的程序机器，提供时与它共享网表和仿真
 * @returns 可读可驱动的显示对象；编译被拒绝时返回 null
 */
export function createDisplay(
  graph: Graph,
  registry: Registry,
  level: LevelSpec,
  vector: Readonly<Record<string, number>>,
  machine?: ProgramMachine | null,
): DisplaySimulation | null {
  const regions: OutputRegion[] = [];
  // 无论哪种画板，都要先拿到“这块板子的引脚”。关卡自己声明引脚；
  // 沙盒没有自己的引脚，它的引脚就是玩家放上去的那些连接器（`sandboxPins`）。
  // 驱动、读取和侧边栏共用同一份清单——在这里算一次并捕获进闭包，
  // 因为每次图编辑都会重建显示，而增删一个连接器恰恰就是一次图编辑。
  const pins = boardPins(level, graph, registry);
  // 集中在一个块里编译：任何一处拒绝——引脚没分配、图不被 `compile` 接受——
  // 都从同一个出口返回 null。
  const ready = ((): { sim: Simulation; io: LevelIo } | null => {
    try {
      // 调用方准备好的机器要整体使用，网表也不例外：
      // 它编译出的引脚基址正是下面 `regions` 要寻址的东西。
      const net = machine?.net ?? compile(graph, registry);
      const sim = machine?.sim ?? new Simulation(net, registry);
      const io = isSandbox(level) ? bindSandboxIo(sim, net, pins) : bindLevelIo(sim, net, level);
      // 每个“已编译输出引脚”一个 region，而不是每个文档实例一个。
      // 自定义元件会编译成它内部的许多元件，所以画板能画的引脚：
      // 对叶子实例是 `i3` 自己的，对自定义元件是 `i3/i1` 的；
      // 而元件定义的引脚是后者的别名，因此枚举“每一个输出键”就覆盖了全部可画表面，
      // 包括别名，本模块不需要知道“自定义元件”是什么概念。
      for (const key of net.outputKeys()) {
        try {
          regions.push({ key, base: net.outputBase(key), width: net.outputWidth(key) });
        } catch {
          // `compile` 报告过、却无法寻址的键：没有东西可画。
        }
      }
      return { sim, io };
    } catch {
      return null;
    }
  })();
  if (!ready) return null;
  const { sim, io } = ready;

  const driveVector = (values: Readonly<Record<string, number>>): void => {
    for (const pin of pins.inputs) {
      io.writeInput(pin.id, within(values[pin.id] ?? 0, pin.width));
    }
  };

  /**
   * 最近一次结算的判定结果。`reset` 在内部也会结算但不上报，
   * 所以每条改变电路的通路都要再经过这里结算一次；
   * 对已经稳定的表再扫一遍会立刻返回，开销可以忽略。
   */
  let stable = true;
  const settleNow = (): void => {
    stable = sim.settle().stable;
  };

  const display: DisplaySimulation = {
    io,
    read(): SignalSnapshot {
      const tick = sim.tickCount;
      // 没收敛的电路没有值得画的数值：显示循环最后一次扫描的结果，
      // 等于显示一个马上就会变掉的数。
      if (!stable) return { ...UNSTABLE, tick };
      const outputs = new Map<string, number>();
      for (const region of regions) {
        outputs.set(region.key, portValueToNumber(sim.read(region.base, region.width)));
      }
      const levelOutputs = new Map<string, number>();
      for (const pin of pins.outputs) levelOutputs.set(pin.id, io.readOutput(pin.id));
      return { outputs, levelOutputs, stable: true, tick };
    },
    tick(): void {
      // `tick` 从信号表里采样存储元件，所以边沿之前表里必须已经有一轮结算结果；
      // 这是成立的，因为进入这里的每条路径（`reset`、`drive`、上一次 `tick`）都以结算收尾。
      sim.tick();
      settleNow();
    },
    drive(values: Readonly<Record<string, number>>): void {
      driveVector(values);
      settleNow();
    },
    reset(): void {
      // `reset` 会把输入连同存储一起清零，所以输入向量必须在它之后重新驱动，而不是之前。
      // 对调用方准备好的机器来说，这也会清掉运行过程的存储（同一批对象）；
      // 运行过程通过自己的 `ticks` 计数器报告这件事，而本模块画的正是那个计数器。
      sim.reset();
      driveVector(vector);
      settleNow();
    },
  };

  // 自己编译电路的那种显示要负责启动它：reset 会清空每一个存储字节，
  // 对程序关卡而言，这会擦掉运行过程刚刚装入的镜像。
  // 外部传入的 machine 已经是起始状态——运行过程在交出机器之前已经 reset 并装入镜像——
  // 所以原样绘制即可。
  if (!machine) display.reset();
  return display;
}

/** 把数值裁进引脚的位宽，这样过期的输入向量也不会因为超宽被拒绝。 */
function within(value: number, width: number): number {
  return maskInto(value, width);
}

/** 什么都还没跑时的快照，给完全没有显示对象的调用方使用。 */
export function emptySignals(): SignalSnapshot {
  return UNSTABLE;
}
