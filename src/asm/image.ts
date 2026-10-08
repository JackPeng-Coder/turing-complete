import { stripComment } from './assemble';

/**
 * Hand-written machine code -> instruction bytes.
 *
 * THE FORMAT (phase-3 ruling 3). One byte per line, written as eight binary
 * digits, with whitespace free to group the digits for the eye:
 *
 *   `# ...`            a comment, to the end of the line
 *   (blank)            skipped, as is a line of nothing but whitespace
 *   `10110001`         one byte
 *   `1011 0001`        the same byte, grouped
 *
 * WHITESPACE IS ONLY EVER A SEPARATOR, AND ONE CHARACTER OF IT. Any whitespace
 * character groups the digits -- a space, a tab, anything else in that class --
 * because a player's editor decides which one lands between two groups and this
 * parser must not care (`1011\t0001` is the byte `1011 0001` is). A RUN of two
 * or more whitespace characters between groups is refused as an EMPTY FIELD
 * instead: it leaves a group with nothing in it, and folding it away would make
 * `1011  0001` and `1011 0001` the same byte while the player who typed the
 * first one has no way to learn which spelling the machine agreed with. Leading
 * and trailing whitespace is not an empty field -- the line is trimmed first, so
 * indenting a program stays legal.
 *
 * WHY THIS EXISTS BESIDE THE ASSEMBLER. Chapter 4's first level is about the
 * ENCODING -- which two bits select the mode, what the other six mean -- so the
 * program has to be written the way the machine reads it. An assembler would
 * stand between the player and the bits, which is the one thing that level
 * teaches; so the player writes bytes, and this is the reader that turns them
 * into an image. It is deliberately NOT a second assembler: there are no
 * mnemonics here and there never will be.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not know what any byte means (see
 * `isa.ts`); it does not enforce `ram_prog`'s 256-byte capacity, which is the
 * machine's property rather than the format's; and it does not reject an empty
 * program, because zero bytes with zero errors is an honest answer and "a
 * program must exist" is the level checker's `missing-program` failure, not the
 * parser's.
 *
 * ERRORS ARE DATA, NEVER EXCEPTIONS, exactly as in `assemble()`: this runs on
 * the board-edit path, and a throw here would escape `runChecks` into `grade()`
 * on every keystroke. `ImageParseError` mirrors `AssembleError` field for field
 * -- 1-based `line`, the offending `text` verbatim, a readable `reason` -- so a
 * UI that renders one renders the other.
 */

/**
 * One problem with the image, at the line that caused it.
 *
 * `line` is 1-based and counts EVERY line of the source, comments and blanks
 * included -- a UI points at the player's text, not at the lines that survived.
 * `text` is the line exactly as written, comment included, so a caller can show
 * it without re-splitting the source.
 */
export interface ImageParseError {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface ImageParseResult {
  /**
   * One byte per line that parsed, in source order.
   *
   * A line that failed contributes nothing, so with a non-empty `errors` this
   * array is a diagnostic listing, not an image. Every caller refuses an image
   * with errors, which is the one case where the difference can show at all.
   */
  readonly bytes: readonly number[];
  readonly errors: readonly ImageParseError[];
}

/** How many digits one byte is written with. Named, because both messages state it. */
const DIGITS_PER_BYTE = 8;

/**
 * Compiles `source` into an image.
 *
 * TOTAL: every problem comes back in `errors` and nothing is thrown at the
 * caller. At most one error is reported per line -- the line is abandoned at its
 * first fault, so a line with both a typo and a wrong length is not rendered
 * twice -- and parsing CONTINUES, because a player who mistyped three lines
 * needs all three in one run rather than three runs of one.
 *
 * A line that fails contributes NO byte. Emitting a placeholder instead would
 * shift every instruction after it by one address, and the machine would then
 * run something the player never wrote while the check reported the image had
 * loaded.
 */
export function parseImage(source: string): ImageParseResult {
  const bytes: number[] = [];
  const errors: ImageParseError[] = [];

  // `\r\n` is ONE break, the same rule the assembler follows: splitting on '\n'
  // alone would leave a carriage return on every line of a Windows-authored
  // program, and every digit check below would fail on a character the player
  // cannot see.
  const lines = source.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const text = lines[index] ?? '';
    // The comment goes first and the trim second, so a line that is only a
    // comment -- or only spaces -- is skipped rather than reported: annotating a
    // program is the normal case, and an annotation that became an error would
    // make the format unusable past a handful of bytes. Trimming also means
    // leading and trailing spaces are not an empty field, so indenting a program
    // stays legal.
    const body = stripComment(text).trim();
    if (body === '') continue;

    // Whitespace GROUPS digits and carries no meaning of its own, so a run of
    // two or more whitespace characters leaves a group with nothing in it. That
    // is refused rather than folded away: accepting it would make `1011  0001`
    // and `1011 0001` the same byte while the player who typed the first one has
    // no way to learn which spelling the machine agreed with. The separator is
    // ANY whitespace rather than U+0020 alone, because which character an editor
    // inserts between two groups is not the player's decision -- and a tab
    // refused here would be reported as a character the player cannot see.
    //
    // The run is tested before the split, not by looking for an empty field
    // among its results: a single separator is not an empty field, so `1011\t0001`
    // has to come back as two fields, while a run has to be refused whichever
    // characters it is made of. Leading and trailing whitespace never reaches
    // here -- the line was trimmed above -- so a run can only sit between groups.
    if (/\s{2,}/.test(body)) {
      errors.push({
        line,
        text,
        reason:
          'an empty field: whitespace separates groups of digits, and two' +
          ' whitespace characters in a row leave a group with nothing in it',
      });
      continue;
    }

    const fields = body.split(/\s/);
    const digits = fields.join('');
    const foreign = [...digits].find((digit) => digit !== '0' && digit !== '1');
    if (foreign !== undefined) {
      // Named, because this is the typo a player actually makes: `2` is the one
      // key that reads as a digit while being outside the alphabet.
      errors.push({
        line,
        text,
        reason: `"${foreign}" is not a binary digit: a byte is written as eight 0s and 1s`,
      });
      continue;
    }
    if (digits.length !== DIGITS_PER_BYTE) {
      errors.push({
        line,
        text,
        reason: `a byte is ${DIGITS_PER_BYTE} binary digits, got ${digits.length}`,
      });
      continue;
    }
    bytes.push(Number.parseInt(digits, 2));
  }

  return { bytes, errors };
}
