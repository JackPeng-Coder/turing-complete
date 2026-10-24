import { describe, expect, it } from 'vitest';
import {
  encodeClock,
  encodeInput,
  encodePoll,
  encodeReset,
  encodeTick,
  frameValue,
  parseBoardLine,
} from '../../src/flash/protocol';

describe('the board protocol', () => {
  it('parses the banner and its image hash', () => {
    expect(parseBoardLine('#TC1 1A2B3C4D 896 340 2 1\r')).toEqual({
      kind: 'banner',
      hash: 0x1a2b3c4d,
      nodes: 896,
      slotBytes: 340,
      inputCount: 2,
      outputCount: 1,
    });
  });

  it('parses a frame with every output column', () => {
    expect(parseBoardLine('F 42 1 255 0 7')).toEqual({
      kind: 'frame',
      tick: 42,
      stable: true,
      outputs: [255, 0, 7],
    });
  });

  it('marks an unsettled frame rather than dropping it', () => {
    const line = parseBoardLine('F 9 0 1');
    expect(line).toEqual({ kind: 'frame', tick: 9, stable: false, outputs: [1] });
  });

  it('parses an error line', () => {
    expect(parseBoardLine('E nope')).toEqual({ kind: 'error', message: 'nope' });
  });

  it('treats a blank line as nothing to do', () => {
    expect(parseBoardLine('')).toBeNull();
    expect(parseBoardLine('\r')).toBeNull();
  });

  it('keeps an unparseable line as text instead of throwing', () => {
    expect(parseBoardLine('hello board')).toEqual({ kind: 'other', text: 'hello board' });
    // A half-received banner after a reconnect is normal; it must not look like
    // a real banner with NaN fields.
    expect(parseBoardLine('#TC1 1 2')).toEqual({ kind: 'other', text: '#TC1 1 2' });
    expect(parseBoardLine('F nope 1 3')).toEqual({ kind: 'other', text: 'F nope 1 3' });
    expect(parseBoardLine('F 1 1 nope')).toEqual({ kind: 'other', text: 'F 1 1 nope' });
  });

  it('encodes commands as one newline-terminated line each', () => {
    expect(encodeInput(2, 255)).toBe('I 2 255\n');
    expect(encodeInput(0, 0xffff_ffff)).toBe('I 0 4294967295\n');
    expect(encodeTick()).toBe('T\n');
    expect(encodeReset()).toBe('R\n');
    expect(encodeClock(10)).toBe('C 10\n');
    expect(encodeClock(-5)).toBe('C 0\n');
    expect(encodePoll()).toBe('S\n');
  });

  it('reads one output column, and nothing for an absent one', () => {
    const frame = parseBoardLine('F 1 1 3 4');
    if (frame === null || frame.kind !== 'frame') throw new Error('not a frame');
    expect(frameValue(frame, 0)).toBe(3);
    expect(frameValue(frame, 1)).toBe(4);
    expect(frameValue(frame, 2)).toBeUndefined();
  });
});
