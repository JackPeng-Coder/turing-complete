import type { PinDef, Registry } from './registry';

/**
 * 可编辑的电路文档。
 *
 * Graph 是画板直接修改、也是会被写入磁盘的对象。它是"文档"而不是网表：
 * 它可能只搭了一半，可能引用了玩家还没解锁的元件，也可能含有仿真器无法
 * 稳定的反馈。因此这里的一切都由 validateGraph 检查（只报告、从不抛错），
 * 而不是默认可信。
 */

/**
 * 文档里的一个元件实例：指向注册表中的一个定义，并带画板坐标、旋转与调参。
 * id 在一份文档内唯一；自定义元件被展开时，实例 id 会按路径拼成 i3/i1
 * 这样的编译路径（见 net.ts）。
 */
export interface Instance {
  readonly id: string;
  /** 元件定义 id，编译时通过 Registry 解析成 ComponentDef。 */
  readonly def: string;
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  /** 每个实例的调参项（目前只有位宽 width）；基础门保持空对象。 */
  readonly params: Record<string, number>;
}

/** 导线的一端：一个实例 id 加上该实例上的一个引脚 id。 */
export interface WireEnd {
  readonly inst: string;
  readonly port: string;
}

/** 信号从 from（输出引脚）流向 to（输入引脚），方向由类型强制。 */
export interface Wire {
  readonly id: string;
  readonly from: WireEnd;
  readonly to: WireEnd;
}

/**
 * 一个自定义元件声明的引脚，在它的内部电路里落到哪个引脚上。
 *
 * PinDef 只说明"这个元件有一个引脚"，并不说明这个引脚对应内部电路的哪个
 * 引脚。没有这份映射，元件的表面就只是一串没有实体的名字，所以每个声明
 * 引脚都携带它代表的内部端点：输入代表它去驱动的内部输入引脚，输出代表
 * 它去读取的内部输出引脚。
 *
 * 用 WireEnd 而不是裸的引脚 id，是因为内部电路是一整张 Graph：端点必须
 * 同时点名实例与引脚，和一根导线的端点完全一样。
 */
export interface BlueprintBinds {
  /** 声明的输入引脚 id -> 它在内部电路里驱动的那个 INPUT 引脚。 */
  readonly inputs: Readonly<Record<string, WireEnd>>;
  /** 声明的输出引脚 id -> 它在内部电路里读取的那个 OUTPUT 引脚。 */
  readonly outputs: Readonly<Record<string, WireEnd>>;
}

/**
 * 玩家自己搭建的元件：一张命名的内部电路图，外加一套声明的引脚表面。
 *
 * 这里的 ID 是元件 id，不是实例 id。这个元件的某个实例通过 Instance.def
 * 引用它，和引用 nand 的方式完全一样，所以元件托盘、validateGraph 与
 * compile 看到的都是同一种东西。BlueprintBinds 说明"表面"的含义；body 是
 * 一张普通的可编辑电路图——正因为如此，一个自定义元件才能再被别人封装。
 *
 * body 里刻意没有 level 字段：那个字段标的是"某次关卡作答"属于哪一关，
 * 而元件不属于任何关卡。
 */
export interface CustomComponentDef {
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  readonly binds: BlueprintBinds;
  readonly body: Graph;
}

/**
 * 一份电路文档：实例、导线与自定义元件定义。
 *
 * 它是"可编辑的中间状态"，不是可直接运行的网表，因此允许只搭了一半；
 * level 只出现在"某次关卡作答"里，沙盒电路没有这个字段。
 */
export interface Graph {
  /** 这份电路针对的关卡 id；沙盒电路没有这个字段。 */
  level?: string;
  instances: Instance[];
  wires: Wire[];
  customComponents: CustomComponentDef[];
}

/**
 * 校验问题的种类。error 级会阻止 compile；warning 级只是提示。
 *
 * 把问题分类而不是靠字符串消息判定，是为了让 UI 与智能体能稳定地按 code
 * 分支处理：消息是给玩家看的，措辞可以随时改。
 */
