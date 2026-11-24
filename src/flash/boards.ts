/**
 * 本地桥能够烧录的开发板清单，以及导出器在估算时对照的资源预算。
 *
 * 这些数字来自芯片本身，不是随手定的目标。ATmega328P（Uno 与 Nano）有 32 KiB
 * flash，其中约半 KiB 被 bootloader 占用；SRAM 只有 2 KiB，运行时缓冲、调用栈
 * 和电路自身状态的每一个字节都要挤在里面。Mega 2560 则是 256 KiB flash 与 8 KiB
 * SRAM。下面的 `max*` 是**估算值允许声称的上限**，不是芯片顶格容量：真实尺寸由
 * `arduino-cli compile` 编译后回报，面板会把估算与实测两个数字并排显示。
 *
 * FQBN 与本地桥的白名单（`tools/arduino-bridge.mjs`）保持一致。这里是**拷贝**而
 * 不是 import：桥是一个无需构建步骤的独立 Node 脚本，无法 import TypeScript 模块。
 * `test/flash/bridge.test.ts` 在桥那一侧钉住同样的三个值，因此两份清单一旦漂移，
 * 挂掉的是测试而不是一次烧录。
 */
export type BoardId = 'arduino:avr:uno' | 'arduino:avr:nano' | 'arduino:avr:mega';

/** 一种可烧录开发板的静态资料：名称、容量与估算预算。 */
export interface BoardProfile {
  readonly id: BoardId;
  /** 面板与拒绝消息里使用的板卡名称。 */
  readonly name: string;
  /** 板卡选择器里显示的短名称。 */
  readonly short: string;
  /** 芯片物理上拥有的程序存储容量（尚未扣除 bootloader）。 */
  readonly chipFlash: number;
  /** 芯片物理上拥有的 SRAM 容量。 */
  readonly chipRam: number;
  /** 估算可用的 flash 上限：芯片容量减去 bootloader 与余量。 */
  readonly maxFlash: number;
  /** 估算可用的 RAM 上限：芯片 SRAM 减去一块实打实的保留区。 */
  readonly maxRam: number;
}

/**
 * 三种板卡的静态资料表，Uno 排第一。
 *
 * Uno 是默认板卡、测试与文档使用的板卡，也是整个功能最初围绕设计和实测的板卡。
 *
 * 容量数字的来源：Mega 的 253_952 = 256 KiB 减去 8 KiB bootloader；328P 的
 * 32_256 = 32 KiB 减去 0.5 KiB bootloader。`maxFlash`/`maxRam` 再各自留出运行时
 * 与调用栈的余量，所以估算永远比芯片顶格容量保守。
 */
export const BOARDS: readonly BoardProfile[] = [
  {
    id: 'arduino:avr:uno',
    name: 'Arduino Uno',
    short: 'Uno',
    chipFlash: 32_256,
    chipRam: 2_048,
    maxFlash: 30_000,
    maxRam: 1_900,
  },
  {
    id: 'arduino:avr:nano',
    name: 'Arduino Nano',
    short: 'Nano',
    chipFlash: 32_256,
    chipRam: 2_048,
    maxFlash: 30_000,
    maxRam: 1_900,
  },
  {
    id: 'arduino:avr:mega',
    name: 'Arduino Mega 2560',
    short: 'Mega',
    chipFlash: 253_952,
    chipRam: 8_192,
    maxFlash: 250_000,
    maxRam: 7_900,
  },
];

/** 默认板卡：第一版实现与实测所针对的那块板。 */
export const DEFAULT_BOARD: BoardId = 'arduino:avr:uno';

/**
 * 按 FQBN 查一块板卡的资料。
 *
 * 未知 id 属于编程错误，而不是玩家能制造的状态：类型层面调用方只能传 `BoardId`，
 * 因此这里直接抛异常，而不是返回一个拒绝值。
 *
 * @param id 目标板卡的 FQBN。
 * @returns 对应的板卡资料。
 * @throws 当 id 不在 `BOARDS` 中时抛出。
 */
export function boardProfile(id: BoardId): BoardProfile {
  const found = BOARDS.find((board) => board.id === id);
  if (found === undefined) throw new Error(`unknown board: ${id}`);
  return found;
}

/**
 * 面板板卡选择器里的一行。
 *
 * Nano 的旧 bootloader 是同一颗芯片上的单独一行：FQBN 完全相同，真正告诉
 * `arduino-cli` 用哪个 bootloader 波特率的是 `boardOptions`。之所以做成"选择器的
 * 一行"而不是直接让玩家填 argv，是因为玩家是在货架上挑板子；两行背后共用同一份
 * Nano 资料与同一套预算。
 */
export interface BoardChoice {
  /** 选择器的值，也是面板记住的值。 */
  readonly id: string;
  /** 请求本地桥编译时使用的 FQBN。 */
  readonly board: BoardId;
  /** 选择器与预算行显示的名称。 */
  readonly name: string;
  /** `arduino-cli --board-options`，用于同一个 FQBN 的变体。 */
  readonly boardOptions?: string;
}

/** 选择器的全部行：三种默认板卡，外加旧 bootloader 的 Nano。 */
export const BOARD_CHOICES: readonly BoardChoice[] = [
  { id: 'arduino:avr:uno', board: 'arduino:avr:uno', name: 'Arduino Uno' },
  { id: 'arduino:avr:nano', board: 'arduino:avr:nano', name: 'Arduino Nano' },
  {
    id: 'arduino:avr:nano:old',
    board: 'arduino:avr:nano',
    name: 'Arduino Nano（旧 bootloader）',
    boardOptions: 'cpu=atmega328old',
  },
  { id: 'arduino:avr:mega', board: 'arduino:avr:mega', name: 'Arduino Mega 2560' },
];

/** 默认行：第一版实现与实测所针对的 Uno。 */
export const DEFAULT_BOARD_CHOICE = 'arduino:avr:uno';

/**
 * 由选择器 id 得到背后的 FQBN 与编译参数。
 *
 * 未知 id 回落到第一行（Uno）：这个 id 来自 localStorage 里的玩家偏好，
 * 旧版本保存过的值或手改过的值，不应该让烧录功能直接报错。
 *
 * @param id 选择器一行的 id。
 * @returns 对应的选择行；未知 id 返回默认行。
 */
export function boardChoice(id: string): BoardChoice {
  return BOARD_CHOICES.find((choice) => choice.id === id) ?? BOARD_CHOICES[0]!;
}
