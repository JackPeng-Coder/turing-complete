/**
 * 仿真内核的信号层：位、端口值的两种载体，以及一块固定容量的信号表。
 *
 * 一个端口的每一位都占信号表的一个字节槽（只存 0/1，便于逐位读写）；端口位宽
 * 决定它占多少个连续槽，起始下标叫 base。整个仿真里所有实例的所有引脚共享
 * 同一块表，所以 net.ts 拿到槽下标就能读写信号，不必再按名字查找。
 *
 * 取值有两种载体：位宽不大于 8 时读回 number（低位在前），更宽时读回小端
 * Uint8Array；写入两种都接受，number 最多能承载 32 位（见 assertWidth）。
 * 所有入口都经 assertWidth 校验，保证值不会悄悄溢出端口位宽。
 *
 * 本模块不依赖任何其它模块，是 core 层最底层的基石；net.ts、UI 与导出器都
 * 通过这里的掩码与载体换算共享同一套位语义。
 */

/** 单个逻辑位。用字面量联合类型 0 | 1 而不是 boolean，是为了能直接写进
 *  Uint8Array 槽位，也避免布尔与数字混用时的隐式转换。 */
export type Bit = 0 | 1;

/** 端口值：窄端口用 number（无符号整数），超过 32 位用 Uint8Array
 *  （小端字节序，每字节 8 位）。 */
export type PortValue = number | Uint8Array;

/**
 * 固定容量的信号表：所有实例、所有引脚的位共享一块 Uint8Array。
 *
 * 每个槽只存 0 或 1。alloc(width) 从尾部切出 width 个连续槽并返回起始下标，
 * 之后 setBit/getBit/setPort/getPort 都按"下标 + 位宽"访问，不再保存引脚名。
 * size 是已经分配到的位置（从 0 单调递增），clear() 只清已分配区、不重置 size。
 */
export interface SignalTable {
  readonly slots: Uint8Array;
  readonly size: number;
  alloc(width: number): number;
  setBit(slot: number, bit: Bit): void;
  getBit(slot: number): Bit;
  setPort(base: number, width: number, v: PortValue): void;
  getPort(base: number, width: number): PortValue;
  clear(): void;
}

/**
 * 当 v 中高于 width 的位全为 0（即 v 装得进该端口）时返回 true。
 *
 * 窄位宽分支的上界必须写成 2 ** width，不能写 1 << width：按位左移会把两个
 * 操作数都经 int32 转换，1 << 31 实际是 -2 ** 31，比较式就变成
 * v < -2147483648，对任何非负 v 都为假——于是 assertWidth(v, 31) 会拒绝所有
 * 31 位值，连 0 也拒绝（1..30 位两种写法结果相同，而 32 位从不会走到这里）。
 * 2 ** w 对所有 double 能精确表示的位宽都精确，远超过 MAX_PARAM_WIDTH 允许的
 * 4096，所以任何位宽都不需要特例。
 *
 * width >= 32 的分支保留着，而且并不冗余：32 位时它接受的范围与通式完全一致，
 * 但大于 32 的位宽确实可达（graph.ts 允许 params.width 到 4096，net.ts 会据此
 * 解析引脚），此时这个分支是"number 写入器自身的上限"——setPort 的 number 分支
 * 是 (v >>> i) & 1，最多只能搬运 32 位。因此这里把守卫钉在 number 真正能暂存的
 * 范围上，而不是放进来一个会被写入器悄悄截断的值。超过 32 位由 Uint8Array
 * 承载，assertWidth 会按完整位宽检查它的字节数。
 *
 * 两个分支都拒绝负数，快速路径上的 v >= 0 也和上界一样不能省：setPort 的
 * number 分支会让值经过 ToUint32，若接受 -1，它就会被暂存成 0xffff_ffff——
 * 负数被重新解释成一个全 1 的无符号端口，而不是被拒绝。
 */
function fitsWidth(v: number, width: number): boolean {
  if (width >= 32) return v >= 0 && v <= 0xffff_ffff;
  return v >= 0 && v < 2 ** width;
}

