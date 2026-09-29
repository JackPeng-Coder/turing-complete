/**
 * OVERTURE's instruction ENCODING, as data -- and nothing else.
 *
 * The layout is ruling 5 of
 * `docs/superpowers/plans/2026-09-29-turing-complete-phase2.md`: the top two
 * bits select one of four modes and the low six bits are that mode's argument.
 * The source material fixes "top 2 bits opcode, low 6 bits argument" and the
 * four modes (`GAME_REFERENCE.md` §6.1, §6.3) but NOT the field order inside
 * the low six bits. That order is this replica's design, and this file is its
 * single authority -- the assembler, the `instr_decoder` component and every
 * chapter-3 level's hand-written bytes are all read against it.
 *
 * WHAT IS DELIBERATELY ABSENT: any statement of what an instruction DOES. That
 * `loadi` writes REG0, that `add` reads REG1/REG2 and writes REG3, that a jump
 * takes its target from REG0 and its condition from REG3 -- none of it is here.
 * The CPU is a circuit the player builds (spec §6.1, phase-2 constraint 11), so
 * an instruction's meaning must come from that circuit. A copy in the toolchain
 * would be a second source of truth for behaviour, and the day the two
 * disagreed, a level author would have a table telling them the circuit was
 * wrong. The register numbers below are operand CODES, not roles.
 *
 * `instr_decoder` -- also the player's to build -- is the mirror image of this
 * module: it slices the same bits back out. `assemble.ts` is the only reader.
 */

/** A named slice of the instruction word. `offset` is its lowest bit index. */
export interface FieldRange {
  /**
   * Field name. Where the player's `instr_decoder` exposes the same slice this
   * is the decoder's own pin name (`mode`, `op`, `src`, `dst`, `imm`), so a
   * level author reading a byte maps it in one step; `cond` and `reserved` name
   * slices no pin carries on its own.
   */
  readonly id: string;
  /** Index of the field's lowest bit within the word. */
  readonly offset: number;
  readonly width: number;
}

/** The four modes, named by the toolchain (the source calls them 立即数 etc.). */
export type ModeId = 'immediate' | 'calc' | 'move' | 'jump';

/** How a written operand token becomes a field value. */
export type OperandKind =
  /** A number or a label: the value is what the source wrote. */
  | 'immediate'
  /** A token looked up in `OperandDef.codes` (`s1`, `inp`, `out`, ...). */
  | 'code';

export interface OperandDef {
  /** The slice this operand fills; must name a `FieldRange` of the same mode. */
  readonly field: string;
  readonly kind: OperandKind;
  /**
   * Accepted tokens and the code each writes, for `kind: 'code'`.
   *
   * Absent for `immediate`, whose value is the number or label the source wrote
   * -- an `immediate` operand has no token table because every 6-bit value is
   * legal, and a table of 64 entries would be a second way to say "0 to 63".
   */
  readonly codes?: Readonly<Record<string, number>>;
}

export interface ModeDef {
  readonly id: ModeId;
  /** This mode's selector value, written into `Isa.modeField`. */
  readonly opcode: number;
  /**
   * Every slice of the low six bits, `reserved` included where the mode has
   * unused bits. They tile `[0, 6)` exactly -- no gap, no overlap -- and that
   * tiling is what pins ruling 5's field order; a range test asserts it.
   */
  readonly fields: readonly FieldRange[];
  /**
   * Mnemonic -> the value written into `selectField`, or `null` when the mode
   * has no selector and its mnemonic names the mode outright (`loadi`, `move`).
   *
   * `null` rather than a sentinel number, because 0 is a real selector value --
   * `add` and `j` both use it. With a number sentinel there would be no way to
   * tell "no selector" from "selector 0" except by also testing `selectField`,
   * and two fields saying one thing is how a `move` silently becomes `add`.
   */
  readonly mnemonics: Readonly<Record<string, number | null>>;
  /** The field a mnemonic's value goes into; absent for the modes above. */
  readonly selectField?: string;
  /** Operand slots, in the order the source writes them. */
  readonly operands: readonly OperandDef[];
}

export interface Isa {
  readonly id: string;
  /** Instruction width in bits: one 8-bit word, per the source material §6.1. */
  readonly wordWidth: number;
  /** The selector every mode shares: word bits [7:6]. */
  readonly modeField: FieldRange;
  readonly modes: readonly ModeDef[];
}

/**
 * What a 3-bit operand code addresses, index = the code.
 *
 * `0-5` are REG0-REG5, `6` is `inp` and `7` is `out` (`GAME_REFERENCE.md` §6.2).
 * This is the naming authority the two token tables below and the decoder's
 * `src`/`dst` pins are read against; it is not itself a token table, because a
 * register is spelled `sN` in the source field and `dN` in the destination one.
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
 * Tokens accepted in the `move` mode's SOURCE field, and the code each writes.
 *
 * The source material's grammar spells a source `sN`/`inp` (`move|s1|d2`,
 * `move|inp|d1`, §6.4 and §10.2). One shared map of all eight codes, valid in
 * both fields, was rejected: it would accept `move|out|d3` and `move|s1|inp`,
 * spellings the grammar never shows, and both fields are three bits wide either
 * way -- so nothing is gained by admitting them but a byte nobody reviewed.
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
 * Tokens accepted in the `move` mode's DESTINATION field: `dN` for REG0-REG5
 * and `out` for the output port (`move|s0|d2`, `move|s3|out`, §6.2/§10.2).
 * `inp` is not a destination and `out` is not a source; see `SOURCE_CODES`.
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
 * Ruling 5, transcribed.
 *
 * The encoder writes `modeField`, then the mode's `selectField` when it has one,
 * then the operand fields, and nothing else: every other slice -- notably the
 * `reserved` field of `calc` and `jump` -- is left 0 by construction. That is
 * what ruling 5's 「[2:0] 保留必须为 0」 means, and there is deliberately no
 * `mustBeZero` flag to keep in sync with it, because a flag and an unwritten
 * field can disagree while an unwritten field cannot.
 */
export const OVERTURE_ISA: Isa = {
  id: 'overture',
  wordWidth: 8,
  modeField: { id: 'mode', offset: 6, width: 2 },
  modes: [
    {
      // 00 iiiiii: the low six bits ARE the immediate value (0-63).
      id: 'immediate',
      opcode: 0b00,
      fields: [{ id: 'imm', offset: 0, width: 6 }],
      mnemonics: { loadi: null },
      operands: [{ field: 'imm', kind: 'immediate' }],
    },
    {
      // 01 ooo 000: operation in [5:3], reserved zeros in [2:0].
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
      // 10 sss ddd: source in [5:3], destination in [2:0].
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
      // 11 ccc 000: condition in [5:3], reserved zeros in [2:0].
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
