import type { BoardId } from './boards';

/**
 * 游戏可以把沙盒连接器映射到哪些物理引脚。
 *
 * 映射是**开发板**的属性而不是电路的属性：同一份电路可以跑在 Uno 上把输出接
 * D13，也可以跑在 Mega 上接 D40，所以分配由面板记住（localStorage 键
 * `tc.flash.v1`），而不是写进图里。但它确实是程序映像的一部分——固件行为会因此
 * 不同——所以 `imageSignature` 把它算进哈希。
 *
 * 第一版里**只有 1 位连接器能占一个引脚**。多位连接器要么一位一根引脚、要么走
 * 总线协议，两种都是面板不应该替玩家猜的契约；独立模式没有串口通道，因此宽连接器
 * 在构建映像时会被直接拒绝。
 *
 * 独立模式不再占用 D0/D1：它们和其余数字脚一样可选。328P 的 A6/A7 仍不可选——
 * 它们只能做模拟输入，无法驱动，也无法开启内部上拉。
 */

/** 玩家看到的引脚名：`2`…`13`、`A0`…，与 Arduino 核的定义一致。 */
export type PinId = string;

/** 连接器实例 id（`IN_1`、`OUT_1`）到它使用的板卡引脚。 */
export type PinMap = Readonly<Record<string, PinId>>;

/** Uno 与 Nano：同一份 ATmega328P 引脚表，D0–D13 加 A0–A5。 */
const UNO_PINS: readonly PinId[] = [
  ...Array.from({ length: 14 }, (_, index) => String(index)),
  ...Array.from({ length: 6 }, (_, index) => `A${index}`),
];

/** Mega 2560：全部 D0–D53 与 A0–A15，均可作数字口。 */
const MEGA_PINS: readonly PinId[] = [
  ...Array.from({ length: 54 }, (_, index) => String(index)),
  ...Array.from({ length: 16 }, (_, index) => `A${index}`),
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
