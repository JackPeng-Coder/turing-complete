import type { CustomComponentDef } from './graph';
import type { PortValue } from './signal';

/**
 * 元件定义（ComponentDef）与注册表：仿真内核认识的"元件目录"。
 *
 * 每个 ComponentDef 描述一种元件：id、双语名称、引脚表、延迟代价 cost、
 * NAND 等价门数 gateCost，以及可选的组合逻辑函数 evaluate / 时钟沿函数
 * clockEdge / 自定义元件的内部电路 body。注册表就是 id 到定义的映射，
 * net.ts 的 compile() 通过它把文档里的元件 id 解析成定义。
 *
 * 关键不变量：
 *  - 组合元件的 evaluate 必须是纯函数，且不能读 state；
 *  - 时序元件的 evaluate 只发布 state、不读输入（唯一例外是 RAM 的地址选择），
 *    clockEdge 只采样输入写 state、不写输出；
 *  - 自定义元件没有自己的 evaluate 和 state，它的代价由展开后的内部电路计算。
 *
 * 依赖：只依赖 graph.ts 与 signal.ts 的类型；使用者是 net.ts（编译时解析
 * 元件 id）、defs/（注册具体元件），以及测试（按 category 核对家族边界；
 * 应用层没有任何地方按 category 给托盘分组）。
 */
export type ComponentCategory =
  | 'logic1'
  | 'memory1'
  | 'wide'
  // CPU 家族（phase 2 任务 2）：第 3 章发放的六个元件，定义在 defs/cpu.ts 里。
  // 之所以独立成族而不是塞进 wide：各家族都被注册元组与测试精确钉死——
  // logic1 就是那十个 1 位逻辑门，wide 就是宽位模块的 id 集合，level 就是
  // 两个 IO 连接器——而这六个元件哪个都不属于。
  | 'cpu'
  | 'io'
  | 'display'
  | 'probe'
  | 'level'
  /**
   * 玩家自己搭建的元件：自定义元件。注册时以 ComponentDef 的形式交给注册表，
   * 其 body 就是它的内部电路（graph.ts 的 CustomComponentDef）。
   *
   * 它独立成分类而不是 logic1 或 wide，因为它既不是门、代价也不由自己承担：
   * gateCost 与 delayOf 会把它的 body 展开来算，所以这个分类只需要回答
   * "它是不是我们自己造的"，元件托盘的分组标题也只用到这里。
   */
  | 'custom';

/**
 * 一个引脚的声明：id 是网表与关卡数据里使用的名字，width 是位宽（1 位是
 * 普通逻辑信号，8/16/32 位是宽位数据），label 是可选的双语显示名。
 * 实例的 params.width 可以覆盖这里声明的位宽，见 net.ts 的 effectiveWidth。
 */
export interface PinDef {
  readonly id: string;
  readonly width: number;
  readonly label?: { zh: string; en: string };
}

/** 求值上下文：tick 是已经走过的时钟沿数量（从 0 开始计数）。 */
export interface EvalContext {
  readonly tick: number;
}

/**
 * 一种元件的完整定义。注册表按 id 索引它，net.ts 在编译时按 id 取出它。
 *
 * 结构上分三类：纯组合元件（只有 evaluate）、时序元件（evaluate 负责发布
 * 所存的值，clockEdge 负责在时钟沿采样），以及自定义元件（只有 body，
 * 没有自己的逻辑，展开后由内部元件实现）。
 */
