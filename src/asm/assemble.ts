import { insertField } from '../core/fields';
import { maskOf } from '../core/signal';
import type { FieldRange, Isa, ModeDef } from './isa';

/**
 * OVERTURE assembly text -> instruction bytes.
 *
 * THE GRAMMAR (source material §6.6, §10.2). One instruction per line:
 *
 *   `# ...`        a comment, to the end of the line
 *   (blank)        skipped
 *   `label name`   defines `name` as the index of the NEXT instruction
 *   `loadi|5`      an ISA mnemonic, then `|`-separated fields
 *
 * Fields are split on `|` only -- whitespace never separates them, it is
 * trimmed off their edges -- and mnemonics are case-sensitive. Which tokens
 * exist, and what each encodes, comes from the `isa` argument and never from
 * this file.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not know what any instruction does
 * (see `isa.ts`); it does not enforce `ram_prog`'s 256-byte capacity, which is
 * the machine's property rather than the encoding's, so a 257-line program is a
 * legal byte stream; and it does not reject an empty program, because zero
 * instructions with zero errors is an honest answer and "a program must exist"
 * is the level checker's `missing-program` failure, not the compiler's.
 */

/**
 * One problem with the source, at the line that caused it.
 *
 * `line` is 1-based and counts EVERY line of the source, comments and blanks
 * included -- a UI points at the file, not at the lines that survived. `text`
 * is the offending line exactly as written, comment included, so a caller can
 * render it without re-splitting the source. `reason` is one readable sentence
 * naming the token that failed. An `AssembleError` is data, never an `Error`
 * instance: these arrive in `AssembleResult.errors`, so there is no throw for a
 * caller to forget to catch.
 */
