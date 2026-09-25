// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStore, type AppState, type Store } from '../../src/app/store';
import { emptyProgress, applyGrade } from '../../src/app/progress';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';
import { getLevel } from '../../src/levels/index';
import { grade } from '../../src/levels/grader';
import { mountPalette } from '../../src/ui/palette';
import { mountTruthTable } from '../../src/ui/truthTable';
import { mountShell } from '../../src/ui/shell';
import { levelIoInstanceId } from '../../src/ui/board/interact';

const registry = createRegistry(BASE_DEFS);

/**
 * `Store<AppState>` rather than an inferred literal state: without the
 * annotation TypeScript widens `lastGrade: null` to the type `null` and the
 * panel tests cannot set a grade on the store at all.
 */
function makeStore(levelId: string): Store<AppState> {
  return createStore<AppState>({
    level: getLevel(levelId),
    graph: emptyGraph(levelId),
    registry,
    progress: emptyProgress(),
    camera: { x: 0, y: 0, zoom: 1 },
    selected: [],
    dragging: null,
    lastGrade: null,
    status: null,
  });
}

describe('palette panel', () => {
  it('offers nothing but the starter components while nothing is unlocked', () => {
    // level 2 needs a NAND, which only level 1's reward unlocks
    const store = makeStore('ch1-02-nand-gate');
    const root = document.createElement('div');
    mountPalette(root, store, () => {});
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['关卡输入', '关卡输出']);
  });

  it('offers a part once its unlocking level is passed', () => {
    const store = makeStore('ch1-02-nand-gate');
    const passed = applyGrade(emptyProgress(), getLevel('ch1-01-crude-awakening'), {
      passed: true,
      metrics: { gate: 0, delay: 0, tick: 0 },
      score: 0,
      stars: 3,
      failures: [],
      issues: [],
    });
    store.set({ progress: passed });
    const root = document.createElement('div');
    mountPalette(root, store, () => {});
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('与非门');
  });

  it('reports the picked part id, not its label', () => {
    const store = makeStore('ch1-01-crude-awakening');
    const root = document.createElement('div');
    const picked: string[] = [];
    mountPalette(root, store, (defId) => picked.push(defId));
    const on = [...root.querySelectorAll('button')].find((b) => b.textContent === '高电平');
    on?.click();
    expect(picked).toEqual(['const_on']);
  });
});

describe('truth table panel', () => {
  it('reports a pass with the three metrics', () => {
    const store = makeStore('ch1-01-crude-awakening');
    store.set({
      lastGrade: {
        passed: true,
        metrics: { gate: 0, delay: 0, tick: 0 },
        score: 0,
        stars: 3,
        failures: [],
        issues: [],
      },
    });
    const root = document.createElement('div');
    mountTruthTable(root, store);
    expect(root.textContent).toContain('全部用例通过');
    expect(root.textContent).toContain('门 0');
  });

  it('lists failing rows with expected and actual values', () => {
    const store = makeStore('ch1-04-and-gate');
    store.set({
      lastGrade: {
        passed: false,
        metrics: { gate: 1, delay: 1, tick: 0 },
        score: 5,
        stars: 0,
        failures: [
          {
            check: 'truth-table',
            inputs: { a: 0, b: 0 },
            expected: { out: 0 },
            actual: { out: 1 },
            tick: 0,
            reason: 'mismatch',
          },
        ],
        issues: [],
      },
    });
    const root = document.createElement('div');
    mountTruthTable(root, store);
    expect(root.textContent).toContain('1 ≠ 0');
  });
});

describe('shell bar', () => {
  it('shows the level name and score once graded', () => {
    const store = makeStore('ch1-04-and-gate');
    const root = document.createElement('div');
    mountShell(root, store, { onOpenMap: () => {} });
    expect(root.textContent).toContain('与门');
    store.set({
      lastGrade: {
        passed: true,
        metrics: { gate: 2, delay: 2, tick: 0 },
        score: 10,
        stars: 3,
        failures: [],
        issues: [],
      },
    });
    expect(root.textContent).toContain('得分 10');
    expect(root.textContent).toContain('★★★');
  });

  it('offers a way back to the chapter map', () => {
    const store = makeStore('ch1-04-and-gate');
    const root = document.createElement('div');
    let opened = 0;
    mountShell(root, store, {
      onOpenMap: () => {
        opened += 1;
      },
    });
    (root.querySelector('button') as HTMLButtonElement).click();
    expect(opened).toBe(1);
  });
});

/**
 * Dropping a part from the palette is the only way a player can put level IO
 * on the board, and `levels/checks.ts` binds a circuit to its level by instance
 * id (`IN_<pin>`, `OUT`, `OUT_<pin>`). Without these ids every placement would
 * be named `i1`, `i2`, … and no level could ever be passed.
 */
describe('level io placement', () => {
  it('names the single level output OUT', () => {
    const level = getLevel('ch1-01-crude-awakening');
    expect(levelIoInstanceId(level, emptyGraph(level.id), 'level_output')).toBe('OUT');
  });

  it('hands out one level input per declared pin, then stops naming them', () => {
    const level = getLevel('ch1-02-nand-gate');
    const g = emptyGraph(level.id);
    expect(levelIoInstanceId(level, g, 'level_input')).toBe('IN_a');
    addInstance(g, 'level_input', 0, 0, 'IN_a');
    expect(levelIoInstanceId(level, g, 'level_input')).toBe('IN_b');
    addInstance(g, 'level_input', 0, 0, 'IN_b');
    // every level input is placed: an extra part falls back to a plain id
    expect(levelIoInstanceId(level, g, 'level_input')).toBeUndefined();
  });

  it('names the four outputs of the binary racer in pin order', () => {
    const level = getLevel('ch1-12-binary-racer');
    const g = emptyGraph(level.id);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = levelIoInstanceId(level, g, 'level_output');
      expect(id).toBeDefined();
      ids.push(id!);
      addInstance(g, 'level_output', 0, 0, id);
    }
    expect(ids).toEqual(['OUT_out3', 'OUT_out2', 'OUT_out1', 'OUT_out0']);
  });

  it('leaves ordinary gates to the graph id allocator', () => {
    const level = getLevel('ch1-04-and-gate');
    expect(levelIoInstanceId(level, emptyGraph(level.id), 'nand')).toBeUndefined();
  });

  it('makes level 1 pass with two palette placements and one wire', () => {
    const level = getLevel('ch1-01-crude-awakening');
    const g = emptyGraph(level.id);
    const source = addInstance(g, 'const_on', 0, 0);
    const sink = addInstance(g, 'level_output', 128, 0, levelIoInstanceId(level, g, 'level_output'));
    connect(g, { inst: source.id, port: 'out' }, { inst: sink.id, port: 'in' });

    expect(sink.id).toBe('OUT');
    const result = grade(g, registry, level);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.stars).toBe(3);
  });
});