export interface ComponentDef {
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly category: ComponentCategory;
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  /**
   * 延迟代价 cost：信号穿过这个元件要花几个"基础门延迟"，供最长路径
   * delayOf 使用。电源和导线类元件为 0，每个门为 1，宽位元件同样记为 1
   * （延迟口径：8 位加法器这类宽位组件也只算 1）。
   *
   * 它不是门数指标：门数指标由下面的 gateCost 承担。cost 只被 delayOf
   * 按节点读取一次。
   */
  readonly cost: number;
  /**
   * NAND 等价门数 gateCost：把这个元件展开成 2 输入与非门后需要多少门
   * （成本口径）。只被 levels/grader.ts 的门数统计读取。
   *
   * 两个指标故意对宽位元件给出不同数值：一个 add8 在延迟上只算 1 个单位，
   * 在门数上是 72 个与非门，所以不能共用一个字段。
   *
   * 它也不是"每个门记 1"：在与非门基底下，1 位 and 记 2、or 记 3
   * （对照表在 defs/index.ts），宽位元件按位宽倍增——and8 的一位就是那 2 个
   * 与非门，所以整个元件是 16。只有 nand 和 not 两个数恰好相同；每个门都
   * 显式写出这个字段，避免有人的计数靠继承"碰巧"正确。
   *
   * 缺省表示"与 cost 相同"，这是真实情况而不是遗留默认值：电源
   * （const_on）、关卡连接器、纯导线性质的打包器以及所有存储元件在两个
   * 指标上都是 0，再显式写一个 0 只会给两个 0 制造分头漂移的机会。凡代价
   * 超过一个与非门的元件都显式写这个字段。
   */
  readonly gateCost?: number;
  /** 时序元件在时钟沿采样，不计组合延迟（最长路径在其中被切断）。 */
  readonly sequential: boolean;
  /**
   * 组合传递函数：读 inputs、写 outputs，必须是纯函数。
   *
   * 时序元件用同一个函数来"发布"它持有的值：读第三个参数 state，且绝不能
   * 读 inputs，否则延迟线就退化成了导线。唯一的例外是一个只用于在 state
   * 已有的字节里做选择的输入——存储器的读地址（ram8 的 addr）：它只是 state
   * 的下标，永远不会成为被发布的字节，它选中的每个字节都是某个时钟沿写进去
   * 的（见该元件的定义）。除它之外的任何输入读取，或把地址当值而不是当下标，
   * 都是这条规则禁止的"导线"。组合元件忽略 state，保持 (i, o) => ... 的
   * 两参数形状。
   *
   * state 的类型写成 Uint8Array | undefined 而不是 Uint8Array，是为了让
   * 时序元件无法假装自己总有状态。它是必填参数而不是可选参数（TypeScript
   * 会拒绝省略），所以组合元件必须显式传 undefined。
   */
  readonly evaluate?: (
    inputs: readonly PortValue[],
    outputs: PortValue[],
    state: Uint8Array | undefined,
    ctx: EvalContext,
  ) => void;
  /**
   * 存储更新：时钟沿到来时用沿前的输入采样进 state。
   * 只写 state，不许写 outputs——输出由 evaluate 负责发布。
   */
  readonly clockEdge?: (
    inputs: readonly PortValue[],
    outputs: PortValue[],
    state: Uint8Array,
    ctx: EvalContext,
  ) => void;
  /** 每个实例的私有状态字节数；纯组合元件为 0。 */
  readonly stateBytes: number;
  /** 是否从元件托盘中隐藏（关卡内部管线元件使用）。 */
  readonly hidden?: boolean;
  /**
   * 当元件由玩家自己搭建时，这里就是它所代表的电路。
   *
   * 带 body 的定义就是自定义元件（graph.ts 的 CustomComponentDef）：它没有
   * evaluate、也没有自己的状态，因为 compile 从不会实例化它——compile 会走
   * 它的 body、把内部的元件逐个展开，每个实例各分配一套存储槽（core/net.ts）。
   * 这正是"元件是电路的名字"而不是"仿真器必须学会打开的盒子"的原因，也是
   * 同一个定义能被实例化两次而两个实例不共享任何一位状态的原因。
   *
   * 这种定义的 cost 和 gateCost 都是 0：它的代价等于它 body 里所含元件的
   * 总和，由 gateCostOf / delayOf 展开时计算，所以在这里再记一笔就会既算
   * 导线又算门。
   *
   * 存的是完整定义而不只是里面那张图：表面（这个元件有哪些引脚、每个引脚
   * 绑定到 body 的哪个引脚）正是 compile 解析导线时用的东西，只带 body 的
   * 定义会知道元件算什么、却不知道它的引脚是什么。
   */
  readonly body?: CustomComponentDef;
}

/**
 * 元件注册表：id 到定义的只读映射。
 *
 * get 对未知 id 抛错（调用方应先 has）；register 对重复 id 抛错，因此
 * "注册表里有什么"在注册完成后是稳定、可枚举的。all() 的顺序就是注册顺序，
 * defs/index.ts 依赖它固定元件在托盘中的顺序。
 */
export interface Registry {
  readonly size: number;
  get(id: string): ComponentDef;
  has(id: string): boolean;
  all(): readonly ComponentDef[];
  byCategory(category: ComponentCategory): readonly ComponentDef[];
  register(def: ComponentDef): void;
}

/**
 * 用给定的定义列表建一个注册表；列表为空也可以，之后再 register。
 *
 * 重复 id 会在注册时抛错——同一个 id 对应两种元件会让关卡数据与网表对不上，
 * 属于装配期错误，应当尽早暴露。
 */
export function createRegistry(defs: readonly ComponentDef[] = []): Registry {
  const map = new Map<string, ComponentDef>();
  const registry: Registry = {
    get size() {
      return map.size;
    },
    get(id: string): ComponentDef {
      const def = map.get(id);
      if (!def) throw new Error(`unknown component: ${id}`);
      return def;
    },
    has: (id: string) => map.has(id),
    all: () => [...map.values()],
    byCategory: (category) => [...map.values()].filter((d) => d.category === category),
    register(def: ComponentDef): void {
      if (map.has(def.id)) throw new Error(`duplicate component id: ${def.id}`);
      map.set(def.id, def);
    },
  };
  for (const def of defs) registry.register(def);
  return registry;
}
