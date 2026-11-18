import type { Graph } from '../core/graph';

/**
 * Arduino 实际运行的程序：一个电路被压平成表驱动的映像。
 *
 * 这**不是第二个模拟器**。这里每一张表都是在构建时调用元件自己的 `evaluate`/
 * `clockEdge` 产生的（`extract.ts`），所以映像与页面里的 `Simulation` 不可能对
 * "NAND 是什么"产生分歧：每种元件只有一份实现（JavaScript），开发板只是读取交给
 * 它的答案，而不是读一份手写的 C++ 副本。这正是第一版无需把每个元件移植到 C++
 * 就能支持一组元件的原因。
 *
 * 映像刻意是**面向开发板**的，而不是 `Graph`：槽号、表偏移和节点顺序都是固件直接
 * 索引的东西。生成器（`build.ts`）是唯一允许构造映像的地方。
 */

/** 固件必须采用的结算策略：`dag` 可按拓扑序原地求值，`jacobi` 需要双缓冲迭代。 */
export type ImageMode = 'dag' | 'jacobi';

/** 沙盒画板上的一个连接器，按串口协议的编号方式表示。 */
export interface ConnectorPin {
  /** 连接器实例 id（`IN_1`、`OUT_1`），也就是沙盒里的引脚 id。 */
  readonly id: string;
  /** 协议里 `I <index>` 与 `F` 帧各列使用的下标。 */
  readonly index: number;
  /** 连接器位宽（位数）。 */
  readonly width: number;
  /**
   * 连接器发布的那个编译后输出槽位。
   *
   * 对输入引脚，它是源写到的 `level_input` 输出槽；对输出引脚，它是拷贝写入、
   * 帧打包读取的 `level_output` 镜像槽。放在这里，生成器和宿主模型就都不必再从
   * 一个 key 重新推导基址。
   */
  readonly base: number;
}

/**
 * `tab` 用真值表算出一个输出引脚，`copy` 搬运一个槽位，`pub` 发布存储元件的
 * 保持状态。外部连接器值不是节点：`ImageSource` 指明 `tcApplySrc` 写哪些槽位，
 * 因为它们是扫描不能覆盖的输入（扫描读的是上一轮的缓冲）。
 */
export type ImageNodeKind = 'tab' | 'copy' | 'pub';

/**
 * 一个被计算出来的槽位。
 *
 * `state` 是 `pub` 节点要发布的存储实例下标，其他种类为 `-1`。用数字而不是可选
 * 字段，是因为生成器要拿它索引数组，而开启 `exactOptionalPropertyTypes` 后，
 * 每个构造点都得用不同写法表达"没有"。
 */
export interface ImageNode {
  /** 节点种类。 */
  readonly kind: ImageNodeKind;
  /** 计算结果的槽位号。 */
  readonly out: number;
  /** 源槽位，按真值表下标顺序排列，最多三个。 */
  readonly inputs: readonly number[];
  /** 在 `tables` 里的下标；`copy` 节点没有意义。 */
  readonly table: number;
  /** 存储实例下标（仅 `pub` 节点），其他为 -1。 */
  readonly state: number;
}

/** 输入连接器的一位：连接器 `ext` 的第 `bit` 位，写到槽位 `out`。 */
export interface ImageSource {
  readonly out: number;
  readonly ext: number;
  readonly bit: number;
}

/**
 * 一个存储元件的时钟沿。
 *
 * `inputs` 是它每个输入引脚各一位的源槽位；转移表按
 * `state * 2 ** inputs.length + vector` 索引，与固件里的算法完全一致。
 * 每个沿都先全部采样、再统一提交（`tcTick`），这是内核自己的规则：
 * 两个串联的存储器每拍只移动一级。
 */
export interface ImageEdge {
  readonly state: number;
  readonly inputs: readonly number[];
  readonly table: number;
}

/** 面板展示、`buildImage` 用来拒绝板卡的那组数字。 */
export interface ImageReport {
  readonly level: string;
  /** 文档里的实例数，自定义元件展开之前。 */
  readonly instances: number;
  /** 编译后的叶子数，每个被发射的元件一条（含连接器）。 */
  readonly expanded: number;
  /** 计算节点数。 */
  readonly nodes: number;
  /** 输入连接器的位源数（每一位一条）。 */
  readonly sources: number;
  /** 存储元件的时钟沿数。 */
  readonly edges: number;
  /** 存储实例数（每个存储元件一个状态字节）。 */
  readonly stateCount: number;
  /** 开发板必须持有的位槽总数。 */
  readonly slots: number;
  /** 去重后的表张数。 */
  readonly tables: number;
  /** 所有表的字节总数。 */
  readonly tableBytes: number;
  /** 估算 RAM：结算缓冲、存储状态，以及串口/栈的保留区。 */
  readonly ramBytes: number;
  /** 估算 flash：节点/边数组、表和运行时模板。 */
  readonly flashBytes: number;
  /** 本次要走的结算模式。 */
  readonly mode: ImageMode;
}