export interface AssembleError {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface AssembleResult {
  /**
   * One 8-bit word per instruction that encoded, in source order.
   *
   * A line that failed contributes nothing (see `assemble`), so with a
   * non-empty `errors` this array is a diagnostic listing, not an image.
   */
  readonly bytes: number[];
  /** Label name -> the instruction index it names. */
  readonly labels: Record<string, number>;
  readonly errors: AssembleError[];
}

/** The one directive the grammar has besides the ISA's mnemonics. */
const LABEL_DIRECTIVE = 'label';

/**
 * Decimal only, and strictly: `Number('')` is 0 and `Number('1e2')` is 100, so
 * a loose `Number(token)` would let `loadi|` load a silent 0 and `loadi|1e2`
 * load a value no reader asked for. `0x10` is rejected by the same rule -- the
 * source material's grammar has no number prefixes, and half a number grammar
 * (hex but not binary, say) is worse than none.
 */
const DECIMAL = /^\d+$/;

/**
 * A label name starts with a letter or `_`, never a digit: `loadi|5` is an
 * immediate, so a label named `5` could not be told apart from one and every
 * operand token would become ambiguous.
 */
const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface MnemonicEntry {
  readonly mode: ModeDef;
  readonly select: number | null;
}

/** An operand whose value is known at parse time (a number, or a code token). */
interface LiteralOperand {
  readonly kind: 'literal';
  readonly field: FieldRange;
  /** The token as written, for the error message. */
  readonly token: string;
  readonly value: number;
}

/** An operand naming a label, whose address is only known after the scan. */
interface LabelOperand {
  readonly kind: 'label';
  readonly field: FieldRange;
  readonly name: string;
}

type PendingOperand = LiteralOperand | LabelOperand;

interface PendingInstruction {
  readonly line: number;
  readonly text: string;
  readonly mnemonic: string;
  readonly mode: ModeDef;
  readonly select: number | null;
  readonly operands: readonly PendingOperand[];
}

interface LabelDefinition {
  readonly line: number;
  readonly address: number;
}

function fieldOf(mode: ModeDef, id: string): FieldRange | undefined {
  return mode.fields.find((field) => field.id === id);
}

function maxValue(field: FieldRange): number {
  return maskOf(field.width);
}

/** A field's limit, in words: `6-bit "imm" field (0-63)`. */
function describeField(field: FieldRange): string {
  return `${field.width}-bit "${field.id}" field (0-${maxValue(field)})`;
}

/** A defect in the `isa` argument -- the caller's data, not the player's source. */
function isaDefect(mode: ModeDef, fieldId: string): string {
  return `the ISA declares no "${fieldId}" field for mode "${mode.id}"`;
}

function operandCount(count: number): string {
  if (count === 0) return 'no operands';
  return `${count} operand${count === 1 ? '' : 's'}`;
}

function unknownMnemonic(token: string, byLowerCase: ReadonlyMap<string, string>): string {
  const spelling = byLowerCase.get(token.toLowerCase());
  return spelling === undefined
    ? `unknown mnemonic "${token}" (mnemonics are case-sensitive)`
    : `unknown mnemonic "${token}" (mnemonics are case-sensitive; did you mean "${spelling}"?)`;
}

/**
 * Token -> mode and selector, plus a lower-cased spelling purely for the
 * "did you mean" hint.
 *
 * Built from the `isa` argument rather than from `OVERTURE_ISA`, because the ISA
 * is a parameter: phase 5's LEG gets this compiler for the price of a second
 * table.
 */
function indexMnemonics(isa: Isa): {
  readonly byToken: ReadonlyMap<string, MnemonicEntry>;
  readonly byLowerCase: ReadonlyMap<string, string>;
} {
  const byToken = new Map<string, MnemonicEntry>();
  const byLowerCase = new Map<string, string>();
  for (const mode of isa.modes) {
    for (const [token, select] of Object.entries(mode.mnemonics)) {
      byToken.set(token, { mode, select });
      const lower = token.toLowerCase();
      if (!byLowerCase.has(lower)) byLowerCase.set(lower, token);
    }
  }
  return { byToken, byLowerCase };
}

/**
 * One instruction, encoded -- or the reason it will not encode.
 *
 * The reason string is the whole message; the caller attaches the line and the
 * source text. Every range is checked here, before `insertField`, so a value a
 * field cannot hold is an error the source can be told about instead of a
 * `RangeError` thrown through the caller.
 */
function encode(
  instruction: PendingInstruction,
  labels: ReadonlyMap<string, LabelDefinition>,
  isa: Isa,
): { readonly byte: number } | { readonly reason: string } {
  const modeField = isa.modeField;
  if (instruction.mode.opcode > maxValue(modeField)) {
    return {
      reason:
        `the ISA's opcode ${instruction.mode.opcode} for mode "${instruction.mode.id}"` +
        ` does not fit the ${describeField(modeField)}`,
    };
  }
  let word = insertField(0, modeField.offset, modeField.width, instruction.mode.opcode);

  const selectField = instruction.mode.selectField;
  if (instruction.select !== null && selectField !== undefined) {
    const field = fieldOf(instruction.mode, selectField);
    if (!field) return { reason: isaDefect(instruction.mode, selectField) };
    if (instruction.select > maxValue(field)) {
      return {
        reason:
          `the ISA's selector ${instruction.select} for "${instruction.mnemonic}"` +
          ` does not fit the ${describeField(field)}`,
      };
    }
    word = insertField(word, field.offset, field.width, instruction.select);
  }

  for (const operand of instruction.operands) {
    let value: number;
    if (operand.kind === 'label') {
      const definition = labels.get(operand.name);
      if (!definition) return { reason: `unknown label "${operand.name}"` };
      value = definition.address;
      if (value > maxValue(operand.field)) {
        return {
          reason:
            `label "${operand.name}" is at address ${value},` +
            ` which does not fit the ${describeField(operand.field)}`,
        };
      }
    } else {
      value = operand.value;
      if (value > maxValue(operand.field)) {
        return {
          reason: `value ${operand.token} does not fit the ${describeField(operand.field)}`,
        };
      }
    }
    word = insertField(word, operand.field.offset, operand.field.width, value);
  }
  return { byte: word };
}

/**
 * Compiles `source` against `isa`.
 *
 * TOTAL: every problem, including a malformed `isa` argument, comes back in
 * `errors` -- nothing is thrown at the caller (`insertField` would throw on an
 * out-of-range field; the encoder checks first).
 *
 * `line` counts physical lines from 1, comments and blanks included, because a
 * UI points at the file. At most one error is reported per line: the line is
 * abandoned at its first fault, so `move|s9|d9` reports `s9` and the second
 * typo surfaces on the next run. Collecting both would render one source line
 * twice in a listing, once per mistake.
 *
 * A line that fails contributes NO byte. A label names the instruction SLOT
 * after it, and a slot exists for every line that parsed as an instruction --
 * including one whose operand turned out to be an undefined label, which parsed
 * but could not be resolved. `bytes` is therefore the subset of slots that
 * resolved, and the two are in step exactly when `errors` is empty. Emitting a
 * placeholder byte for a failed line instead was rejected: `loadi|64` would
 * become a real `loadi|0` sitting in a listing next to the player's line, and an
 * instruction shown as written but never written is worse than a hole. Every
 * caller refuses an image with a non-empty `errors`, which is the one case where
 * the difference between slots and bytes can show at all.
 *
 * PURE: no I/O, no clock, no `Math.random()`. The same `source` and `isa` always
 * produce the same result, because an image that differed between two runs of
 * one level would make the checker's verdict unreproducible (phase-2
 * constraint 12).
 */
export function assemble(source: string, isa: Isa): AssembleResult {
  const errors: AssembleError[] = [];
  const { byToken, byLowerCase } = indexMnemonics(isa);
  const labels = new Map<string, LabelDefinition>();
  const pending: PendingInstruction[] = [];

  // \r\n is ONE break. Splitting on '\n' alone leaves a carriage return on
  // every line, and that CR would ride into every field token and into
  // `error.text`, so a program written on Windows would fail on a character the
  // player cannot see.
  const lines = source.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const text = lines[index] ?? '';
    const body = stripComment(text).trim();
    if (body === '') continue;

    // Two line shapes meet here. A label's name follows its directive as a
    // WHITESPACE-separated word (`label loop`, source material §6.6); an
    // instruction's fields are `|`-separated (`loadi|5`). The directive is
    // therefore matched on the first word, before any field splitting.
    const words = body.split(/\s+/);
    if (words[0] === LABEL_DIRECTIVE) {
      // A label is its own line. `label loop add` is rejected rather than read
      // as "define, then instruction": the source grammar has no inline label,
      // and accepting one would need a second rule for where the instruction
      // starts and would silently swallow the token after the name.
      if (words.length !== 2) {
        errors.push({
          line,
          text,
          reason: `"${LABEL_DIRECTIVE}" takes exactly one name, got ${words.length - 1}`,
        });
        continue;
      }
      const name = words[1] ?? '';
      if (!LABEL_NAME.test(name)) {
        errors.push({
          line,
          text,
          reason:
            `label name "${name}" must start with a letter or "_"` +
            ' and hold only letters, digits and "_"',
        });
        continue;
      }
      const prior = labels.get(name);
      if (prior) {
        errors.push({
          line,
          text,
          reason: `label "${name}" is already defined on line ${prior.line}`,
        });
        continue;
      }
      labels.set(name, { line, address: pending.length });
      continue;
    }

    const fields = body.split('|').map((field) => field.trim());
    const head = fields[0] ?? '';
    if (head === LABEL_DIRECTIVE) {
      // `label|loop`: the one place the two line shapes get crossed, and the
      // error would otherwise be "unknown mnemonic label|loop", which names
      // nothing the player wrote as a token.
      errors.push({
        line,
        text,
        reason: `"${LABEL_DIRECTIVE}" takes its name after a space, not a "|"`,
      });
      continue;
    }

    const entry = byToken.get(head);
    if (!entry) {
      errors.push({ line, text, reason: unknownMnemonic(head, byLowerCase) });
      continue;
    }

    const slots = entry.mode.operands;
    if (fields.length - 1 !== slots.length) {
      errors.push({
        line,
        text,
        reason: `"${head}" takes ${operandCount(slots.length)}, got ${fields.length - 1}`,
      });
      continue;
    }

    const operands: PendingOperand[] = [];
    let failed = false;
    for (const [slot, operand] of slots.entries()) {
      const field = fieldOf(entry.mode, operand.field);
      if (!field) {
        errors.push({ line, text, reason: isaDefect(entry.mode, operand.field) });
        failed = true;
        break;
      }
      // An empty field is a fault, not a token to skip: `move|s0|` is a
      // truncated line, and dropping the empty tail would quietly turn it into
      // something the player did not write.
      const token = fields[slot + 1] ?? '';
      if (token === '') {
        errors.push({ line, text, reason: `field ${slot + 2} is empty` });
        failed = true;
        break;
      }
      if (operand.kind === 'immediate') {
        if (DECIMAL.test(token)) {
          operands.push({ kind: 'literal', field, token, value: Number(token) });
        } else if (LABEL_NAME.test(token)) {
          operands.push({ kind: 'label', field, name: token });
        } else {
          errors.push({
            line,
            text,
            reason: `"${token}" is neither an immediate value (0-63) nor a label name`,
          });
          failed = true;
          break;
        }
      } else {
        const codes = operand.codes ?? {};
        const code = codes[token];
        if (code === undefined) {
          errors.push({
            line,
            text,
            reason:
              `unknown code "${token}" for the "${field.id}" field` +
              ` (expected ${Object.keys(codes).join(', ')})`,
          });
          failed = true;
          break;
        }
        if (code > maxValue(field)) {
          errors.push({
            line,
            text,
            reason:
              `the ISA's code ${code} for "${token}"` +
              ` does not fit the ${describeField(field)}`,
          });
          failed = true;
          break;
        }
        operands.push({ kind: 'literal', field, token, value: code });
      }
    }
    if (failed) continue;
    pending.push({ line, text, mnemonic: head, mode: entry.mode, select: entry.select, operands });
  }

