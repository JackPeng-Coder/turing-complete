import type { Graph, Instance, Wire } from '../core/graph';
import {
  libraryFrom,
  mergeLibrary,
  repointComponents,
  type BlueprintLibrary,
} from '../levels/blueprints';

/**
 * 电路文件：导出时写、导入时读的东西。
 *
 * 元件随文件内联保存。文件是电路离开它被搭建的那台机器的方式，而玩家的自定义
 * 元件是电路的一部分——一个引用 `bp1`、指望读者本地正好也有 `bp1` 的文件，有
 * 一半场合打不开。`Progress.blueprints` 是持久元件库，这里则是它的载体；导入
 * 时会把文件带来的元件合并进已有库。
 *
 * 绝不部分加载。任何失败——格式不对、版本未知、字段类型错误——都返回一条说明
 * 而不是一个电路，因为唯一必须排除的结果是"坏文件悄悄替换了画板"。
 */
export const CIRCUIT_FORMAT = 'tc-circuit';
export const CIRCUIT_VERSION = 1;

/** 文件的对象形态。写文件就是把它 `JSON.stringify` 出去。 */
export interface CircuitFile {
  readonly format: typeof CIRCUIT_FORMAT;
  readonly version: typeof CIRCUIT_VERSION;
  readonly level: string;
  readonly instances: readonly Instance[];
  readonly wires: readonly Wire[];
  /** 电路用到的自定义元件，按依赖顺序排列。 */
  readonly blueprints: readonly Graph[] | readonly unknown[];
}

/** 一个文件所表达的内容：一个电路，以及它带来的元件。 */
export interface ParsedCircuit {
  readonly graph: Graph;
  readonly blueprints: BlueprintLibrary;
}

/**
 * 读不出来的文件，用"键 + 值"的形式表达。
 *
 * 采用可判别的分支（discriminated arm），而不是裸字符串消息。读取函数返回两种
 * 形状之一，调用方靠结果里有没有 `error` 来区分——若错误分支没有自己的专属属性，
 * 它就与"成功读到一份恰好有个 zh 字段的电路"无法区分，类型也无法收窄。
 * 文案同时给中英两份，是为了让状态栏与命令行都能直接显示。
 */
export interface CircuitRefusal {
  readonly error: { readonly zh: string; readonly en: string };
}

/**
 * 把文档写成文件文本。
 *
 * `blueprints` 是调用方算好的闭包（`libraryClosure`）：实例所命名的元件，加上
 * 那些元件自己又实例化的元件。图的 `customComponents` 在这里不被查询——元件
 * 住在元件库里，所以随文件走的就是库里的那份。
 */
export function serializeCircuit(graph: Graph, components: readonly unknown[]): string {
  const file = {
    format: CIRCUIT_FORMAT,
    version: CIRCUIT_VERSION,
    level: graph.level ?? 'sandbox',
    instances: graph.instances,
    wires: graph.wires,
    blueprints: components,
  };
  // 带缩进并补上末尾换行：导出的电路是玩家很可能打开来看的文本文件，
  // 多花几个字节换来可读、可 diff 是值得的。
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * 把文件文本读成文档；不是文档时给出原因。
 *
 * `existing` 是读取方自己的元件库，这正是导入安全的关键：文件带来的元件会用
 * 冲突 id 改名的方式合并进去（`mergeLibrary`），随后电路再被重新指向它最终
 * 得到的名字。省略该参数表示对着空库读取，这既是测试想要的，也是"没什么可
 * 失去"的调用方自然得到的默认。
 *
 * 返回的图带着它需要的元件（`customComponents`），这样调用方可以把返回的库与
 * 这些元件组成注册表交给 `compile`，得到与写出方相同的电路。
 */
export function parseCircuit(
  text: string,
  existing: BlueprintLibrary = {},
): ParsedCircuit | CircuitRefusal {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      error: {
        zh: '这不是一个电路文件：内容不是 JSON。',
        en: 'This is not a circuit file: its contents are not JSON.',
      },
    };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { error: { zh: '这不是一个电路文件。', en: 'This is not a circuit file.' } };
  }
  const file = raw as Partial<{
    format: unknown;
    version: unknown;
    level: unknown;
    instances: unknown;
    wires: unknown;
    blueprints: unknown;
  }>;
  if (file.format !== CIRCUIT_FORMAT) {
    return {
      error: {
        zh: `这不是本作的电路文件（format 是 ${JSON.stringify(file.format)}，应为 ${CIRCUIT_FORMAT}）。`,
        en: `This is not one of this project's circuit files (format is ${JSON.stringify(file.format)}, expected ${CIRCUIT_FORMAT}).`,
      },
    };
  }
  if (file.version !== CIRCUIT_VERSION) {
    return {
      error: {
        zh: `电路文件版本 ${String(file.version)} 无法读取（本作支持 ${CIRCUIT_VERSION}）。`,
        en: `Circuit file version ${String(file.version)} cannot be read (this build writes ${CIRCUIT_VERSION}).`,
      },
    };
  }
  if (!Array.isArray(file.instances) || !Array.isArray(file.wires)) {
    return {
      error: {
        zh: '电路文件缺少元件或导线列表。',
        en: 'The circuit file has no instance or wire list.',
      },
    };
  }

  const incoming = libraryFrom(Array.isArray(file.blueprints) ? file.blueprints : []);
  const { library, renamed } = mergeLibrary(existing, incoming);
  const base: Graph = {
    instances: cloneInstances(file.instances),
    wires: cloneWires(file.wires),
    // 内联一份，使文档在元件库合并之前也能独立成立：`compile` 从两处中的任一处
    // 都能读到定义（`core/net.ts`）。
    customComponents: Object.values(incoming).map((entry) => entry.def),
  };
  if (typeof file.level === 'string' && file.level !== '') base.level = file.level;
  return { graph: repointComponents(base, renamed), blueprints: library };
}

/**
 * 逐条类型检查实例列表，而不是相信文件自己的说法。
 *
 * 规则是"跳过坏条目，保留好条目"：一份半损坏的文件仍然能给出玩家搭过的那部分
 * 电路，缺失的坐标补 0、缺失的旋转补 0、缺失的参数补空表，于是下游不必到处
 * 判空。只要 `id` 与 `def` 不是字符串就丢弃——这两项是实例的身份，猜不出来。
 */
function cloneInstances(raw: readonly unknown[]): Instance[] {
  const out: Instance[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const inst = entry as Partial<Instance>;
    if (typeof inst.id !== 'string' || typeof inst.def !== 'string') continue;
    out.push({
      id: inst.id,
      def: inst.def,
      x: typeof inst.x === 'number' ? inst.x : 0,
      y: typeof inst.y === 'number' ? inst.y : 0,
      rot: (inst.rot ?? 0) as Instance['rot'],
      params: typeof inst.params === 'object' && inst.params !== null ? { ...inst.params } : {},
    });
  }
  return out;
}

/** 导线同理：任意一端没有名字的导线被丢弃，因为无法知道它连到哪里。 */
function cloneWires(raw: readonly unknown[]): Wire[] {
  const out: Wire[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const wire = entry as Partial<Wire>;
    if (typeof wire.id !== 'string') continue;
    const from = wire.from;
    const to = wire.to;
    if (typeof from?.inst !== 'string' || typeof from?.port !== 'string') continue;
    if (typeof to?.inst !== 'string' || typeof to?.port !== 'string') continue;
    out.push({
      id: wire.id,
      from: { inst: from.inst, port: from.port },
      to: { inst: to.inst, port: to.port },
    });
  }
  return out;
}
