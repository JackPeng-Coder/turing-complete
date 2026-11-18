import { CircuitValidationError, UnstableCircuitError } from './errors';
import {
  PATH_SEPARATOR,
  validateGraph,
  type CustomComponentDef,
  type Graph,
  type GraphIssue,
  type Instance,
} from './graph';
import { assertWidth, createSignalTable, type PortValue, type SignalTable } from './signal';
import type { ComponentDef, PinDef, Registry } from './registry';

/**
 * 网表层：把可编辑的电路文档编译成可运行的网表，并驱动仿真。
 *
 * 职责链：compile() 先用 graph.ts 的 validateGraph 拒绝非法文档，再把自定义
 * 元件展开成叶子、为每个引脚分配信号槽、把导线预先解析成"槽到槽"的 drive
 * 映射，最后产出 Netlist；Simulation 持有这份网表，用 settle() 求组合逻辑的
 * 不动点，用 tick() 施加时钟沿。gateCostOf()/delayOf() 复用同一套展开逻辑，
 * 保证编译器与评分器看到的是同一批元件。
 *
 * 关键不变量：位宽一律走 effectiveWidth（实例 params.width 优先于定义），
 * 分配、读取、写回全用同一组解析值；结算采用并行（Jacobi）扫描，因此结果与
 * 实例顺序无关，真正的振荡器也无法伪装成稳定。
 *
 * 依赖：errors.ts、graph.ts、signal.ts、registry.ts（均为下层）；使用者是
 * levels/（关卡检查与判定）、ui/（画板与调试面板）与 flash/（导出器）。
 */

/** 结算循环的迭代次数上限；组合逻辑环会耗尽它并抛 UnstableCircuitError。 */
export const SETTLE_LIMIT = 512;

/** compile 会申请的最小信号表容量；再小的电路也有一个真实的缓冲区。 */
const MIN_CAPACITY = 64;

/**
 * 一张被展平、可求值的电路：每个引脚的每一位占一个信号槽，外加"引脚到槽"的
 * 映射，以及为需要连续读取的输入引脚准备的读取区。
 *
 * 网表是 Simulation 持有的值对象（两者通过一个私有 WeakMap 关联）；调用方只和
 * 槽下标打交道、不再用名字，所以热循环里 "i3.a" 只解析一次，而不是每次求值都
 * 解析。
 */
export interface Netlist {
  /**
   * 真正参与运行的叶子元件数量。
   *
   * 文档用了自定义元件之后，它不再等于 graph.instances.length：元件是一个电路
   * 的名字，compile 会把该电路里的元件逐个展开，每实例化一次发一套。
   * expandedCount 重复这个数字，保留计划文档里原来的叫法。
   */
  readonly instanceCount: number;
  readonly expandedCount: number;
  /** 分配的位数：每个引脚的每一位一个槽，加上每个读取区。 */
  readonly slotCount: number;
  /**
   * drive[slot] 是 slot 读取值的来源槽：除被导线驱动的输入引脚位之外都是
   * 恒等（自己读自己）；被导线驱动的输入位读的是驱动它的输出引脚位。
   * 提前把导线解析成槽下标，能让结算循环里没有任何分支判断。
   *
   * 它只覆盖引脚槽。没有被任何导线认领的位保留自己的槽，因此只要没人写这个槽
   * 它就始终读 0——未接线的输入正是靠这一点被直接驱动的。物化出来的读取区不
   * 经过 drive 寻址。
   */
  readonly drive: Int32Array;
  /**
   * 编译路径 -> 文档里的原始实例 id。
   *
   * "原始实例"指叶子所属的最外层实例，所以同一个自定义元件内部的每个叶子都
   * 报告同一个 id——玩家在画板上看得见、也删得掉的那一个。
   */
  readonly refs: Map<string, string>;
  /**
   * 输入引脚 "<实例id>.<引脚id>" 的**连续**读取区起始槽，使
   * read(inputBase(key), inputWidth(key)) 读到的是这个引脚的值。
   *
   * 通常它就是驱动者自己的起始槽：未接线的引脚读自己的槽（这样关卡仍能直接
   * 驱动它），而与引脚同宽的驱动者本身就是一段连续槽。比引脚窄的驱动者两者
   * 都不是，于是 compile 会按引脚自身的位宽物化一段读取区，并让这里返回它。
   * 那种情况下若返回驱动者的起始槽，调用方就会读到驱动者后面紧挨着的槽——
   * 其它引脚的信号，而且悄无声息。
   *
   * 每次 settle 结束时，读取区都会从已结算的信号表重新发布，所以调用方在结算
   * 之后直接读即可，不需要额外请求。它只是一个读取别名：往读取区里写并不会
   * 驱动该引脚。要驱动关卡输入，仍然写 level_input 的输出槽（outputBase）。
   */
  inputBase(key: string): number;
  /** 输出引脚 "<实例id>.<引脚id>" 的槽下标。 */
  outputBase(key: string): number;
  /**
   * 输入引脚自己那份存储的起始槽：也就是 drive 数组使用的下标基准。
   *
   * inputBase 面向"按范围读取"的调用方，可能返回物化的读取区而不是引脚自己的
   * 槽（驱动者比引脚窄时才需要读取区）。而逐位遍历网表的消费者需要引脚自己的
   * 起始槽，这样 drive[inputSlot(key) + bit] 才指向那一位真正读取的槽：drive
   * 只建在引脚槽上，读取区是在它之后分配的，用读取区的起始槽去索引 drive 会
   * 越界读到数组之外。
   *
   * 这是给 Arduino 导出器用的访问器。所有按范围读的调用方继续使用 inputBase；
   * 两者只在上面说的"窄驱动者"情形下不同。
   */
  inputSlot(key: string): number;
  /**
   * 输入引脚 "<实例id>.<引脚id>" 的位宽（按编译结果，单位 bit）。
   *
   * 这是该引脚槽位分配时使用的位宽，也是它读取区的位宽：实例设置过
   * params.width 时取它，否则取定义声明的位宽——见 effectiveWidth。按范围读取
   * 引脚的调用方必须用它而不是定义里的位宽，否则会读到按实例尺寸建好的读取区
   * 之外。
   */
  inputWidth(key: string): number;
  /** 输出引脚 "<实例id>.<引脚id>" 的位宽（按编译结果，单位 bit）。 */
  outputWidth(key: string): number;
  /**
   * 某一个外层实例内部的所有编译路径，自身排在最前。
   *
   * 网表里没有这个 id 时返回空数组。普通元件只有一项（路径就是 id 本身），
   * 自定义元件有多项——调用方要遍历画板上一个实例的信号时需要它，因为元件自己
   * 的引脚只是它内部引脚的别名。
   */
  pathsOf(instanceId: string): readonly string[];
  /** 按求值顺序排列的编译实例 id（是路径，不是文档 id）。 */
  instanceIds(): readonly string[];
  /** 展开后各实例的元件定义 id，按求值顺序排列。 */
  instanceDefs(): readonly string[];
  /** 每个输出引脚的 "<实例id>.<引脚id>" 键。 */
  outputKeys(): readonly string[];
}

