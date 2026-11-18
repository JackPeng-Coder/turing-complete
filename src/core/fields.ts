import { maskInto, maskOf, type Bit } from './signal';

/**
 * 位与整数之间的打包/解包工具，以及"字段"（位段）的提取与插入。
 *
 * 约定：位序与 signal.ts 一致，都是"低位在前"——bits[0] 是结果的最低位，
 * offset 也从最低位数起。这里只做纯数值运算，不碰引脚和信号表，认识它的只有
 * 汇编器（拼程序镜像里的指令字段）与核心测试；宽位元件的位切片在 wide.ts 里用
 * 自己的 u / splitOp / makeOp 实现，不走这里。
 *
 * 依赖：只依赖 signal.ts 的掩码工具 maskInto / maskOf，保持依赖单向向下。
 * 不变量：所有返回值都是非负安全整数，绝不会把补码意义的负数带出本模块。
 */

/** 把位数组按低位在前打包成整数：bits[0] 成为结果的第 0 位。 */
export function packBits(bits: readonly Bit[]): number {
  let out = 0;
  for (let i = 0; i < bits.length; i += 1) if (bits[i]) out |= 1 << i;
  return out >>> 0;
}

/**
 * packBits 的逆运算：把整数拆成 count 个低位在前的位。
 * 这里用无符号右移 >>> 逐位取出，所以最高位为 1 时也不会得到负数。
 */
export function unpackBits(value: number, count: number): Bit[] {
  const out: Bit[] = new Array(count);
  for (let i = 0; i < count; i += 1) out[i] = ((value >>> i) & 1) as Bit;
  return out;
}

/**
 * 取出 value 从 offset 位起、宽 width 位的字段（低位在前）。
 *
 * 先右移再用 maskInto 截断；maskInto 用取模而不是按位与，是为了在 32 位
 * 边界上仍保持非负（推导见 signal.ts 中 maskInto 的说明）。
 * width 小于等于 0 属于调用方 bug，抛 RangeError 立即暴露。
 */
export function extractField(value: number, offset: number, width: number): number {
  if (width <= 0) throw new RangeError('field width must be positive');
  return maskInto(value >>> offset, width);
}

/**
 * extractField 的逆操作：把 field 写到 value 的 offset 位处，返回新值。
 *
 * 先用 maskOf(width) 生成掩码把目标位段清零，再或入左移后的字段；
 * 最后 >>> 0 强制成无符号 32 位，避免第 31 位为 1 时整个数变负。
 * field 超出 width 位能表示的范围时抛 RangeError，而不是悄悄截断。
 */
export function insertField(
  value: number,
  offset: number,
  width: number,
  field: number,
): number {
  if (width <= 0) throw new RangeError('field width must be positive');
  const mask = maskOf(width);
  if (field < 0 || field > mask) {
    throw new RangeError(`field ${field} out of range for width ${width}`);
  }
  const cleared = value & ~(mask << offset);
  return (cleared | (field << offset)) >>> 0;
}