export type IssueCode =
  | 'unknown-def'
  | 'unknown-instance'
  | 'unknown-port'
  | 'multiple-drivers'
  | 'invalid-params'
  | 'dangling-input'
  | 'feedback-loop'
  /**
   * 自定义元件的内部电路里出现了它自己。
   *
   * 这里选择拒绝而不是展开：仿真的做法就是展开，而一个包含自己的元件会
   * 永远展开下去；若用上限去截断，报出来的就变成"尺寸问题"，而真正的缺陷
   * 是环。规格允许的嵌套上限是 8 层，但环不是"深"，是格式错误。
   */
  | 'recursive-blueprint';

/**
 * 文档允许设置的最大 params.width，单位是位。
 *
 * 位宽会成倍放大实例的每个引脚，并且要提前预留存储槽，所以这个上界用于
 * 阻止格式错误的文档向信号表索取它给不出的分配——具体检查见
 * validateGraph。
 */
export const MAX_PARAM_WIDTH = 4096;

/**
 * 在一张图里发现的一处缺陷。
 *
 * error 表示电路没有意义，仿真器要么崩溃要么算出垃圾，所以 compile 会
 * 拒绝它。warning 表示玩家大概还在搭：未接线的输入按规则读 0，而反馈环
 * 只要有存储元件就可能是合法的——到底能否稳定只有仿真器知道。
 */
export interface GraphIssue {
  readonly severity: 'error' | 'warning';
  readonly code: IssueCode;
  readonly message: { zh: string; en: string };
  readonly inst?: string;
  readonly port?: string;
}

/**
 * 建一份空文档；传入 level 时表示这是某一关的作答。
 * 不传 level 时文档里不会出现 level 字段（沙盒电路）。
 */
export function emptyGraph(level?: string): Graph {
  const g: Graph = { instances: [], wires: [], customComponents: [] };
  if (level !== undefined) g.level = level;
  return g;
}

/**
 * 下一个可用的 <前缀><数字> id：已用数字后缀的最大值加一。
 *
 * 因此从 [i1, i2, i3] 里删掉 i2 后，i2 会在以后被重新使用，这没有问题——
 * id 只要求在"某一时刻同时存在的对象之间"唯一。
 */
