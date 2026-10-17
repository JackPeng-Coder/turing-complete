/**
 * THE CLICK ON AN INPUT CONNECTOR, as a pure decision.
 *
 * The board has always said "a click on an input flips what it drives" -- one bit
 * toggles, a wider pin counts up and wraps -- and the sandbox did not honour it,
 * because the handler resolved the pin by slicing `IN_` off the instance id and
 * looking the rest up in `level.io`. A sandbox has no `level.io`: its pins ARE
 * its connectors, with the instance id as the pin id (`sandboxPins`). So a click
 * on `IN_1` found nothing and did nothing, while the same click on a level's
 * `IN_a` worked.
 *
 * This file holds the decision itself, away from main.ts, so both boards are
 * tested against one table rather than one of them being "covered by the browser".
 */
import { describe, expect, it } from 'vitest';
import { nudgedInput } from '../../src/app/inputs';
import type { BoardPins } from '../../src/levels/sandbox';

const levelPins: BoardPins = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 8 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};

const sandboxPins: BoardPins = {
  inputs: [
    { id: 'IN_1', width: 1 },
    { id: 'IN_2', width: 8 },
  ],
  outputs: [{ id: 'OUT_1', width: 1 }],
};

describe('a click nudges an input pin', () => {
  it('toggles a level input by its IN_<pin> instance name', () => {
    expect(nudgedInput(levelPins, 'IN_a', {})).toEqual({ pinId: 'a', value: 1 });
    expect(nudgedInput(levelPins, 'IN_a', { a: 1 })).toEqual({ pinId: 'a', value: 0 });
  });

  it('counts a wider level pin up and wraps it at its own width', () => {
    expect(nudgedInput(levelPins, 'IN_b', { b: 4 })).toEqual({ pinId: 'b', value: 5 });
    expect(nudgedInput(levelPins, 'IN_b', { b: 255 })).toEqual({ pinId: 'b', value: 0 });
  });

  it("toggles a sandbox connector by the instance id that IS the pin id", () => {
    // The click that used to do nothing: `IN_1` has no `level.io` pin called `1`.
    expect(nudgedInput(sandboxPins, 'IN_1', {})).toEqual({ pinId: 'IN_1', value: 1 });
    expect(nudgedInput(sandboxPins, 'IN_1', { IN_1: 1 })).toEqual({ pinId: 'IN_1', value: 0 });
    expect(nudgedInput(sandboxPins, 'IN_2', { IN_2: 255 })).toEqual({ pinId: 'IN_2', value: 0 });
  });

  it('does nothing to a part that is not an input connector', () => {
    // A click on a gate means select, on both boards.
    expect(nudgedInput(levelPins, 'i1', {})).toBeNull();
    expect(nudgedInput(sandboxPins, 'i1', {})).toBeNull();
    // An output connector is not a driver either.
    expect(nudgedInput(sandboxPins, 'OUT_1', {})).toBeNull();
    // A connector name that is not on this board's pin list.
    expect(nudgedInput(sandboxPins, 'IN_9', {})).toBeNull();
  });
});