/**
 * inst 上 pin 的位宽：实例自己的覆盖值优先，否则再用定义声明值。
 *
 * ComponentDef 给每个 PinDef 只声明一个位宽，所以一个 params.width 会覆盖该
 * 实例的所有引脚——level_input 的宽输出、level_output 的两个引脚、一个门的所有
 * 输入输出都是如此。这里刻意没有"按引脚名分别设置"的语法：目前没有需要，而且
 * 在这里发明一种会让文档出现第二个、又无人强制的位宽来源。
 *
 * validateGraph 已经拒绝了不是正整数的 params.width，所以这里解析出的位宽
 * 不可能触发 alloc 自己的位宽守卫。
 *
 * 导出给 ui/board/render.ts 使用：它也按同一规则计算元件尺寸，过去还自己留了
 * 一份副本——如果渲染器与编译器对位宽的理解不一致，就会把一根导线画成 1 位宽、
 * 却让一个字节从中穿过。
 */
export function effectiveWidth(inst: Instance, pin: PinDef): number {
  return inst.params.width ?? pin.width;
}

interface CompiledInstance {
  readonly key: string;
  readonly origin: string;
  readonly def: ComponentDef;
  /** 每个输入引脚的起始槽，按 def.inputs 的顺序排列。 */
  readonly inputs: readonly number[];
  /** 每个输入引脚按实例解析出的位宽，与 inputs 一一对应。 */
  readonly inputWidths: readonly number[];
  /** 每个输出引脚的起始槽，按 def.outputs 的顺序排列。 */
  readonly outputs: readonly number[];
  /** 每个输出引脚按实例解析出的位宽，与 outputs 一一对应。 */
  readonly outputWidths: readonly number[];
  /** 每个输出引脚在整个网表输出引脚列表中的下标。 */
  readonly outPin: readonly number[];
}

interface OutputPin {
  readonly base: number;
  readonly width: number;
}

/** 一段连续槽区间，inputBase 可以把它的起始槽交给按范围读取的调用方。 */
interface ReadRegion {
  /** 该区间的起始槽：即 inputBase 为该引脚报告的下标。 */
  readonly base: number;
  readonly width: number;
  /** 被该区间镜像的输入引脚的起始槽。 */
  readonly src: number;
}

interface NetInternals {
  readonly table: SignalTable;
  readonly instances: readonly CompiledInstance[];
  readonly outputPins: readonly OutputPin[];
  readonly readRegions: readonly ReadRegion[];
  /** 编译路径 -> 叶子，用于解析被自定义元件遮蔽的文档 id。 */
  readonly byKey: ReadonlyMap<string, CompiledInstance>;
  /** 编译路径 -> 它所属的外层实例。 */
  readonly origins: ReadonlyMap<string, string>;
  /** 外层实例 id -> 携带其引脚的那个叶子。 */
  readonly roots: ReadonlyMap<string, CompiledInstance>;
}

/** 把网表与 compile 为它建好的存储关联起来，不暴露公开字段。 */
const INTERNALS = new WeakMap<Netlist, NetInternals>();

/**
 * 区间 [base, base + width) 的每一位都从同一个起始槽连续读取时，返回那个起始
 * 槽；否则返回 -1。
 *
 * 恒等结果（返回 base 本身）也算连续，这是刻意的：未接线的引脚读自己的槽，
 * 正是这一点让调用方可以直接往未接线的输入里写值。从别处开始的连续段意味着有
 * 一个覆盖整个引脚的驱动者，那么从那里读 width 个槽正好是这个引脚的值。而比
 * 引脚窄的驱动者会让尾部继续指向引脚自己的槽（见 compile 里 drive 的恒等初始化），
 * 这种情形无法用单一起始槽描述——该引脚需要一段读取区。
 */
function contiguousRun(drive: Int32Array, base: number, width: number): number {
  const first = drive[base]!;
  for (let bit = 1; bit < width; bit += 1) {
    if (drive[base + bit] !== first + bit) return -1;
  }
  return first;
}

/**
 * 为展平后的文档估算容量，依据电路本身而不是信号表的默认值。
 *
 * createSignalTable 默认的 65,536 个槽装不下规格给的 20,000 实例预算：20,000 个
 * 二输入门就要占 60,000 个槽，再多一个三输入门就会溢出。这里的估算等于精确
 * 需求加上四分之一的余量，再加上读取区最多可能需要的量（每个"被驱动且宽于
 * 1 位"的输入引脚最多一个读取区，只有这种引脚可能需要读取区），所以容量不是
 * 卡着刀刃给的；万一估算还是错了，alloc 会抛出带名字的 RangeError，而不是让
 * 缓冲区扩容。
 *
 * 这里每个位宽都是**解析后**的位宽（effectiveWidth），与 compile 分配时用的
 * 完全一致。若按定义声明的位宽来算，预留量会小于分配循环和读取区实际占用的
 * 量，于是一个完全合法的电路也会把表撑爆。
 *
 * 它统计的是叶子数量，不是实例数量。自定义元件自身不占槽——compile 展开的是
 * 它的内部电路——所以为元件本身预留会把它内部的一切重复预留一遍，而且完全
 * 覆盖不到"内部电路里还含有另一个元件"的情形。
 */
function capacityFor(ops: readonly FlatOp[], registry: Registry): number {
  let slots = 0;
  let regions = 0;
  for (const op of ops) {
    // validateGraph 已经拒绝过未知的元件 id，所以 get 不会抛错。
    const def = registry.get(op.inst.def);
    for (const pin of def.inputs) {
      const width = effectiveWidth(op.inst, pin);
      slots += width;
      // 每个宽输入引脚都要预留一段可能的读取区，而不只是被驱动的那些。比
      // 驱动者宽的引脚不需要读取区，由调用方直接驱动的引脚也不需要，但预留
      // 必须覆盖最坏情况——alloc 会抛错而不是扩容，预留不足等于电路根本编译
      // 不了。
      if (width > 1) regions += width;
    }
    for (const pin of def.outputs) slots += effectiveWidth(op.inst, pin);
  }
  return Math.max(MIN_CAPACITY, Math.ceil(slots * 1.25) + regions + 16);
}

/** 展平后文档中的一个叶子：一个实例，以及它来自哪张图。 */
interface FlatOp {
  /** 编译路径：实例 id 前面拼上包含它的各级元件。 */
  readonly path: string;
  /** 这个叶子所属的最外层实例；根部的叶子等于 path。 */
  readonly origin: string;
  readonly inst: Instance;
  /** inst 所在的那张图，这样找它的导线时不必再遍历一遍。 */
  readonly graph: Graph;
}

/**
 * 取一个元件的定义：来自文档，或来自注册表。
 *
 * 文档可以实例化一个它自己并不携带的元件，这在本应用里是常态：定义放在玩家的
 * 元件库里（Progress.blueprints），文档按 id 引用它们，就像引用 nand 一样。
 * 文档编译时使用的注册表就是从这个库组装出来的（levels/blueprints.ts），所以
 * 运行时的定义在 ComponentDef.body 里；而 graph.customComponents 是电路文件
 * 为了能独立导入导出而自带的那份副本。两条来源都会被读取，以文档里的副本为
 * 优先，这样任何一条路径都不会是唯一能走通的路。
 */
