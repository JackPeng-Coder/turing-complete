/**
 * The boards the local bridge can program, and the budget the exporter checks.
 *
 * THE NUMBERS ARE THE CHIP'S, NOT A WISH. An ATmega328P -- the Uno and the Nano
 * -- has 32 KiB of flash with half a kilobyte taken by the bootloader and 2 KiB
 * of SRAM, which the serial buffers, the call stack and every byte of the
 * circuit's own state all share. A Mega 2560 has 256 KiB and 8 KiB. The
 * `max*` figures below are the conservative share the ESTIMATE may claim, not
 * the chip's ceiling: the real size comes back from `arduino-cli compile` and
 * the panel shows both numbers side by side.
 *
 * THE FQBNS MATCH THE BRIDGE'S WHITELIST (`tools/arduino-bridge.mjs`). It is a
 * copy and not an import: the bridge is a standalone Node script with no build
 * step, so it cannot import a TypeScript module. `test/flash/bridge.test.ts`
 * pins the same three values on the bridge's side, so the two lists drifting
 * apart fails a test rather than a flash.
 */
export type BoardId = 'arduino:avr:uno' | 'arduino:avr:nano' | 'arduino:avr:mega';

export interface BoardProfile {
  readonly id: BoardId;
  /** The name the panel and the refusal messages use. */
  readonly name: string;
  /** A short form for the board picker. */
  readonly short: string;
  /** Program storage the chip physically has, before the bootloader. */
  readonly chipFlash: number;
  /** SRAM the chip physically has. */
  readonly chipRam: number;
  /** The estimate's flash ceiling: chip flash minus the bootloader and slack. */
  readonly maxFlash: number;
  /** The estimate's RAM ceiling: the chip's SRAM minus a real reserve. */
  readonly maxRam: number;
}

/**
 * Uno first: it is the default, the one the tests and the docs use, and the one
 * the feature was designed around.
 */
export const BOARDS: readonly BoardProfile[] = [
  {
    id: 'arduino:avr:uno',
    name: 'Arduino Uno',
    short: 'Uno',
    chipFlash: 32_256,
    chipRam: 2_048,
    maxFlash: 30_000,
    maxRam: 1_900,
  },
  {
    id: 'arduino:avr:nano',
    name: 'Arduino Nano',
    short: 'Nano',
    chipFlash: 32_256,
    chipRam: 2_048,
    maxFlash: 30_000,
    maxRam: 1_900,
  },
  {
    id: 'arduino:avr:mega',
    name: 'Arduino Mega 2560',
    short: 'Mega',
    chipFlash: 253_952,
    chipRam: 8_192,
    maxFlash: 250_000,
    maxRam: 7_900,
  },
];

/** The default board: the one the first version was built and measured against. */
export const DEFAULT_BOARD: BoardId = 'arduino:avr:uno';

/** A board by FQBN. An unknown id is a programming error, not a player state. */
export function boardProfile(id: BoardId): BoardProfile {
  const found = BOARDS.find((board) => board.id === id);
  if (found === undefined) throw new Error(`unknown board: ${id}`);
  return found;
}

/**
 * One row of the panel's board picker.
 *
 * The Nano's old bootloader is a separate row over the same chip: the FQBN is
 * identical and `boardOptions` is what tells `arduino-cli` which bootloader
 * baud rate to use. It is a row because a player picks a board off a shelf, not
 * an argv; the budget behind both rows is the same Nano profile.
 */
export interface BoardChoice {
  /** The picker's value, which is also what the panel remembers. */
  readonly id: string;
  /** The FQBN the bridge is asked to compile for. */
  readonly board: BoardId;
  /** The name the picker and the budget line show. */
  readonly name: string;
  /** `arduino-cli --board-options`, for a variant of the same FQBN. */
  readonly boardOptions?: string;
}

export const BOARD_CHOICES: readonly BoardChoice[] = [
  { id: 'arduino:avr:uno', board: 'arduino:avr:uno', name: 'Arduino Uno' },
  { id: 'arduino:avr:nano', board: 'arduino:avr:nano', name: 'Arduino Nano' },
  {
    id: 'arduino:avr:nano:old',
    board: 'arduino:avr:nano',
    name: 'Arduino Nano（旧 bootloader）',
    boardOptions: 'cpu=atmega328old',
  },
  { id: 'arduino:avr:mega', board: 'arduino:avr:mega', name: 'Arduino Mega 2560' },
];

/** The default row: the Uno the first version was built and measured against. */
export const DEFAULT_BOARD_CHOICE = 'arduino:avr:uno';

/** The FQBN and options behind a picker id; unknown ids fall back to the default. */
export function boardChoice(id: string): BoardChoice {
  return BOARD_CHOICES.find((choice) => choice.id === id) ?? BOARD_CHOICES[0]!;
}
