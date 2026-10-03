import { describe, expect, it } from 'vitest';
import { addInstance, emptyGraph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import { hitTest, pinPosition, screenToWorld, snap, worldToScreen } from '../../src/ui/board/view';
import { instanceHeight } from '../../src/ui/board/geometry';

const registry = createRegistry(BASE_DEFS);

describe('camera', () => {
  it('round-trips world and screen coordinates', () => {
    const camera = { x: 100, y: 50, zoom: 2 };
    const world = { x: 13, y: 27 };
    const screen = worldToScreen(camera, world);
    expect(screenToWorld(camera, screen)).toEqual(world);
  });

  it('translates without scaling when zoom is 1', () => {
    expect(worldToScreen({ x: 10, y: 20, zoom: 1 }, { x: 5, y: 5 })).toEqual({ x: 15, y: 25 });
  });
});

describe('snap', () => {
  it('snaps to the 8 pixel grid', () => {
    expect(snap(0)).toBe(0);
    expect(snap(3)).toBe(0);
    expect(snap(5)).toBe(8);
    expect(snap(13)).toBe(16);
    expect(Object.is(snap(-3), 0)).toBe(true); // -0 and 0 are the same grid cell
  });
});

describe('hitTest', () => {
  it('finds an instance by its body', () => {
    const g = emptyGraph();
    const inst = addInstance(g, 'nand', 100, 100);
    const hit = hitTest(g, registry, { x: 100, y: 100 });
    expect(hit).toEqual({ kind: 'instance', id: inst.id });
  });

  it('prefers a pin over the body underneath it', () => {
    const g = emptyGraph();
    const inst = addInstance(g, 'nand', 100, 100);
    const pin = { inst: inst.id, port: 'a', isInput: true };
    const pos = pinPosition(g.instances[0]!, registry.get('nand'), 'a', true);
    const hit = hitTest(g, registry, pos);
    expect(hit).toEqual({ kind: 'pin', ...pin });
  });

  it('returns null in empty space', () => {
    expect(hitTest(emptyGraph(), registry, { x: 5000, y: 5000 })).toBeNull();
  });
});

/**
 * A body is as tall as its pins need, which is the fix for a column of loose pin
 * markers trailing down the paper below the splitter: the registered height was
 * fixed at 72 and `pinPosition` spread the pins about the centre whatever the
 * count, so anything with a fourth pin on an edge drew it outside its own body.
 */
describe('a body that holds its own pins', () => {
  const pinY = (defId: string): number[] => {
    const def = registry.get(defId);
    const g = emptyGraph();
    const inst = addInstance(g, defId, 0, 0);
    const ys: number[] = [];
    for (const pin of def.inputs) ys.push(pinPosition(inst, def, pin.id, true).y);
    for (const pin of def.outputs) ys.push(pinPosition(inst, def, pin.id, false).y);
    return ys;
  };

  it('is exactly 72 for every part that already fitted', () => {
    // Three pins is 72, which is the height every level connector, gate and wide
    // operator was drawn at before. Nothing about those parts moved.
    for (const id of ['level_input', 'level_output', 'nand', 'and', 'and3', 'or3', 'xor', 'add8']) {
      expect(instanceHeight(registry.get(id)), id).toBe(72);
    }
  });

  it('grows so that no pin of any registered part lands outside it', () => {
    // Walked over the whole registry: a part added later with nine pins on an
    // edge fails here rather than shipping with its pins in space.
    for (const def of registry.all()) {
      const height = instanceHeight(def);
      for (const y of pinY(def.id)) {
        expect(y, `${def.id} has a pin outside its body`).toBeGreaterThanOrEqual(0);
        expect(y, `${def.id} has a pin outside its body`).toBeLessThanOrEqual(height);
      }
    }
  });

  it('is tall enough for the packers, which is what made them ugly', () => {
    // Eight outputs at 24 apart do not fit in 72 and never did.
    expect(instanceHeight(registry.get('splitter'))).toBe(192);
    expect(instanceHeight(registry.get('maker'))).toBe(192);
  });
});
