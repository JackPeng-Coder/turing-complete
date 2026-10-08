import { describe, expect, it } from 'vitest';
import { parseImage } from '../../src/asm/index';

/**
 * `parseImage`: the hand-written machine-code format chapter 4's first level
 * grades.
 *
 * WHY A SECOND READER OF TEXT EXISTS AT ALL. The assembler is the toolchain, and
 * a player who has one would never spell a program as binary. The level that
 * introduces machine code is about the ENCODING -- what the top two bits select,
 * what the low six mean -- so the program has to be written the way the machine
 * sees it, one byte per line, with no mnemonic standing between the player and
 * the bits. That makes this parser the level's interface, and its error contract
 * is the same as `assemble()`'s: it reports, it never throws, and an error names
 * the line so a player can find the typo in their own text.
 *
 * The five bytes below are the plan's own example (`B1 05 82 40 9F`), spelled
 * the way a player would type them. They are also a real program in the OVERTURE
 * encoding, which is what makes them worth pinning rather than an arbitrary
 * pattern: `0xB1` is `move|inp|d1` and `0x9F` is `move|s3|out`.
 */

/** The five-byte image, one byte per line, exactly as a player would write it. */
const FIVE_BYTES = ['10110001', '00000101', '10000010', '01000000', '10011111'].join('\n');

