/**
 * 把画板上的一块选区封装成一个自定义元件（“封装”）。
 *
 * 封装是应用里唯一同时改动两处的一次编辑：电路失去选中的元件、多出一个
 * 新实例；元件库则多出一个定义。所以本模块把它拆成“先算计划、再一次性
 * 应用”，计划完全由 (graph, selection) 决定。
 *
 * 依赖下层 `core/graph`（实例、导线、id 生成）与同层 `blueprints.ts`
 * （元件库与 id）；被 `main.ts`、命令栈与测试使用。
 *
 * 关键规则：新元件的引脚由“跨越选区边界的导线”推导——从外到内的导线
 * 成为输入引脚，从内到外的成为输出引脚；没有接线的内侧引脚不暴露成引脚。
 */

import {
  addInstance,
  emptyGraph,
  nextId,
  type CustomComponentDef,
  type Graph,
  type Instance,
  type Wire,
  type WireEnd,
} from '../core/graph';
import type { Registry } from '../core/registry';
import { nextBlueprintId, type BlueprintLibrary } from './blueprints';

/**
 * 选区即将变成的元件的一个引脚。
 *
 * `inner` 是该引脚在元件体内部对应的端点：外部导线最终要接到选区里那个
 * 实例的引脚上。`id` 是这个引脚在新元件上的名字，提交前玩家可以在草稿
 * 面板里修改。
 */
export interface DraftPin {
  /** 建议的 id，在一份草稿内唯一。 */
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly inner: WireEnd;
  /** 与它相连的那个外部引脚，供面板显示。 */
  readonly label: string;
  /** 内部引脚的位宽，新元件的引脚继承它。 */
  readonly width: number;
}

/**
 * 把选区变成元件之后的样子，以纯数据表示。
 *
 * 这里不碰文档。由于封装会同时改动两处，它被设计成“先算好、再一步
 * 应用”（`commands.ts`）；把计划做成 (graph, selection) 的函数，也让
 * 真正有意思的一半可以脱离画板测试：元件暴露哪些引脚、导线如何重画、
 * 元件体是什么。
 */
export interface WrapPlan {
  /** 移入元件体的实例，按它们在画板上的原顺序。 */
  readonly body: Graph;
  /** 元件库将新增的定义。 */
  readonly component: CustomComponentDef;
  /** 画板上其余实例，原样保留。 */
  readonly kept: readonly Instance[];
  /** 留在画板上的导线；跨越切口的那些已经改画到新实例。 */
  readonly wires: readonly Wire[];
  /** 移入元件体的导线。 */
  readonly movedWires: readonly Wire[];
  /** 新实例放置的位置：选区的中心。 */
  readonly at: { x: number; y: number };
  readonly inputs: readonly DraftPin[];
  readonly outputs: readonly DraftPin[];
  /** 玩家画了、却没有为它声明引脚的边界导线条数。 */
  readonly undeclared: number;
}

/** 选中的画板实例，按画板顺序返回（不是点击顺序）。 */
export function selectionOf(graph: Graph, ids: readonly string[]): Instance[] {
  const wanted = new Set(ids);
  return graph.instances.filter((inst) => wanted.has(inst.id));
}

/**
 * 计算封装 `selection` 会得到什么。
 *
 * 边界由导线推导——这是唯一诚实的来源：一个元件的引脚，恰好是导线跨越
 * 选区边缘的那些地方。于是玩家在选区外新接一根线，就自动多一个引脚，
 * 不需要声明什么；而什么都没接的选区，得到一个没有出入口的元件——这恰
 * 好也是它电路的实际行为。
 *
 *  * 从外部接到选区内某个输入引脚的导线 → 元件的 INPUT 引脚
 *  * 从选区内某个输出引脚接到外部的导线     → 元件的 OUTPUT 引脚
 *  * 两端都在选区内的导线                   → 元件体内部接线，原样移入
 *  * 选区内完全没接线的输入引脚             → 在体内读 0，和现在一样，
 *    所以刻意不给它引脚：硬造一个引脚，等于凭空发明电路本来没有的控制端。
 *
 * 元件声明的引脚就是这些推导出来的引脚，每根跨界导线一个；每根跨界导线
 * 也都改画到新实例上。`undeclared` 统计无法改画的跨界导线——端点已经
 * 不存在的那种，`validateGraph` 早就报告过——于是调用方可以如实告诉玩家，
 * 而不是悄悄丢掉一条连接。
 */