/**
 * 固件每个 PROGMEM 条目占的字节数，只在这里写一次。
 *
 * `build.ts` 用这些数字估算草图的 flash，`emit.ts` 则在生成的草图里用 `sizeof`
 * 对它们做断言；因此某个描述符一旦变长，`arduino-cli`（或宿主测试）会直接失败，
 * 而不是悄悄让面板展示过的估算失效。这些结构体都是打包的（packed）：AVR 把
 * `uint16_t` 按 1 字节对齐，而 PC 编译器按 2 字节对齐，不打包的话同一份草图在
 * 宿主测试两侧会占不同字节数。
 *
 * `TcNode` 在状态索引扩宽成 `uint16_t` 之后仍是 14 字节：它原先占的那 1 字节
 * 本来就是填充，所以存储多到一字节索引不够的电路，并不会让每个节点多花 flash。
 * `TcEdge` 则确实长了 1 字节。
 */
export const NODE_BYTES = 14;
/** `TcEdge` 的打包尺寸：2 + 1 + 2 + 2 + 2 + 2 = 11 字节。 */
export const EDGE_BYTES = 11;
/** `TcSrc`：一个槽位（`uint16_t`）、一个连接器下标（`uint16_t`）加一个位号。 */
export const SOURCE_BYTES = 5;
/** 每个输出：`TC_OUT_BASE` 的 `uint16_t` 加上 `TC_OUT_WIDTH` 的 `uint8_t`。 */
export const OUTPUT_BYTES = 3;
/** `TcPinIn`：一个板卡引脚与它驱动的输入连接器，各 1 字节。 */
export const PIN_IN_BYTES = 2;
/** `TcPinOut`：一个板卡引脚与它发布的输出槽，槽基址是 `uint16_t`。 */
export const PIN_OUT_BYTES = 3;
/** `TC_PIN_LAST`：每个输入引脚 1 字节，用来检测硬件电平变化。 */
export const PIN_RAM_BYTES = 1;

/**
 * 一个从物理引脚读取的输入连接器（`ext` 是连接器下标）。
 *
 * `pin` 是草图写出的 Arduino 引脚**编号**（`digitalRead(2)` 里的 2），这就是为什么
 * 只要连接器映射了引脚，映像就不再完全与板卡无关：`A0` 在 328P 上是 14，在 Mega
 * 上是 54。也正因如此，进哈希的是编号而不是名字。名字到编号的规则由 `pins.ts` 负责。
 */
export interface ImagePinIn {
  readonly ext: number;
  readonly pin: number;
}

/** 一个写到物理引脚上的输出连接器（`base` 是它的槽基址）。 */
export interface ImagePinOut {
  readonly base: number;
  readonly pin: number;
}

/** 固件与它的宿主侧必须达成一致的全部内容。 */
export interface ProgramImage {
  /** 来源关卡 id。 */
  readonly level: string;
  /** 结算模式，固件据此切换双缓冲。 */
  readonly mode: ImageMode;
  /** 规范化映像文本的 FNV-1a 值；固件在 banner 里回报它。 */
  readonly hash: number;
  /** 槽位总数。 */
  readonly slots: number;
  /** 计算节点，`dag` 模式下数组顺序就是求值顺序。 */
  readonly nodes: readonly ImageNode[];
  /** 输入连接器的位源。 */
  readonly sources: readonly ImageSource[];
  /** 存储元件的时钟沿。 */
  readonly edges: readonly ImageEdge[];
  /** 表字节，由 `ImageNode.table` / `ImageEdge.table` 索引。 */
  readonly tables: readonly Uint8Array[];
  /** 存储实例数（每个存储元件一个状态字节）。 */
  readonly stateCount: number;
  /** 输入连接器，按协议编号顺序。 */
  readonly inputs: readonly ConnectorPin[];
  /** 输出连接器，按协议编号顺序；`F` 帧各列的顺序。 */
  readonly outputs: readonly ConnectorPin[];
  /** 被分到物理引脚的输入连接器；全部走串口时为空。 */
  readonly pinInputs: readonly ImagePinIn[];
  /** 被分到物理引脚的输出连接器；全部走串口时为空。 */
  readonly pinOutputs: readonly ImagePinOut[];
  /** 面板展示的估算数字。 */
  readonly report: ImageReport;
}

