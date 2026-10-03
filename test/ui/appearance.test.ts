import { describe, expect, it } from 'vitest';
import { THEME, bodyColourOf, glowColourOf, partStateOf } from '../../src/ui/theme';

/**
 * The board's colour rule, on its own.
 *
 * Every wire, pin, part body and bit cell reads the same three colours, so this
 * one mapping is what the whole board's legibility rests on -- and it is the part
 * of the painting that can be tested without a canvas.
 */
describe('the board value rule', () => {
  it('reads green as 1, red as 0 and blue as wider than one bit', () => {
    expect(partStateOf(1, 1)).toBe('on');
    expect(partStateOf(1, 0)).toBe('off');
    expect(partStateOf(8, 0)).toBe('bus');
    expect(partStateOf(8, 255)).toBe('bus');
  });

  /**
   * Not red. A value the app has not simulated is not a zero, and a half-built
   * board painted in confident red would be telling the player something the app
   * cannot know.
   */
  it('leaves a part neutral until something has been simulated', () => {
    expect(partStateOf(1, undefined)).toBe('idle');
    expect(partStateOf(8, undefined)).toBe('idle');
    expect(glowColourOf('idle')).toBeNull();
  });

  it('paints a word blue whatever its low bit is', () => {
    // Width wins over value: an eight-bit part has no single bit to report.
    expect(partStateOf(8, 1)).toBe('bus');
    expect(bodyColourOf('bus')).toBe(THEME.busBody);
    expect(bodyColourOf('on')).toBe(THEME.onBody);
    expect(bodyColourOf('off')).toBe(THEME.offBody);
    expect(bodyColourOf('idle')).toBe(THEME.idleBody);
  });

  it('haloes only what is lit', () => {
    expect(glowColourOf('on')).toBe(THEME.on);
    expect(glowColourOf('bus')).toBe(THEME.bus);
    expect(glowColourOf('off')).toBeNull();
  });

  it('keeps the three value colours distinct from each other', () => {
    // A palette edit that collapsed two of them would make the board unreadable
    // in a way nothing else in the suite would notice.
    expect(new Set([THEME.on, THEME.off, THEME.bus]).size).toBe(3);
    expect(new Set([THEME.onBody, THEME.offBody, THEME.busBody]).size).toBe(3);
    expect(new Set([THEME.onBody, THEME.offBody, THEME.busBody, THEME.idleBody]).size).toBe(4);
  });
});