describe('parseImage', () => {
  it('reads one byte per line', () => {
    const parsed = parseImage(FIVE_BYTES);
    expect(parsed.errors).toEqual([]);
    expect(parsed.bytes).toEqual([0xb1, 0x05, 0x82, 0x40, 0x9f]);
  });

  it('skips blank lines, whitespace-only lines and comments', () => {
    // Comments are skipped WHOLE-LINE as well as trailing: a player annotating
    // their program is the normal case, and an annotation that became an error
    // would make the format unusable for anything longer than five bytes. The
    // line numbers the errors carry still count these lines, because a UI points
    // at the player's file rather than at the lines that survived.
    const source = [
      '# the echo program',
      '',
      '10110001   # move|inp|d1',
      '   ',
      '00000101',
      '10000010',
      '01000000',
      '10011111',
      '# done',
      '   ',
    ].join('\n');
    expect(parseImage(source)).toEqual({
      bytes: [0xb1, 0x05, 0x82, 0x40, 0x9f],
      errors: [],
    });
  });

  it('accepts digits grouped with spaces', () => {
    // `0011 0101` is ONE byte: the spaces group the digits for the eye and carry
    // no meaning of their own. The ungrouped spelling of the same byte parses to
    // the same value, which is the claim -- grouping is presentation.
    expect(parseImage('0011 0101')).toEqual({ bytes: [0x35], errors: [] });
    expect(parseImage('00110101')).toEqual({ bytes: [0x35], errors: [] });
    // A single group of any shape that adds up to eight digits is one byte, so
    // the grouping is free to follow the fields rather than the byte.
    expect(parseImage('001 10101')).toEqual({ bytes: [0x35], errors: [] });
  });

  it('accepts a tab between groups as the same separator a space is', () => {
    // Whitespace GROUPS digits and carries no meaning of its own, and a tab is
    // whitespace like any other. Accepting only U+0020 would refuse a
    // tab-separated program with a reason that quoted a character the player
    // cannot see, which is the least debuggable failure this parser can produce.
    // `1011` then `0101` is `10110101`, 0xb5, and the second case is the 0x35 the
    // space-grouped test above pins, restated under a vertical tab so the class
    // is what is being read rather than one character's special case.
    expect(parseImage('1011\t0101')).toEqual({ bytes: [0xb5], errors: [] });
    expect(parseImage('0011\u000b0101')).toEqual({ bytes: [0x35], errors: [] });
    // One whitespace character per boundary, on every line: grouping never
    // changes how many LINES a program has.
    expect(parseImage('0011\t0101\n0000 0001')).toEqual({ bytes: [0x35, 0x01], errors: [] });
  });

  it('still refuses a run of two whitespace characters, whatever they are', () => {
    // The empty-field rule is deliberate (see the test above it) and is not
    // widened by the tab: two ADJACENT whitespace characters leave a group with
    // nothing in it, and it makes no difference whether that pair is two spaces,
    // two tabs or one of each -- only the count is read. Folding the run away
    // would silently accept the spelling the rule exists to refuse.
    for (const line of ['0011\t\t0101', '0011 \t0101', '0011\t 0101', '0011  \t0101']) {
      const parsed = parseImage(line);
      expect(parsed.bytes, JSON.stringify(line)).toEqual([]);
      expect(parsed.errors, JSON.stringify(line)).toHaveLength(1);
      expect(parsed.errors[0]?.reason).toContain('empty field');
    }
  });

  it('rejects a line with fewer than eight digits, naming its line', () => {
    const source = ['10110001', '1011010'].join('\n');
    const parsed = parseImage(source);
    expect(parsed.bytes).toEqual([0xb1]);
    // The line number is the error's OWN, so the second bad line in the next
    // test must report 3 rather than repeat this one.
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]?.line).toBe(2);
    expect(parsed.errors[0]?.text).toBe('1011010');
    expect(parsed.errors[0]?.reason).toContain('7');
  });

  it('rejects a line with more than eight digits', () => {
    const parsed = parseImage(['10110001', '101101011'].join('\n'));
    expect(parsed.bytes).toEqual([0xb1]);
    expect(parsed.errors[0]?.line).toBe(2);
    expect(parsed.errors[0]?.reason).toContain('9');
  });

  it('rejects a character that is not a binary digit, naming the character', () => {
    // The typo a player actually makes on a binary keyboard is pressing the key
    // next to the one they meant, and `2` is the one that reads as a digit while
    // being outside the alphabet. The reason names it so the line is searchable.
    const parsed = parseImage(['10110001', '10110002'].join('\n'));
    expect(parsed.bytes).toEqual([0xb1]);
    expect(parsed.errors[0]?.line).toBe(2);
    expect(parsed.errors[0]?.text).toBe('10110002');
    expect(parsed.errors[0]?.reason).toContain('"2"');
  });

  it('rejects an empty field, which is what two spaces in a row leave behind', () => {
    // Spaces are GROUP separators; two in a row therefore leave a group with
    // nothing in it, and that is a typo rather than a wider gap: silently
    // accepting it would let `1011  0101` and `1011 0101` mean the same byte
    // while a player who typed the first one has no way to know which.
    const parsed = parseImage(['10110001', '1011  0101'].join('\n'));
    expect(parsed.bytes).toEqual([0xb1]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]?.line).toBe(2);
    expect(parsed.errors[0]?.text).toBe('1011  0101');
    // Leading and trailing spaces are NOT an empty field: the line is trimmed
    // first, so indenting a program -- which every player does -- stays legal.
    expect(parseImage('   10110001   ')).toEqual({ bytes: [0xb1], errors: [] });
  });

  it('reports every bad line, so one run shows the whole list', () => {
    const source = ['10110001', '1011010', '00000101', '1011000x'].join('\n');
    const parsed = parseImage(source);
    // A line that failed contributes NO byte: an image that quietly dropped the
    // bad line would shift every instruction after it by one address, and the
    // program would run the wrong instructions while reporting success.
    expect(parsed.bytes).toEqual([0xb1, 0x05]);
    expect(parsed.errors.map((error) => error.line)).toEqual([2, 4]);
  });

  it('reads an empty source as an empty image, not a failure', () => {
    // Zero bytes with zero errors is an honest answer: "nothing" is a failure to
    // the CHECKER (`missing-program`), which knows that a program check with no
    // instructions would compare nothing, and not to the parser, which only knows
    // what the text says.
    expect(parseImage('')).toEqual({ bytes: [], errors: [] });
    expect(parseImage('# only a comment\n   \n')).toEqual({ bytes: [], errors: [] });
  });

  it('never throws, whatever the text holds', () => {
    // The same contract `assemble()` keeps, and for the same reason: this runs on
    // the board-edit path, where a throw would escape `runChecks` into `grade()`
    // on every keystroke once the IDE exists.
    for (const source of ['\r\n', 'ÿ', '\t\t', '2', '10110001\r\n00000101']) {
      expect(() => parseImage(source), source).not.toThrow();
    }
    // A carriage return is ONE break, as it is in the assembler: `\r\n` must not
    // leave a CR riding on the line, or every line of a Windows-authored program
    // would fail on a character the player cannot see.
    expect(parseImage('10110001\r\n00000101').bytes).toEqual([0xb1, 0x05]);
  });
});
