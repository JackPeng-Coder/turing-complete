import { describe, expect, it } from 'vitest';
import { THEME, bodyColourOf, glowColourOf, partStateOf } from '../../src/ui/theme';
import { gateLookOf } from '../../src/ui/board/render';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';

const registry = createRegistry(BASE_DEFS);

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

/**
 * The original draws every gate differently, and so does the board: the shapes
 * are read faster than the labels are, and a grid of identical boxes says
 * nothing about what is on it.
 */
describe('gate silhouettes', () => {
  /**
   * The whole family, walked rather than listed: a gate added to `logic1`
   * without a silhouette fails here instead of shipping as a plain box that
   * looks like a register.
   */
  it('gives every boolean part a shape of its own', () => {
    const family = registry.byCategory('logic1');
    expect(family).toHaveLength(10);
    for (const def of family) {
      expect(gateLookOf(def).shape, `${def.id} has no silhouette`).not.toBe('box');
    }
  });

  it('distinguishes the inverting gates with a bubble', () => {
    // AND and NAND share a body; the bubble is the whole difference between
    // them, and it is how a logic diagram has always said so.
    const look = (id: string) => gateLookOf(registry.get(id));
    expect(look('and').shape).toBe(look('nand').shape);
    expect(look('and').bubble).toBe(false);
    expect(look('nand').bubble).toBe(true);
    expect(look('or').shape).toBe(look('nor').shape);
    expect(look('xor').shape).toBe(look('xnor').shape);
    for (const id of ['not', 'nor', 'xnor']) expect(look(id).bubble, id).toBe(true);
    for (const id of ['or', 'xor', 'and3', 'or3', 'and', 'full_adder']) {
      expect(look(id).bubble, id).toBe(false);
    }
  });

  it('separates the OR family from the XOR family', () => {
    const shape = (id: string) => gateLookOf(registry.get(id)).shape;
    expect(shape('or')).toBe('or');
    expect(shape('xor')).toBe('xor');
    expect(shape('xor')).not.toBe(shape('or'));
    // The full adder is a circuit and not a gate, so it is drawn as a block.
    expect(shape('full_adder')).toBe('block');
  });

  it('leaves ordinary parts as boxes', () => {
    for (const id of ['level_input', 'level_output', 'const_on', 'mem1', 'delay_line']) {
      expect(gateLookOf(registry.get(id)).shape, id).toBe('box');
    }
  });
});
