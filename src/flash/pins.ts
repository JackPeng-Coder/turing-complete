import type { BoardId } from './boards';

/**
 * 游戏可以把沙盒连接器映射到哪些物理引脚。
 *
 * 映射是**开发板**的属性而不是电路的属性：同一份电路可以跑在 Uno 上把输出接
 * D13，也可以跑在 Mega 上接 D40，所以分配由面板记住（localStorage 键
 * `tc.flash.v1`），而不是写进图里。但它确实是程序映像的一部分——固件行为会因此
 * 不同——这就是 `imageSignature` 把它算进哈希、banner 仍能回答"板子跑的是不是
 * 屏幕上的电路"的原因。
 *
 * 第一版里**只有 1 位连接器能占一个引脚**。多位连接器要么一位一根引脚、要么走
 * 总线协议，两种都是面板不应该替玩家猜的契约；宽连接器继续走串口，协议本来就把它
 * 作为一个数字传输。
 *
 * D0/D1 **不在可选列表中**：它们是游戏自己通信用的 USB 串口线。Nano 的 A6/A7 也
 * 不可选——在 ATmega328P 上它们只能做模拟输入，无法驱动，也无法开启内部上拉。
 */

/** 玩家看到的引脚名：`2`…`13`、`A0`…，与 Arduino 核的定义一致。 */
export type PinId = string;

/** 连接器实例 id（`IN_1`、`OUT_1`）到它使用的板卡引脚。 */
export type PinMap = Readonly<Record<string, PinId>>;

/** Uno 与 Nano：同一份 ATmega328P 引脚表，去掉 D0/D1 与 A6/A7。 */
const UNO_PINS: readonly PinId[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
];

/** Mega 2560：在 Uno 的基础上增加额外排针，全部可用作数字口。 */
const MEGA_PINS: readonly PinId[] = [
  ...UNO_PINS,
  ...Array.from({ length: 32 }, (_, index) => String(22 + index)),
  ...Array.from({ length: 10 }, (_, index) => `A${6 + index}`),
];

/**
 * 某块板卡在面板里可选的引脚，按排针顺序。
 *
 * @param board 目标板卡。
 * @returns 该板卡可用的引脚名列表（只读）。
 */
export function boardPinChoices(board: BoardId): readonly PinId[] {
  return board === 'arduino:avr:mega' ? MEGA_PINS : UNO_PINS;
}

/** 这块板卡上是否存在这个引脚。 */
export function boardHasPin(board: BoardId, pin: PinId): boolean {
  return boardPinChoices(board).includes(pin);
}

/**
 * 引脚编号，也就是草图实际写出的那个数字。
 *
 * Arduino 核把 `A0` 定义成 328P 上的 14、Mega 2560 上的 54，所以最终交给
 * `digitalWrite` 的正是一个数字字面量——但这个数字取决于板卡。`buildImage`
 * 只在这里解析一次（映像携带它要写出的编号），草图因此不需要 `A*` 常量，
 * 宿主侧的 shim 也不必自己发明它们。
 *
 * 例：`A0` 在 Uno 上是 14 + 0 = 14，在 Mega 上是 54 + 0 = 54；引脚名 `7`
 * 则直接就是数字 7。
 *
 * @param board 目标板卡。
 * @param pin 引脚名：`A0`…`A15`，或数字字符串。
 * @returns AVR 核使用的引脚编号。
 */
export function pinValue(board: BoardId, pin: PinId): number {
  const analog = /^A(\d{1,2})$/.exec(pin);
  if (analog !== null) return board === 'arduino:avr:mega' ? 54 + Number(analog[1]) : 14 + Number(analog[1]);
  return Number(pin);
}

/** 一个沙盒连接器，校验器看到的样子。 */
export interface PinConnector {
  /** 连接器实例 id。 */
  readonly id: string;
  /** 连接器位宽（位数）。 */
  readonly width: number;
}

/** 引脚问题的分类。 */
export type PinIssueCode = 'unsupported-pin' | 'duplicate-pin' | 'wide-connector';

/** 一条分配为什么不可用，附带拼出消息所需的全部字段。 */
export interface PinIssue {
  /** 问题分类。 */
  readonly code: PinIssueCode;
  /** 出问题的连接器 id。 */
  readonly connector: string;
  /** 涉及的引脚；`wide-connector` 时不存在。 */
  readonly pin?: PinId;
  /** `duplicate-pin` 时，先占用该引脚的连接器。 */
  readonly other?: string;
}

/**
 * 一份映射里的全部问题，按连接器顺序排列。
 *
 * 电路里已不存在的连接器的键会被忽略而不是报错：面板会跨编辑和换板记住分配，
 * 一个被删掉的连接器不能让剩下的电路变得无法构建。
 *
 * @param board 目标板卡，决定哪些引脚存在。
 * @param connectors 当前电路里的连接器。
 * @param map 连接器 id 到引脚名的映射。
 * @returns 按连接器顺序排列的问题列表；空数组表示这份映射可用。
 */
export function validatePinMap(
  board: BoardId,
  connectors: readonly PinConnector[],
  map: PinMap,
): readonly PinIssue[] {
  const allowed = new Set(boardPinChoices(board));
  // holders 记录"这个引脚目前被哪个连接器占用"；按连接器顺序扫描，先到先得，
  // 后到的重复分配会被报出来。
  const holders = new Map<PinId, string>();
  const issues: PinIssue[] = [];
  for (const connector of connectors) {
    const pin = map[connector.id];
    if (pin === undefined) continue;
    if (connector.width !== 1) {
      issues.push({ code: 'wide-connector', connector: connector.id });
      continue;
    }
    if (!allowed.has(pin)) {
      issues.push({ code: 'unsupported-pin', connector: connector.id, pin });
      continue;
    }
    const other = holders.get(pin);
    if (other !== undefined) {
      issues.push({ code: 'duplicate-pin', connector: connector.id, pin, other });
      continue;
    }
    holders.set(pin, connector.id);
  }
  return issues;
}
