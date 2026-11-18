import { emptyGraph, type Graph } from '../core/graph';

/**
 * 沙盒电路，跨会话保留。
 *
 * 与存档分键保存，因为它是另一类东西。`tc.progress.v1` 是战役进行到哪的
 * 记录，会被版本化、迁移和统计；沙盒则是玩家随手留下的一个自由电路。把它
 * 放进存档意味着每次进度迁移都得带上它，而且一个损坏的草稿电路会连带把
 * 星星一起弄丢。
 *
 * 这里不会抛出异常。单元测试没有 localStorage，隐私窗口可能拒绝写入，而读
 * 失败的沙盒有一个显然的答案——一块空画板——所以失败模式是"重新开始"，而
 * 不是画面坏掉。同样的理由让损坏载荷读成 `null` 而不是一条要上报的错误：
 * 它没有可执行的迁移，因为不存在它的更早版本。
 */
export const SANDBOX_KEY = 'tc.sandbox.v1';

interface SandboxPayload {
  readonly version: 1;
  readonly graph: Graph;
}

/** 这个值是否具备 `compile` 会被要求接受的形状（三个字段都是数组）。 */
function isGraph(value: unknown): value is Graph {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<Graph>;
  return (
    Array.isArray(g.instances) &&
    Array.isArray(g.wires) &&
    (g.customComponents === undefined || Array.isArray(g.customComponents))
  );
}

/**
 * 取回离开时的沙盒电路；没有任何存档时返回 `null`，表示"从空画板开始"。
 *
 * 返回的是存储里的图，而不是"修好"的图：`validateGraph` 负责判定一个电路，
 * 画板则照着找到的东西画，所以一份搭到一半的文档是正常的回归状态——只有
 * 完全不是图的载荷才没有答案。
 *
 * 返回前把数组和这一层的对象都复制一遍：实例对象（连同 `params`）、导线的两个
 * 端点、自定义元件条目都是新的，避免面板原地修改时改到解析出来的 JSON 对象。
 * 这是一层"够用"的拷贝，不是通用的深拷贝——目的只是不让调用方与刚解析出的
 * 对象共享可变子结构。
 */
export function loadSandbox(): Graph | null {
  try {
    const raw = globalThis.localStorage?.getItem(SANDBOX_KEY);
    if (!raw) return null;
    const payload: unknown = JSON.parse(raw);
    if (typeof payload !== 'object' || payload === null) return null;
    const { version, graph } = payload as Partial<SandboxPayload>;
    if (version !== 1 || !isGraph(graph)) return null;
    return {
      instances: graph.instances.map((inst) => ({ ...inst, params: { ...inst.params } })),
      wires: graph.wires.map((wire) => ({ ...wire, from: { ...wire.from }, to: { ...wire.to } })),
      customComponents: (graph.customComponents ?? []).map((component) => ({ ...component })),
    };
  } catch {
    return null;
  }
}

/** 尽力保存；没有存储时电路只留在内存里。 */
export function saveSandbox(graph: Graph): void {
  try {
    const payload: SandboxPayload = { version: 1, graph };
    globalThis.localStorage?.setItem(SANDBOX_KEY, JSON.stringify(payload));
  } catch {
    /* 存储不可用（隐私模式、测试）：电路只保留在内存里 */
  }
}

/**
 * 一个低成本的"这个电路变了吗"签名，避免每一帧都写存储。
 *
 * store 在每次变化时都会通知，包括平移的每一帧和选择变化的每一次按键，而
 * 这些都不改动电路。把实例与导线拼成一个字符串、和上次写入的字符串比较，
 * 代价是遍历一遍文档，换来的却是每帧省掉一次 localStorage 写入——在
 * 大画板上，这正是"平移顺滑"与"卡顿"的差别。
 *
 * 签名只覆盖实例的 id、种类、坐标、参数以及导线的两个端点；用途是去重写入，
 * 而不是判断两份电路是否等价，所以它刻意不去追求覆盖图上的每一个字段。
 */
export function circuitSignature(graph: Graph): string {
  const parts = graph.instances.map(
    (inst) => `${inst.id}:${inst.def}:${inst.x}:${inst.y}:${JSON.stringify(inst.params)}`,
  );
  const wires = graph.wires.map(
    (wire) => `${wire.from.inst}.${wire.from.port}>${wire.to.inst}.${wire.to.port}`,
  );
  return `${parts.join('|')}#${wires.join('|')}`;
}

/** 一块空沙盒画板，给没有已存电路的调用方。 */
export function emptySandbox(): Graph {
  return emptyGraph('sandbox');
}
