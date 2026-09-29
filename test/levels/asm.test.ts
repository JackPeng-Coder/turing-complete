import { describe, expect, it } from 'vitest';
import {
  DEST_CODES,
  OPERAND_NAMES,
  OVERTURE_ISA,
  SOURCE_CODES,
  assemble,
} from '../../src/asm/index';
import type { Isa } from '../../src/asm/index';

/**
 * The assembler kernel: OVERTURE assembly text -> instruction bytes, and the
 * ISA table it is read against.
 *
 * WHY EVERY BYTE BELOW IS A LITERAL. A round-trip test that encoded with
 * `assemble` and decoded with a helper of its own would pass with a WRONG
 * layout, as long as both halves were wrong the same way -- and the layout in
 * this phase is this replica's own design (plan ruling 5), so there is no
 * upstream byte to compare against. Each expectation here is therefore written
 * as the hand-computed word: mode bits [7:6], then the mode's fields, with the
 * bit layout in the comment above it. The ISA structure tests at the end pin
 * the table itself, so a byte test and the table cannot drift apart silently.
 */

/** Assembles with no errors allowed, so a byte test can never pass on a failure. */
function bytesFor(source: string): number[] {
  const result = assemble(source, OVERTURE_ISA);
  expect(result.errors).toEqual([]);
  return result.bytes;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

// ---------------------------------------------------------------------------
// One instruction at a time
// ---------------------------------------------------------------------------

describe('assemble / the instruction set, byte by byte', () => {
  it('encodes loadi as mode 00 with the value in the low six bits', () => {
    // 00 000101
    expect(bytesFor('loadi|5')).toEqual([0x05]);
    // The top of the field, and the reason a bigger number is an error.
    expect(bytesFor('loadi|63')).toEqual([0x3f]);
    expect(bytesFor('loadi|0')).toEqual([0x00]);
  });

  it('encodes all six calc operations as mode 01, with the low three bits zero', () => {
    // 01 ooo 000 -- the reserved field is never written, so it is 0.
    expect(bytesFor('add')).toEqual([0x40]); //  01 000 000
    expect(bytesFor('sub')).toEqual([0x48]); //  01 001 000
    expect(bytesFor('and')).toEqual([0x50]); //  01 010 000
    expect(bytesFor('or')).toEqual([0x58]); //   01 011 000
    expect(bytesFor('nand')).toEqual([0x60]); // 01 100 000
    expect(bytesFor('nor')).toEqual([0x68]); //  01 101 000
  });

  it('encodes move as mode 10, source in [5:3] and destination in [2:0]', () => {
    // 10 sss ddd
    expect(bytesFor('move|s0|d2')).toEqual([0x82]); //  10 000 010
    expect(bytesFor('move|s3|d1')).toEqual([0x99]); //  10 011 001
    // `inp` is code 6 on the source side and `out` is code 7 on the
    // destination side (source material §6.2), so both directions through the
    // I/O ports encode:
    expect(bytesFor('move|inp|d1')).toEqual([0xb1]); // 10 110 001
    expect(bytesFor('move|s3|out')).toEqual([0x9f]); // 10 011 111
    expect(bytesFor('move|inp|out')).toEqual([0xb7]); // 10 110 111
  });

  it('encodes j, jz and jnz as mode 11 condition 000/001/010', () => {
    // 11 ccc 000 -- the target is not a field, so a jump is one bare opcode.
    expect(bytesFor('j')).toEqual([0xc0]); //   11 000 000
    expect(bytesFor('jz')).toEqual([0xc8]); //  11 001 000
    expect(bytesFor('jnz')).toEqual([0xd0]); // 11 010 000
  });
});

// ---------------------------------------------------------------------------
// Whole programs: labels, comments and layout
// ---------------------------------------------------------------------------

describe('assemble / programs', () => {
  it('assembles the source material’s countdown loop byte for byte', () => {
    // GAME_REFERENCE.md §10.3, which is also the shape chapter 3's levels use:
    // an immediate, a copy into the accumulator, then a label and a jump back.
    const source = [
      'loadi|1',
      'move|s0|d2',
      'label loop',
      'add',
      'move|s3|d1',
      'loadi|loop',
      'jnz',
    ].join('\n');
    expect(assemble(source, OVERTURE_ISA)).toEqual({
      bytes: [0x01, 0x82, 0x40, 0x99, 0x02, 0xd0],
      labels: { loop: 2 },
      errors: [],
    });
  });

  it('resolves a label defined after the line that refers to it', () => {
    // A forward reference is ordinary assembly (a jump over a branch); the
    // assembler scans the whole file before it encodes anything, so the address
    // is known by the time the immediate is written.
    const source = ['loadi|stop', 'j', 'label stop'].join('\n');
    expect(assemble(source, OVERTURE_ISA)).toEqual({
      bytes: [0x02, 0xc0],
      labels: { stop: 2 },
      errors: [],
    });
  });

  it('strips comments, skips blank lines and trims the fields', () => {
    const source = ['# what this program does', 'loadi|5   # five', '', '  move | s0 | d2  '].join(
      '\n',
    );
    expect(assemble(source, OVERTURE_ISA)).toEqual({
      bytes: [0x05, 0x82],
      labels: {},
      errors: [],
    });
  });

  it('counts lines from 1 with comments and blank lines included', () => {
    // The line number is a file coordinate: it must count the lines a reader
    // sees, not the instructions the assembler kept.
    const source = ['# comment', '', 'loadi|5', 'nope'].join('\n');
    const { errors } = assemble(source, OVERTURE_ISA);
    expect(errors.map((error) => error.line)).toEqual([4]);
    expect(errors[0]?.text).toBe('nope');
  });

  it('treats CRLF as one line break and keeps the CR out of the text', () => {
    // A program authored on Windows must not fail on a character the player
    // cannot see -- nor carry it into the reported source line.
    const { bytes, errors } = assemble('loadi|5\r\nnope\r\n', OVERTURE_ISA);
    expect(bytes).toEqual([0x05]);
    expect(errors.map((error) => error.line)).toEqual([2]);
    expect(errors[0]?.text).toBe('nope');
  });

  it('treats | as the only field separator, never whitespace', () => {
    // The source material's "指令字节间用空格分隔" describes the byte listing the
    // game shows, not the source text: one line is one instruction, so a
    // space-separated pair is one malformed loadi rather than two instructions.
    const { bytes, errors } = assemble('loadi|5 loadi|6', OVERTURE_ISA);
    expect(bytes).toEqual([]);
    expect(errors[0]?.reason).toBe('"loadi" takes 1 operand, got 2');
  });

  it('assembles an empty program to an empty image, not to an error', () => {
    // "a program must exist" is the level checker's `missing-program` failure
    // (the `missing-rows` lesson). The compiler's answer to zero instructions
    // is zero bytes with nothing wrong with them.
    expect(assemble('', OVERTURE_ISA)).toEqual({ bytes: [], labels: {}, errors: [] });
    expect(assemble('# only a comment\n\n', OVERTURE_ISA)).toEqual({
      bytes: [],
      labels: {},
      errors: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Errors: returned, located, readable
// ---------------------------------------------------------------------------

describe('assemble / errors', () => {
  it('reports an unknown mnemonic at its line, with the line as written', () => {
    const source = ['# a program', '', 'loadi|5', 'adc   # not an OVERTURE mnemonic'].join('\n');
    const { bytes, errors } = assemble(source, OVERTURE_ISA);
    expect(bytes).toEqual([0x05]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(4);
    expect(errors[0]?.text).toBe('adc   # not an OVERTURE mnemonic');
    expect(errors[0]?.reason).toMatch(/unknown mnemonic "adc"/);
  });

  it('hints the exact spelling when only the case is wrong', () => {
    const { errors } = assemble('ADD', OVERTURE_ISA);
    expect(errors[0]?.line).toBe(1);
    expect(errors[0]?.reason).toMatch(/unknown mnemonic "ADD"/);
    expect(errors[0]?.reason).toMatch(/did you mean "add"\?/);
  });

  it('reports an immediate that does not fit the six-bit field', () => {
    const { bytes, errors } = assemble('loadi|64   # 64 needs seven bits', OVERTURE_ISA);
    expect(bytes).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(1);
    expect(errors[0]?.reason).toBe('value 64 does not fit the 6-bit "imm" field (0-63)');
  });

  it('reports a label whose address does not fit the six-bit field', () => {
    // 63 filler instructions plus the `loadi` itself make 64 slots, so the
    // label sits at address 64 -- the first address a `loadi|name` cannot
    // carry. That is the §10.5 limitation, as a located error rather than a
    // wrapped address.
    const source = [...Array.from({ length: 63 }, () => 'add'), 'loadi|far', 'label far'].join(
      '\n',
    );
    const { bytes, errors } = assemble(source, OVERTURE_ISA);
    expect(bytes).toHaveLength(63);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(64);
    expect(errors[0]?.reason).toMatch(/label "far" is at address 64/);
    expect(errors[0]?.reason).toMatch(/does not fit the 6-bit "imm" field \(0-63\)/);
  });

  it('reports an undefined label at the line that refers to it', () => {
    const { bytes, labels, errors } = assemble(
      ['label here', 'loadi|there'].join('\n'),
      OVERTURE_ISA,
    );
    expect(labels).toEqual({ here: 0 });
    expect(bytes).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(2);
    expect(errors[0]?.reason).toBe('unknown label "there"');
  });

  it('reports a wrong operand count per mnemonic', () => {
    expect(assemble('add|1', OVERTURE_ISA).errors[0]?.reason).toBe(
      '"add" takes no operands, got 1',
    );
    expect(assemble('jnz|loop', OVERTURE_ISA).errors[0]?.reason).toBe(
      '"jnz" takes no operands, got 1',
    );
    expect(assemble('loadi', OVERTURE_ISA).errors[0]?.reason).toBe(
      '"loadi" takes 1 operand, got 0',
    );
    expect(assemble('move|s0', OVERTURE_ISA).errors[0]?.reason).toBe(
      '"move" takes 2 operands, got 1',
    );
  });

  it('reports an empty field instead of skipping it', () => {
    const { errors } = assemble('move|s0|', OVERTURE_ISA);
    expect(errors[0]?.line).toBe(1);
    expect(errors[0]?.reason).toBe('field 3 is empty');
  });

  it('reports an unknown operand code with the spellings the field accepts', () => {
    const { errors } = assemble('move|s6|d1', OVERTURE_ISA);
    expect(errors[0]?.line).toBe(1);
    expect(errors[0]?.reason).toMatch(/unknown code "s6" for the "src" field/);
    expect(errors[0]?.reason).toMatch(/expected s0, s1, s2, s3, s4, s5, inp/);
  });

  it('refuses the codes that are not spellings of the field they appear in', () => {
    // `out` is code 7 and `inp` is code 6, but the source material's grammar
    // offers `inp` only as a source and `out` only as a destination.
    expect(assemble('move|out|d1', OVERTURE_ISA).errors[0]?.reason).toMatch(/unknown code "out"/);
    expect(assemble('move|s0|inp', OVERTURE_ISA).errors[0]?.reason).toMatch(/unknown code "inp"/);
  });

  it('rejects an immediate token that is neither a number nor a label name', () => {
    for (const token of ['0x10', '-1', '1e2', 'abc def']) {
      const { errors } = assemble(`loadi|${token}`, OVERTURE_ISA);
      expect(errors[0]?.reason, token).toBe(
        `"${token}" is neither an immediate value (0-63) nor a label name`,
      );
    }
  });

  it('reports a duplicate label and names the first definition', () => {
    const { errors } = assemble(['label loop', 'add', 'label loop'].join('\n'), OVERTURE_ISA);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(3);
    expect(errors[0]?.reason).toBe('label "loop" is already defined on line 1');
  });

  it('reports a label name that is not an identifier, and a label arity error', () => {
    expect(assemble('label 5', OVERTURE_ISA).errors[0]?.reason).toMatch(
      /label name "5" must start with a letter/,
    );
    expect(assemble('label', OVERTURE_ISA).errors[0]?.reason).toBe(
      '"label" takes exactly one name, got 0',
    );
    expect(assemble('label a b', OVERTURE_ISA).errors[0]?.reason).toBe(
      '"label" takes exactly one name, got 2',
    );
    // `label|loop` crosses the two line shapes. Without its own branch the
    // message would be `unknown mnemonic "label|loop"`, which names no token
    // the player actually typed.
    expect(assemble('label|loop', OVERTURE_ISA).errors[0]?.reason).toBe(
      '"label" takes its name after a space, not a "|"',
    );
  });

  it('lists errors in file order, resolution errors included', () => {
    // `errors[0]` is the one a caller shows first (the `program` checker puts it
    // in its failure detail), and label resolution runs after the whole-file
    // scan -- so without the sort, line 2's parse error would be reported ahead
    // of line 1's undefined label.
    const { errors } = assemble(['loadi|missing', 'nope'].join('\n'), OVERTURE_ISA);
    expect(errors.map((error) => error.line)).toEqual([1, 2]);
    expect(errors[0]?.reason).toBe('unknown label "missing"');
  });

  it('reports every bad line independently and never throws', () => {
    const source = ['loadi|64', 'add|1', 'nope', 'move|s0|'].join('\n');
    const result = assemble(source, OVERTURE_ISA);
    expect(() => assemble(source, OVERTURE_ISA)).not.toThrow();
    expect(result.errors.map((error) => error.line)).toEqual([1, 2, 3, 4]);
    expect(result.bytes).toEqual([]);
  });

  it('reports a malformed ISA instead of throwing out of assemble', () => {
    // The no-throw contract covers the `isa` argument too: `insertField` would
    // throw on a value its field cannot hold, so the encoder checks first.
    const narrowed: Isa = {
      ...OVERTURE_ISA,
      modes: OVERTURE_ISA.modes.map((mode) =>
        mode.id === 'move'
          ? {
              ...mode,
              fields: [
                { id: 'src', offset: 3, width: 1 },
                { id: 'dst', offset: 0, width: 3 },
              ],
            }
          : mode,
      ),
    };
    expect(() => assemble('move|s2|d1', narrowed)).not.toThrow();
    expect(assemble('move|s2|d1', narrowed).errors[0]?.reason).toMatch(
      /the ISA's code 2 for "s2" does not fit the 1-bit "src" field/,
    );
  });

  it('reports an operand field the ISA does not declare', () => {
    const missingSrc: Isa = {
      ...OVERTURE_ISA,
      modes: OVERTURE_ISA.modes.map((mode) =>
        mode.id === 'move' ? { ...mode, fields: [{ id: 'dst', offset: 0, width: 3 }] } : mode,
      ),
    };
    expect(assemble('move|s0|d1', missingSrc).errors[0]?.reason).toBe(
      'the ISA declares no "src" field for mode "move"',
    );
  });
});

// ---------------------------------------------------------------------------
// Purity: the same (source, isa) always gives the same image
// ---------------------------------------------------------------------------

describe('assemble / purity', () => {
  it('gives the same result twice for the same input', () => {
    // Would fail the moment an address, a seed or a timestamp leaked into the
    // encoding -- and a program image that differs between two runs of one
    // level makes the checker's verdict unreproducible (constraint 12).
    const source = ['loadi|1', 'move|s0|d2', 'label loop', 'add', 'loadi|loop', 'jnz'].join('\n');
    expect(assemble(source, OVERTURE_ISA)).toEqual(assemble(source, OVERTURE_ISA));
  });

  it('reads the ISA without writing to it', () => {
    // A frozen copy turns any write into a TypeError, so this test fails loudly
    // if the encoder ever caches into the table it was handed.
    const frozen = structuredClone(OVERTURE_ISA);
    deepFreeze(frozen);
    expect(() => assemble('move|inp|out', frozen)).not.toThrow();
    expect(assemble('move|inp|out', frozen).bytes).toEqual([0xb7]);
  });
});

// ---------------------------------------------------------------------------
// The ISA table itself
// ---------------------------------------------------------------------------

describe('the ISA data is ruling 5, transcribed', () => {
  it('puts the four modes in the top two bits, opcodes 00 to 11', () => {
    expect(OVERTURE_ISA.wordWidth).toBe(8);
    expect(OVERTURE_ISA.modeField).toEqual({ id: 'mode', offset: 6, width: 2 });
    expect(OVERTURE_ISA.modes.map((mode) => [mode.id, mode.opcode])).toEqual([
      ['immediate', 0b00],
      ['calc', 0b01],
      ['move', 0b10],
      ['jump', 0b11],
    ]);
  });

  it('slices the low six bits exactly as ruling 5 writes them', () => {
    const fieldsOf = (id: string) => OVERTURE_ISA.modes.find((mode) => mode.id === id)?.fields;
    expect(fieldsOf('immediate')).toEqual([{ id: 'imm', offset: 0, width: 6 }]);
    expect(fieldsOf('calc')).toEqual([
      { id: 'op', offset: 3, width: 3 },
      { id: 'reserved', offset: 0, width: 3 },
    ]);
    expect(fieldsOf('move')).toEqual([
      { id: 'src', offset: 3, width: 3 },
      { id: 'dst', offset: 0, width: 3 },
    ]);
    expect(fieldsOf('jump')).toEqual([
      { id: 'cond', offset: 3, width: 3 },
      { id: 'reserved', offset: 0, width: 3 },
    ]);
  });

  it('tiles every mode’s low six bits with no gap and no overlap', () => {
    // The layout this catches: `op` declared at offset 2, which would leave bit
    // 5 unwritten and overlap the reserved field while still producing bytes.
    for (const mode of OVERTURE_ISA.modes) {
      const sorted = [...mode.fields].sort((a, b) => a.offset - b.offset);
      let next = 0;
      for (const field of sorted) {
        expect(field.offset, `${mode.id}.${field.id}`).toBe(next);
        next += field.width;
      }
      expect(next, `${mode.id} covers six bits`).toBe(6);
    }
  });

  it('maps the mnemonics ruling 5 names, and no others', () => {
    const tokens = OVERTURE_ISA.modes.flatMap((mode) => Object.keys(mode.mnemonics)).sort();
    // This list is the checklist for the byte tests above: a mnemonic added to
    // the ISA fails here until it also gets a hand-computed byte.
    expect(tokens).toEqual([
      'add',
      'and',
      'j',
      'jnz',
      'jz',
      'loadi',
      'move',
      'nand',
      'nor',
      'or',
      'sub',
    ]);
    const mnemonicsOf = (id: string) =>
      OVERTURE_ISA.modes.find((mode) => mode.id === id)?.mnemonics;
    expect(mnemonicsOf('calc')).toEqual({ add: 0, sub: 1, and: 2, or: 3, nand: 4, nor: 5 });
    expect(mnemonicsOf('jump')).toEqual({ j: 0, jz: 1, jnz: 2 });
    // `null` is "this mnemonic names the mode itself", not "selector 0": `add`
    // and `j` really do use selector 0.
    expect(mnemonicsOf('immediate')).toEqual({ loadi: null });
    expect(mnemonicsOf('move')).toEqual({ move: null });
  });

  it('declares every field an operand or a selector names', () => {
    for (const mode of OVERTURE_ISA.modes) {
      const ids = mode.fields.map((field) => field.id);
      if (mode.selectField !== undefined) expect(ids, mode.id).toContain(mode.selectField);
      for (const operand of mode.operands) expect(ids, mode.id).toContain(operand.field);
    }
  });

  it('carries operand codes 0-5 = REG0-REG5, 6 = inp, 7 = out', () => {
    expect(OPERAND_NAMES).toEqual([
      'REG0',
      'REG1',
      'REG2',
      'REG3',
      'REG4',
      'REG5',
      'inp',
      'out',
    ]);
    // sN/dN must carry N: a transposed entry would put the wrong register in a
    // byte while every other test in this file still passed.
    for (const [token, code] of Object.entries(SOURCE_CODES)) {
      expect(OPERAND_NAMES[code], `SOURCE_CODES.${token}`).toBe(
        token === 'inp' ? 'inp' : `REG${code}`,
      );
    }
    for (const [token, code] of Object.entries(DEST_CODES)) {
      expect(OPERAND_NAMES[code], `DEST_CODES.${token}`).toBe(
        token === 'out' ? 'out' : `REG${code}`,
      );
    }
  });
});
