import { describe, expect, it } from 'vitest';
import {
  boardHasPin,
  boardPinChoices,
  pinValue,
  validatePinMap,
  type PinConnector,
} from '../../src/flash/pins';

/** Two one-bit connectors and one wide one, the shapes the panel can show. */
const CONNECTORS: readonly PinConnector[] = [
  { id: 'IN_1', width: 1 },
  { id: 'OUT_1', width: 1 },
  { id: 'IN_2', width: 8 },
];

describe('the board pin vocabulary', () => {
  it('offers the digital pins and the analogue header, never the serial line', () => {
    const uno = boardPinChoices('arduino:avr:uno');
    expect(uno).toContain('2');
    expect(uno).toContain('13');
    expect(uno).toContain('A0');
    expect(uno).toContain('A5');
    // D0/D1 are the USB serial line the game talks on; A6/A7 are analogue-only
    // on the 328P, so neither can be a mapped connector.
    expect(uno).not.toContain('0');
    expect(uno).not.toContain('1');
    expect(uno).not.toContain('A6');
    expect(boardPinChoices('arduino:avr:nano')).toEqual(uno);
    const mega = boardPinChoices('arduino:avr:mega');
    expect(mega).toContain('22');
    expect(mega).toContain('53');
    expect(mega).toContain('A15');
    expect(mega).not.toContain('0');
    expect(boardHasPin('arduino:avr:uno', 'A0')).toBe(true);
    expect(boardHasPin('arduino:avr:uno', '22')).toBe(false);
    expect(boardHasPin('arduino:avr:mega', '22')).toBe(true);
  });

  it('turns a pin name into the number the sketch writes', () => {
    expect(pinValue('arduino:avr:uno', '2')).toBe(2);
    expect(pinValue('arduino:avr:uno', '13')).toBe(13);
    expect(pinValue('arduino:avr:mega', '22')).toBe(22);
    // A0 is 14 on the 328P but 54 on the Mega 2560; A15 is 69 on the Mega.
    expect(pinValue('arduino:avr:uno', 'A0')).toBe(14);
    expect(pinValue('arduino:avr:nano', 'A5')).toBe(19);
    expect(pinValue('arduino:avr:mega', 'A0')).toBe(54);
    expect(pinValue('arduino:avr:mega', 'A15')).toBe(69);
  });
});

describe('validatePinMap', () => {
  it('accepts an empty map and a one-bit connector on a real pin', () => {
    expect(validatePinMap('arduino:avr:uno', CONNECTORS, {})).toEqual([]);
    expect(validatePinMap('arduino:avr:uno', CONNECTORS, { IN_1: '2', OUT_1: '13' })).toEqual([]);
  });

  it('ignores a connector the circuit no longer has', () => {
    // The panel remembers assignments across edits; a deleted connector must not
    // make the rest of the circuit unbuildable.
    expect(validatePinMap('arduino:avr:uno', CONNECTORS, { GONE: '13' })).toEqual([]);
  });

  it('reports a wide connector rather than guessing a bus', () => {
    expect(validatePinMap('arduino:avr:uno', CONNECTORS, { IN_2: '3' })).toEqual([
      { code: 'wide-connector', connector: 'IN_2' },
    ]);
  });

  it('reports a pin the board does not have, and one asked for twice', () => {
    expect(validatePinMap('arduino:avr:uno', CONNECTORS, { IN_1: '22' })).toEqual([
      { code: 'unsupported-pin', connector: 'IN_1', pin: '22' },
    ]);
    expect(validatePinMap('arduino:avr:uno', CONNECTORS, { IN_1: '13', OUT_1: '13' })).toEqual([
      { code: 'duplicate-pin', connector: 'OUT_1', pin: '13', other: 'IN_1' },
    ]);
  });

  it('reports in connector order, so a message reads the way the panel lists them', () => {
    const issues = validatePinMap('arduino:avr:uno', CONNECTORS, {
      OUT_1: '22',
      IN_1: '23',
    });
    expect(issues.map((issue) => issue.connector)).toEqual(['IN_1', 'OUT_1']);
  });
});