export function nextId(prefix: string, existing: readonly { id: string }[]): string {
  let max = 0;
  for (const item of existing) {
    const m = /^(\d+)$/.exec(item.id.slice(prefix.length));
    if (item.id.startsWith(prefix) && m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/**
 * 往文档里加一个实例并返回它；id 省略时自动分配下一个 i<n>。
 * 旋转固定为 0，params 初始为空；需要位宽等调参的调用方拿到返回值后再写。
 * 只负责插入，不做校验——validateGraph 才是唯一的判定处。
 */
export function addInstance(g: Graph, def: string, x: number, y: number, id?: string): Instance {
  const inst: Instance = {
    id: id ?? nextId('i', g.instances),
    def,
    x,
    y,
    rot: 0,
    params: {},
  };
  g.instances.push(inst);
  return inst;
}

/** 删除一个元件实例，同时删掉所有以它为起点或终点的导线。 */
export function removeInstance(g: Graph, id: string): void {
  g.instances = g.instances.filter((i) => i.id !== id);
  g.wires = g.wires.filter((w) => w.from.inst !== id && w.to.inst !== id);
}

/**
 * 添加一根导线，不检查两端是否合法：调用方可能正处在编辑中途，
 * validateGraph 才是唯一判定结果的地方。
 */
export function connect(g: Graph, from: WireEnd, to: WireEnd, id?: string): Wire {
  const wire: Wire = { id: id ?? nextId('w', g.wires), from, to };
  g.wires.push(wire);
  return wire;
}

/**
 * 按导线 id 删除一根导线；id 不存在时什么也不做（幂等）。
 * 撤销栈保存的是整张图快照，所以这里不需要记录被删掉的导线。
 */
export function disconnect(g: Graph, wireId: string): void {
  g.wires = g.wires.filter((w) => w.id !== wireId);
}

/**
 * 深拷贝，供编辑器做撤销快照。每个嵌套对象都被重建——实例、导线的两端、
 * 以及自定义元件的内部电路（递归进行）——所以修改副本绝不会写回正在使用的
 * 原图。
 */
export function cloneGraph(g: Graph): Graph {
  const copy: Graph = {
    instances: g.instances.map((i) => ({ ...i, params: { ...i.params } })),
    wires: g.wires.map((w) => ({ ...w, from: { ...w.from }, to: { ...w.to } })),
    customComponents: g.customComponents.map((c) => ({
      id: c.id,
      name: { ...c.name },
      inputs: c.inputs.map((p) => ({ ...p })),
      outputs: c.outputs.map((p) => ({ ...p })),
      binds: {
        inputs: cloneWireEnds(c.binds.inputs),
        outputs: cloneWireEnds(c.binds.outputs),
      },
      body: cloneGraph(c.body),
    })),
  };
  if (g.level !== undefined) copy.level = g.level;
  return copy;
}

/** 复制自定义元件绑定表的一侧，保证克隆体与原图不共享任何对象。 */
function cloneWireEnds(
  ends: Readonly<Record<string, WireEnd>>,
): Record<string, WireEnd> {
  const copy: Record<string, WireEnd> = {};
  for (const [pin, end] of Object.entries(ends)) copy[pin] = { ...end };
  return copy;
}

function pinIds(pins: readonly PinDef[]): Set<string> {
  return new Set(pins.map((p) => p.id));
}

/**
 * 报告 g 中所有结构性缺陷，顺序固定：未知元件类型 -> 非法实例参数 ->
 * 坏的导线端点 -> 一个输入被多根线驱动 -> 全图的反馈环扫描 -> 未接线输入。
 *
 * 从不抛错、也不修改任何东西：未知元件类型会作为问题报告，而不让它走到会
 * 抛错的 registry.get；非法的 params.width 同理，也不让它走到会抛错的
 * 信号表 alloc。
 */
export function validateGraph(g: Graph, registry: Registry): GraphIssue[] {
  return validateAt(g, registry, new Map(), new Set(), '', new Set());
}

/**
 * compile 在实例 id 与它内部实例之间放的分隔符（例如 i3/i1）。
 *
 * 它让"元件实例内部的位置"可以被寻址——自定义元件内部元件的 id 在每个
 * 实例里都会重复；也正因如此，下面会拒绝含有这个字符的实例 id。
 */
export const PATH_SEPARATOR = '/';

/** validateGraph 愿意遍历的元件嵌套层数上限。 */
const MAX_BLUEPRINT_DEPTH = 8;

/**
 * 对单张图做 validateGraph，并带上它在文档中的路径。
 *
 * 自定义元件的内部电路本身就是一张完整的 Graph，所以在这里递归校验，而不是
 * 交给调用方：内部电路只有在"承载它的那份文档"里才有意义——元件内部的
 * 未知元件、被双驱动的输入或错误的绑定，都是玩家正在搭的这份电路的缺陷。
 *
 * path 是当前这张图自己的路径（根图为空串，在实例 i3 内部就是 i3/），所以
 * 报告里的 inst 是实例的路径——和 compile 建索引时的写法一致，也是元件能被
 * 实例化多次之后唯一不重复的写法。seen 保存当前正在遍历的元件 id 链：一个
 * 内部电路实例化了链上的某个元件，就是环，直接拒绝而不是展开。
 */
function validateAt(
  g: Graph,
  registry: Registry,
  components: Map<string, CustomComponentDef>,
  validated: Set<string>,
  path: string,
  seen: ReadonlySet<string>,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, Instance>();
  for (const inst of g.instances) byId.set(inst.id, inst);

  /** 这张图里某个实例的完整路径，用于在问题里点名。 */
  const at = (id: string): string => `${path}${id}`;

  /**
   * 每个输出引脚上引出多少根导线。目前还没有人读取它——多驱动是从输入侧
   * （下面的 drivenInputs）抓的——但它把"合法扇出方向"记录了下来，将来若要
   * 加扇出上限，账本已经就位。
   */
  const driverCount = new Map<string, number>();

  const defOf = (inst: Instance) => {
    if (registry.has(inst.def)) return registry.get(inst.def);
    issues.push({
      severity: 'error',
      code: 'unknown-def',
      inst: at(inst.id),
      message: { zh: `未知元件类型：${inst.def}`, en: `Unknown component type: ${inst.def}` },
    });
    return null;
  };

  const defs = new Map<string, ReturnType<Registry['get']> | null>();
  for (const inst of g.instances) defs.set(inst.id, defOf(inst));

  // 这个分隔符是保留字符。compile 用 <外层>/<内层> 来寻址一个自定义元件的
  // 内部实例，所以 id 里若已含分隔符，两个不同实例就会撞到同一个键上：变成
  // 一台被悄悄共享的机器，而不是一份被拒绝的文档。关卡数据与编辑器都自己
  // 生成 id（i1、IN_a、OUT），所以这只是格式错误的文档，不是大电路。
  for (const inst of g.instances) {
    if (!inst.id.includes(PATH_SEPARATOR)) continue;
    issues.push({
      severity: 'error',
      code: 'invalid-params',
      inst: at(inst.id),
      message: {
        zh: `元件 id ${inst.id} 含有保留字符 ${PATH_SEPARATOR}（它用于寻址自定义元件内部的实例）`,
        en: `Instance id ${inst.id} contains the reserved character ${PATH_SEPARATOR} (it addresses instances inside a custom component)`,
      },
    });
  }

  // 每个实例的位宽覆盖值由 compile 解析，并直接用于信号表槽位分配，所以
  // alloc 无法接受的值必须在这里报告——理由和未知元件类型相同：若放行，
  // 它会一路走到 table.alloc，从判定流程里抛出裸 RangeError，而不是变成
  // 调用方已经处理好的 CircuitValidationError。
  //
  // 这里的上界刻意是双侧的。只用 Number.isSafeInteger 会放过 1e9，而位宽
  // 不只是一个引脚的槽数：capacityFor 会在 alloc 之前先为整张表预留
  // slots * 1.25 + regions + 16 个字节，于是手写的一个 1e9 位引脚会要求
  // 分配一个超过 1 GB 的类型化数组，RangeError 从那次分配里冒出来，照样
  // 逃出 compile。4096 远高于游戏实际发放的任何引脚（本阶段 8 位，第 5
  // 阶段最多 64 位），又能让整张表保持小巧，所以超过它就是格式错误的
  // 文档，而不是大电路。
  for (const inst of g.instances) {
    const width = inst.params.width;
    if (width === undefined) continue;
    if (Number.isSafeInteger(width) && width > 0 && width <= MAX_PARAM_WIDTH) continue;
    issues.push({
      severity: 'error',
      code: 'invalid-params',
      inst: at(inst.id),
      message: {
        zh: `元件 ${inst.id} 的参数 width 无效：${String(width)}（必须是 1 到 ${MAX_PARAM_WIDTH} 之间的整数）`,
        en: `Instance ${inst.id} has an invalid width parameter: ${String(width)} (must be a positive integer no greater than ${MAX_PARAM_WIDTH})`,
      },
    });
  }

  const drivenInputs = new Map<string, string[]>();
  /**
   * 每个 drivenInputs 键背后的端口 id。
   *
   * 之所以把它和键存在一起，而不是事后从键里还原：实例 id 是玩家可控的，
   * 引脚 id 来自定义，所以 id 任意之后 "<实例>.<引脚>" 并没有无歧义的分割
   * 方式。键本身仍是两个 id 用点号连接——这没问题，它只当键用，之后没有
   * 任何地方会再把它拆开。
   */
  const drivenPorts = new Map<string, string>();
  for (const wire of g.wires) {
    const fromInst = byId.get(wire.from.inst);
    const toInst = byId.get(wire.to.inst);
    if (!fromInst || !toInst) {
      issues.push({
        severity: 'error',
        code: 'unknown-instance',
        message: {
          zh: `导线 ${wire.id} 指向不存在的元件`,
          en: `Wire ${wire.id} points at a missing instance`,
        },
      });
      continue;
    }
    const fromDef = defs.get(fromInst.id);
    const toDef = defs.get(toInst.id);
    if (fromDef && !pinIds(fromDef.outputs).has(wire.from.port)) {
      issues.push({
        severity: 'error',
        code: 'unknown-port',
        inst: fromInst.id,
        port: wire.from.port,
        message: {
          zh: `${fromDef.name.zh} 没有输出引脚 ${wire.from.port}`,
          en: `${fromDef.name.en} has no output pin ${wire.from.port}`,
        },
      });
      continue;
    }
    if (toDef && !pinIds(toDef.inputs).has(wire.to.port)) {
      issues.push({
        severity: 'error',
        code: 'unknown-port',
        inst: toInst.id,
        port: wire.to.port,
        message: {
          zh: `${toDef.name.zh} 没有输入引脚 ${wire.to.port}`,
          en: `${toDef.name.en} has no input pin ${wire.to.port}`,
        },
      });
      continue;
    }
    const key = `${toInst.id}.${wire.to.port}`;
    const list = drivenInputs.get(key) ?? [];
    list.push(wire.id);
    drivenInputs.set(key, list);
    drivenPorts.set(key, wire.to.port);
    const outKey = `${fromInst.id}.${wire.from.port}`;
    driverCount.set(outKey, (driverCount.get(outKey) ?? 0) + 1);
  }

  for (const [key, wires] of drivenInputs) {
    if (wires.length > 1) {
      const instId = key.slice(0, key.length - (drivenPorts.get(key)!.length + 1));
      issues.push({
        severity: 'error',
        code: 'multiple-drivers',
        inst: at(instId),
        port: drivenPorts.get(key)!,
        message: {
          zh: `输入引脚 ${drivenPorts.get(key)!} 被 ${wires.length} 根导线同时驱动`,
          en: `Input pin ${drivenPorts.get(key)!} is driven by ${wires.length} wires`,
        },
      });
    }
  }

  // 悬空输入 + 反馈环检测（在实例关系图上做迭代式 DFS，避免递归爆栈）
  const adjacency = new Map<string, string[]>();
  for (const inst of g.instances) adjacency.set(inst.id, []);
  for (const wire of g.wires) {
    if (byId.has(wire.from.inst) && byId.has(wire.to.inst)) {
      adjacency.get(wire.from.inst)!.push(wire.to.inst);
    }
  }
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const inst of g.instances) color.set(inst.id, WHITE);
  // 在回边上发现的节点。当前只用到"集合是否为空"（按计划只发一条汇总警告）；
  // 保留这些 id 是为了将来编辑器要高亮回路时，不必重新跑一遍扫描。
  const loopNodes = new Set<string>();
  // 显式栈，不用递归：深电路不能把 JS 调用栈撑爆。
  for (const root of g.instances) {
    if (color.get(root.id) !== WHITE) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }];
    color.set(root.id, GREY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbours = adjacency.get(frame.id)!;
      if (frame.next < neighbours.length) {
        const nb = neighbours[frame.next]!;
        frame.next += 1;
        const c = color.get(nb);
        if (c === WHITE) {
          color.set(nb, GREY);
          stack.push({ id: nb, next: 0 });
        } else if (c === GREY) {
          loopNodes.add(nb);
          loopNodes.add(frame.id);
        }
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }
  if (loopNodes.size > 0) {
    issues.push({
      severity: 'warning',
      code: 'feedback-loop',
      message: {
        zh: '电路中存在反馈回路；若其中没有存储元件，仿真将无法稳定',
        en: 'The circuit has a feedback loop; without a storage element in it the simulation cannot settle',
      },
    });
  }

  for (const inst of g.instances) {
    const def = defs.get(inst.id);
    if (!def) continue;
    for (const pin of def.inputs) {
      if (!drivenInputs.has(`${inst.id}.${pin.id}`)) {
        issues.push({
          severity: 'warning',
          code: 'dangling-input',
          inst: at(inst.id),
          port: pin.id,
          message: {
            zh: `${def.name.zh} 的输入引脚 ${pin.id} 未接线（默认读取 0）`,
            en: `Input pin ${pin.id} of ${def.name.en} is not wired (reads 0)`,
          },
        });
      }
    }
  }

  issues.push(...validateComponents(g, registry, components, validated, path, seen));
  return issues;
}

/**
 * 这张图实例化的自定义元件，作为这张图的一部分接受检查。
 *
 * 凡是 def 带 body 的实例都要：递归校验它的内部电路（把 path 延长，使内部
 * 缺陷点到玩家真正看得见的那个实例）、拒绝它自己包含自己的环、并核对它声明
 * 的引脚表面与它声称代表的内部引脚是否对得上。
 *
 * 内部电路也是一张图，所以享受同样的全套检查——元件内部的未知元件、被双
 * 驱动的输入和悬空引脚，都会由 validateAt 报告，和根图完全一样。
 * validateGraph 是唯一判定文档的地方，而带元件的文档仍然只是一份文档。
 */
function validateComponents(
  g: Graph,
  registry: Registry,
  components: Map<string, CustomComponentDef>,
  validated: Set<string>,
  path: string,
  seen: ReadonlySet<string>,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const component of g.customComponents) {
    // 文档自带的表只是参考：调用方是从图自身的元件建的表，而图里带着一个
    // 调用方没传进来的元件时，它仍然是这张图的元件。先写入者优先，这样调用方
    // 手里更权威的版本（Progress.blueprints）不会被过期的内联副本覆盖。
    if (!components.has(component.id)) components.set(component.id, component);
  }
  // 到底遍历哪些元件，是由"实例"决定的，而不只是 customComponents 数组。
  // 一个内部电路实例化另一个元件时，它自己并不携带那个元件的定义——文档的
  // 表才是元件的存放处——所以顺着实例的 def 走，是抵达嵌套元件的唯一途径。
  const named = new Set<string>();
  for (const inst of g.instances) {
    const component = components.get(inst.def);
    if (component) named.add(component.id);
  }
  for (const component of g.customComponents) named.add(component.id);

  for (const id of named) {
    const component = components.get(id);
    if (!component) continue;
    // 环的检查要放在记忆化之前，顺序是有意义的。元件只会被遍历一次，但
    // "已经遍历过"不等于"不可能包含自己"：一个内部电路实例化了它自己的元件，
    // 会在 seen 带着整条链时再次回到这个元件，此时记忆化会回答"已完成"，
    // 从而掩盖掉这个让文档无法展开的环。
    if (seen.has(id)) {
      // 环在"闭合它的那个元件"上报错：到这里的链就是解释，链上每个元件
      // 都会被点名。
      issues.push({
        severity: 'error',
        code: 'recursive-blueprint',
        message: {
          zh: `自定义元件 ${component.name.zh}（${id}）的电路里含它自己：${[...seen].join(' → ')} → ${id}`,
          en: `Custom component ${component.name.en} (${id}) contains itself: ${[...seen].join(' → ')} → ${id}`,
        },
      });
      continue;
    }
    // 无论多少个实例引用它、无论有多少条路径通向它，都只遍历一次。被两个
    // 元件同时包含的元件仍然是一个元件、只有一组缺陷；按路径分别报告，只会
    // 把同一条消息乘上文档里的路径数。
    if (validated.has(id)) continue;
    if (seen.size >= MAX_BLUEPRINT_DEPTH) {
      issues.push({
        severity: 'error',
        code: 'recursive-blueprint',
        message: {
          zh: `自定义元件嵌套超过 ${MAX_BLUEPRINT_DEPTH} 层：${[...seen].join(' → ')} → ${id}`,
          en: `Custom components nest more than ${MAX_BLUEPRINT_DEPTH} deep: ${[...seen].join(' → ')} → ${id}`,
        },
      });
      continue;
    }
    const inner = new Set(seen);
    inner.add(id);
    validated.add(id);
    issues.push(
      ...validateAt(
        component.body,
        registry,
        components,
        validated,
        `${path}${id}${PATH_SEPARATOR}`,
        inner,
      ),
    );
    issues.push(...validateBinds(component, registry, path));
  }
  return issues;
}

/**
 * 检查一个元件声明的引脚是否指向真实存在的东西。
 *
 * 表面与内部电路是同一个东西的两半，只写了一半的一对会以别处看不见的方式
 * 失败：compile 读绑定来解析导线，所以绑定里写了内部电路没有的引脚、或把
 * 输入绑到了 OUTPUT 上，最终都会表现为"某个引脚悄悄读 0"——一个看起来接好
 * 了线、却什么也算不出来的元件。
 */
function validateBinds(
  component: CustomComponentDef,
  registry: Registry,
  path: string,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const body = component.body;
  const inBody = new Map(body.instances.map((inst) => [inst.id, inst]));
  const label = `${path}${component.id}`;

  const check = (
    side: 'inputs' | 'outputs',
    pins: readonly PinDef[],
    binds: Readonly<Record<string, WireEnd>>,
  ): void => {
    for (const pin of pins) {
      const bind = binds[pin.id];
      const name = { zh: component.name.zh, en: component.name.en };
      if (!bind) {
        issues.push({
          severity: 'error',
          code: 'invalid-params',
          inst: label,
          port: pin.id,
          message: {
            zh: `自定义元件 ${name.zh} 的${side === 'inputs' ? '输入' : '输出'}引脚 ${pin.id} 没有绑定到电路里的引脚`,
            en: `Custom component ${name.en} has no body pin bound to its ${side === 'inputs' ? 'input' : 'output'} ${pin.id}`,
          },
        });
        continue;
      }
      const target = inBody.get(bind.inst);
      const def = target ? registry.get(target.def) : null;
      if (!target || !def) {
        issues.push({
          severity: 'error',
          code: 'unknown-instance',
          inst: label,
          port: pin.id,
          message: {
            zh: `自定义元件 ${name.zh} 的引脚 ${pin.id} 绑定到电路里不存在的元件 ${bind.inst}`,
            en: `Pin ${pin.id} of ${name.en} is bound to ${bind.inst}, which its circuit does not have`,
          },
        });
        continue;
      }
      const pool = side === 'inputs' ? def.inputs : def.outputs;
      if (!pinIds(pool).has(bind.port)) {
        issues.push({
          severity: 'error',
          code: 'unknown-port',
          inst: label,
          port: pin.id,
          message: {
            zh: `自定义元件 ${name.zh} 的引脚 ${pin.id} 绑定到 ${bind.inst}，但 ${def.name.zh} 没有${side === 'inputs' ? '输入' : '输出'}引脚 ${bind.port}`,
            en: `Pin ${pin.id} of ${name.en} is bound to ${bind.inst}, which has no ${side === 'inputs' ? 'input' : 'output'} ${bind.port}`,
          },
        });
      }
    }
  };

  check('inputs', component.inputs, component.binds.inputs);
  check('outputs', component.outputs, component.binds.outputs);
  return issues;
}