/** 拒绝的机器可读分类；面板与测试按它分支，文案则按语言取。 */
export type RefusalCode =
  | 'sandbox-only'
  | 'compile'
  | 'no-connectors'
  | 'unsupported'
  | 'unstable'
  | 'pins'
  | 'too-big';

/** 电路为什么不能变成固件，中英双语各一份。 */
export interface ImageRefusal {
  /** 机器可读的原因分类。 */
  readonly code: RefusalCode;
  /** 面板展示的中文原因。 */
  readonly zh: string;
  /** 同一原因的英文版本（面板按语言切换）。 */
  readonly en: string;
  /** 拒绝所涉及的编译路径（或文档 id）；空表示全局问题。 */
  readonly instances: readonly string[];
}

/** 构建结果：要么有映像，要么有拒绝原因。 */
export type BuildResult =
  | { readonly image: ProgramImage }
  | { readonly refusal: ImageRefusal };

/** 结果携带的是固件而不是"不能"的原因时返回 `true`。 */
export function isImage(result: BuildResult): result is { readonly image: ProgramImage } {
  return 'image' in result;
}

/** 把拒绝值转成应用状态行的形状，调用方可以直接展示。 */
export function refusalStatus(refusal: ImageRefusal): { zh: string; en: string } {
  return { zh: refusal.zh, en: refusal.en };
}

/**
 * FNV-1a，32 位，作用在映像的规范拼写上。
 *
 * 刻意保持确定性：面板记住它烧录过的哈希，固件在 banner 里打印同一个数字，
 * 于是"板子跑的就是屏幕上的电路"只需一次比较，而不是靠猜。只为检测同一个标签页
 * 里的改动，用加密哈希就过度了。
 *
 * @param text `imageSignature` 产出的规范文本。
 * @returns 无符号 32 位哈希（固件以十六进制打印它）。
 */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 哈希所依据的规范拼写：固定字段顺序、以 `|` 分隔的文本。 */
export function imageSignature(image: {
  readonly level: string;
  readonly mode: ImageMode;
  readonly slots: number;
  readonly nodes: readonly ImageNode[];
  readonly sources: readonly ImageSource[];
  readonly edges: readonly ImageEdge[];
  readonly tables: readonly Uint8Array[];
  readonly inputs: readonly ConnectorPin[];
  readonly outputs: readonly ConnectorPin[];
  readonly pinInputs: readonly ImagePinIn[];
  readonly pinOutputs: readonly ImagePinOut[];
}): string {
  const parts: string[] = [image.level, image.mode, String(image.slots)];
  for (const input of image.inputs) parts.push(`i:${input.id}:${input.index}:${input.width}:${input.base}`);
  for (const output of image.outputs)
    parts.push(`o:${output.id}:${output.index}:${output.width}:${output.base}`);
  // 引脚会改变固件的实际行为，所以它也改变哈希：映射引脚之后，banner 仍然能回答
  // "板子跑的是不是屏幕上的东西"。
  for (const pin of image.pinInputs) parts.push(`pi:${pin.ext}:${pin.pin}`);
  for (const pin of image.pinOutputs) parts.push(`po:${pin.base}:${pin.pin}`);
  for (const source of image.sources) parts.push(`s:${source.out}:${source.ext}:${source.bit}`);
  for (const node of image.nodes) {
    parts.push(`n:${node.kind}:${node.out}:${node.inputs.join('/')}:${node.table}:${node.state}`);
  }
  for (const edge of image.edges) parts.push(`e:${edge.state}:${edge.inputs.join('/')}:${edge.table}`);
  for (const table of image.tables) parts.push(`t:${Array.from(table).join(',')}`);
  return parts.join('|');
}

/** 本模块用不了的一张图是拒绝值，而不是抛出的 `Error`。 */
export function refusal(
  code: RefusalCode,
  zh: string,
  en: string,
  instances: readonly string[] = [],
): { readonly refusal: ImageRefusal } {
  return { refusal: { code, zh, en, instances } };
}

/** 映像来源的文档类型；再导出一次，调用方只需 import 本模块。 */
export type SourceGraph = Graph;
