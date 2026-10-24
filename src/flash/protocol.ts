/**
 * The serial line protocol between the game and the board.
 *
 * EVERY LINE IS ASCII AND EVERY LINE ENDS WITH `\n`; the firmware ignores `\r`.
 * It is deliberately a line protocol rather than a binary frame: the same
 * commands work typed into a serial monitor, which is what makes the board
 * debuggable without the game, and a garbled line is one bad line rather than a
 * desynchronised stream.
 *
 * Host to board:
 *
 *   I <connector-index> <value>   set an input connector (index in IN_1, IN_2 order)
 *   T                             apply one clock edge, settle, print a frame
 *   R                             clear storage and inputs, settle, print a frame
 *   C <hz>                        free-run the clock at hz (0 stops it)
 *   S                             print the current frame
 *   B                             print the banner again
 *
 * Board to host:
 *
 *   #TC1 <hash> <nodes> <slotBytes> <inputs> <outputs>
 *   F <tick> <stable> <out0> <out1> ...
 *   E <text>
 *
 * The banner carries the image hash so the game can say "the board is running a
 * different circuit" without trusting the port to be the one it flashed; the
 * frame carries every output connector as one unsigned number.
 */

/** A board that just booted (or was asked for its banner). */
export interface BoardBanner {
  readonly kind: 'banner';
  readonly hash: number;
  readonly nodes: number;
  readonly slotBytes: number;
  readonly inputCount: number;
  readonly outputCount: number;
}

/** One settled state of the board. */
export interface BoardFrame {
  readonly kind: 'frame';
  readonly tick: number;
  readonly stable: boolean;
  readonly outputs: readonly number[];
}

/** A command the firmware refused or a line it could not parse. */
export interface BoardError {
  readonly kind: 'error';
  readonly message: string;
}

/** Anything else the board printed (a boot message, a future line). */
export interface BoardOther {
  readonly kind: 'other';
  readonly text: string;
}

export type BoardLine = BoardBanner | BoardFrame | BoardError | BoardOther;

/** The largest value an output connector can carry on the wire. */
export const MAX_WIRE_VALUE = 0xffff_ffff;

/**
 * One line from the board, or `null` for a blank one.
 *
 * A malformed `F`/`#TC1` line becomes `other` rather than throwing: the serial
 * stream is not a trusted channel, a half-received line after a reconnect is
 * normal, and a reader that threw would drop the port for a single bad byte.
 */
export function parseBoardLine(raw: string): BoardLine | null {
  const line = raw.replace(/\r$/, '');
  if (line === '') return null;
  if (line.startsWith('#TC1 ')) {
    const parts = line.slice(5).split(' ').filter((part) => part !== '');
    if (parts.length < 5) return { kind: 'other', text: line };
    const hash = Number.parseInt(parts[0]!, 16);
    const nodes = Number.parseInt(parts[1]!, 10);
    const slotBytes = Number.parseInt(parts[2]!, 10);
    const inputCount = Number.parseInt(parts[3]!, 10);
    const outputCount = Number.parseInt(parts[4]!, 10);
    if (![hash, nodes, slotBytes, inputCount, outputCount].every(Number.isFinite)) {
      return { kind: 'other', text: line };
    }
    return { kind: 'banner', hash, nodes, slotBytes, inputCount, outputCount };
  }
  if (line.startsWith('F ')) {
    const parts = line.slice(2).split(' ').filter((part) => part !== '');
    if (parts.length < 2) return { kind: 'other', text: line };
    const tick = Number.parseInt(parts[0]!, 10);
    const stable = parts[1] === '1';
    const outputs: number[] = [];
    for (const part of parts.slice(2)) {
      const value = Number.parseInt(part, 10);
      if (!Number.isFinite(value)) return { kind: 'other', text: line };
      outputs.push(value);
    }
    if (!Number.isFinite(tick)) return { kind: 'other', text: line };
    return { kind: 'frame', tick, stable, outputs };
  }
  if (line.startsWith('E ')) return { kind: 'error', message: line.slice(2) };
  return { kind: 'other', text: line };
}

/** `I <index> <value>`: drive one input connector. */
export function encodeInput(index: number, value: number): string {
  return `I ${index} ${value >>> 0}\n`;
}

/** `T`: one clock edge. */
export function encodeTick(): string {
  return 'T\n';
}

/** `R`: clear storage and inputs. */
export function encodeReset(): string {
  return 'R\n';
}

/** `C <hz>`: free-run the board's own clock, or stop it. */
export function encodeClock(hz: number): string {
  return `C ${Math.max(0, Math.floor(hz))}\n`;
}

/** `S`: print the current frame. */
export function encodePoll(): string {
  return 'S\n';
}

/** The value of one output connector in a frame, or `undefined` if absent. */
export function frameValue(frame: BoardFrame, index: number): number | undefined {
  return frame.outputs[index];
}