  // Second pass: label addresses are only all known once the whole file has
  // been read, and a forward reference is an ordinary thing to write.
  const bytes: number[] = [];
  for (const instruction of pending) {
    const encoded = encode(instruction, labels, isa);
    if ('reason' in encoded) {
      errors.push({ line: instruction.line, text: instruction.text, reason: encoded.reason });
      continue;
    }
    bytes.push(encoded.byte);
  }

  // Pass 2 appends label-resolution errors after pass 1's parse errors, so the
  // list is sorted back into file order. `errors[0]` is the one a caller shows
  // first -- the `program` checker puts it in its failure detail -- and "the
  // first error" has to mean the first in the file, not the first one noticed.
  // The sort is stable, and two errors never share a line: a line abandoned in
  // pass 1 is never encoded in pass 2.
  errors.sort((a, b) => a.line - b.line);

  // `Object.fromEntries`, not assignment into `{}`: the identifier grammar
  // allows a label named `__proto__`, and assigning that key onto a plain
  // object sets its prototype instead of a property -- the label would vanish
  // from `Object.keys(labels)` while `labels[name]` kept answering something.
  return {
    bytes,
    labels: Object.fromEntries([...labels].map(([name, def]) => [name, def.address])),
    errors,
  };
}

/** Everything before the first `#`; the grammar has no strings or escapes. */
function stripComment(text: string): string {
  const hash = text.indexOf('#');
  return hash === -1 ? text : text.slice(0, hash);
}