export function planWrap(
  graph: Graph,
  registry: Registry,
  library: BlueprintLibrary,
  ids: readonly string[],
  options: { name?: { zh: string; en: string } } = {},
): WrapPlan | null {
  const selection = selectionOf(graph, ids);
  if (selection.length === 0) return null;
  const inside = new Set(selection.map((inst) => inst.id));
  const id = nextBlueprintId(library);

  const body = emptyGraph();
  for (const inst of selection) {
    // 放进元件体的是副本，不是实例本身：元件体的寿命长于这份计划，把
    // 文档自己的对象交给元件库，二者会共用同一条记录。元件体需要 id、位置
    // 和 params，所以副本带上它们，其余字段不变。
    body.instances.push({ ...inst, params: { ...inst.params } });
  }

  const inputs: DraftPin[] = [];
  const outputs: DraftPin[] = [];
  const wires: Wire[] = [];
  const movedWires: Wire[] = [];
  let undeclared = 0;

  /** 端点所指的选中实例；端点在选区外时为 `null`。 */
  const selectedAt = (end: WireEnd): Instance | null =>
    inside.has(end.inst) ? (selection.find((inst) => inst.id === end.inst) ?? null) : null;

  for (const wire of graph.wires) {
    const from = selectedAt(wire.from);
    const to = selectedAt(wire.to);
    if (from && to) {
      movedWires.push({ ...wire, from: { ...wire.from }, to: { ...wire.to } });
      continue;
    }
    if (!from && !to) {
      wires.push({ ...wire, from: { ...wire.from }, to: { ...wire.to } });
      continue;
    }
    // 一端在里、一端在外：这条导线变成一个引脚。引脚继承它所连接的那个
    // 内侧引脚的位宽——若只看导线恰好在用一位，就给元件一个一位宽的 `a`，
    // 会把一个字节悄悄切成两半。
    const inner = from ? wire.from : wire.to;
    const outer = from ? wire.to : wire.from;
    const host = selection.find((inst) => inst.id === inner.inst)!;
    const def = registry.has(host.def) ? registry.get(host.def) : null;
    if (!def || def.body !== undefined) {
      // 选区内是管道引脚（`level_*`）或嵌套元件：没有它自己的引脚可暴露，
      // 因此这条导线无法重画。
      undeclared += 1;
      continue;
    }
    const pins = from ? def.outputs : def.inputs;
    const width = host.params.width ?? pins.find((pin) => pin.id === inner.port)?.width ?? 1;
    if (from) {
      // 导线指向选区外：从此由新元件驱动外部引脚，所以新元件自己的引脚是
      // 重画后那条导线的 SOURCE（起点）。
      const pin: DraftPin = {
        id: uniquePinId(outputs, inner.port),
        name: { zh: inner.port, en: inner.port },
        inner: { inst: inner.inst, port: inner.port },
        label: `${outer.inst}.${outer.port}`,
        width,
      };
      outputs.push(pin);
      wires.push({
        ...wire,
        from: { inst: NEW_INSTANCE, port: pin.id },
        to: { ...outer },
      });
    } else {
      // 导线指入选区内：从此由外部引脚驱动新元件，所以新元件自己的引脚是
      // DESTINATION（终点）。
      const pin: DraftPin = {
        id: uniquePinId(inputs, inner.port),
        name: { zh: inner.port, en: inner.port },
        inner: { inst: inner.inst, port: inner.port },
        label: `${outer.inst}.${outer.port}`,
        width,
      };
      inputs.push(pin);
      wires.push({
        ...wire,
        from: { ...outer },
        to: { inst: NEW_INSTANCE, port: pin.id },
      });
    }
  }

  body.wires.push(...movedWires);
  const component: CustomComponentDef = {
    id,
    name: options.name ?? { zh: `自制元件 ${id}`, en: `Part ${id}` },
    inputs: inputs.map((pin) => ({ id: pin.id, width: pin.width })),
    outputs: outputs.map((pin) => ({ id: pin.id, width: pin.width })),
    binds: {
      inputs: Object.fromEntries(inputs.map((pin) => [pin.id, { ...pin.inner }])),
      outputs: Object.fromEntries(outputs.map((pin) => [pin.id, { ...pin.inner }])),
    },
    body,
  };

  const xs = selection.map((inst) => inst.x);
  const ys = selection.map((inst) => inst.y);
  return {
    body,
    component,
    kept: graph.instances.filter((inst) => !inside.has(inst.id)),
    wires,
    movedWires,
    at: {
      x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
      y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
    },
    inputs,
    outputs,
    undeclared,
  };
}

