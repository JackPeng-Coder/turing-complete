/**
 * 单块电路上的“一次程序运行”：把程序镜像装进电路，再由人手一拍一拍地
 * 推进，并读出机器内部状态。
 *
 * 它服务调试器与汇编 IDE：检查器一次跑完整串步骤只给结论，而写程序的人
 * 需要装镜像、只走一个时钟沿、再看两个沿之间机器里是什么。因此本模块复用
 * 内核与 `checks.ts` 的既有部件（`loadProgramImage`、`programTargets`、
 * `bindLevelIo`、`Simulation.readState`），只额外提供“人手”才有的东西：
 * 步骤之间的时间。无 DOM、无真实时间、无随机数；驱动 `step` 的定时器在
 * `main.ts` 里。本模块从不抛错——解析失败、编译失败、结算不收敛都变成
 * `errors` 里的一句话。
 */

import { CircuitValidationError, UnstableCircuitError } from '../core/errors';
import type { Graph } from '../core/graph';
import type { Netlist } from '../core/net';
import { Simulation, compile } from '../core/net';
import type { Registry } from '../core/registry';
import { portValueToNumber } from '../core/signal';
import { bindLevelIo, loadProgramImage, programImageOf, programTargets, type LevelIo } from './checks';
import type { LevelSpec } from './spec';

/**
 * 一块电路上的一个程序，按节拍手动推进。
 *
 * 既然已有检查器，为什么还要它：`program` 检查一次驱动整串步骤并给出
 * 结论，而正在写程序的玩家需要相反的东西——装好镜像、只走一个时钟沿、
 * 并读取两个沿之间机器的状态。调试器和 IDE 要的正是这个，而且它们不应
 * 重新推导决定语义的部分（哪些 `ram_prog` 装程序、文本如何变成镜像、
 * 装载镜像前要不要先复位）。于是这一层由内核自己的部件组合而成
 * （`loadProgramImage`、`programTargets`、`bindLevelIo` 与
 * `Simulation.readState` 等部件），只补上人比检查器多出来的东西：
 * 步骤之间的时间。
 * 时间。
 *
 * 无 DOM、无时间、无随机。反复驱动 `step` 的定时器在 `main.ts` 里（按钮
 * 所在处）；本模块放进测试夹具也完全一样，因此 `test/levels/run.test.ts`
 * 里那个两行的小程序能钉住真实画板的行为。
 *
 * 这里什么都不抛。`createProgramRun` 被 IDE 的编辑路径调用，`step` 被
 * 重复定时器调用，所以上层检查流水线遵循的同一条规则在此适用：拒绝是
 * 数据。解析错误、电路编译不过、结算不收敛——每一条都变成 `errors` 里的
 * 一句话，而带错误的运行什么都不做。
 */
