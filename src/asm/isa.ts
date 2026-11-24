/**
 * AXIS 的指令编码，以数据的形式存在——仅此而已。
 *
 * `instr_decoder`——同样由玩家搭建——是本模块的镜像：它把这些位原样切回去。
 * `assemble.ts` 是本模块唯一的读取者。
 */

/** 指令字中的一个具名位段。`offset` 是它的最低位下标（从 0 数起）。 */
export interface FieldRange {
  /**
   * 位段名。当玩家的 `instr_decoder` 暴露同一个位段时，这里用的是译码器自己的
   * 引脚名（`mode`、`op`、`src`、`dst`、`imm`），于是关卡作者读到一字节就能一步
   * 对应到引脚；`cond` 与 `reserved` 则是没有单独引脚承载的位段名。
   */
  readonly id: string;
  /** 该位段最低位在指令字中的下标。 */
  readonly offset: number;
  /** 该位段的宽度，单位是位。 */
  readonly width: number;
}

/** 四种模式：立即数、运算、传送、跳转。 */
export type ModeId = 'immediate' | 'calc' | 'move' | 'jump';

/** 写出的操作数 token 如何变成一个字段值。 */
export type OperandKind =
  /** 数字或标号：值就是源里写的那个数。 */
  | 'immediate'
  /** 在 `OperandDef.codes` 里查表的 token（`s1`、`inp`、`out` 等）。 */
  | 'code';

export interface OperandDef {
  /** 该操作数填充的位段；必须指向同一模式里存在的 `FieldRange`。 */
  readonly field: string;
  readonly kind: OperandKind;
  /**
   * `kind: 'code'` 时接受的 token，以及每个 token 写入的编码。
   *
   * `immediate` 没有这张表：立即数的值就是源里写的数字或标号——每个 6 位值都
   * 合法，列一张 64 项的表只会变成"0 到 63"的第二种说法。
   */
  readonly codes?: Readonly<Record<string, number>>;
}

export interface ModeDef {
  readonly id: ModeId;
  /** 该模式的选择子值，会写进 `Isa.modeField`。 */
  readonly opcode: number;
  /**
   * 低六位的全部位段；模式有未用位时连 `reserved` 一起列出。它们恰好平铺
   * `[0, 6)`——没有空隙、没有重叠——正是这种平铺固定了字段顺序；
   * 有一条范围测试会断言它。
   */
  readonly fields: readonly FieldRange[];
  /**
   * 助记符 -> 写入 `selectField` 的值；当模式没有选择子、助记符本身就直接
   * 命名该模式时（`loadi`、`move`）为 `null`。
   *
   * 用 `null` 而不是哨兵数字，因为 0 是真实的选择子值——`add` 与 `j` 都用它。
   * 若用数字哨兵，就只能同时再查 `selectField` 才能区分"没有选择子"与
   * "选择子 0"；两个字段表达同一件事，正是 `move` 悄悄变成 `add` 的由来。
   */
  readonly mnemonics: Readonly<Record<string, number | null>>;
  /** 助记符的值写入哪个字段；上面那种直接命名的模式没有该字段。 */
  readonly selectField?: string;
  /** 操作数槽位，顺序就是源中书写的顺序。 */
  readonly operands: readonly OperandDef[];
}

export interface Isa {
  readonly id: string;
  /** 指令位宽：一个 8 位字。 */
  readonly wordWidth: number;
  /** 所有模式共用的选择子：指令字的 [7:6] 位。 */
  readonly modeField: FieldRange;
  readonly modes: readonly ModeDef[];
}

/**
 * 3 位操作数编码各自指向什么，下标就是编码值。
 */
export const OPERAND_NAMES = [
  'REG0',
  'REG1',
  'REG2',
  'REG3',
  'REG4',
  'REG5',
  'inp',
  'out',
] as const;

/**
 * `move` 模式"源"字段接受的 token，以及每个 token 写入的编码。
 */
export const SOURCE_CODES: Readonly<Record<string, number>> = {
  s0: 0,
  s1: 1,
  s2: 2,
  s3: 3,
  s4: 4,
  s5: 5,
  inp: 6,
};

/**
 * `move` 模式"目标"字段接受的 token：`dN` 对应 REG0-REG5，`out` 对应输出端口
 * （`move|s0|d2`、`move|s3|out`）。`inp` 不是目标、`out` 不是源；
 * 见 `SOURCE_CODES`。
 */
export const DEST_CODES: Readonly<Record<string, number>> = {
  d0: 0,
  d1: 1,
  d2: 2,
  d3: 3,
  d4: 4,
  d5: 5,
  out: 7,
};

/**
 * 编码规则。
 *
 * 编码器先写 `modeField`，再写模式的选择字段（若有），再写各操作数字段，除此之外
 * 什么都不写：其余所有位段——尤其是 `calc` 与 `jump` 的 `reserved`——按构造保持为
 * 0。这正是该规则中「[2:0] 保留必须为 0」的含义；这里刻意不设 `mustBeZero` 之类
 * 的标志去同步，因为标志可以和一个未写入的字段相矛盾，而未写入的字段不会自相
 * 矛盾。
 */
export const AXIS_ISA: Isa = {
  id: 'axis',
  wordWidth: 8,
  modeField: { id: 'mode', offset: 6, width: 2 },
  modes: [
    {
      // 00 iiiiii：低六位就是立即数值本身（0-63）。
      id: 'immediate',
      opcode: 0b00,
      fields: [{ id: 'imm', offset: 0, width: 6 }],
      mnemonics: { loadi: null },
      operands: [{ field: 'imm', kind: 'immediate' }],
    },
    {
      // 01 ooo 000：运算码在 [5:3]，[2:0] 为保留的 0。
      id: 'calc',
      opcode: 0b01,
      fields: [
        { id: 'op', offset: 3, width: 3 },
        { id: 'reserved', offset: 0, width: 3 },
      ],
      selectField: 'op',
      mnemonics: { add: 0, sub: 1, and: 2, or: 3, nand: 4, nor: 5 },
      operands: [],
    },
    {
      // 10 sss ddd：源在 [5:3]，目标在 [2:0]。
      id: 'move',
      opcode: 0b10,
      fields: [
        { id: 'src', offset: 3, width: 3 },
        { id: 'dst', offset: 0, width: 3 },
      ],
      mnemonics: { move: null },
      operands: [
        { field: 'src', kind: 'code', codes: SOURCE_CODES },
        { field: 'dst', kind: 'code', codes: DEST_CODES },
      ],
    },
    {
      // 11 ccc 000：条件在 [5:3]，[2:0] 为保留的 0。
      id: 'jump',
      opcode: 0b11,
      fields: [
        { id: 'cond', offset: 3, width: 3 },
        { id: 'reserved', offset: 0, width: 3 },
      ],
      selectField: 'cond',
      mnemonics: { j: 0, jz: 1, jnz: 2 },
      operands: [],
    },
  ],
};