/**
 * 计划构建期间新实例携带的 id。
 *
 * 它是占位符，不是真正的 id：真正的 id 由 `applyWrap` 针对它要写入的那张
 * 图现场生成（计划是纯函数，无从知道哪个 id 空着）。计划重画的每一条
 * 导线都写成这个占位符，应用计划时统一替换一次。
 */
export const NEW_INSTANCE = '\u0000new';

/**
 * 取一个尚未被占用的引脚 id，于是两个 `a` 引脚会变成 `a` 和 `a2`。
 *
 * 唯一性按输入、输出各自计算，而不是整颗元件统一：`new` 与 `out` 可以
 * 同时存在，只有真正重名时才加后缀。否则一个“输出叫 a”的元件会逼得
 * 第二个输入被改名成 `a2`，而玩家看不出任何理由。
 */
function uniquePinId(taken: readonly DraftPin[], port: string): string {
  const used = new Set(taken.map((pin) => pin.id));
  if (!used.has(port)) return port;
  let n = 2;
  while (used.has(`${port}${n}`)) n += 1;
  return `${port}${n}`;
}

/**
 * 把计划应用到一张图和一个元件库上，返回它们变成的两个值。
 *
 * 新实例的 id 在这里、从封装要写入的那张图生成，因此计划里重画导线上的
 * 占位符会在同一趟里被替换。返回值是普通的 `{ graph, library }`，调用方
 * 可以直接把它交给一条命令，而本模块不必知道“命令”是什么。
 */
export function applyWrap(
  graph: Graph,
  library: BlueprintLibrary,
  plan: WrapPlan,
): { graph: Graph; library: BlueprintLibrary } {
  const next: Graph = {
    instances: plan.kept.map((inst) => ({ ...inst, params: { ...inst.params } })),
    wires: plan.wires.map((wire) => ({
      ...wire,
      from: { ...wire.from },
      to: { ...wire.to },
    })),
    customComponents: [...graph.customComponents],
  };
  if (graph.level !== undefined) next.level = graph.level;

  // ID 从玩家当前持有的图里生成，而不是从正在构建的图。移入元件体的实例
  // 已经不在 `next.instances` 里，若对着这份缩短后的列表生成 id，就会重新
  // 发出元件体内部还在使用的 id——于是接到新实例的导线会悄悄解析到同名的
  // 体内实例，电路把自己接成了环。
  const instanceId = nextId('i', graph.instances);
  const instance = addInstance(next, plan.component.id, plan.at.x, plan.at.y, instanceId);
  // 重新绑定成新值：`WireEnd` 是只读的，所以占位符靠重新构造端点来替换，
  // 而不是原地赋值。
  next.wires = next.wires.map((wire) => ({
    ...wire,
    from: wire.from.inst === NEW_INSTANCE ? { inst: instance.id, port: wire.from.port } : wire.from,
    to: wire.to.inst === NEW_INSTANCE ? { inst: instance.id, port: wire.to.port } : wire.to,
  }));

  return {
    graph: next,
    library: {
      ...library,
      [plan.component.id]: { name: { ...plan.component.name }, def: plan.component },
    },
  };
}