function componentDefs(graph: Graph, registry: Registry): Map<string, CustomComponentDef> {
  const defs = new Map<string, CustomComponentDef>();
  for (const def of registry.all()) {
    if (def.body) defs.set(def.id, def.body);
  }
  for (const component of graph.customComponents) defs.set(component.id, component);
  return defs;
}

/**
 * 把一份文档展开成"真正会运行"的实例平铺列表。
 *
 * 自定义元件是一个名字，不是一个盒子：compile 从不输出它。compile 输出的是它
 * 内部电路里的元件，每实例化一次输出一套——这正是同一个元件的两个实例彼此独立
 * 的原因：叶子是分开的，所以 Simulation 按叶子分配状态（#state 与 instances
 * 同下标），每个实例的寄存器天然是它自己的，而代码里没有一行需要知道"什么是
 * 元件"。
 *
 * 展开沿着实例走，而不是沿着文档的 customComponents 数组走：一个元件的内部
 * 电路还可能实例化另一个元件，而定义是在展开到它时才查的（componentDefs）。
 *
 * 路径就是身份，所以展开会拒绝无法寻址的东西：环会让展开永不终止
 * （validateGraph 会先拒绝它，这里再抛一次而不是选择相信），而含有分隔符的
 * 实例 id 会与元件内部的实例撞车。
 *
 * 环的守卫是"当前链"，而不是全局 visited 集合：同一个元件被两个不同元件使用
 * 是合法的菱形引用，而一个包含自己的元件——无论绕多远——都不合法。
 */
function flattenForCompile(graph: Graph, registry: Registry): FlatOp[] {
  const components = componentDefs(graph, registry);
  const ops: FlatOp[] = [];
  const walk = (g: Graph, prefix: string, origin: string, chain: ReadonlySet<string>): void => {
    for (const inst of g.instances) {
      const path = `${prefix}${inst.id}`;
      const component = components.get(inst.def);
      if (!component) {
        ops.push({ path, origin: origin === '' ? path : origin, inst, graph: g });
        continue;
      }
      if (chain.has(inst.def)) {
        throw new CircuitValidationError([
          {
            severity: 'error',
            code: 'recursive-blueprint',
            inst: path,
            message: {
              zh: `自定义元件 ${component.name.zh}（${component.id}）的电路里含它自己，无法展开`,
              en: `Custom component ${component.name.en} (${component.id}) contains itself and cannot be expanded`,
            },
          },
        ]);
      }
      const inner = new Set(chain);
      inner.add(inst.def);
      walk(component.body, `${path}${PATH_SEPARATOR}`, origin === '' ? path : origin, inner);
    }
  };
  walk(graph, '', '', new Set());
  return ops;
}

/**
 * 把一份文档展平成网表。
 *
 * error 级问题是致命的（电路没有意义）；warning 级问题被接受，因为未接线的
 * 输入按规则读 0，而反馈环能否稳定只有仿真器知道。
 *
 * 引脚的位宽：实例设置过 params.width 就用它，否则用定义声明的位宽——见
 * effectiveWidth。下面每一步依赖位宽的处理（槽位分配、drive、读取区、逐位
 * 读取、写回、容量预留）都走这组解析后的值，因为"按一个位宽分配、按另一个
 * 位宽读取"正是这个内核要挡在门外的静默数据损坏。
 */
