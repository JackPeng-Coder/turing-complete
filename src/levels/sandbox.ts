/**
 * 沙盒：一份“没有题目”的关卡规格，以及它如何把画板上的接插件当作引脚。
 *
 * 沙盒被建模成 `LevelSpec`，而不是另起一种屏幕：画板、调色板、相机、
 * 读数、智能体都已经只会读 `LevelSpec`，另起一套必然与关卡那一套漂移。
 *
 * 依赖同层 `spec.ts` 的类型，以及调用方传入的 `core/graph` 与
 * `core/registry`；被 `main.ts`、`app/inputs.ts`、`app/progress.ts` 与
 * 测试使用。关键不变量：沙盒的 `io` 永远为空，它的引脚来自画板上放置的
 * `level_input` / `level_output` 实例，且实例 id 就是引脚 id。
 */

import type { Graph } from '../core/graph';
import type { Registry } from '../core/registry';
import type { LevelSpec, PinSpec } from './spec';

/**
 * 沙盒屏幕，用一份 `LevelSpec` 表示。
 *
 * 之所以能是一个 spec，是因为画板本来就只会读 spec：应用对电路做的每件事
 * （`openLevel`、`rebuild`、`measure`、`createDisplay`、调色板、相机
 * 取景）都接受 `LevelSpec`，并从它读 `io`、`checks`、`allowedComponents`
 * 与 `board`。若沙盒是“另一种屏幕”，上面每一项都得再实现一遍，而两份
 * 实现第一次改动就会漂移。于是沙盒就是一份“挑战字段全空”的 spec：
 *
 *  * `checks: []` —— 没有任何判定。读数仍会测量门数、延迟与节拍，因为
 *    “测量”不等于“评判”（见 `AppState.metrics`）。
 *  * `io` 为空 —— 没有关卡需要绑定引脚。驱动沙盒电路的是玩家自己放置的
 *    `level_input` / `level_output` 元件，它们在这里是普通元件而不是
 *    关卡管道：`sandboxPins` 把放下的接插件读成画板的引脚，`boardPins`
 *    再把同一份列表交给读数、显示与智能体。
 *  * `allowedComponents: []` —— 刻意不是沙盒的调色板。调色板改为从元件
 *    注册表推导（`sandboxPaletteDefs`），这正是这块屏幕的意义：基础
 *    注册表里的全部元件、玩家已解锁的元件，加上玩家自制的元件。
 *  * `sandbox: true` —— 面板因此能区分“沙盒本来就没有测试用例”与
 *    “某一关漏了测试用例”，而不必靠 id 猜。
 *
 * `chapter` 为 0、`index` 为 0 是占位值：沙盒不属于任何章节，也没有
 * 关卡位次。它不在 `ALL_LEVELS` 或 `LEVEL_ORDER` 里，所以章节地图、
 * 解锁链以及任何遍历已发布关卡的地方，都不会因为它的存在而改变。
 */
export const SANDBOX_ID = 'sandbox';

export const SANDBOX_LEVEL: LevelSpec = {
  id: SANDBOX_ID,
  chapter: 0,
  index: 0,
  name: { zh: '沙盒', en: 'Sandbox' },
  brief: {
    zh: '自由建造：这里没有题目、没有测试用例，也没有对错。元件随你取用，电路一直在跑——顶栏的门数与延迟是你自己的读数。做完的东西可以导出成电路文件，也可以随时导入回来。',
    en: 'Free build: no puzzle, no test cases, no verdict. Take any part, watch the circuit run, and read the gate and delay counters as your own measurements. What you build can be exported to a circuit file and imported back at any time.',
  },
  hint: {
    zh: '左侧调色板里是你已经解锁的元件和全部基础元件。把「关卡输入」和「关卡输出」放到板上，左下角的面板就能翻转输入、读出结果；如果同一块电路要用很多次，框选它并封装成自己的元件。',
    en: 'The palette on the left holds every base part plus what you have unlocked. Put a Level Input and a Level Output on the board and the sidebar can flip the input and read the answer; if you need the same circuit more than once, band-select it and wrap it into a part of your own.',
  },
  allowedComponents: [],
  io: { inputs: [], outputs: [] },
  checks: [],
  sandbox: true,
};

/** 判断一份规格是沙盒而不是战役关卡。 */
export function isSandbox(level: LevelSpec): boolean {
  return level.sandbox === true;
}

/**
 * 沙盒调色板提供的两个接插件，作为普通元件。
 *
 * 它们与关卡使用的是同一批注册表定义（`level_input` / `level_output`），
 * 也保留了自己的 `hidden` 标记——正因如此，它们不会出现在其他关卡的调色板
 * 里，只会出现在明确列出它们的关卡。沙盒是例外：它没有关卡规格来声明
 * 引脚，所以这两个接插件“就是”它的引脚；没有它们，沙盒电路既没有地方
 * 施加输入，也没有数字可报告——这正是有玩家踩过的坑（“怎么没有输出”）。
 */
export const SANDBOX_CONNECTORS = ['level_input', 'level_output'] as const;

/** 一块画板的引脚：从哪里施加输入、向哪里读出输出。 */
export interface BoardPins {
  readonly inputs: readonly PinSpec[];
  readonly outputs: readonly PinSpec[];
}

/**
 * 沙盒画板的引脚，就是画板上的接插件。
 *
 * `SANDBOX_LEVEL.io` 刻意留空：沙盒没有题目来固定引脚表，所以引脚表就是
 * 玩家放了什么。每个接插件实例成为一个引脚，名字用实例 id（`IN_1`、
 * `OUT_1`……）；位宽取实例的 `params.width`（若设置了），否则取定义声明
 * 的位宽（1 位）——与 `compile` 用的是同一条规则，所以这里的引脚永远与
 * 它所指的已编译槽位一致。
 *
 * 顺序就是画板自身的顺序。实例按图的顺序返回，也就是创建顺序，所以面板里
 * `IN_1` 排在 `IN_2` 前面，且删掉其中一个不会让其余引脚重新编号。
 */
export function sandboxPins(graph: Graph, registry: Registry): BoardPins {
  const inputs: PinSpec[] = [];
  const outputs: PinSpec[] = [];
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    const def = registry.get(inst.def);
    if (inst.def === 'level_input') {
      inputs.push({ id: inst.id, width: widthOf(inst.params.width, def.outputs[0]?.width) });
    } else if (inst.def === 'level_output') {
      outputs.push({ id: inst.id, width: widthOf(inst.params.width, def.inputs[0]?.width) });
    }
  }
  return { inputs, outputs };
}

/** 引脚的最终位宽：实例覆盖值优先，其次定义声明的位宽，最后兜底 1 位。 */
function widthOf(override: number | undefined, declared: number | undefined): number {
  if (override !== undefined && Number.isSafeInteger(override) && override > 0) return override;
  return declared ?? 1;
}

/**
 * 当前打开的画板的引脚：关卡用关卡自己的，沙盒用放上去的接插件。
 *
 * 所有读取画板引脚的地方都走这里——侧边读数、实时显示、智能体的
 * `read_board`——于是“引脚是什么”对三者只有一个答案。另起一份列表，
 * 就是又一处需要同步维护的东西。
 */
export function boardPins(level: LevelSpec, graph: Graph, registry: Registry): BoardPins {
  return isSandbox(level) ? sandboxPins(graph, registry) : level.io;
}
