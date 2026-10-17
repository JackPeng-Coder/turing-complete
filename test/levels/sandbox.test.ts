/**
 * THE SANDBOX'S PINS ARE THE CONNECTORS ON IT.
 *
 * A level declares its pins in `io`; a sandbox has no puzzle, so it declares none
 * and the player's own `level_input` / `level_output` parts are the pins. This
 * file pins that reading down (`sandboxPins`), the one entry point every reader
 * goes through (`boardPins`), and the naming a placed connector gets
 * (`levelIoPlacement`), because without the `IN_n` / `OUT_n` name the board would
 * not paint the connector's value.
 */
import { describe, expect, it } from 'vitest';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, emptyGraph } from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { getLevel } from '../../src/levels/index';
import {
  SANDBOX_CONNECTORS,
  SANDBOX_ID,
  SANDBOX_LEVEL,
  boardPins,
  sandboxPins,
} from '../../src/levels/sandbox';
import { levelIoPlacement } from '../../src/ui/board/interact';

const registry = createRegistry(BASE_DEFS);

describe('the sandbox board pins', () => {
  it('are the connectors placed on the board, in creation order', () => {
    const g = emptyGraph(SANDBOX_ID);
    addInstance(g, 'level_input', 0, 0, 'IN_1');
    addInstance(g, 'level_input', 0, 80, 'IN_2').params.width = 8;
    addInstance(g, 'level_output', 200, 0, 'OUT_1');
    const pins = sandboxPins(g, registry);
    expect(pins.inputs.map((pin) => [pin.id, pin.width])).toEqual([
      ['IN_1', 1],
      ['IN_2', 8],
    ]);
    expect(pins.outputs.map((pin) => [pin.id, pin.width])).toEqual([['OUT_1', 1]]);
  });

  it('ignores everything on the board that is not a connector', () => {
    const g = emptyGraph(SANDBOX_ID);
    addInstance(g, 'nand', 0, 0, 'i1');
    addInstance(g, 'const_on', 0, 80, 'i2');
    expect(sandboxPins(g, registry)).toEqual({ inputs: [], outputs: [] });
  });

  it('is the level own pin list on an ordinary level', () => {
    const level = getLevel('ch1-04-and-gate');
    const g = emptyGraph(level.id);
    // Not a copy: a level's pins are fixed data, and the panel may hold it.
    expect(boardPins(level, g, registry)).toBe(level.io);
  });

  it('is exactly the two connectors a sandbox palette adds', () => {
    expect([...SANDBOX_CONNECTORS]).toEqual(['level_input', 'level_output']);
  });
});

describe('placing a connector in the sandbox', () => {
  it('names it IN_<n> / OUT_<n>, one bit each', () => {
    const g = emptyGraph(SANDBOX_ID);
    expect(levelIoPlacement(SANDBOX_LEVEL, g, 'level_input')).toEqual({ id: 'IN_1', width: 1 });
    addInstance(g, 'level_input', 0, 0, 'IN_1');
    expect(levelIoPlacement(SANDBOX_LEVEL, g, 'level_input')).toEqual({ id: 'IN_2', width: 1 });
    expect(levelIoPlacement(SANDBOX_LEVEL, g, 'level_output')).toEqual({ id: 'OUT_1', width: 1 });
    // Only the two connectors are named this way; an ordinary part is left to the
    // graph's own allocator.
    expect(levelIoPlacement(SANDBOX_LEVEL, g, 'nand')).toBeUndefined();
  });

  it('does not rename a connector that is already there', () => {
    const g = emptyGraph(SANDBOX_ID);
    addInstance(g, 'level_input', 0, 0, 'IN_1');
    addInstance(g, 'level_input', 0, 80, 'IN_2');
    addInstance(g, 'level_output', 200, 0, 'OUT_1');
    expect(levelIoPlacement(SANDBOX_LEVEL, g, 'level_input')).toEqual({ id: 'IN_3', width: 1 });
    expect(levelIoPlacement(SANDBOX_LEVEL, g, 'level_output')).toEqual({ id: 'OUT_2', width: 1 });
  });

  it('still binds a level by the pins its spec declares', () => {
    const level = getLevel('ch1-04-and-gate');
    const g = emptyGraph(level.id);
    expect(levelIoPlacement(level, g, 'level_input')).toEqual({ id: 'IN_a', width: 1 });
    addInstance(g, 'level_output', 0, 0, 'OUT');
    // The level's single output is taken, so a second one would be a spare whose
    // id is the allocator's business.
    expect(levelIoPlacement(level, g, 'level_output')).toBeUndefined();
  });
});
