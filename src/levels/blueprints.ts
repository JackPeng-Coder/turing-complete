// 蓝图库：保存"玩家自己封装出来的自定义元件"（封装 / 内部编辑的产物）。
// 本模块位于 levels 层，只依赖 core 的图类型与注册表类型；app、persist、ui 读取这里的纯函数。
// 库与文档的关系是"按 id 引用"而不是拷贝：导出的电路文件内联它用到的条目，
// 进度存档保存整库，两者通过元件 id 关联。
// 关键不变量：库条目的 key 必须等于 `def.id`；`def` 只携带 body、代价恒为 0；
// 任何外部数据（localStorage、导入的文件、手改过的存档）都必须先经 normalizeComponent 清洗。

import { createRegistry, type ComponentDef, type PinDef, type Registry } from '../core/registry';
import type { CustomComponentDef, Graph, WireEnd } from '../core/graph';

/**
 * 玩家自有的全部自定义元件，以应用当前保存它们的形状表示。
 *
 * 用 Map/Record 而不是放在 Graph 的字段里：`Graph.customComponents` 是元件存在于"某份文档"里的地方
 * （电路文件携带它自己需要的元件），而库是玩家元件在"文档之间"的家，两者按 id 关联、不做拷贝。
 * `Persist.circuit` 写文件时把它用到的条目内联写出；`Progress.blueprints` 是持久记录，
 * 电路引用其中一条而不是把条目嵌进自己。
 *
 * 以元件 id 为键，而 id 同时是实例携带的 `def`：如果某条目的键与 `def.id` 不一致，这份库就是畸形的——
 * `blueprintDef` 读的是 def，而 `libraryDefs` 否则会把同一个元件注册成两个名字。
 */
export type BlueprintLibrary = Readonly<
  Record<string, { readonly name: { zh: string; en: string }; readonly def: CustomComponentDef }>
>;

/**
 * 把库里的一个条目转成内核可以编译的 `ComponentDef`。
 *
 * 这个 def 只携带 BODY，别的什么都没有：没有 `evaluate`、没有 `stateBytes`，
 * `cost` / `gateCost` 都是 0。这不是占位值——`compile` 会把 body 展开成叶子，
 * 并按叶子分配存储，元件本身永远不会被实例化；如果给它记代价，同一批门就会被记两次
 * （一次在元件上、一次在元件内部的门上）。参见 `ComponentDef.body` 与 `flattenDocument`。
 *
 * 名字取自库条目而不是 `def.name`：改名的操作编辑的是条目；让两者保持同步是库的职责，
 * 而 `applyGrade`（按引用共享同一个库）从不改写其中任何一方。
 */
export function blueprintDef(component: CustomComponentDef): ComponentDef {
  return {
    id: component.id,
    name: { ...component.name },
    category: 'custom',
    inputs: component.inputs.map((pin) => ({ ...pin })),
    outputs: component.outputs.map((pin) => ({ ...pin })),
    cost: 0,
    gateCost: 0,
    sequential: false,
    stateBytes: 0,
    body: component,
  };
}

/** 基础目录里的全部已注册元件，按注册顺序：基础目录的排在前面。 */
function registryAll(registry: Registry): readonly ComponentDef[] {
  return registry.all();
}

/**
 * "某份文档"编译时使用的注册表：基础目录 + 玩家的自定义元件。
 *
 * 每份文档各建一份，绝不合并进基础注册表。基础注册表是应用的单例，回答的是
 * "游戏本体发布了哪些元件"；而自定义元件是编辑器手下随时变化的玩家数据，
 * 把它注册进单例会让目录取决于"装载了哪一份库"——同一份电路在两个界面里可能编译出不同结果。
 * 组合只是遍历几百个 def；热路径（`settle`、`tick`）里没有任何按 id 查 def 的操作，
 * 所以代价每次编译只付一次，不值得再加一个可能过期的缓存。
 *
 * id 与真实元件撞车的元件会被跳过：基础目录优先，库条目永远不能遮蔽 `nand`。
 */
export function composeRegistry(base: Registry, library: BlueprintLibrary): Registry {
  const composed = createRegistry(registryAll(base));
  for (const entry of Object.values(library)) {
    if (composed.has(entry.def.id)) continue;
    composed.register(blueprintDef(entry.def));
  }
  return composed;
}