/**
 * 取低 width 位的掩码，返回非负整数。
 *
 * 用 2 ** width - 1，而不是 (1 << width) - 1：左移经 int32 转换，在允许范围
 * 顶端会产生负数掩码——1 << 31 是 -2 ** 31，(1 << 31) - 1 是 -2147483649，
 * 而不是 0x7fff_ffff。这个负数根本不是掩码：x & -2147483649 碰巧等于
 * x & 0x7fff_ffff，但凡是"返回掩码"而不是"用掩码做与运算"的地方
 * （div8 除零、ashr8 的符号位填充）都会把它直接交给端口，于是 assertWidth
 * 拒绝它，runChecks 就把一个正确的电路判成 'invalid'。
 *
 * 2 ** width - 1 对 1..32 的每个位宽都精确（double 精确范围远到 2 ** 32 以上），
 * 所以不需要特例。范围顶端由 MAX_WIDE_WIDTH = 32 和它返回的 number 共同界定：
 * maskOf(32) 是 0xffff_ffff，这是任何调用方需要的最宽掩码；位宽超过 32 属于
 * Uint8Array 路径的事。
 *
 * 它最初是 core/defs/wide.ts 的私有工具，是在发现 31 位端口无法写入之后带着
 * 一大段论证写下的。之所以导出到这里，是因为每一层都需要掩码，而且各写各的：
 * (1 << width) - 1 这种写法曾在另外五个模块里存活，在 31 位时错误、在更高位宽
 * 下毫无意义。只保留一个定义、处处 import，是让这个修复不再退化的唯一办法。
 */
export function maskOf(width: number): number {
  return 2 ** width - 1;
}

/**
 * 取非负 value 的低 width 位，对任意位宽都成立。
 *
 * 这正是掩码通常的用途，但这里刻意不写 value & maskOf(width)：& 会把两个
 * 操作数都经 int32 转换，于是在范围顶端掩码本身先被搞坏（maskOf(32) 是
 * 0xffff_ffff，& 把它读成 -1），而大于等于 2 ** 31 的值也会变负。
 * 取模 % 对 number 能承载的每个位宽都精确。
 */
export function maskInto(value: number, width: number): number {
  return value % 2 ** width;
}

/**
 * 校验一个端口值确实装得进 width 位端口，不合格就抛 RangeError。
 *
 * number 必须是整数、非负，并按位宽检查上界（见 fitsWidth）；Uint8Array 必须
 * 恰好是 Math.ceil(width / 8) 个字节（至少 1 个）。
 *
 * 为什么不静默截断：信号表写入是按位搬运的，一个越界的值会被移位运算悄悄
 * 重新解释（例如 -1 变成全 1 端口、超宽值丢掉高位），错误会以"电路行为不对"
 * 的形式在很远的地方出现。在入口拒绝可以把问题定位到源头。
 */
export function assertWidth(v: PortValue, width: number): void {
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) {
      throw new RangeError(`port value must be an integer, got ${v}`);
    }
    if (!fitsWidth(v, width)) {
      throw new RangeError(`value ${v} does not fit a ${width}-bit port width`);
    }
    return;
  }
  const needed = Math.max(1, Math.ceil(width / 8));
  if (v.length !== needed) {
    throw new RangeError(
      `byte array length ${v.length} does not fit a ${width}-bit port width (expected ${needed})`,
    );
  }
}

/**
 * 固定容量的信号表。
 *
 * 刻意做成不可扩容：重新分配底层的 Uint8Array 会让此前发出去的每个 base 下标
 * 全部失效，也会悄悄破坏 net.ts 在其上建立的 drive 索引数组。"固定缓冲 +
 * 容量守卫"才是诚实的做法——规格给展开后实例的预算是 20,000 个，默认 65,536
 * 个槽绰绰有余。
 *
 * 参数 capacity 是槽的总数（每个槽存 1 位）；分配超限时 alloc 抛 RangeError，
 * 而不是扩容。
 */