export interface ProgramRun {
  /**
   * 面板用来代替“运行结果”显示的内容。
   *
   * 最前面是文本自身的拒绝，带行号、用读取器的措辞；文本是合法程序时为
   * 空。其后可能跟一句“电路层面”的话——“电路编译不过”“没有 `ram_prog`
   * 可以装载”“电路结算不收敛”——因为面板没有别的渠道显示它，而一个
   * 看上去能按、按了却没反应的控制，比一句说明更糟。
   *
   * 非空表示这次运行是惰性的，而且什么都没装载过：所有读取器都像机器从未
   * 启动一样回答——`step` 与 `setInput` 什么都做、`ticks` 保持不动，
   * `bytes` 为空，状态读取器（`readRam`、`readRegisters`、`readPc`、
   * `readHalt`）回答 `null` 而不是构造函数表格里的 0——于是面对拒绝的面板
   * 会打印破折号，而不是描述一台从未结算过的机器。读取器拒绝一段程序时，
   * 这条约束由 `checks.ts` 的 `loadProgramImage` 保证；另外四句话出现在
   * 装载之前或代替装载，只要其中任何一句已经存在就跳过装载——这正是电路
   * 层面的拒绝不会在玩家脚下重置机器的原因。
   */
  readonly errors: readonly string[];
  /**
   * 汇编出的镜像；文本不是程序时为 `[]`。
   *
   * 与 `errors` 同一条规则：`[]` 表示什么都没装载，而每一份非空 `bytes`
   * 都已经在 `ram_prog` 里——因此调用方只要在它非空时才显示字节视图，就
   * 绝不会打印一个从未装载成功的程序的镜像。
   */
  readonly bytes: readonly number[];
  /**
   * 本次运行驱动的电路；没有东西可画时为 `null`。
   *
   * 显示层画的正是它，所以玩家在画板上看到的就是程序正在运行的机器，而
   * 不是同一张图第二次编译的结果——io 面板的时钟、`out` 行和调试器的
   * 计数器都读同一个仿真，这才让画板与运行不会各说各话。运行惰性时恰好是
   * `null`（见 `errors`：没有电路，或装载前就被拒绝）。`net` 编译后不可
   * 变；`sim` 是活的，属于本次运行。
   */
  readonly machine: ProgramMachine | null;
  /** 自上次 `reset` 起走过的时钟沿数。 */
  readonly ticks: number;
  /** 复位、装载镜像、结算：运行重新开始。 */
  reset(): void;
  /** 结算、施加一个时钟沿、再结算。 */
  step(): void;
  /** 驱动一个关卡输入引脚；画板会结算，因此下一个时钟沿采样到它。 */
  setInput(name: string, value: number): void;
  /** `spec.io.outputs` 的每个引脚，按关卡读取的方式取值。 */
  readOutputs(): Readonly<Record<string, number>>;
  /** 电路里 `regfile6` 的 REG0..REG5；没有寄存器文件时为 `null`。 */
  readRegisters(): readonly number[] | null;
  /** `pc8` 的状态——正在执行的地址；没有计数器时为 `null`。 */
  readPc(): number | null;
  /**
   * 电路的 `halt` 线；这块画板上没有 `halt` 元件时为 `null`。
   *
   * 这是调试器唯一无法自行推断的东西。第 3 章的机器在 `halt` 为高时冻结
   * 计数器，于是“程序跑完了”和“程序跳到了自己的地址”都会让机器停住——
   * 只看“计数器不动”会把后者报成前者。这里读机器自己的信号：`halt` 是
   * 一个带输出引脚的元件，它的值与计数器装载逻辑看到的是同一个。
   */
  readHalt(): boolean | null;
  /** 当前的 256 字节程序镜像；没有 `ram_prog` 时为 `null`。 */
  readRam(): readonly number[] | null;
}

/**
 * 一块编译好的电路连同它的存储：运行时逐步推进、画板负责绘制的东西。
 *
 * 之所以给一个有名字的类型而不是内联形状，是因为两层要互相传递它：
 * `levels/run.ts` 构建它，`ui/board/signals.ts` 绘制它，而两边都需要
 * 完整看到 `core` 自己的 `Netlist`/`Simulation` 组合。这里没有任何
 * 拷贝：共享的是同一批对象，这是刻意的。
 */
export interface ProgramMachine {
  readonly net: Netlist;
  readonly sim: Simulation;
}

/** 一次运行能驱动的电路：编译好的仿真，加上已绑定关卡引脚。 */
interface Ready {
  readonly net: Netlist;
  readonly sim: Simulation;
  readonly io: LevelIo;
}

/**
 * 在 `graph` 上为 `text` 建立一次运行，并推进到起始状态：复位、装载
 * 镜像、结算完毕、节拍为 0。
 *
 * `format` 由检查决定（`'asm'` 或手写镜像格式），文本永远是玩家的——
 * 零字节那句话触发时说的正是这一点。
 */
