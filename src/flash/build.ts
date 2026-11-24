import { CircuitValidationError, UnstableCircuitError } from '../core/errors';
import type { Graph } from '../core/graph';
import type { Registry } from '../core/registry';
import { Simulation, compile, type Netlist } from '../core/net';
import { boardPins, isSandbox } from '../levels/sandbox';
import type { LevelSpec } from '../levels/spec';
import { DEFAULT_BOARD, boardProfile, type BoardId } from './boards';
import { ExtractionError, MAX_STATES, extractCombination, extractStorage } from './extract';
import { pinValue, validatePinMap, type PinConnector, type PinIssue, type PinMap } from './pins';
import {
  EDGE_BYTES,
  NODE_BYTES,
  OUTPUT_BYTES,
  PIN_IN_BYTES,
  PIN_OUT_BYTES,
  PIN_RAM_BYTES,
  SOURCE_BYTES,
  hashText,
  imageSignature,
  refusal,
  type BuildResult,
  type ConnectorPin,
  type ImageEdge,
  type ImageMode,
  type ImageNode,
  type ImagePinIn,
  type ImagePinOut,
  type ImageRefusal,
  type ImageSource,
} from './image';

/**
 * 由沙盒电路构建开发板要运行的程序映像。
 *
 * 受支持的元件集合是一份刻意收窄的契约。第一版只认识十种 1 位门、`full_adder`、
 * 两种 1 位存储器和两种连接器。宽位元件（`and8`、`add8`）、译码器、CPU 元件，
 * 以及用它们搭出来的玩家自定义元件，都会被**拒绝并点名实例**，而不是悄悄略过：
 * 一块"能跑电路大部分"的板子，比一块明确说"这个元件跑不了"的板子更糟。
 *
 * 同一电路在板上与在页面里运行结果一致的原因：每张表都从元件自己的 JavaScript
 * 行为中抽取（`extract.ts`），槽位边直接来自编译后的网表（`inputSlot` 加 `drive`），
 * 组合依赖环则回落到底层内核同样的 Jacobi 结算规则，而不是假装存在拓扑序。
 *
 * RAM 预算是一次**拒绝**，不是警告。Uno 只有 2 KiB SRAM，超限的失败方式是板子
 * 复位或输出乱跳，这比面板上的一条消息难诊断得多。估算刻意保守，并且对照
 * 玩家选中的板卡检查（`boards.ts`）：对 Uno 太大的电路也许仍能放进 Mega，拒绝
 * 消息会说明是哪块板卡拒绝的。真实尺寸在选定板卡后由 `arduino-cli compile`
 * 回报，面板两个数字都会显示。
 */

/** 第一版能够抽取真值表的 1 位门元件。 */
const COMBINATIONAL = new Set([
  'const_on',
  'const_off',
  'nand',
  'not',
  'and',
  'or',
  'nor',
  'xor',
  'xnor',
  'and3',
  'or3',
  'full_adder',
]);

/** 两种存储元件：各占 1 个状态字节，先由状态发布输出，再由时钟沿采样。 */
const SEQUENTIAL = new Set(['delay_line', 'mem1']);

/** 支持集合：组合元件与存储元件的并集，其余元件一律拒绝。 */
const SUPPORTED = new Set([...COMBINATIONAL, ...SEQUENTIAL]);

/** 独立模式允许的最大时钟频率：1 kHz，即最短 1 ms 一个节拍。 */
const MAX_CLOCK_HZ = 1_000;

/** 未指定时钟时的默认频率：1 Hz，足够看见寄存器和计数器在动。 */
export const DEFAULT_CLOCK_HZ = 1;

/**
 * 估算在"电路自身字节"之外，给调用栈与运行时留出的 SRAM。
 *
 * 刻意不是"几乎整块芯片"：固件自己的表，以及 Jacobi 每轮扫描里层层嵌套的调用，
 * 都和槽位数组共享同一块 SRAM。
 */
const RAM_RESERVE = 320;

