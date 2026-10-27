import type { BoardId } from './boards';

/**
 * Physical pins the game may map a sandbox connector onto.
 *
 * A mapping is a property of the BOARD, not of the circuit: the same circuit
 * runs on an Uno with its output on D13 and on a Mega with it on D40, so the
 * assignment is remembered by the panel (`tc.flash.v1`) rather than written into
 * the graph. It is part of the program image, though -- the firmware behaves
 * differently -- which is why `imageSignature` includes it and the banner's hash
 * still says whether the board is running what the screen shows.
 *
 * ONLY ONE-BIT CONNECTORS TAKE A PIN in the first version. A multi-bit connector
 * would need one pin per bit or a bus protocol, and either choice is a contract
 * the panel should not guess; wide connectors stay on the serial line, where the
 * protocol already carries them as one number.
 *
 * D0/D1 ARE NOT OFFERED: they are the USB serial line the game itself talks on.
 * The Nano's A6/A7 are not offered either -- on the ATmega328P they are
 * analogue-only and cannot be driven or pulled up.
 */

/** A pin as the player sees it: `2`…`13`, `A0`…, following the Arduino core. */
export type PinId = string;

/** Connector instance id (`IN_1`, `OUT_1`) -> the board pin it uses. */
export type PinMap = Readonly<Record<string, PinId>>;

/** Uno and Nano: the same ATmega328P pinout, minus D0/D1 and A6/A7. */
const UNO_PINS: readonly PinId[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
];

/** Mega 2560: the extra headers, all of them digital-capable. */
const MEGA_PINS: readonly PinId[] = [
  ...UNO_PINS,
  ...Array.from({ length: 32 }, (_, index) => String(22 + index)),
  ...Array.from({ length: 10 }, (_, index) => `A${6 + index}`),
];

/** The pins the panel offers for a board, in header order. */
export function boardPinChoices(board: BoardId): readonly PinId[] {
  return board === 'arduino:avr:mega' ? MEGA_PINS : UNO_PINS;
}

/** Whether a board has the pin at all. */
export function boardHasPin(board: BoardId, pin: PinId): boolean {
  return boardPinChoices(board).includes(pin);
}

/**
 * The pin's number, which is what the sketch writes.
 *
 * The Arduino core defines `A0` as 14 on the 328P but 54 on the Mega 2560, so a
 * numeric literal is exactly what `digitalWrite` would use -- but the number
 * depends on the board. `buildImage` resolves it once (the image carries the
 * numbers it emits) and the sketch needs no `A*` constants, which is also what
 * keeps the host shim from having to invent them.
 */
export function pinValue(board: BoardId, pin: PinId): number {
  const analog = /^A(\d{1,2})$/.exec(pin);
  if (analog !== null) return board === 'arduino:avr:mega' ? 54 + Number(analog[1]) : 14 + Number(analog[1]);
  return Number(pin);
}

/** One sandbox connector, as the validator sees it. */
export interface PinConnector {
  readonly id: string;
  readonly width: number;
}

export type PinIssueCode = 'unsupported-pin' | 'duplicate-pin' | 'wide-connector';

/** Why one assignment cannot be used, with everything a message needs. */
export interface PinIssue {
  readonly code: PinIssueCode;
  readonly connector: string;
  readonly pin?: PinId;
  /** For `duplicate-pin`: the connector that already holds it. */
  readonly other?: string;
}

/**
 * Everything wrong with a mapping, in connector order.
 *
 * A key for a connector the circuit does not have is ignored rather than
 * reported: the panel remembers assignments across edits and board changes, and
 * a connector that was deleted must not make the remaining circuit unbuildable.
 */
export function validatePinMap(
  board: BoardId,
  connectors: readonly PinConnector[],
  map: PinMap,
): readonly PinIssue[] {
  const allowed = new Set(boardPinChoices(board));
  const holders = new Map<PinId, string>();
  const issues: PinIssue[] = [];
  for (const connector of connectors) {
    const pin = map[connector.id];
    if (pin === undefined) continue;
    if (connector.width !== 1) {
      issues.push({ code: 'wide-connector', connector: connector.id });
      continue;
    }
    if (!allowed.has(pin)) {
      issues.push({ code: 'unsupported-pin', connector: connector.id, pin });
      continue;
    }
    const other = holders.get(pin);
    if (other !== undefined) {
      issues.push({ code: 'duplicate-pin', connector: connector.id, pin, other });
      continue;
    }
    holders.set(pin, connector.id);
  }
  return issues;
}