export function compile(graph: Graph, registry: Registry): Netlist {
  const errors: GraphIssue[] = validateGraph(graph, registry).filter(
    (i) => i.severity === 'error',
  );
  if (errors.length > 0) throw new CircuitValidationError(errors);

  const ops = flattenForCompile(graph, registry);
  const table = createSignalTable(capacityFor(ops, registry));
  const instances: CompiledInstance[] = [];
  /**
   * 编译路径 -> 它对应的叶子，这样解析一根导线只需一次查表。
   *
   * 键是路径，而路径正是同一个元件两个实例的区别所在：两个 bp1 实例内部都有
   * i1，只有 i3/i1 和 i7/i1 能区分它们，而每个实例拥有的存储也是按路径分配的
   * （见 Simulation 的状态数组）——"元件的每个实例都有自己的状态"这句话的全部
   * 含义就在这里。
   */
  const byKey = new Map<string, CompiledInstance>();
  /**
   * 外层实例 id -> 携带它引脚的那个已编译实例。
   *
   * 对叶子来说就是它自己；对自定义元件来说则是它内部电路的第一个实例，因为
   * 元件自己没有引脚——它的表面只是内部引脚的别名。
   */
  const roots = new Map<string, CompiledInstance>();
  /** 编译路径 -> 它所属的外层实例。 */
  const origins = new Map<string, string>();
  const refs = new Map<string, string>();
  /** 外层实例 id -> 它内部编译出的所有路径，自身排在最前。 */
  const pathsOfRoot = new Map<string, string[]>();
  const outputBases = new Map<string, number>();
  const outputPins: OutputPin[] = [];
  const inputBases = new Map<string, number>();
  const inputWidths = new Map<string, number>();
  const outputWidths = new Map<string, number>();
  /** 编译路径 -> 真实引脚键，用于自定义元件声明的引脚。 */
  const aliases = new Map<string, string>();

  for (const op of ops) {
    const def = registry.get(op.inst.def);
    // 存储元件通过自己的 evaluate 发布它保存的值（见 Simulation.#publishState），
    // 所以没有 evaluate 的存储元件永远无法把状态放到引脚上。这是 DEF 的缺陷，
    // 而不是电路的缺陷；而这里是"图"与"元件目录"唯一的交汇点，因此在这里直接、
    // 显眼地拒绝，而不是让它悄悄保持 0。
    //
    // 之所以用 CircuitValidationError 而不是普通 Error：关卡检查器会重新抛出
    // "既不是它、也不是 UnstableCircuitError"的任何异常（levels/checks.ts）——
    // 从这里抛出的裸 Error 会逃出检查流水线，而不是变成一次失败的 'invalid'
    // 检查。问题分类表里没有"定义本身坏了"这种 code，而 code 列表在 graph.ts
    // 里，所以这里用了最接近的已有 code——并且 ISSUE 里点名了该 def，诊断信息
    // 就在错误对象自己的 issues 里：CircuitValidationError 的 message 只是 code
    // 列表。这个细节在直接捕获该异常的地方会保留；关卡检查器会把它压平——
    // createSim 把它映射成裸的 { error: 'invalid' }，runChecks 推入一条不带
    // issue 的失败（levels/checks.ts）——所以那条路径上没有任何地方点名这个 def。
    if (def.sequential && def.stateBytes > 0 && !def.evaluate) {
      throw new CircuitValidationError([
        {
          severity: 'error',
          code: 'invalid-params',
          inst: op.path,
          message: {
            zh: `${def.id}: 存储元件必须声明 evaluate() 才能发布其所存的值`,
            en: `${def.id}: a storage element must declare evaluate() to publish what it holds`,
          },
        },
      ]);
    }
    const inWidths = def.inputs.map((pin) => effectiveWidth(op.inst, pin));
    const outWidths = def.outputs.map((pin) => effectiveWidth(op.inst, pin));
    const inputs = inWidths.map((width) => table.alloc(width));
    def.inputs.forEach((pin, i) => {
      inputWidths.set(`${op.path}.${pin.id}`, inWidths[i]!);
      inputBases.set(`${op.path}.${pin.id}`, inputs[i]!);
    });
    const outPin: number[] = [];
    const outputs = outWidths.map((width, i) => {
      const pin = def.outputs[i]!;
      const base = table.alloc(width);
      outputBases.set(`${op.path}.${pin.id}`, base);
      outputWidths.set(`${op.path}.${pin.id}`, width);
      outPin.push(outputPins.length);
      outputPins.push({ base, width });
      return base;
    });
    const compiled: CompiledInstance = {
      key: op.path,
      origin: op.origin,
      def,
      inputs,
      inputWidths: inWidths,
      outputs,
      outputWidths: outWidths,
      outPin,
    };
    // 外层实例的第一个叶子携带它的引脚。一个自定义元件会贡献多个叶子，但只有
    // 一个根，元件的表面别名指向的正是这个根叶子的引脚。
    if (!roots.has(op.origin)) roots.set(op.origin, compiled);
    byKey.set(op.path, compiled);
    origins.set(op.path, op.origin);
    refs.set(op.path, op.origin);
    const paths = pathsOfRoot.get(op.origin);
    if (paths) paths.push(op.path);
    else pathsOfRoot.set(op.origin, [op.path]);
    instances.push(compiled);
  }

  /** 一根导线的端点所命名的实际编译键，会跟随自定义元件的表面别名。 */
  const realKey = (instanceId: string, port: string): string =>
    aliases.get(`${instanceId}.${port}`) ?? `${instanceId}.${port}`;

  /**
   * 一个引脚按编译结果对应的起始槽与位宽。
   *
   * left 选择方向：驱动方用输出侧，被驱动方用输入侧。引脚不存在时返回 null
   * ——那是 validateGraph 已经拒绝过的端点，所以跳过这根导线，而不是让编译
   * 崩溃。
   */
  const pinAt = (
    instanceId: string,
    port: string,
    left: boolean,
  ): { base: number; width: number; key: string } | null => {
    const key = realKey(instanceId, port);
    const base = left ? outputBases.get(key) : inputBases.get(key);
    const width = left ? outputWidths.get(key) : inputWidths.get(key);
    if (base === undefined || width === undefined) return null;
    return { base, width, key };
  };

  /**
   * 自定义元件的边界，必须在解析导线之前声明好。
   *
   * 元件声明的引脚就是内部电路的一个引脚：输入代表它去驱动的那个内部引脚，
   * 输出代表它去读取的那个内部引脚。把两者别名起来，是让"表面"在内核里不需要
   * 任何新概念就能工作的原因——接到 i3.a 的导线驱动的是与 i3/i1.a 完全相同的
   * 槽，读 i3.out 的调用方读到的也是内部电路自己的输出槽——而且它必须在导线
   * 之前完成，因为导线循环会通过 realKey 解析两端。
   *
   * 输入引脚的槽也与内部引脚共享，而不是复制：内部引脚的 drive 项已经指向从
   * 内部驱动它的地方，外层导线会覆盖它覆盖到的那些位。因此内部没驱动、外层也
   * 没接线的输入读 0——和其它地方未接线引脚的答案一样。
   */
  for (const inst of graph.instances) {
    const def = registry.has(inst.def) ? registry.get(inst.def) : null;
    const component = def?.body;
    const binds = component?.binds;
    const owner = roots.get(inst.id);
    if (!def || !binds || !owner) continue;

    def.inputs.forEach((pin, index) => {
      const bind = binds.inputs[pin.id];
      if (!bind) return;
      const scope = `${inst.id}.${pin.id}`;
      inputBases.set(scope, owner.inputs[index]!);
      inputWidths.set(scope, owner.inputWidths[index]!);
      aliases.set(scope, `${inst.id}/${bind.inst}.${bind.port}`);
    });
    def.outputs.forEach((pin) => {
      const bind = binds.outputs[pin.id];
      if (!bind) return;
      const scope = `${inst.id}.${pin.id}`;
      const target = pinAt(`${inst.id}/${bind.inst}`, bind.port, true);
      if (!target) return;
      outputBases.set(scope, target.base);
      outputWidths.set(scope, target.width);
      aliases.set(scope, target.key);
    });
  }

  // 先置为恒等，让未接线的输入读自己的（零）槽，再把每个被接线的输入位指向
  // 驱动它的输出引脚位。给每个未接线引脚分配自己的槽而不是共享一个零槽，正是
  // 允许调用方直接写未接线输入的原因——它也让"窄驱动者覆盖不到的位"读 0：
  // 那些位继续指向自己的槽，而内核从不写它们。
  const drive = new Int32Array(table.size);
  for (let slot = 0; slot < drive.length; slot += 1) drive[slot] = slot;
  // 每张图单独一遍，因为自定义元件的内部电路有自己的导线，它们和玩家在画板上
  // 画的导线一样真实。两遍做的事相同，区别只在端点如何寻址——外层导线点名外层
  // 实例（自定义元件经过它的表面别名），内部导线则用编译路径点名叶子。
  //
  // 这些图来自叶子，而不是来自 graph.customComponents：一个内部电路可能属于只
  // 存在于元件库里的元件，那时枚举文档自带的数组会漏掉它内部的每一根导线。
  const graphs = new Set<Graph>(ops.map((op) => op.graph));
  /** 某张图 + 实例 id -> 该实例在这张图里编译成的叶子路径。 */
  const leafPath = new Map<Graph, Map<string, string>>();
  for (const op of ops) {
    const within = op.path.slice(op.path.lastIndexOf(PATH_SEPARATOR) + 1);
    const paths = leafPath.get(op.graph) ?? new Map<string, string>();
    if (!paths.has(within)) paths.set(within, op.path);
    leafPath.set(op.graph, paths);
  }
  /**
   * 内部电路图里某个实例的某个引脚，按它的编译路径寻址。
   *
   * 内部导线点名的是内部实例，所以路径是 <元件实例>/<实例>.<引脚>——这正是
   * 分配循环给各张映射表建键的方式。展开时没有输出的东西返回 null，
   * validateGraph 已经报告过它们。
   */
  const bodyPin = (
    g: Graph,
    id: string,
    port: string,
    left: boolean,
  ): { base: number; width: number } | null => {
    const path = leafPath.get(g)?.get(id);
    if (path === undefined) return null;
    const key = `${path}.${port}`;
    const base = left ? outputBases.get(key) : inputBases.get(key);
    const width = left ? outputWidths.get(key) : inputWidths.get(key);
    if (base === undefined || width === undefined) return null;
    return { base, width };
  };
  for (const g of graphs) {
    const outer = g === graph;
    for (const wire of g.wires) {
      const from = outer
        ? pinAt(wire.from.inst, wire.from.port, true)
        : bodyPin(g, wire.from.inst, wire.from.port, true);
      const to = outer
        ? pinAt(wire.to.inst, wire.to.port, false)
        : bodyPin(g, wire.to.inst, wire.to.port, false);
      if (!from || !to) continue;
      // 两侧都按实例解析过：驱动者和引脚各自的位宽都可能比定义声明的更宽
      //（或更窄）。
      const width = Math.min(from.width, to.width);
      for (let bit = 0; bit < width; bit += 1) drive[to.base + bit] = from.base + bit;
    }
  }

  // 元件的输入引脚与内部引脚共享槽位和起始槽（见上面的边界处理），所以它的
  // drive 项就是内部引脚的 drive 项——由导线循环写入，两端都解析过了。对未接线
  // 的情形也不需要复制任何东西：未接线引脚的 drive 项是恒等，于是它读到的是
  // 没人写过的槽，与叶子的未接线输入读到的是同一个 0。

  // drive 回答的是"这一位由哪一个槽驱动"，这正是一次逐位读取需要的全部信息。
  // 但调用方读的是**范围**（read(inputBase(key), width)），而驱动者比引脚窄时，
  // 这个答案就是错的：读取会从驱动者末尾跑进它后面物理相邻的槽——其它引脚正在
  // 使用的信号——而不是该引脚自己的零位。所以凡是"各位不构成一段连续槽"的输入
  // 引脚，都按该引脚位宽物化一段读取区并报告它。常见情形（未接线引脚、与引脚
  // 同宽的驱动者）直接别名自己的槽，不分配任何东西。
  const readRegions: ReadRegion[] = [];
  const readBases = new Map<string, number>();
  for (const inst of instances) {
    for (let p = 0; p < inst.inputs.length; p += 1) {
      const base = inst.inputs[p]!;
      const width = inst.inputWidths[p]!;
      const key = `${inst.key}.${inst.def.inputs[p]!.id}`;
      const run = contiguousRun(drive, base, width);
      if (run >= 0) {
        readBases.set(key, run);
        continue;
      }
      const regionBase = table.alloc(width);
      readRegions.push({ base: regionBase, width, src: base });
      readBases.set(key, regionBase);
    }
  }

  // 元件的输入引脚别名到内部引脚的读取区，这是唯一需要写两遍的别名：
  // readBases 是 inputBase 交给按范围读取的调用方的那张表，而内部引脚在其中的
  // 条目可能是一段物化的读取区，而不是它自己的槽。不这样做的话，元件引脚会读
  // 自己的槽——那是没人驱动的槽——关卡按范围读取时就会在内部看得见值的地方读到
  // 全零。
  for (const [scope, key] of aliases) {
    if (!inputBases.has(key)) continue;
    const base = readBases.get(key) ?? inputBases.get(key)!;
    readBases.set(scope, base);
  }

  const instanceIds = instances.map((i) => i.key);
  const instanceDefs = instances.map((i) => i.def.id);
  const baseOf = (map: Map<string, number>, kind: string, key: string): number => {
    const [instanceId, ...rest] = key.split('.');
    const base = map.get(key) ?? map.get(realKey(instanceId ?? '', rest.join('.')));
    if (base === undefined) throw new Error(`no such ${kind} pin: ${key}`);
    return base;
  };
  const widthOf = (map: Map<string, number>, kind: string, key: string): number => {
    const [instanceId, ...rest] = key.split('.');
    const width = map.get(key) ?? map.get(realKey(instanceId ?? '', rest.join('.')));
    if (width === undefined) throw new Error(`no such ${kind} pin: ${key}`);
    return width;
  };
  const net: Netlist = {
    instanceCount: instances.length,
    expandedCount: instances.length,
    slotCount: table.size,
    drive,
    refs,
    inputBase: (key) => baseOf(readBases, 'input', key),
    outputBase: (key) => baseOf(outputBases, 'output', key),
    inputSlot: (key) => baseOf(inputBases, 'input', key),
    inputWidth: (key) => widthOf(inputWidths, 'input', key),
    outputWidth: (key) => widthOf(outputWidths, 'output', key),
    pathsOf: (instanceId) => pathsOfRoot.get(instanceId) ?? [],
    instanceIds: () => instanceIds,
    instanceDefs: () => instanceDefs,
    outputKeys: () => [...outputBases.keys()],
  };
  INTERNALS.set(net, { table, instances, outputPins, readRegions, byKey, origins, roots });
  return net;
}