/**
 * 玩家拥有的全部元件 id，按库内顺序排列。
 *
 * 供元件托盘使用：沙盒把它们排在基础元件之后；`ui/palette.ts` 里 `custom` 分类排在最后，
 * 于是它们自然落在自己的标题下，托盘不需要知道它们"不一样"。
 */
export function libraryIds(library: BlueprintLibrary): string[] {
  return Object.values(library).map((entry) => entry.def.id);
}

/** 下一个空闲的元件 id，保证新元件不会覆盖旧元件。 */
export function nextBlueprintId(library: BlueprintLibrary): string {
  let max = 0;
  for (const id of Object.keys(library)) {
    const match = /^bp(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `bp${max + 1}`;
}

/**
 * 某份文档需要的全部库条目，按依赖顺序排列（被使用的元件排在它内部的元件之后）。
 *
 * 供电路导出使用：文件必须携带其实例点名过的元件，而一个元件如果把另一个元件实例化在内部，
 * 也需要把后者一起带上。遍历是带 `visiting` 集合的深度优先，因此即使出现环
 * （`validateGraph` 会拒绝文档里的环，但手改过的存档仍可能含有），遍历也会终止，
 * 并且每个条目只贡献一次。
 */
export function libraryClosure(
  library: BlueprintLibrary,
  roots: readonly string[],
): CustomComponentDef[] {
  const out: CustomComponentDef[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (done.has(id) || visiting.has(id)) return;
    const entry = library[id];
    if (!entry) return;
    visiting.add(id);
    for (const inst of entry.def.body.instances) visit(inst.def);
    visiting.delete(id);
    done.add(id);
    out.push(entry.def);
  };

  for (const id of roots) visit(id);
  return out;
}

/** 图里所有实例点名到的元件 id，任意深度都算。 */
export function referencedComponents(graph: Graph): string[] {
  const ids = new Set<string>();
  const walk = (g: Graph): void => {
    for (const inst of g.instances) ids.add(inst.def);
    for (const component of g.customComponents) walk(component.body);
  };
  walk(graph);
  return [...ids];
}

/**
 * 从不可信数据里读出一个自定义元件；不是元件则返回 `null`。
 *
 * 这是玩家自制元件的唯一读取入口。库条目来自三个方向，全都不可信：
 * `localStorage`、导入的电路文件、手改过的存档。它们都只是 JSON，
 * 应用必须能扛住 `inputs` 是字符串、`binds` 缺失之类的载荷——
 * 否则失败模式就是渲染途中抛出 `TypeError`，整块画板跟着倒下，而不是只丢掉一个坏元件。
 *
 * 缺失的 `binds` 读成空表而不是判为非法：没有声明引脚的自定义元件虽然退化，但结构仍然良构
 * （它的 body 只是从外面进不去）。若把它当损坏数据，老版本文件（在 bindings 字段出现之前写的）
 * 就会变成完全读不了，而本来只是"没有引脚"而已。
 */
export function normalizeComponent(raw: unknown): CustomComponentDef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<CustomComponentDef>;
  if (typeof candidate.id !== 'string' || candidate.id === '') return null;
  if (!Array.isArray(candidate.inputs) || !Array.isArray(candidate.outputs)) return null;
  if (!isGraphLike(candidate.body)) return null;
  const pins = (list: readonly PinDef[]): PinDef[] =>
    list
      .filter((pin) => typeof pin?.id === 'string' && typeof pin?.width === 'number')
      .map((pin) => ({ ...pin }));
  const inputs = pins(candidate.inputs);
  const outputs = pins(candidate.outputs);
  const name = candidate.name;
  return {
    id: candidate.id,
    name:
      typeof name?.zh === 'string' && typeof name?.en === 'string'
        ? { zh: name.zh, en: name.en }
        : { zh: candidate.id, en: candidate.id },
    inputs,
    outputs,
    binds: {
      inputs: normalizeBinds(candidate.binds?.inputs),
      outputs: normalizeBinds(candidate.binds?.outputs),
    },
    body: candidate.body as Graph,
  };
}

/** 只校验"能走图"所需的最小 `Graph` 形状；其余部分由注册表在编译时校验。 */
function isGraphLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<Graph>;
  return Array.isArray(g.instances) && Array.isArray(g.wires);
}

/** 绑定表的一侧：只保留"确实点到一个端点"的条目。 */
function normalizeBinds(raw: unknown): Record<string, WireEnd> {
  const out: Record<string, WireEnd> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [pin, end] of Object.entries(raw as Record<string, unknown>)) {
    const candidate = end as Partial<WireEnd> | null;
    if (typeof candidate?.inst !== 'string' || typeof candidate?.port !== 'string') continue;
    out[pin] = { inst: candidate.inst, port: candidate.port };
  }
  return out;
}