/** 草图中运行时代码占用的 flash：各张表、结算循环与引脚轮询。 */
const FLASH_RUNTIME = 6_144;

/**
 * 把一张画板文档变成开发板程序映像；变不成时给出原因。
 *
 * `board` 只决定估算要对照哪块板卡的预算——在没有引脚映射时，映像在所有 AVR 上
 * 是同样的字节，所以板卡不进哈希。默认是 Uno，即第一版实现与实测围绕的板卡。
 *
 * 拒绝的先后顺序，就是玩家可以依次处理的顺序：屏幕不对、编译不过、没有连接器、
 * 有元件不支持、引脚分配不可用、电路不收敛、放不下。同时有两个缺陷的电路报告
 * 第一个，而那通常正是应该先修的那个。
 *
 * 一旦某个连接器映射到模拟引脚，`board` 还决定草图写出的引脚**编号**：A0 在 328P
 * 上是 14，在 Mega 上是 54。没有映射时，映像在所有 AVR 上字节相同；有映射时，
 * 编号本身就在映像里，也就在哈希里。
 *
 * `pinMap` 是面板"引脚"卡片选出的结果：连接器 id → 板卡引脚。它在这里与面板里
 * 各校验一次（过期存档或其他调用方不能产出共用同一引脚、或用了板上没有的引脚的
 * 固件），并且因为它改变固件行为，所以参与映像哈希——规则见 `pins.ts`。
 *
 * @param graph 画板文档，提供实例与连线。
 * @param registry 元件定义表，用来读取每个实例的 `evaluate`/`clockEdge`。
 * @param level 关卡规格；只有沙盒关卡允许烧录。
 * @param board 预算与引脚编号所依据的板卡，默认 Uno。
 * @param pinMap 连接器 id 到板卡引脚的映射；缺省表示不占用任何物理引脚。
 * @param clockHz 固件自行推进时钟的频率（0–1000）；0 表示只结算组合逻辑。
 * @returns 成功时是 `{ image }`，失败时是 `{ refusal }`（含中英两种原因文本）。
 */