/**
 * 一次结算的结果：iterations 是实际跑了几轮扫描（至少 1），stable 为 true 时
 * 表示某一轮之后没有任何输出引脚的值发生变化；若跑满上限仍未稳定，settle 会抛
 * UnstableCircuitError 而不是返回 stable: false。
 */
export interface SettleReport {
  readonly iterations: number;
  readonly stable: boolean;
}

/**
 * 运行一张已编译的电路，一次一个时钟沿。
 *
 * 时钟沿之间，电路是"关卡输入 + 存储元件当前状态"的组合函数；settle 把它跑到
 * 那个不动点，tick 施加一个时钟沿之后再结算一次。
 */
export class Simulation {
  readonly net: Netlist;
  /** 编译这张网表时使用的元件目录，供需要定义的调用方使用。 */
  readonly registry: Registry;
  readonly #table: SignalTable;
  readonly #drive: Int32Array;
  readonly #instances: readonly CompiledInstance[];
  readonly #outputPins: readonly OutputPin[];
  readonly #readRegions: readonly ReadRegion[];
  /** 每个实例的私有状态，下标与 #instances 一一对应。 */
  readonly #state: Uint8Array[];
  /** 本轮结算暂存的输出值，下标与 #outputPins 一一对应。 */
  readonly #staged: Array<PortValue | undefined>;
  #tickCount = 0;

  constructor(net: Netlist, registry: Registry) {
    const internals = INTERNALS.get(net);
    if (!internals) throw new Error('netlist was not produced by compile()');
    this.net = net;
    this.registry = registry;
    this.#table = internals.table;
    this.#drive = net.drive;
    this.#instances = internals.instances;
    this.#outputPins = internals.outputPins;
    this.#readRegions = internals.readRegions;
    this.#state = internals.instances.map((i) => new Uint8Array(i.def.stateBytes));
    this.#staged = new Array<PortValue | undefined>(internals.outputPins.length).fill(undefined);
  }

  get tickCount(): number {
    return this.#tickCount;
  }

