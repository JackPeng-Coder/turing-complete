import { describe, expect, it } from 'vitest';
import { addInstance, emptyGraph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import { hitTest, pinPosition, screenToWorld, snap, worldToScreen } from '../../src/ui/board/view';

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
