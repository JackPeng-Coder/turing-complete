// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStore, type AppState, type Store } from '../../src/app/store';
import { emptyProgress, applyGrade, type Progress } from '../../src/app/progress';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';
import { getLevel, LEVELS } from '../../src/levels/index';
import { grade } from '../../src/levels/grader';
import { mountPalette } from '../../src/ui/palette';
import { mountTruthTable } from '../../src/ui/truthTable';
import { mountShell } from '../../src/ui/shell';
import { mountMap } from '../../src/ui/map';
import { NARRATIVE, narrativeFor } from '../../src/ui/narrative';
import { THEME } from '../../src/ui/theme';
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

describe('narrative coverage', () => {
  it('writes dedicated text for every chapter 1 level', () => {
    for (const level of LEVELS.filter((l) => l.chapter === 1)) {
      expect(NARRATIVE[level.id], `no narrative for ${level.id}`).toBeDefined();
      const text = narrativeFor(level.id);
      expect(text.before.zh.length).toBeGreaterThan(4);
      expect(text.after.en.length).toBeGreaterThan(4);
    }
  });

  it('falls back to generic text for a level with no narrative yet', () => {
    const text = narrativeFor('ch9-not-written-yet');
    expect(text.before.zh.length).toBeGreaterThan(0);
    expect(text.before.zh).not.toBe(NARRATIVE['ch1-04-and-gate']!.before.zh);
  });

  /**
   * Both locales are rendered by the same overlay; a missing `en` would ship a
   * briefing that reads `undefined` to an English player, and the fallback path
   * has to be complete for the same reason.
   */
  it('has both locales for every chapter 1 level, before and after', () => {
    for (const level of LEVELS.filter((l) => l.chapter === 1)) {
      const text = narrativeFor(level.id);
      expect(text.before.en.length, `before.en for ${level.id}`).toBeGreaterThan(4);
      expect(text.after.zh.length, `after.zh for ${level.id}`).toBeGreaterThan(4);
    }
    const fallback = narrativeFor('ch9-not-written-yet');
    expect(fallback.before.en.length).toBeGreaterThan(0);
    expect(fallback.after.zh.length).toBeGreaterThan(0);
  });
});

describe('chapter map', () => {
  function mapStore(levelId: string, progress: Progress = emptyProgress()): Store<AppState> {
    const store = makeStore(levelId);
    store.set({ progress });
    return store;
  }

  /**
   * jsdom parses the inline colour and reports it back normalised, so a
   * comparison against `THEME.success` has to be made in the same units.
   */
  function rgbOf(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${r}, ${g}, ${b})`;
  }

  const passedLevel1: Progress = {
    version: 1,
    levels: {
      'ch1-01-crude-awakening': {
        passed: true,
        best: { gate: 0, delay: 0, tick: 0 },
        stars: 3,
      },
    },
  };

  it('shows one tile per level and disables the ones still locked', () => {
    const root = document.createElement('div');
    mountMap(root, mapStore('ch1-01-crude-awakening'), () => {});
    const tiles = [...root.querySelectorAll<HTMLButtonElement>('.map-tile')];
    expect(tiles).toHaveLength(LEVELS.length);
    expect(tiles[0]!.disabled).toBe(false);
    expect(tiles[1]!.disabled).toBe(true);
    expect(tiles[2]!.disabled).toBe(true);
  });

  it('marks the level that is open, and only that one', () => {
    const root = document.createElement('div');
    mountMap(root, mapStore('ch1-02-nand-gate', passedLevel1), () => {});
    const tiles = [...root.querySelectorAll<HTMLButtonElement>('.map-tile')];
    expect(tiles.filter((t) => t.classList.contains('map-tile-current'))).toEqual([tiles[1]]);
  });

  it('shows the stars of a passed level and unlocks its successor', () => {
    const root = document.createElement('div');
    mountMap(root, mapStore('ch1-01-crude-awakening', passedLevel1), () => {});
    const tiles = [...root.querySelectorAll<HTMLButtonElement>('.map-tile')];
    expect(tiles[0]!.textContent).toContain('★');
    expect(tiles[0]!.style.color).toBe(rgbOf(THEME.success));
    expect(tiles[1]!.disabled).toBe(false);
    expect(tiles[2]!.disabled).toBe(true);
    // a tile that is neither passed nor unlocked is dimmed, not tinted green
    expect(tiles[2]!.style.color).toBe(rgbOf(THEME.textMuted));
  });

  it('reports the selected level id and ignores clicks on locked tiles', () => {
    const root = document.createElement('div');
    const picked: string[] = [];
    mountMap(root, mapStore('ch1-01-crude-awakening', passedLevel1), (id) => picked.push(id));
    const tiles = [...root.querySelectorAll<HTMLButtonElement>('.map-tile')];
    tiles[1]!.click();
    tiles[2]!.click(); // still locked: a disabled button fires nothing
    expect(picked).toEqual(['ch1-02-nand-gate']);
  });

  it('re-renders when progress changes', () => {
    const store = mapStore('ch1-01-crude-awakening');
    const root = document.createElement('div');
    mountMap(root, store, () => {});
    const before = [...root.querySelectorAll<HTMLButtonElement>('.map-tile')];
    expect(before[1]!.disabled).toBe(true);

    store.set({ progress: passedLevel1 });
    const after = [...root.querySelectorAll<HTMLButtonElement>('.map-tile')];
    expect(after).toHaveLength(LEVELS.length);
    expect(after[1]!.disabled).toBe(false);
  });
});
