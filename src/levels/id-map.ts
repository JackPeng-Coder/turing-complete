/**
 * 1.x 版关卡 id 与它们现在的新名字之间的对照表。
 *
 * 2026-10-04 的版本对齐把第 1~3 章的每一关都移到了它在 2.x 中的位置
 * （见 `src/levels/campaign.ts`），这改掉了其中 44 关的 id：id 里带着
 * 关卡的全局序号，所以给一关重新编号，就会连带改掉它后面所有关卡的编号。
 *
 * 存档是按这些 id 记录的（`persist/storage.ts`），因此 `migrate` 会读这张
 * 表，把玩家的通关星星带过这次改名。它是一张翻译表，不是关卡列表：已经
 * 是新 id 的、或者这张表从没听说过的 id，都会原样通过——这正是迁移可以
 * 反复执行（幂等）的原因。
 *
 * `RETIRED_LEVEL_IDS` 里的三个 id 是同一个故事的另一半：2.x 里没有对应的
 * 关卡，所以提到它们的旧存档会丢掉那一条记录。
 */
export const LEGACY_LEVEL_IDS: Readonly<Record<string, string>> = {
  'ch1-01-crude-awakening': 'ch1-01-humble-beginnings',
  'ch1-06-nor-gate': 'ch1-05-nor-gate',
  'ch1-05-or-gate': 'ch1-06-or-gate',
  'ch1-08-second-tick': 'ch1-08-second-cycle',
  'ch1-12-binary-racer': 'ch2-14-binary-racer',
  'ch2-14-double-trouble': 'ch2-15-double-detection',
  'ch2-13-odd-number-of-signals': 'ch2-16-odd-number-of-signals',
  'ch2-28-circular-dependency': 'ch2-17-circular-dependency',
  'ch2-16-counting-signals': 'ch2-18-counting-signals',
  'ch2-20-half-adder': 'ch2-19-half-adder',
  'ch2-29-delayed-lines': 'ch2-20-delayed-lines',
  'ch2-17-double-the-number': 'ch2-21-double-the-number',
  'ch2-21-full-adder': 'ch2-22-full-adder',
  'ch2-30-odd-ticks': 'ch2-23-odd-cycles',
  'ch2-32-bit-switch': 'ch2-24-bit-switch',
  'ch2-19-byte-not': 'ch2-26-byte-not',
  'ch2-22-adding-bytes': 'ch2-27-adding-bytes',
  'ch2-31-bit-inverter': 'ch2-28-bit-inverter',
  'ch2-23-negative-numbers': 'ch2-29-negative-numbers',
  'ch2-33-input-selector': 'ch2-30-multiplexer',
  'ch2-24-signed-negator': 'ch2-31-signed-negator',
  'ch2-34-the-bus': 'ch2-32-the-bus',
  'ch2-35-saving-gracefully': 'ch2-33-saving-gracefully',
  'ch2-36-saving-bytes': 'ch2-34-saving-bytes',
  'ch2-25-1-bit-decoder': 'ch2-35-1-bit-decoder',
  'ch2-26-3-bit-decoder': 'ch2-37-3-bit-decoder',
  'ch2-37-little-box': 'ch2-38-little-box',
  'ch2-38-counter': 'ch2-39-counter',
  'ch3-39-arithmetic-engine': 'ch3-40-alu-1',
  'ch3-40-registers': 'ch3-41-registers',
  'ch3-41-component-factory': 'ch3-43-the-foundry',
  'ch3-42-instruction-decoder': 'ch3-44-instruction-decoder',
  'ch3-44-conditions': 'ch3-45-conditions',
  'ch3-43-calculations': 'ch3-46-alu',
  'ch3-46-immediate-values': 'ch3-47-immediate-values',
  'ch3-45-program': 'ch3-48-program',
  'ch3-47-turing-complete': 'ch3-49-turing-complete',
};

/**
 * 已经没有关卡与之对应的旧 id。
 *
 * 第 2 章在向 2.x 对齐时少了三个 1.x 关卡：`Byte OR`（2.x 在这一带换成
 * 了 `Byte NAND`）、`Logic Engine`（2.x 把它删了），以及那个被误命名为
 * `Binary Racer` 的计数关（它和 `Counting Signals` 重复；2.x 只留一个
 * Binary Racer，指的是四位数读取的那一关）。
 */
export const RETIRED_LEVEL_IDS: readonly string[] = [
  'ch2-15-binary-racer',
  'ch2-18-byte-or',
  'ch2-27-logic-engine',
];

/**
 * 把存档里的旧 id 翻译成当前 id；若已经没有关卡使用它，返回 null。
 *
 * 迁移是幂等的：新 id 与未知 id 都原样返回，所以对同一份存档连续迁移
 * 两次，结果和一次相同。
 */
export function currentIdOf(id: string): string | null {
  const mapped = LEGACY_LEVEL_IDS[id];
  if (mapped !== undefined) return mapped;
  return RETIRED_LEVEL_IDS.includes(id) ? null : id;
}