  /** 清空所有信号与所有存储元件，然后从头结算一次。 */
  reset(): void {
    this.#table.clear();
    for (const state of this.#state) state.fill(0);
    this.#tickCount = 0;
    this.#publishState();
    this.settle();
  }

  /**
   * 把存储元件的输出从它们的私有状态中发布出来：一次遍历，发生在每次 reset()
   * 与 tick() 之后的结算之前。
   *
   * 这个内核并不认识任何状态布局。它曾经认识：旧版本把 state[p] 写到第 p 个
   * 输出引脚，每个引脚一位，这只有在每个状态字节都是 1 位值时才是对的。一个
   * 把字节存在单个状态字节里的 8 位寄存器会被写成 0b00000001 输出到引脚上
   * ——之所以看不出来，只是因为紧随其后的结算会通过 evaluate 重新发布；而对
   * 这个遍历本要服务的唯一情形（没有 evaluate 的存储元件）来说则是致命的，因为
   * 没有东西能纠正它。现在由 DEF 通过结算扫描所用的同一个 evaluate 来发布，
   * 于是两条路径不可能对"一个字节如何变成引脚"有两种意见：delay_line 和 mem1
   * 发布它们一向发布的那一位，reg8 发布它的全部八位，ram8 发布 addr 选中的
   * 那个字节，因为选择哪个字节正是它的 evaluate 读取 addr 的原因。
   *
   * 这次遍历仍然值得保留：它直接写信号表，所以紧随其后的结算第一次扫描读到的
   * 就是保持值，而不是时钟沿之前的值；调用方在 reset/tick 之后立刻读取，也能
   * 看到保持值，而不必等一次扫描。每个时钟沿把 def 的 evaluate 跑第二遍（这里
   * 和 settle 各一次）是安全的，因为 evaluate 必须是纯函数——注册表这样规定，
   * 第二次调用从同一状态出发会得到同一个值。
   *
   * 没有 evaluate 的存储元件根本无法发布，所以 compile 会拒绝它，而不是让它
   * 悄悄保持 0。
   */
  #publishState(): void {
    const inputs: PortValue[] = [];
    const outputs: PortValue[] = [];
    for (let i = 0; i < this.#instances.length; i += 1) {
      const inst = this.#instances[i]!;
      const evaluate = inst.def.evaluate;
      if (!inst.def.sequential || !evaluate) continue;
      this.#readInputs(inst, inputs);
      outputs.length = 0;
      evaluate(inputs, outputs, this.#state[i], { tick: this.#tickCount });
      for (let p = 0; p < inst.outputs.length; p += 1) {
        const value = outputs[p];
        if (value === undefined) continue;
        this.#table.setPort(inst.outputs[p]!, inst.outputWidths[p]!, value);
      }
    }
  }

  /**
   * 按位沿 drive 逐位拼出一个引脚的值。
   *
   * 刻意不写成 getPort(drive[base], width)：那样会从驱动者所在位置连读 width 个
   * 连续槽，于是比引脚窄的驱动者会把其后分配的槽——其它引脚的信号——一起卷进
   * 来。这里没有自己驱动者的位会（通过 drive）退回引脚自己的槽，而内核从不写
   * 那个槽，所以读到 0。
   *
   * number 与字节数组的分支与 SignalTable.getPort 完全对应，这样 def 在任意
   * 位宽下看到的都是同一种值形态。
   */
  #gather(base: number, width: number): PortValue {
    const slots = this.#table.slots;
    if (width <= 8) {
      let out = 0;
      for (let bit = 0; bit < width; bit += 1) {
        if (slots[this.#drive[base + bit]!] === 1) out |= 1 << bit;
      }
      return out;
    }
    const bytes = new Uint8Array(Math.ceil(width / 8));
    for (let bit = 0; bit < width; bit += 1) {
      if (slots[this.#drive[base + bit]!] === 1) bytes[bit >> 3]! |= 1 << (bit & 7);
    }
    return bytes;
  }

  /** 通过预先解析好的驱动槽，逐位读出每个输入引脚的值。 */
  #readInputs(inst: CompiledInstance, scratch: PortValue[]): void {
    for (let p = 0; p < inst.inputs.length; p += 1) {
      scratch[p] = this.#gather(inst.inputs[p]!, inst.inputWidths[p]!);
    }
    // 把临时数组截到与本实例引脚数一样长，这样较短的实例不会看到较长实例留下
    // 的值。
    scratch.length = inst.inputs.length;
  }

  /**
   * 用刚结算出的值重新发布每个物化的读取区。
   *
   * inputBase 交出的是槽区间，调用方随后想什么时候读就什么时候读，没有任何东西
   * 会告诉它"需要重新收集一次"——所以 settle 返回时读取区必须已经是当前值。这里
   * 只遍历读取区（而不是遍历实例），让这项开销离开扫描的主路径。
   */
  #refreshReadRegions(): void {
    for (const region of this.#readRegions) {
      this.#table.setPort(region.base, region.width, this.#gather(region.src, region.width));
    }
  }

  /**
   * 当信号表在这个引脚上已经持有 value 时返回 true。
   *
   * 刻意逐位比较，而不是比较 PortValue：valuesEqual 无法把 number 和同一数值的
   * 字节数组形式判为相等（12 位引脚读回来是 Uint8Array），用值形态比较会让每一
   * 轮扫描都报告"有变化"，从而把健康电路误诊成不稳定。assertWidth 仍然会执行，
   * 所以畸形的暂存值会大声抛错，而不是被悄悄截断成比较所看的那几位。
   */
  #holds(base: number, width: number, value: PortValue): boolean {
    assertWidth(value, width);
    for (let bit = 0; bit < width; bit += 1) {
      const held =
        typeof value === 'number'
          ? bit < 32
            ? (value >>> bit) & 1
            : 0
          : ((value[bit >> 3] ?? 0) >> (bit & 7)) & 1;
      if (this.#table.slots[base + bit] !== held) return false;
    }
    return true;
  }

  /**
   * 把电路跑到不动点，并报告跑了几轮扫描。
   *
   * 每个带 evaluate 的 def 都会运行，包括存储元件：它们发布自己保持的值
   * （state），从不发布输入，这正是延迟线能保持整整一个节拍的原因。（ram8 还
   * 会读 addr 输入，以选择发布哪个已保存的字节——这是唯一对此正确的存储元件，
   * 理由写在它的定义处。）某个 def 没有为某个引脚产生值时，该引脚保持原样，所以
   * 由外部通过输出槽驱动的 level_input 能在扫描中存活。
   *
   * 扫描是并行的（Jacobi 式）：所有实例都针对上一轮提交的值求值，暂存起来，再
   * 一起提交。由此得到两条性质，游戏两者都需要：结果不可能依赖实例在文档里的
   * 先后；真正的振荡器无法伪造出不动点——若是原地（Gauss-Seidel）求值，两个
   * 非门构成的环会"收敛"到一对自洽的 1/0，从而被报告为稳定。
   *
   * 成功时最后刷新物化的读取区，所以 settle 之后立刻通过 inputBase 读取的调用方
   * 看到的就是结算后的值，不需要额外请求什么。
   */
  settle(): SettleReport {
    const inputs: PortValue[] = [];
    const outputs: PortValue[] = [];
    // 从一个干净的暂存区开始：某个 def 没有为某个引脚产生值（level_input）时，
    // 不能继承之前某个失败轮次暂存下来的值。
    this.#staged.fill(undefined);
    for (let iteration = 0; iteration < SETTLE_LIMIT; iteration += 1) {
      for (let i = 0; i < this.#instances.length; i += 1) {
        const inst = this.#instances[i]!;
        const evaluate = inst.def.evaluate;
        if (!evaluate) continue;
        this.#readInputs(inst, inputs);
        outputs.length = 0;
        evaluate(inputs, outputs, inst.def.sequential ? this.#state[i] : undefined, {
          tick: this.#tickCount,
        });
        for (let p = 0; p < inst.outputs.length; p += 1) {
          const value = outputs[p];
          if (value === undefined) continue;
          this.#staged[inst.outPin[p]!] = value;
        }
      }

      let changed = false;
      for (let k = 0; k < this.#outputPins.length; k += 1) {
        const value = this.#staged[k];
        if (value === undefined) continue;
        this.#staged[k] = undefined;
        const pin = this.#outputPins[k]!;
        if (this.#holds(pin.base, pin.width, value)) continue;
        this.#table.setPort(pin.base, pin.width, value);
        changed = true;
      }
      if (!changed) {
        this.#refreshReadRegions();
        return { iterations: iteration + 1, stable: true };
      }
    }
    throw new UnstableCircuitError(
      SETTLE_LIMIT,
      this.#instances.map((i) => i.origin),
    );
  }

  /**
   * 施加一个时钟沿：所有存储元件先采样，然后电路结算。
   *
   * 所有存储元件的输入在任何一个更新之前就被统一快照，所以两个串联的存储元件
   * 每个节拍只把值推进一级，而不会在一个节拍里竞速穿过两级。
   *
   * 调用方要先结算、再打节拍。存储元件是从信号表（上一轮完整扫描后的值）里读
   * 数据，所以一个时钟沿采样到的是上一轮扫描**结束时**的控制线——写了输入却不
   * 结算就直接 tick 的调用方，等于用上一个输入向量打拍。levels/checks.ts 里的
   * 两个调用方都是先结算（driveSteps 在写完一步的输入之后、推进时钟之前调用
   * io.sim.settle()，runRow 在 writeInput 之后也一样），ch2/batch4.ts 也从关卡
   * 数据一侧记录了同样的约定，所以这个顺序是既定约定，而不是某个调用方的偶然
   * 行为。
   *
   * 在 tick() 内部结算曾经尝试过又被撤回。那样方法会自给自足，而且从数值上并
   * 没有错——末尾的结算无论如何都会通过 evaluate 重新发布，结算结果完全相同。
   * 它改变的是扫描的轮数，而 test/core/net.test.ts 里有两个测试直接观察第一轮
   * 扫描：#publishState 是先写入的一步，在扫描开始前把保持字节带进信号表，于是
   * 一个时钟沿之后的第一轮扫描读到的已经是沿后的值；这两个测试（断言
   * report.iterations 恰好为 2 的那个，以及断言 reset() 之前零状态发布出 1 的
   * 那个）把这个顺序钉死了。在沿之前多一轮扫描会把先写入的那一步挤到后面，两个
   * 测试都会失败。这个顺序属于调用方。
   */
  tick(): SettleReport {
    this.#tickCount += 1;
    const pending: Array<{ index: number; inputs: PortValue[] }> = [];
    const inputs: PortValue[] = [];
    for (let i = 0; i < this.#instances.length; i += 1) {
      const inst = this.#instances[i]!;
      if (!inst.def.sequential || !inst.def.clockEdge) continue;
      this.#readInputs(inst, inputs);
      pending.push({ index: i, inputs: [...inputs] });
    }
    const outputs: PortValue[] = [];
    for (const { index, inputs: sampled } of pending) {
      const inst = this.#instances[index]!;
      outputs.length = 0;
      inst.def.clockEdge!(sampled, outputs, this.#state[index]!, { tick: this.#tickCount });
    }
    this.#publishState();
    return this.settle();
  }

  read(base: number, width: number): PortValue {
    return this.#table.getPort(base, width);
  }

  write(base: number, width: number, v: PortValue): void {
    this.#table.setPort(base, width, v);
  }

  /**
   * 一个实例的存储字节的副本；网表里没有这个实例时返回 null。
   *
   * 这是内核原本没有的那个读取器。调用方能从仿真里读出来的其它一切都要经过
   * 引脚，而引脚是电路自己发布的值；存储元件当前**持有什么**是没有引脚的私有
   * 状态——程序镜像没有能把 256 个字节全都显示出来的输出，regfile6 两个读端口
   * 背后的六个寄存器也无法从外部寻址。调试器需要的正是这个：readState('RF')
   * 是 REG0..REG5 六个字节，readState('PC') 是那一个地址，readState('RAM') 是
   * 当前的程序内容。
   *
   * 布局由 DEF 决定（ComponentDef.stateBytes，由 Simulation 构造函数分配，由
   * reset / clockEdge / loadImage 填写），所以这个方法自己不认识任何布局——和
   * publishState 为发布路径声明的规则相同。没有状态的元件返回空数组，这是对
   * "它持有什么"最诚实的回答。
   *
   * 永远返回副本。数组是仿真自己的存储：面板若写入拿到的数组，就会改动它正在
   * 展示的机器，而且这次写入对其它读者不可见。未知 id 返回 null 而不是抛错，
   * 因为调试器会在每次画板编辑时询问，而搭到一半的画板不是错误。
   *
   * instanceId 是文档 id，按 loadImage 的解析方式解析（CompiledInstance.key，
   * compile 用 instance.id 设置它）。
   */
  readState(instanceId: string): Uint8Array | null {
    const index = this.#instances.findIndex((inst) => inst.key === instanceId);
    if (index < 0) return null;
    return new Uint8Array(this.#state[index]!);
  }

  /**
   * 把一个字节镜像带外装载进某个实例的私有状态。
   *
   * 这是程序进入电路的路径。ram_prog 没有写引脚，所以它的字节无法像 ram8 那样
   * 通过时钟沿到达；关卡检查器改为汇编源码后调用这个方法。它必须在 reset()
   * 之后调用：reset 会把每个状态字节清零，而 runChecks 对每个检查用例编译一次、
   * 且编译发生在任何检查分支运行之前，所以在编译期写进去的镜像会在第一步读取
   * 之前就被清掉。这个方法自己不发布任何东西——调用方负责结算，由 def 自己的
   * evaluate 通过每个结算值都走的同一条扫描发布新的字节。
   *
   * instanceId 是文档 id，也就是 CompiledInstance.key 里保存的值（compile 目前
   * 用 instance.id 同时设置 key 和 origin），所以检查器可以从 graph.instances
   * 解析出一个实例，直接把它的 id 传进来。
   *
   * 拷贝之前整个状态会先清零，而不只是要写入的那些字节，这样短镜像写在长镜像
   * 之后不会留下尾巴，第二次调用也不依赖先后顺序。
   *
   * 对网表中不存在的 id、以及比实例状态更长的镜像，抛 RangeError 而不是裸的
   * Error。runChecks 会把 RangeError 吸收成一次 'invalid' 失败，而别的异常会从
   * grade() 的检查循环里逃出去，而 grade() 在每次画板编辑时都会运行。
   */
  loadImage(instanceId: string, bytes: Uint8Array | readonly number[]): void {
    const index = this.#instances.findIndex((inst) => inst.key === instanceId);
    if (index < 0) throw new RangeError(`this netlist has no instance "${instanceId}"`);
    const state = this.#state[index]!;
    if (bytes.length > state.length) {
      throw new RangeError(
        `an image of ${bytes.length} bytes does not fit instance "${instanceId}" (${state.length} bytes of state)`,
      );
    }
    state.fill(0);
    state.set(bytes);
  }
}

/**
 * 一份文档中所有自定义元件展开后的 NAND 等价门总数。
 *
 * 这是门数指标（规格 §5.4："电路 + 自定义组件 + 宽位组件全部展开后，NAND 等价
 * 门的总数"）。它放在这里而不是 levels/grader.ts，因为它走的是 compile 与
 * delayOf 走的同一套展平逻辑：对"一份文档包含哪些元件"只有一个定义，这样一个
 * 元件就不会对编译器是一种代价、对评分是另一种代价。
 *
 * gateCost 按叶子读取。一个自定义元件自身的定义写 0，改为统计它的内部电路——
 * 若同时再给元件本身计费就等于把同样的门算两遍；而把元件按一个与非门计价，又
 * 会让玩家能免费把整个电路藏进元件里。
 *
 * 没有声明 gateCost 的 def 回退到 cost，这是真实情形而不是遗留默认值：电源轨、
 * 关卡连接器、导线性质的打包器以及存储元件在两个指标上都是 0（见
 * ComponentDef.gateCost）。
 */
export function gateCostOf(graph: Graph, registry: Registry): number {
  let total = 0;
  for (const op of flattenForCompile(graph, registry)) {
    if (!registry.has(op.inst.def)) continue;
    const def = registry.get(op.inst.def);
    total += def.gateCost ?? def.cost;
  }
  return total;
}

/**
 * 最长的组合路径长度，按基础门延迟计数。
 *
 * 线性时间的 DAG 最长路：先用 Kahn 算法求拓扑序，再单遍松弛。若沿着路径逐条走，
 * 在菱形结构的电路上会是指数级的（2^n 条路径），而真实的 CPU 电路里到处都是
 * 菱形。
 *
 * 只考虑组合边。存储元件的输入是被采样而不是被读取（没有东西传播进去），输出是
 * 新的源头（没有东西穿过它），所以存储不贡献延迟：它的代价体现在节拍指标里。
 */
export function delayOf(graph: Graph, registry: Registry): number {
  // 叶子就是节点，理由与 compile 中相同：自定义元件是一个电路的名字，穿过它的
  // 路径就是穿过它内部元件的路径。把元件当成一个代价为 0 的节点来测，会报出一个
  // 忽略了玩家放进去的一切的延迟——一个靠把电路藏起来就变快的封装，正好与规格
  //"展开元件不能改变它的代价"的规则相反。
  const ops = flattenForCompile(graph, registry);
  const count = ops.length;
  if (count === 0) return 0;

  const cost = new Int32Array(count);
  const sequential = new Uint8Array(count);
  /** 元件 id -> 它的定义，用于读取某个边界的绑定表。 */
  const byId = new Map(graph.customComponents.map((entry) => [entry.id, entry]));
  /** 编译路径 -> 节点下标。 */
  const at = new Map<string, number>();
  /** 外层实例 id -> 携带它引脚的那个节点（它的第一个叶子）。 */
  const rootOf = new Map<string, number>();
  /** 编译路径 -> 它来自的那个内部实例的定义。 */
  const defOf = new Map<string, ComponentDef>();
  for (let i = 0; i < count; i += 1) {
    const op = ops[i]!;
    at.set(op.path, i);
    if (!rootOf.has(op.origin)) rootOf.set(op.origin, i);
    // 未知元件到不了这里（图已经通过校验）；跳过它们是为了让一份搭到一半的
    // 文档不会从指标函数里抛出去。
    const def = registry.has(op.inst.def) ? registry.get(op.inst.def) : null;
    if (def) defOf.set(op.path, def);
    cost[i] = def?.cost ?? 0;
    sequential[i] = def?.sequential ? 1 : 0;
  }

  /**
   * 每个自定义元件声明的输出引脚最终落在哪个叶子路径上。
   *
   * 画到 bp.out 的导线读取的是 body 里 out 绑定的那个引脚，而它通常不是元件的
   * 第一个叶子——所以若把边画到根上就会从错误的位置出发，在很深的内部电路上甚至
   * 可能完全掩盖最长路径。输入引脚不需要对应的映射：它们的槽就是根叶子的输入
   * 槽，所以指向输入引脚的导线落在根上。
   */
  const boundOutput = new Map<string, number>();
  for (const op of ops) {
    const cut = op.path.lastIndexOf(PATH_SEPARATOR);
    if (cut < 0) continue;
    const scope = op.path.slice(0, cut);
    const owner = at.get(scope);
    if (owner === undefined) continue;
    const component = byId.get(defOf.get(scope)?.id ?? '');
    for (const bind of Object.values(component?.binds.outputs ?? {})) {
      const target = at.get(`${scope}${PATH_SEPARATOR}${bind.inst}.${bind.port}`);
      if (target !== undefined) boundOutput.set(scope, target);
    }
  }

  const outgoing: number[][] = Array.from({ length: count }, () => []);
  const inDegree = new Int32Array(count);
  const edge = (from: number | undefined, to: number | undefined): void => {
    if (from === undefined || to === undefined) return;
    if (sequential[from] === 1 || sequential[to] === 1) return;
    outgoing[from]!.push(to);
    inDegree[to] = inDegree[to]! + 1;
  };

  for (const graphOfOps of new Set(ops.map((op) => op.graph))) {
    /** 实例 id -> 它在这张图里编译成的节点。 */
    const node = new Map<string, number>();
    for (let i = 0; i < count; i += 1) {
      const op = ops[i]!;
      if (op.graph === graphOfOps) node.set(op.path.slice(op.path.lastIndexOf(PATH_SEPARATOR) + 1), i);
    }
    // 导线画在同一张图的外层实例之间，所以每一端都是"携带该实例引脚"的节点：
    // 叶子就是实例自己；自定义元件则是它的表面所抵达的那个内部叶子——输出走绑定
    // 的内部引脚，输入走元件自己的节点（边界的输入槽与它共享）。
    const source = (id: string): number | undefined =>
      boundOutput.get(pathOf(id)) ?? node.get(id);
    const sink = (id: string): number | undefined => node.get(id) ?? boundOutput.get(pathOf(id));
    /** 这张图里某个外层实例的编译路径。 */
    function pathOf(id: string): string {
      const index = node.get(id);
      return index === undefined ? '' : ops[index]!.path;
    }
    for (const wire of graphOfOps.wires) {
      edge(source(wire.from.inst), sink(wire.to.inst));
    }
  }

  // delay[i] 是到达实例 i 输出端的最长组合延迟。源头没有前驱，所以它的值就是
  // 自己的 cost（输入未接线的门仍然要花一个门延迟；电源或存储元件的 cost 为 0）。
  const delay = new Int32Array(count);
  const queue: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (inDegree[i] !== 0) continue;
    delay[i] = sequential[i] === 1 ? 0 : cost[i]!;
    queue.push(i);
  }

  let longest = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head]!;
    if (delay[i]! > longest) longest = delay[i]!;
    for (const next of outgoing[i]!) {
      const candidate = delay[i]! + cost[next]!;
      if (candidate > delay[next]!) delay[next] = candidate;
      inDegree[next] = inDegree[next]! - 1;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  // 组合环里的实例永远不会入队（入度永远降不到 0），所以环不贡献深度，遍历也
  // 仍然会终止。validateGraph 会把环作为 warning 报告；它能不能稳定，是仿真器
  // 的问题，不是这个指标的问题。
  return longest;
}