export function buildImage(
  graph: Graph,
  registry: Registry,
  level: LevelSpec,
  board: BoardId = DEFAULT_BOARD,
  pinMap: PinMap = {},
  clockHz: number = DEFAULT_CLOCK_HZ,
): BuildResult {
  if (!Number.isInteger(clockHz) || clockHz < 0 || clockHz > MAX_CLOCK_HZ) {
    return refusal(
      'clock',
      `运行时钟必须是 0 到 ${MAX_CLOCK_HZ} 之间的整数；0 表示只跑组合逻辑。`,
      `The run clock must be an integer from 0 to ${MAX_CLOCK_HZ}; 0 means combinational logic only.`,
    );
  }
  if (!isSandbox(level)) {
    return refusal(
      'sandbox-only',
      '写入开发板只在沙盒里可用：关卡板上的引脚是题目的契约，不能改写成别的电路。',
      'Writing to a board is a sandbox feature: a level board’s pins are the puzzle’s contract.',
    );
  }

  const compiled = compileOrRefuse(graph, registry);
  if ('refusal' in compiled) return compiled;
  const net = compiled.net;

  const pins = boardPins(level, graph, registry);
  if (pins.inputs.length === 0 && pins.outputs.length === 0) {
    return refusal(
      'no-connectors',
      '沙盒里还没有连接器：放一个「关卡输入」和「关卡输出」再烧录，否则板上没有可接的引脚。',
      'The sandbox has no connectors yet: place a Level Input and a Level Output so the board has pins.',
    );
  }

  // 独立模式没有串口通道：宽连接器既不能整字读到，也不能整字写出。与其生成一份
  // 把它们悄悄丢掉的固件，不如在构建时点名拒绝。
  const wide = [...pins.inputs, ...pins.outputs].filter((pin) => pin.width !== 1);
  if (wide.length > 0) {
    const names = wide.map((pin) => `${pin.id}（${pin.width} 位）`).join('、');
    return refusal(
      'wide-connector',
      `独立模式只能接 1 位连接器：${names} 是宽连接器，没有串口通道。请把它拆成 1 位连接器，或改用一位的输入输出。`,
      `Standalone mode only takes one-bit connectors: ${names} are wider and have no serial channel. Split them into one-bit connectors or use one-bit I/O.`,
      wide.map((pin) => pin.id),
    );
  }

  const nodes: ImageNode[] = [];
  const sources: ImageSource[] = [];
  const edges: ImageEdge[] = [];
  const tables: Uint8Array[] = [];
  const tableIndex = new Map<string, number>();
  const addTable = (bytes: Uint8Array): number => {
    const key = Array.from(bytes).join(',');
    const existing = tableIndex.get(key);
    if (existing !== undefined) return existing;
    const index = tables.length;
    tables.push(bytes);
    tableIndex.set(key, index);
    return index;
  };

  const inputs: ConnectorPin[] = [];
  for (const [index, pin] of pins.inputs.entries()) {
    const key = `${pin.id}.out`;
    const base = net.outputBase(key);
    const width = net.outputWidth(key);
    for (let bit = 0; bit < width; bit += 1) sources.push({ out: base + bit, ext: index, bit });
    inputs.push({ id: pin.id, index, width, base });
  }

  const outputs: ConnectorPin[] = [];
  for (const [index, pin] of pins.outputs.entries()) {
    const key = `${pin.id}.mirror`;
    const base = net.outputBase(key);
    const width = net.outputWidth(key);
    outputs.push({ id: pin.id, index, width, base });
  }

  // 引脚卡片里的分配。校验失败会变成拒绝值返回，这样过期存档、第二个调用方或
  // 未来的导入路径都不可能产出"抢同一根引脚"的固件；面板只是提前挡住同样的冲突。
  const pinConnectors: PinConnector[] = [
    ...inputs.map((pin) => ({ id: pin.id, width: pin.width })),
    ...outputs.map((pin) => ({ id: pin.id, width: pin.width })),
  ];
  const pinIssues = validatePinMap(board, pinConnectors, pinMap);
  if (pinIssues.length > 0) {
    return refusal(
      'pins',
      `引脚分配不可用：${pinIssues.slice(0, 6).map(pinIssueZh).join('；')}。只有 1 位连接器能接一个引脚。`,
      `These pin assignments cannot be used: ${pinIssues.slice(0, 6).map(pinIssueEn).join('; ')}. Only one-bit connectors take a pin.`,
      [...new Set(pinIssues.map((issue) => issue.connector))],
    );
  }

  const pinInputs: ImagePinIn[] = [];
  for (const pin of inputs) {
    const assigned = pinMap[pin.id];
    if (assigned !== undefined) pinInputs.push({ ext: pin.index, pin: pinValue(board, assigned) });
  }
  const pinOutputs: ImagePinOut[] = [];
  for (const pin of outputs) {
    const assigned = pinMap[pin.id];
    if (assigned !== undefined) pinOutputs.push({ base: pin.base, pin: pinValue(board, assigned) });
  }

  const paths = net.instanceIds();
  const defIds = net.instanceDefs();
  const unsupported: string[] = [];
  let stateCount = 0;

  for (let at = 0; at < paths.length; at += 1) {
    const path = paths[at]!;
    const defId = defIds[at]!;
    const def = registry.get(defId);
    const origin = net.refs.get(path) ?? path;
    const label = origin === path ? `${path} (${defId})` : `${origin} → ${path} (${defId})`;

    // 关卡输入由外部驱动：它的槽位是一个 `ImageSource`，不是节点。嵌套在自定义
    // 元件里的输入永远没人驱动（判定器只写顶层引脚），所以跳过它正是页面里的行为。
    if (defId === 'level_input') continue;

    // 关卡输出是一面镜子：每一位都拷贝它 `in` 位读到的那个槽位。对**每一个**
    // 编译出来的连接器都这样做（而不只是开发板自己的引脚），玩家把这个输出另外
    // 连到别处时，`mirror` 输出才会保持正确。
    if (defId === 'level_output') {
      const inputPin = def.inputs[0];
      if (inputPin === undefined) {
        unsupported.push(label);
        continue;
      }
      let inBase: number;
      try {
        inBase = net.inputSlot(`${path}.${inputPin.id}`);
      } catch {
        unsupported.push(label);
        continue;
      }
      for (const outPin of def.outputs) {
        const outBase = net.outputBase(`${path}.${outPin.id}`);
        const width = net.outputWidth(`${path}.${outPin.id}`);
        for (let bit = 0; bit < width; bit += 1) {
          nodes.push({
            kind: 'copy',
            out: outBase + bit,
            inputs: [net.drive[inBase + bit]!],
            table: -1,
            state: -1,
          });
        }
      }
      continue;
    }

    if (!SUPPORTED.has(defId)) {
      unsupported.push(label);
      continue;
    }

    const inWidths = def.inputs.map((pin) => net.inputWidth(`${path}.${pin.id}`));
    const outWidths = def.outputs.map((pin) => net.outputWidth(`${path}.${pin.id}`));
    if (inWidths.some((width) => width !== 1) || outWidths.some((width) => width !== 1)) {
      unsupported.push(`${label} — the first version only takes one-bit pins`);
      continue;
    }

    // 输入槽位按引脚顺序、每个引脚低位在前展开成向量，与 extract.ts 的
    // `inputsFor` 的顺序完全一致；节点里的真值表就是按这个下标索引的。
    const slots: number[] = [];
    for (let pinAt = 0; pinAt < def.inputs.length; pinAt += 1) {
      const pin = def.inputs[pinAt]!;
      const base = net.inputSlot(`${path}.${pin.id}`);
      for (let bit = 0; bit < inWidths[pinAt]!; bit += 1) {
        slots.push(net.drive[base + bit]!);
      }
    }

    try {
      if (SEQUENTIAL.has(defId)) {
        const extracted = extractStorage(
          def,
          inWidths,
          def.outputs.map((pin) => pin.id),
        );
        if (extracted.stateCount > MAX_STATES) {
          unsupported.push(`${label} — ${extracted.stateCount} states`);
          continue;
        }
        // 每个存储元件分到一个状态下标（固件里对应 TC_STATE/TC_PENDING 的一格），
        // 与它在节点发射顺序里的位置无关，只要求边与 pub 节点引用同一个下标。
        const state = stateCount;
        stateCount += 1;
        for (let pinAt = 0; pinAt < def.outputs.length; pinAt += 1) {
          const outPin = def.outputs[pinAt]!;
          nodes.push({
            kind: 'pub',
            out: net.outputBase(`${path}.${outPin.id}`),
            inputs: [],
            table: addTable(extracted.publish[pinAt]!),
            state,
          });
        }
        edges.push({ state, inputs: slots, table: addTable(extracted.transitions) });
      } else {
        const extracted = extractCombination(
          def,
          inWidths,
          def.outputs.map((pin) => pin.id),
        );
        for (let pinAt = 0; pinAt < def.outputs.length; pinAt += 1) {
          const outPin = def.outputs[pinAt]!;
          nodes.push({
            kind: 'tab',
            out: net.outputBase(`${path}.${outPin.id}`),
            inputs: slots,
            table: addTable(extracted.tables[pinAt]!),
            state: -1,
          });
        }
      }
    } catch (error) {
      if (error instanceof ExtractionError) {
        unsupported.push(`${label} — ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  if (unsupported.length > 0) {
    const shown = unsupported.slice(0, 10);
    const more = unsupported.length > shown.length ? ` 等 ${unsupported.length} 个` : '';
    return refusal(
      'unsupported',
      `这些元件还不能写到开发板：${shown.join('、')}${more}。第一版只支持 1 位门、延迟线、1 位存储和连接器；宽位/CPU 元件请先不要放进这块电路。`,
      `These parts cannot be written to the board yet: ${shown.join(', ')}${more}. The first version supports one-bit gates, the delay line, one-bit memory and the connectors.`,
      unsupported,
    );
  }

  // 先取内核自己的判决，再谈板卡预算。页面里都无法结算的电路没有不动点可供固件
  // 复现；让一个振荡器上板，看起来会像是固件的 bug。
  try {
    new Simulation(net, registry).settle();
  } catch (error) {
    if (error instanceof UnstableCircuitError) {
      return refusal(
        'unstable',
        '电路在输入为 0 时不收敛（组合反馈环），板上无法给出可重复的结果。先让它在页面里稳定下来。',
        'The circuit does not settle with zero inputs (a combinational feedback loop); the board could not reproduce it.',
        error.blame,
      );
    }
    throw error;
  }

  const ordered = orderNodes(nodes);
  const slots = net.slotCount;
  if (slots > 65_535) {
    return refusal(
      'too-big',
      `电路有 ${slots} 个信号槽，超过固件能寻址的 65535 个。`,
      `The circuit has ${slots} signal slots; the firmware addresses at most 65535.`,
    );
  }

  const slotBytes = Math.ceil(slots / 8);
  const buffered = ordered.mode === 'dag' ? slotBytes : slotBytes * 2;
  // 固件把连接器值放在结算缓冲之外的 `TC_IN`（每个 `uint32_t`），每个存储元件
  // 还要一个状态字节加一个待提交字节，每个被轮询的输入引脚还要一个"上一次电平"
  // 字节。
  const ramBytes =
    buffered + stateCount * 2 + inputs.length * 4 + pinInputs.length * PIN_RAM_BYTES + RAM_RESERVE;
  const tableBytes = tables.reduce((sum, table) => sum + table.length, 0);
  // 草图里每一个 PROGMEM 数组都计入，不只是描述符：源表、每个输出的 base/width
  // 表以及引脚表同样占 flash。
  const flashBytes =
    ordered.nodes.length * NODE_BYTES +
    edges.length * EDGE_BYTES +
    sources.length * SOURCE_BYTES +
    outputs.length * OUTPUT_BYTES +
    pinInputs.length * PIN_IN_BYTES +
    pinOutputs.length * PIN_OUT_BYTES +
    tableBytes +
    FLASH_RUNTIME;

  const limits = boardProfile(board);
  if (ramBytes > limits.maxRam || flashBytes > limits.maxFlash) {
    // 出路取决于板卡：对 Uno 太大的电路，换 Mega 是答案；玩家已经在 Mega 上时，
    // 就没有更大的板子可推荐了。
    const hint =
      board === 'arduino:avr:mega'
        ? ''
        : '减少存储元件、缩小连接器位宽，或换 Mega（256 KB flash / 8 KB RAM）。';
    const hintEn =
      board === 'arduino:avr:mega'
        ? ''
        : ' Reduce memory parts or connector widths, or use a Mega (256 KB flash / 8 KB RAM).';
    return refusal(
      'too-big',
      `这块 ${limits.name} 放不下：RAM 估计 ${ramBytes} B（上限 ${limits.maxRam}），flash 估计 ${flashBytes} B（上限 ${limits.maxFlash}）。${hint}`,
      `This ${limits.name} is too small: estimated ${ramBytes} B RAM (limit ${limits.maxRam}) and ${flashBytes} B flash (limit ${limits.maxFlash}).${hintEn}`,
    );
  }

  const built = {
    level: level.id,
    mode: ordered.mode,
    clockHz,
    slots,
    nodes: ordered.nodes,
    sources,
    edges,
    tables,
    inputs,
    outputs,
    pinInputs,
    pinOutputs,
  } as const;
  const report = {
    level: level.id,
    instances: graph.instances.length,
    expanded: net.instanceCount,
    nodes: ordered.nodes.length,
    sources: sources.length,
    edges: edges.length,
    stateCount,
    slots,
    tables: tables.length,
    tableBytes,
    ramBytes,
    flashBytes,
    mode: ordered.mode,
  } as const;

  return { image: { ...built, hash: hashText(imageSignature(built)), stateCount, report } };
}

/**
 * 一条引脚问题，转成面板上给玩家看的中文句子。
 *
 * 放在 `buildImage` 旁边而不是 `pins.ts`，因为措辞属于玩家读到的拒绝消息，
 * 而不属于校验器本身；英文版本是紧挨着的 `pinIssueEn`。
 */
function pinIssueZh(issue: PinIssue): string {
  switch (issue.code) {
    case 'wide-connector':
      return `${issue.connector} 不是 1 位连接器`;
    case 'unsupported-pin':
      return `${issue.connector} → ${issue.pin ?? '?'}（这块板没有这个引脚）`;
    case 'duplicate-pin':
      return `${issue.pin ?? '?'} 同时接给了 ${issue.other ?? '?'} 和 ${issue.connector}`;
  }
}

function pinIssueEn(issue: PinIssue): string {
  switch (issue.code) {
    case 'wide-connector':
      return `${issue.connector} is not a one-bit connector`;
    case 'unsupported-pin':
      return `${issue.connector} → ${issue.pin ?? '?'} (this board has no such pin)`;
    case 'duplicate-pin':
      return `${issue.pin ?? '?'} is assigned to both ${issue.other ?? '?'} and ${issue.connector}`;
  }
}

/**
 * 调用 `compile`，并把内核的验证异常转成拒绝值。
 *
 * 这个包装存在，只是因为 `compile` 会 throw，而本构建器的契约是"返回可判别的
 * 结果"；非验证类的异常是内核或本文件的缺陷，应当原样抛出，而不是伪装成玩家的
 * 错误。
 */
function compileOrRefuse(
  graph: Graph,
  registry: Registry,
): { readonly net: Netlist } | { readonly refusal: ImageRefusal } {
  try {
    return { net: compile(graph, registry) };
  } catch (error) {
    if (error instanceof CircuitValidationError) {
      return refusal(
        'compile',
        `电路无法编译：${error.issues.map((issue) => issue.message.zh).join('；')}`,
        `The circuit does not compile: ${error.issues.map((issue) => issue.message.en).join('; ')}`,
        [...new Set(error.issues.map((issue) => issue.inst ?? '').filter((id) => id !== ''))],
      );
    }
    throw error;
  }
}

/**
 * 按结算顺序排列节点；不存在这种顺序时返回 `jacobi` 模式。
 *
 * 组合环在这里不是错误：内核用 Jacobi 迭代结算它，开发板也必须照做，而不能因为
 * 看到 NAND 锁存器就拒绝。排序成功时，返回值是节点列表的一个排列；失败时列表
 * 保持发射顺序，由固件走双缓冲循环——那个循环按构造与顺序无关。
 */
function orderNodes(nodes: readonly ImageNode[]): {
  readonly nodes: readonly ImageNode[];
  readonly mode: ImageMode;
} {
  const producer = new Map<number, number>();
  for (let index = 0; index < nodes.length; index += 1) {
    producer.set(nodes[index]!.out, index);
  }
  const dependents: number[][] = nodes.map(() => []);
  const indegree: number[] = nodes.map(() => 0);
  for (let index = 0; index < nodes.length; index += 1) {
    const seen = new Set<number>();
    for (const slot of nodes[index]!.inputs) {
      const from = producer.get(slot);
      if (from === undefined || seen.has(from)) continue;
      seen.add(from);
      dependents[from]!.push(index);
      indegree[index]! += 1;
    }
  }
  const queue: number[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (indegree[index] === 0) queue.push(index);
  }
  const ordered: number[] = [];
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]!;
    ordered.push(index);
    for (const next of dependents[index]!) {
      indegree[next]! -= 1;
      if (indegree[next] === 0) queue.push(next);
    }
  }
  if (ordered.length < nodes.length) return { nodes, mode: 'jacobi' };
  return { nodes: ordered.map((index) => nodes[index]!), mode: 'dag' };
}