/**
 * 从元件数组构造整份库，以 id 为键。
 *
 * 两种形状都从这里读入：`Progress.blueprints` 保存的是映射，电路文件携带的是数组
 * （`customComponents`，即设计规格 8.1 命名的形状）。与键不一致的条目会被修正而不是丢弃——
 * def 才是元件本体，键只是查找它的方式。
 */
export function libraryFrom(entries: readonly unknown[]): BlueprintLibrary {
  const library: Record<string, { name: { zh: string; en: string }; def: CustomComponentDef }> = {};
  for (const raw of entries) {
    const def = normalizeComponent(raw);
    if (!def) continue;
    library[def.id] = { name: { ...def.name }, def };
  }
  return library;
}

/** 从带键的记录构造库，理由与 `libraryFrom` 相同。 */
export function libraryFromRecord(raw: unknown): BlueprintLibrary {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const entries: unknown[] = [];
  for (const value of Object.values(raw as Record<string, unknown>)) {
    const holder = value as { def?: unknown } | null;
    entries.push(holder && typeof holder === 'object' && 'def' in holder ? holder.def : value);
  }
  return libraryFrom(entries);
}

/**
 * 把文件里的自定义元件合并进库，撞名的条目改名后加入。
 *
 * 导入绝不能覆盖本地已有的东西。两名玩家、或同一名玩家两次导入，都会拥有一个 `bp1`——
 * 那只是第一次封装自动生成的名字——而它们是两个不同的电路。
 * 覆盖会悄悄改掉画板上所有本地 `bp1` 实例的含义，所以改的是"进来的那个"，
 * 并把改名结果通过 `renamed` 返回，让调用方把导入的电路重新指向新 id：
 * 文件内部仍然用它自己写下的 id 互相引用，而这些 id 在合并完成后已经不存在了。
 *
 * 不撞名的 id 原样保留，因此最常见的情况——把文件导入到一块新画板上——是一个空操作。
 */
export function mergeLibrary(
  library: BlueprintLibrary,
  incoming: BlueprintLibrary,
): { library: BlueprintLibrary; renamed: ReadonlyMap<string, string> } {
  const merged: Record<string, { name: { zh: string; en: string }; def: CustomComponentDef }> = {
    ...library,
  };
  const renamed = new Map<string, string>();
  const taken = new Set(Object.keys(merged));

  for (const entry of Object.values(incoming)) {
    let id = entry.def.id;
    if (taken.has(id)) {
      let n = 2;
      while (taken.has(`${id}_${n}`)) n += 1;
      const next = `${id}_${n}`;
      renamed.set(id, next);
      id = next;
    }
    taken.add(id);
    merged[id] = {
      name: { ...entry.name },
      def: { ...entry.def, id, name: { ...entry.def.name } },
    };
  }
  return { library: merged, renamed };
}

/**
 * 对随文件导入的文档做同样的改名重定向。
 *
 * 每一处对被改名元件的引用都要改写：实例的 `def`、元件 body 内部的引用，
 * 以及正在导入的元件彼此之间的引用（它们可能互相使用）。
 * 漏掉一处引用，就会留下一个指向"已不存在元件"的实例，
 * 而 `validateGraph` 会把它报成未知 def，让人看不出是导入出了问题。
 */
export function repointComponents(graph: Graph, renamed: ReadonlyMap<string, string>): Graph {
  if (renamed.size === 0) return graph;
  const remap = (g: Graph): Graph => ({
    ...g,
    instances: g.instances.map((inst) => {
      const def = renamed.get(inst.def);
      return def === undefined ? { ...inst, params: { ...inst.params } } : { ...inst, def };
    }),
    wires: g.wires.map((wire) => ({ ...wire, from: { ...wire.from }, to: { ...wire.to } })),
    customComponents: g.customComponents.map((component) => ({
      ...component,
      name: { ...component.name },
      inputs: component.inputs.map((pin) => ({ ...pin })),
      outputs: component.outputs.map((pin) => ({ ...pin })),
      binds: {
        inputs: { ...component.binds.inputs },
        outputs: { ...component.binds.outputs },
      },
      body: remap(component.body),
    })),
  });
  return remap(graph);
}