export function createSignalTable(capacity = 65_536): SignalTable {
  const slots = new Uint8Array(capacity);
  let size = 0;

  const table: SignalTable = {
    slots,
    get size() {
      return size;
    },
    alloc(width: number): number {
      if (width <= 0) throw new RangeError('port width must be positive');
      if (size + width > capacity) {
        throw new RangeError(
          `signal table is full: need ${size + width} slots, capacity is ${capacity}`,
        );
      }
      const base = size;
      size += width;
      return base;
    },
    setBit(slot: number, bit: Bit): void {
      table.slots[slot] = bit;
    },
    getBit(slot: number): Bit {
      return table.slots[slot] === 1 ? 1 : 0;
    },
    setPort(base: number, width: number, v: PortValue): void {
      assertWidth(v, width);
      if (typeof v === 'number') {
        for (let i = 0; i < width; i += 1) {
          table.slots[base + i] = (v >>> i) & 1;
        }
        return;
      }
      for (let i = 0; i < width; i += 1) {
        const byte = v[i >> 3] ?? 0;
        table.slots[base + i] = (byte >> (i & 7)) & 1;
      }
    },
    getPort(base: number, width: number): PortValue {
      if (width <= 8) {
        let out = 0;
        for (let i = 0; i < width; i += 1) out |= table.slots[base + i]! << i;
        return out;
      }
      // 用 Math.ceil，而不是 width / 8：两者必须与 assertWidth 一致——后者在
      // 入口处按 Math.ceil(width / 8) 个字节验收。这里若向下取整，就会丢掉例如
      // 12 位端口（第 8..11 位）的高半个字节，下游会把这种位宽不一致误诊成电路
      // 振荡（读出 1 字节、写回 2 字节 => changed 永远为真）。
      const bytes = new Uint8Array(Math.ceil(width / 8));
      for (let i = 0; i < width; i += 1) {
        if (table.slots[base + i]) bytes[i >> 3]! |= 1 << (i & 7);
      }
      return bytes;
    },
    clear(): void {
      table.slots.fill(0, 0, size);
    },
  };

  return table;
}

/**
 * 一个端口：在信号表里占 [base, base + width) 这一串槽位。
 *
 * read() 按位宽聚合出 PortValue（width <= 8 返回 number，否则返回小端
 * Uint8Array），write(v) 先经 assertWidth 校验再拆成槽里的单个位。端口本身
 * 不保存值，只是信号表上一个窗口的视图。
 */
export interface Port {
  readonly id: string;
  readonly width: number;
  readonly base: number;
  read(): PortValue;
  write(v: PortValue): void;
}

/**
 * 在信号表里分配 width 个槽并返回一个端口视图。
 *
 * 分配失败（表满或位宽非法）会从 alloc 抛出 RangeError；端口之间不共享槽位，
 * 因此同一块表里各端口的读写互不干扰。
 */
export function createPort(id: string, width: number, table: SignalTable): Port {
  const base = table.alloc(width);
  return {
    id,
    width,
    base,
    read: () => table.getPort(base, width),
    write: (v: PortValue) => table.setPort(base, width, v),
  };
}

/**
 * 比较两个端口值是否完全相同。
 *
 * 两个 number 直接比较；只要有一边是 Uint8Array，就把 number 展开成 4 字节
 * 小端再逐字节比较——所以 number 1 与 Uint8Array[1] 会被判为不相等（长度不同）。
 * 内核结算不用它判断收敛：同一端口的读回载体取决于位宽，用值形态比较会把
 * 健康电路误判成振荡，settle 里因此改用逐位比较（net.ts 的 #holds）。
 */
export function valuesEqual(a: PortValue, b: PortValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  const ab = typeof a === 'number' ? numberToBytes(a) : a;
  const bb = typeof b === 'number' ? numberToBytes(b) : b;
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i += 1) if (ab[i] !== bb[i]) return false;
  return true;
}

function numberToBytes(v: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = v & 0xff;
  out[1] = (v >>> 8) & 0xff;
  out[2] = (v >>> 16) & 0xff;
  out[3] = (v >>> 24) & 0xff;
  return out;
}

/**
 * 把 PortValue 折成一个 number。字节数组按小端读取（低字节在前），
 * 与 setPort 的字节数组分支写入的顺序一致。
 *
 * 超过 32 位会丢精度，这是调用方自己的责任：真正需要那些位宽的场合
 * 会继续用 Uint8Array 保存值。
 */
export function portValueToNumber(v: PortValue): number {
  if (typeof v === 'number') return v;
  let total = 0;
  for (let i = 0; i < v.length; i += 1) total += v[i]! * 2 ** (8 * i);
  return total;
}

/**
 * 把端口值格式化成字符串：radix 为 2 时定宽补零到 width 位，16 进制大写，
 * 10 进制按十进制输出。二进制会丢弃超出位宽的高位（见下面的说明）。
 */
export function formatPort(v: PortValue, width: number, radix: 2 | 10 | 16): string {
  const n = portValueToNumber(v);
  // 二进制输出恰好 width 个字符，因此高于端口位宽的位被丢弃：1 位端口即使
  // 值为 0b101 也显示 '1'。这里用 % 2 ** width 而不是 & ((1 << width) - 1)，
  // 是为了让超过 32 位边界、以字节数组承载的值也能被正确约简。
  if (radix === 2) return (n % 2 ** width).toString(2).padStart(width, '0');
  if (radix === 16) return n.toString(16).toUpperCase();
  return String(n);
}
