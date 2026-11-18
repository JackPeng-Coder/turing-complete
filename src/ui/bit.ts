/**
 * 比特指示格：一个方块，一个含义。
 *
 * 原作用一个形状而不是数字来标记比特：红色、尖角朝左是 0；绿色、尖角朝右是 1；
 * 尚未被驱动时是橄榄灰。形状与颜色一起携带数值，所以即使分不清红绿，两种状态也能区分。
 *
 * 之所以共享：底部测试面板与侧栏的输入读数绘制的是同一种格子，
 * 第二份「从字节里取比特」的实现，就等于对「哪一端是 bit 0」给出第二种说法。
 */

/** 一个格子的状态：已知的比特，或未知时的 'x'。 */
export type Bit = 0 | 1 | 'x';

/**
 * 取 `value` 的第 `index` 位，按最高位在前的顺序计数。
 *
 * `>>>` 会先把操作数转成 int32，所以第 30 位之后的位（引脚宽度超过语言移位范围时）
 * 改用除以 2 的幂来取，而不是被静默回绕。
 */
export function bitOf(value: number, width: number, index: number): number {
  const shift = width - 1 - index;
  if (shift > 30) return Math.floor(value / 2 ** shift) % 2;
  return (value >>> shift) & 1;
}

/** 取出 `value` 在 `width` 位宽下的每一位，最高位在前。 */
export function bitsOf(value: number, width: number): Bit[] {
  const bits: Bit[] = [];
  for (let i = 0; i < width; i += 1) bits.push(bitOf(value, width, i) as Bit);
  return bits;
}

/** 一个比特格。`label` 是指针悬停时显示的提示，不是格子里的文本。 */
export function bitElement(bit: Bit, label?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `bit bit-${bit}`;
  if (label) span.title = label;
  return span;
}
