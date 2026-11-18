/**
 * 游戏与开发板之间的串口线协议。
 *
 * 每一行都是 ASCII，并且都以 `\n` 结尾；固件忽略 `\r`。它刻意设计成行协议而不是
 * 二进制帧：同样的命令可以直接敲进串口监视器，这让板子在没有游戏时也能调试，
 * 而且一行乱码只毁掉一行，不会让整条流失去同步。
 *
 * 宿主 -> 开发板：
 *
 *   I <connector-index> <value>   设置一个输入连接器（下标按 IN_1、IN_2 的顺序）
 *   T                            施加一个时钟沿，结算，打印一帧
 *   R                            清零存储与输入（tick 也归零），结算，打印一帧
 *   C <hz>                       以 hz 自由运行时钟（0 表示停止）
 *   S                            打印当前帧
 *   B                            再次打印 banner
 *
 * 开发板 -> 宿主：
 *
 *   #TC1 <hash> <nodes> <slotBytes> <inputs> <outputs>
 *   F <tick> <stable> <out0> <out1> ...
 *   E <text>
 *
 * banner 携带映像哈希，游戏因此能判断"板子跑的是另一份电路"，而不必信任端口就
 * 一定是它烧录的那个；帧则把每个输出连接器表示成一个无符号数字。
 */

/** 一块刚启动（或被要求重新打印 banner）的开发板。 */
export interface BoardBanner {
  /** 行类型判别字段。 */
  readonly kind: 'banner';
  /** 映像哈希，与 `imageSignature` 的哈希结果一致。 */
  readonly hash: number;
  /** 计算节点数。 */
  readonly nodes: number;
  /** 槽位数组占用的字节数。 */
  readonly slotBytes: number;
  /** 输入连接器个数。 */
  readonly inputCount: number;
  /** 输出连接器个数。 */
  readonly outputCount: number;
}

/** 开发板的一个已结算状态。 */
export interface BoardFrame {
  /** 行类型判别字段。 */
  readonly kind: 'frame';
  /** 已经过的时钟沿数：T 命令与自由运行的每个时钟沿都会让它加 1。 */
  readonly tick: number;
  /** 最近一次结算是否收敛；Jacobi 模式下反复振荡会返回 false。 */
  readonly stable: boolean;
  /** 每个输出连接器的值，顺序与 `F` 帧各列一致。 */
  readonly outputs: readonly number[];
}

/** 固件拒绝的命令，或它无法解析的一行。 */
export interface BoardError {
  /** 行类型判别字段。 */
  readonly kind: 'error';
  /** 错误文本。 */
  readonly message: string;
}

/** 开发板打印的其他内容（启动消息、将来新增的行）。 */
export interface BoardOther {
  /** 行类型判别字段。 */
  readonly kind: 'other';
  /** 未识别的原始行（已去掉行尾 `\r`）。 */
  readonly text: string;
}

/** 从开发板读到的任意一行。 */
export type BoardLine = BoardBanner | BoardFrame | BoardError | BoardOther;

/** 输出连接器在线上能承载的最大值（`uint32_t` 上限）。 */
export const MAX_WIRE_VALUE = 0xffff_ffff;

/**
 * 解析开发板的一行；空行返回 `null`。
 *
 * 格式不对的 `F`/`#TC1` 行会变成 `other` 而不是抛异常：串口流不是可信信道，
 * 重连后收到半行是正常现象，而一个会抛异常的读取器会因为一个坏字节就丢掉整个
 * 端口。
 *
 * @param raw 原始一行，可能带行尾 `\r`。
 * @returns 解析结果；空行返回 `null`。
 */
export function parseBoardLine(raw: string): BoardLine | null {
  const line = raw.replace(/\r$/, '');
  if (line === '') return null;
  if (line.startsWith('#TC1 ')) {
    // banner：先按空格切分并去掉空串；字段不足或数字解析失败都算"未识别行"。
    const parts = line.slice(5).split(' ').filter((part) => part !== '');
    if (parts.length < 5) return { kind: 'other', text: line };
    const hash = Number.parseInt(parts[0]!, 16);
    const nodes = Number.parseInt(parts[1]!, 10);
    const slotBytes = Number.parseInt(parts[2]!, 10);
    const inputCount = Number.parseInt(parts[3]!, 10);
    const outputCount = Number.parseInt(parts[4]!, 10);
    if (![hash, nodes, slotBytes, inputCount, outputCount].every(Number.isFinite)) {
      return { kind: 'other', text: line };
    }
    return { kind: 'banner', hash, nodes, slotBytes, inputCount, outputCount };
  }
  if (line.startsWith('F ')) {
    // 帧：tick、stable（'1' 表示收敛），之后每个输出一个十进制数。
    const parts = line.slice(2).split(' ').filter((part) => part !== '');
    if (parts.length < 2) return { kind: 'other', text: line };
    const tick = Number.parseInt(parts[0]!, 10);
    const stable = parts[1] === '1';
    const outputs: number[] = [];
    for (const part of parts.slice(2)) {
      const value = Number.parseInt(part, 10);
      if (!Number.isFinite(value)) return { kind: 'other', text: line };
      outputs.push(value);
    }
    if (!Number.isFinite(tick)) return { kind: 'other', text: line };
    return { kind: 'frame', tick, stable, outputs };
  }
  // 固件报错行；`E ` 之后的内容就是消息体。
  if (line.startsWith('E ')) return { kind: 'error', message: line.slice(2) };
  return { kind: 'other', text: line };
}

/** 编码 `I <index> <value>`：驱动一个输入连接器，值按无符号 32 位发送。 */
export function encodeInput(index: number, value: number): string {
  return `I ${index} ${value >>> 0}\n`;
}

/** 编码 `T`：一个时钟沿。 */
export function encodeTick(): string {
  return 'T\n';
}

/** 编码 `R`：清零存储与输入，并把 tick 归零。 */
export function encodeReset(): string {
  return 'R\n';
}

/** 编码 `C <hz>`：自由运行开发板自己的时钟，或停止它。 */
export function encodeClock(hz: number): string {
  return `C ${Math.max(0, Math.floor(hz))}\n`;
}

/** 编码 `S`：打印当前帧。 */
export function encodePoll(): string {
  return 'S\n';
}

/** 取一帧里某个输出连接器的值；该列不存在时返回 `undefined`。 */
export function frameValue(frame: BoardFrame, index: number): number | undefined {
  return frame.outputs[index];
}