export function createProgramRun(
  graph: Graph,
  registry: Registry,
  spec: LevelSpec,
  text: string,
  format: 'asm' | 'bytes',
): ProgramRun {
  /** 先收集解析拒绝，再收集电路要说的话；见 `errors`。 */
  const errors: string[] = [];
  let bytes: readonly number[] = [];
  /** 一旦结算失败就为 true：此后不再驱动任何东西。 */
  let stopped = false;
  /** 编译好的电路；`compile` 拒绝这张图时为 `null`。 */
  let ready: Ready | null = null;
  /** 一句“电路层面”的说明，先压着，让文本自身的拒绝排在前面。 */
  let circuitIssue: string | null = null;

  const issue = (error: unknown): string => {
    if (error instanceof UnstableCircuitError) {
      return 'the circuit does not settle: there is no fixed point to step';
    }
    if (error instanceof CircuitValidationError) {
      return 'the circuit does not compile, so there is nothing to run';
    }
    if (error instanceof RangeError) {
      return `the program does not fit this circuit: ${error.message}`;
    }
    return `the circuit could not be run: ${String(error)}`;
  };

  const stop = (error: unknown): void => {
    stopped = true;
    errors.push(issue(error));
  };

  /** 没有东西可驱动时为 true：没有电路、已被拒绝，或结算失败过。 */
  const idle = (): boolean => ready === null || stopped || errors.length > 0;

  try {
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const io = bindLevelIo(sim, net, spec);
    ready = { net, sim, io };
    // 引脚存在但位宽不对时，一个字节都绑不上，于是运行要显示或驱动的每个
    // 值都会从这个引脚错误地穿过。检查器把这种电路判为 `missing-io`；
    // 这里只写成一句话，因为“编辑到一半的画板”是编辑器的正常状态，而不是
    // 缺陷。
    if (io.mismatch !== undefined) circuitIssue = io.mismatch;
  } catch (error) {
    circuitIssue = issue(error);
  }

  if (ready === null) {
    // 没有电路，于是先单独读文本：面板的第一职责是把程序的问题告诉玩家，
    // 而笔误不是画板的错——随后再补上电路自己的拒绝，因为一个只能说
    // “第 3 行”的面板，会让“板上有个注册表不认识的元件”看起来也像笔误。
    errors.push(...programImageOf(text, format, 'player').errors);
    if (circuitIssue !== null) errors.push(circuitIssue);
  } else {
    // 电路层面的拒绝要记录在装载之前，而不是之后。装载会复位机器并把镜像
    // 写进 `ram_prog`，所以后补这句话会把镜像留在 RAM 里、而 `errors`
    // 却非空——这正是 `errors` 与 `bytes` 都承诺不会发生的组合，也正是
    // 它让 IDE 隐藏了已经装载成功的程序的字节视图。放在这里还能避免每次
    // 按键都因拒绝而在玩家脚下重置机器，这正是“编辑到一半的画板”需要的。
    if (circuitIssue !== null) errors.push(circuitIssue);
    else {
      try {
        // 镜像落地的唯一路径：`loadProgramImage` 依次复位、装载每一块
        // `ram_prog`、结算——复位为什么必须在前，见它自己的注释。
        const image = loadProgramImage(ready.io, text, format, 'player');
        if (image.errors.length > 0) errors.push(...image.errors);
        else bytes = image.bytes;
      } catch (error) {
        errors.push(issue(error));
      }
    }
  }

  const instanceOfDef = (def: string): string | null => {
    if (ready === null) return null;
    const ids = ready.sim.net.instanceIds();
    const defs = ready.sim.net.instanceDefs();
    for (let index = 0; index < ids.length; index += 1) {
      if (defs[index] === def) return ids[index]!;
    }
    return null;
  };

  const stateOf = (id: string | null): readonly number[] | null => {
    // 惰性的运行没有东西可报告。被拒绝的程序从未到达机器，所以状态表里还是
    // 构造函数留下的 0——读出来会打印一个 0x00 的计数器和六个空寄存器，
    // 那是一台没人启动过的机器。见 `errors`。
    if (ready === null || idle() || id === null) return null;
    const state = ready.sim.readState(id);
    return state === null ? null : Array.from(state);
  };

  return {
    errors,
    bytes,
    get machine(): ProgramMachine | null {
      // 与其他读取器同一道闸门：拒绝过程序的电路不交出去绘制，因为画板显示
      // 全零程序、面板却说程序没装载，正是这个字段要防止的矛盾。见 `errors`。
      return ready === null || idle() ? null : { net: ready.net, sim: ready.sim };
    },
    get ticks(): number {
      return ready?.sim.tickCount ?? 0;
    },

    reset(): void {
      if (idle() || ready === null) return;
      try {
        // 与构造函数做的是同一个调用，于是“复位”与“打开”不会各走各的：
        // 复位电路、把镜像装进去、结算。
        loadProgramImage(ready.io, text, format, 'player');
      } catch (error) {
        stop(error);
      }
    },

    step(): void {
      if (idle() || ready === null) return;
      try {
        // 结算、时钟沿、再结算。`tick` 采样的是信号表，所以沿之前的那次
        // 结算，才让屏幕上的值就是这个沿要锁存的值——只写输入、不结算就
        // tick，机器采样到的是上一组输入，那是一张玩家在画板上看不到的电路。
        // `tick` 自己以一次结算收尾（它要发布新状态），所以末尾这次是对一张
        // 已结算过的表再扫一遍；保留它，是因为这个次序是本层写明的契约，
        // 而不是 `tick` 的实现细节。
        ready.sim.settle();
        ready.sim.tick();
        ready.sim.settle();
      } catch (error) {
        stop(error);
      }
    },

    setInput(name: string, value: number): void {
      if (idle() || ready === null) return;
      try {
        ready.io.writeInput(name, value);
        // 在这里结算，而不是留给下一次 `step`，这样被写进引脚的值会立刻
        // 出现在所有组合逻辑上——调试器的“写入”正是为此——而随后的时钟沿
        // 仍能采样到它，因为 `step` 会再结算一次。`writeInput` 会忽略关卡
        // 没有声明的名字，以及放不进该引脚的值。
        ready.sim.settle();
      } catch (error) {
        stop(error);
      }
    },

    readOutputs(): Readonly<Record<string, number>> {
      if (ready === null) return {};
      const outputs: Record<string, number> = {};
      for (const pin of spec.io.outputs) outputs[pin.id] = ready.io.readOutput(pin.id);
      return outputs;
    },

    readRegisters(): readonly number[] | null {
      return stateOf(instanceOfDef('regfile6'));
    },

    readPc(): number | null {
      const state = stateOf(instanceOfDef('pc8'));
      return state === null ? null : (state[0] ?? 0);
    },

    readHalt(): boolean | null {
      // 与 `stateOf` 同一道闸门：在发生任何结算之前，这个引脚只是构造函数
      // 里的 0，而“运行”不是一台从未运行过的机器有资格给出的读数。见
      // `errors`。
      if (idle() || ready === null) return null;
      const id = instanceOfDef('halt');
      if (id === null) return null;
      // 读引脚而不是读状态：`halt` 发布的是 `out = in`（见 `defs/cpu.ts`），
      // 所以这里得到的信号与计数器装载逻辑读到的是同一个。画板没有这个元件
      // 时返回 `null`，因为从未接出这条线的画板，没有告诉面板计数器是
      // 自由的。
      const line = ready.sim.read(ready.sim.net.outputBase(`${id}.out`), 1);
      return portValueToNumber(line) === 1;
    },

    readRam(): readonly number[] | null {
      // 惰性意味着表里还是原有的 0，那不是装载过任何东西的存储器。见
      // `stateOf` 与 `errors`。
      if (idle() || ready === null) return null;
      // 哪一块 RAM：与检查器装载时用同一条规则（`programTargets`），于是
      // 窗口不会显示与镜像所进不同的存储器。电路里有好几块程序 RAM 时这里
      // 取第一块；它们都持有同一份镜像，因为装载会写全部。
      const targets = programTargets(undefined, ready.sim.net);
      if ('detail' in targets) return null;
      return stateOf(targets.ids[0] ?? null);
    },
  };
}
