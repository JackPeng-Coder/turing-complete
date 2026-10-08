// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStore, type AppState, type Store } from '../../src/app/store';
import { emptyProgress, applyGrade, type Progress } from '../../src/app/progress';
import { CommandStack } from '../../src/app/commands';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';
import { getLevel, LEVELS } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';
import { grade } from '../../src/levels/grader';
import { mountPalette } from '../../src/ui/palette';
import { mountTruthTable } from '../../src/ui/truthTable';
import { mountShell } from '../../src/ui/shell';
import { mountIoPanel, type IoPanelOptions } from '../../src/ui/ioPanel';
import { mountToolbar, type ToolbarState } from '../../src/ui/toolbar';
import { mountMap } from '../../src/ui/map';
import { NARRATIVE, narrativeFor } from '../../src/ui/narrative';
import { THEME } from '../../src/ui/theme';
import { attachBoardInput, levelIoPlacement } from '../../src/ui/board/interact';

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
    armed: null,
    dev: false,
    programs: {},
    metrics: null,
    lastGrade: null,
    status: null,
  });
}

describe('palette panel', () => {
  /** Every SLOT in the tray. The ✕ that releases the armed part is not one. */
  const slots = (root: HTMLElement): (string | null)[] =>
    [...root.querySelectorAll('.palette-item')].map((b) => b.textContent);

  it('offers nothing but the starter components while nothing is unlocked', () => {
    // level 2 needs a NAND, which only level 1's reward unlocks
    const store = makeStore('ch1-02-nand-gate');
    const root = document.createElement('div');
    mountPalette(root, store, () => {});
    expect(slots(root)).toEqual(['关卡输入', '关卡输出']);
  });

  it('offers a part once its unlocking level is passed', () => {
    const store = makeStore('ch1-02-nand-gate');
    const passed = applyGrade(emptyProgress(), getLevel('ch1-01-humble-beginnings'), {
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
    const store = makeStore('ch1-01-humble-beginnings');
    const root = document.createElement('div');
    const picked: (string | null)[] = [];
    mountPalette(root, store, (defId) => picked.push(defId));
    const on = [...root.querySelectorAll('button')].find((b) => b.textContent === '高电平');
    on?.click();
    expect(picked).toEqual(['const_on']);
  });

  /**
   * THE WAY BACK TO HOLDING NOTHING, and the slot that shows you are holding
   * something.
   *
   * With a part armed, a drag on the board places parts instead of panning it,
   * so "nothing armed" is a state a player has to be able to reach without
   * knowing that Esc is the key.
   */
  it('lights the armed slot and offers a way out of it', () => {
    const store = makeStore('ch1-01-humble-beginnings');
    const root = document.createElement('div');
    const picked: (string | null)[] = [];
    mountPalette(root, store, (defId) => picked.push(defId));
    const slot = (): HTMLButtonElement =>
      [...root.querySelectorAll<HTMLButtonElement>('.palette-item')].find(
        (button) => button.textContent === '高电平',
      )!;
    const release = (): HTMLButtonElement => root.querySelector('.palette-release')!;

    expect(slot().classList.contains('palette-item-armed')).toBe(false);
    expect(release().hidden).toBe(true);

    store.set({ armed: 'const_on' });
    expect(slot().classList.contains('palette-item-armed')).toBe(true);
    expect(slot().getAttribute('aria-pressed')).toBe('true');
    expect(release().hidden).toBe(false);

    // The ✕ puts it down.
    release().click();
    expect(picked).toEqual([null]);

    // Clicking the slot again does NOT: stamping the same part three times in a
    // row is the commonest thing a player does, and a slot that put itself down
    // on the second click would place one part and then silently stop placing.
    picked.length = 0;
    slot().click();
    expect(picked).toEqual(['const_on']);
  });
});

describe('truth table panel', () => {
  it('lays the level’s declared cases out before anything has been run', () => {
    // The panel is a PLAN, not a report: the columns exist as soon as the level
    // is open, with the level's own expectations in them, exactly as the
    // original's bottom panel shows them. Nothing is marked wrong, and no output
    // is invented: an unrun circuit has no output to show, which is a neutral dot
    // per bit rather than a value.
    const store = makeStore('ch1-04-and-gate');
    const root = document.createElement('div');
    mountTruthTable(root, store);
    expect(root.querySelector('h2')?.textContent).toBe('用例');
    expect(root.querySelector('.case-count')?.textContent).toBe('共 4 个');
    // 输入 a / 输入 b / 预期 out / 当前 out
    expect(root.querySelectorAll('tr')).toHaveLength(4);
    expect(root.querySelectorAll('td')).toHaveLength(16);
    expect(root.querySelectorAll('.case-bad')).toHaveLength(0);
    // One dot per case on the `当前 out` row, and not one character of text
    // anywhere in the matrix: the cells are bits, not words.
    expect(root.querySelectorAll('.bit-x')).toHaveLength(4);
    expect([...root.querySelectorAll('td')].map((td) => td.textContent).join('')).toBe('');
  });

  it('reports a pass with the level’s own heading', () => {
    const store = makeStore('ch1-01-humble-beginnings');
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
  });

  /**
   * The wall of text, pinned. The panel used to print `用例 3 · out3: 0 ≠ 1`
   * under the matrix, one line per failing case -- which on a fifteen-row level
   * was fifteen lines of the same sentence, and is the complaint this test
   * exists to keep fixed. The matrix already says which bit is wrong and for
   * which case: the cell is boxed.
   */
  it('boxes the wrong pair instead of printing a line per failing case', () => {
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
    expect(root.querySelector('h2')?.textContent).toBe('未通过');
    // The `预期 out` and `当前 out` cells of the first case: two cells, one box.
    const boxed = [...root.querySelectorAll('.case-bad')];
    expect(boxed).toHaveLength(2);
    expect(boxed.map((cell) => cell.previousElementSibling?.textContent)).toEqual([
      '预期 out',
      '当前 out',
    ]);
    // The ends of that box are rounded and the middle is not: it reads as one
    // frame around the pair rather than two separate marks.
    expect(boxed[0]!.classList.contains('bad-cap-top')).toBe(true);
    expect(boxed[1]!.classList.contains('bad-cap-bottom')).toBe(true);
    expect(root.querySelectorAll('p')).toHaveLength(0);
    expect(root.textContent).not.toContain('≠');
  });

  /**
   * The run's payoff: while it is on a case, that column is highlighted and
   * `当前` shows what the CIRCUIT is producing for it, read off the live board --
   * not the last grade's record. Playing the cases one at a time is only worth
   * doing if the answer changes with the case.
   */
  it('reads the current output off the board for the case being played', () => {
    const store = makeStore('ch1-04-and-gate');
    const root = document.createElement('div');
    let active: number | null = 0;
    let live: Record<string, number> | null = { out: 1 };
    mountTruthTable(root, store, { live: () => live, active: () => active });

    /** Each row as its cells read: a value, or `x` for a bit nothing has read. */
    const rows = (): string[][] =>
      [...root.querySelectorAll('tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) =>
          [...td.querySelectorAll('.bit')].map((b) => b.className.replace('bit bit-', '')).join(''),
        ),
      );

    // The AND level's own rows: 00, 01, 10, 11 -> 0, 0, 0, 1.
    // Rows are 输入 a, 输入 b, 预期 out, 当前 out.
    expect(rows()[3]).toEqual(['1', 'x', 'x', 'x']);
    // ...and the live 1 disagrees with that case's expected 0, so that case's
    // expectation and value are boxed together.
    expect(root.querySelectorAll('.case-bad')).toHaveLength(2);
    // One cell per row wears the column's highlight, and the column's band is
    // rounded at the two ends rather than at every cell.
    expect(root.querySelectorAll('.case-active')).toHaveLength(4);
    expect(root.querySelectorAll('.case-active.cap-top')).toHaveLength(1);
    expect(root.querySelectorAll('.case-active.cap-bottom')).toHaveLength(1);
    expect(root.querySelector('h2')?.textContent).toBe('正在测试 用例 1 / 4');

    live = { out: 0 };
    active = 1;
    store.set({});
    expect(rows()[3]).toEqual(['x', '0', 'x', 'x']);
    // A 0 where the second case expects 0: nothing is marked wrong.
    expect(root.querySelectorAll('.case-bad')).toHaveLength(0);
    expect(root.querySelector('h2')?.textContent).toBe('正在测试 用例 2 / 4');
  });

  /**
   * A run's numbers outlive the run. The grade cannot supply them -- it records
   * the cases that FAILED -- so a table that read its `当前` row from the grade
   * alone would go blank wherever the circuit was right, which is half the
   * answer a player needs.
   */
  it('keeps every case’s number after the run has moved on', () => {
    const store = makeStore('ch1-04-and-gate');
    const root = document.createElement('div');
    const results: Array<Record<string, number> | null> = [
      { out: 0 },
      { out: 0 },
      { out: 0 },
      { out: 1 },
    ];
    mountTruthTable(root, store, { live: () => null, active: () => null, results: () => results });

    const current = [...root.querySelectorAll('tr')][3]!;
    // A cell is its bits, not text: `panels.test.ts` elsewhere reads every `td`
    // to prove a failure that drove no vector fabricates no `0`, and a bit cell
    // that also spelled its value out would defeat that reading.
    const bits = (tr: Element): string[] =>
      [...tr.querySelectorAll('td')].map((td) =>
        [...td.querySelectorAll('.bit')].map((b) => b.className.replace('bit bit-', '')).join(''),
      );
    expect(bits(current)).toEqual(['0', '0', '0', '1']);
    expect(root.querySelectorAll('.case-bad')).toHaveLength(0);
  });

  it('offers the test and the speed as buttons, and reports the running state', () => {
    const store = makeStore('ch1-04-and-gate');
    const root = document.createElement('div');
    const fired: string[] = [];
    let testing = false;
    mountTruthTable(root, store, {
      live: () => null,
      active: () => null,
      testing: () => testing,
      rate: () => '2×',
      onToggleTest: () => fired.push('test'),
      onCycleRate: () => fired.push('rate'),
    });

    expect(root.querySelector('.case-rate')?.textContent).toBe('2×');
    (root.querySelector('.case-test') as HTMLButtonElement).click();
    (root.querySelector('.case-rate') as HTMLButtonElement).click();
    expect(fired).toEqual(['test', 'rate']);

    testing = true;
    store.set({});
    expect(root.querySelector('.case-test')?.textContent).toBe('停止');
    expect(root.querySelector('.case-test')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('says why a level’s cases cannot be laid out', () => {
    // A `program` level's vectors only mean anything with the assembled image
    // loaded into the circuit's RAM. Rendering a made-up column would be showing
    // the player a test the level never runs.
    const store = makeStore('ch3-49-turing-complete');
    const root = document.createElement('div');
    mountTruthTable(root, store);
    expect(root.textContent).toContain('无法逐列演示');
    expect(root.querySelectorAll('td')).not.toHaveLength(0);
  });

  it('shows the reason and detail when a failure drove no vector at all', () => {
    // The `unstable` reason (levels 17 and 23) is raised by `settle`, before any
    // vector is driven, so all three maps are empty. Rendering those pins as 0
    // would show the player a test vector that was never driven -- the row has to
    // carry the reason and the detail instead.
    const store = makeStore('ch1-04-and-gate');
    store.set({
      lastGrade: {
        passed: false,
        metrics: { gate: 0, delay: 0, tick: 0 },
        score: 0,
        stars: 0,
        failures: [
          {
            check: 'fuzz',
            inputs: {},
            expected: {},
            actual: {},
            tick: 0,
            reason: 'unstable',
            round: 3,
            detail: 'fuzz round 3 did not settle',
          },
        ],
        issues: [],
      },
    });
    const root = document.createElement('div');
    mountTruthTable(root, store);
    expect(root.textContent).toContain('unstable');
    expect(root.textContent).toContain('fuzz round 3 did not settle');
    // Nothing may be fabricated: no cell of the table reads as a bare `0`.
    const cells = [...root.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).not.toContain('0');
  });
});

describe('shell bar', () => {
  /**
   * The bar reports two different things and they arrive at different times:
   * what the circuit COSTS, measured on every edit, and whether it is CORRECT,
   * which only a test run can say. Saying `未通过` while a player is still
   * drawing is the behaviour this split removes.
   */
  it('measures the circuit on every edit, and stars it only once it is tested', () => {
    const store = makeStore('ch1-04-and-gate');
    const root = document.createElement('div');
    mountShell(root, store, { onOpenMap: () => {} });
    expect(root.textContent).toContain('与门');
    expect(root.textContent).toContain('尚未评测');

    store.set({ metrics: { gate: 2, delay: 2, tick: 0 } });
    expect(root.textContent).toContain('总开销 10');
    expect(root.textContent).toContain('未测试');
    expect(root.textContent).not.toContain('未通过');

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
    expect(root.textContent).toContain('总开销 10');
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
    const level = getLevel('ch1-01-humble-beginnings');
    expect(levelIoPlacement(level, emptyGraph(level.id), 'level_output')?.id).toBe('OUT');
  });

  it('hands out one level input per declared pin, then stops naming them', () => {
    const level = getLevel('ch1-02-nand-gate');
    const g = emptyGraph(level.id);
    expect(levelIoPlacement(level, g, 'level_input')?.id).toBe('IN_a');
    addInstance(g, 'level_input', 0, 0, 'IN_a');
    expect(levelIoPlacement(level, g, 'level_input')?.id).toBe('IN_b');
    addInstance(g, 'level_input', 0, 0, 'IN_b');
    // every level input is placed: an extra part falls back to a plain id
    expect(levelIoPlacement(level, g, 'level_input')).toBeUndefined();
  });

  it('names the four outputs of the binary racer in pin order', () => {
    const level = getLevel('ch2-14-binary-racer');
    const g = emptyGraph(level.id);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = levelIoPlacement(level, g, 'level_output')?.id;
      expect(id).toBeDefined();
      ids.push(id!);
      addInstance(g, 'level_output', 0, 0, id);
    }
    expect(ids).toEqual(['OUT_out3', 'OUT_out2', 'OUT_out1', 'OUT_out0']);
  });

  it('leaves ordinary gates to the graph id allocator', () => {
    const level = getLevel('ch1-04-and-gate');
    expect(levelIoPlacement(level, emptyGraph(level.id), 'nand')).toBeUndefined();
  });

  it('makes level 1 pass with two palette placements and one wire', () => {
    const level = getLevel('ch1-01-humble-beginnings');
    const g = emptyGraph(level.id);
    const source = addInstance(g, 'const_on', 0, 0);
    const placement = levelIoPlacement(level, g, 'level_output');
    const sink = addInstance(g, 'level_output', 128, 0, placement?.id);
    connect(g, { inst: source.id, port: 'out' }, { inst: sink.id, port: 'in' });

    expect(sink.id).toBe('OUT');
    const result = grade(g, registry, level);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.stars).toBe(3);
  });

  /** A chapter-2-shaped level: one 8-bit input, one 8-bit output. */
  function wideLevel(): LevelSpec {
    return {
      ...getLevel('ch1-02-nand-gate'),
      id: 'test-wide-io',
      io: { inputs: [{ id: 'a', width: 8 }], outputs: [{ id: 'out', width: 8 }] },
    };
  }

  /** Arms `defId` in the palette and clicks empty board space with it. */
  function drop(
    store: Store<AppState>,
    canvas: HTMLCanvasElement,
    defId: string,
    x: number,
    y: number,
  ): void {
    // What a click on the palette does now: the armed part is application state,
    // not a flag on the canvas, because the palette has to be able to see it.
    store.set({ armed: defId });
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0 }));
  }

  it('carries each level pin width into the placement', () => {
    const level = wideLevel();
    expect(levelIoPlacement(level, emptyGraph(level.id), 'level_input')).toEqual({
      id: 'IN_a',
      width: 8,
    });
    expect(levelIoPlacement(level, emptyGraph(level.id), 'level_output')).toEqual({
      id: 'OUT',
      width: 8,
    });
  });

  it('writes that width into params when the part is dropped on the board', () => {
    // The id alone is not enough. `compile` sizes a pin from `params.width`, and
    // `bindLevelIo` refuses a bound pin compiled at a width the level does not
    // declare -- so a drop that named the part without sizing it would leave the
    // game's own board ungradable, with an 8-bit level input one bit wide.
    const level = wideLevel();
    const store = createStore<AppState>({
      level,
      graph: emptyGraph(level.id),
      registry,
      progress: emptyProgress(),
      camera: { x: 0, y: 0, zoom: 1 },
      selected: [],
      dragging: null,
      armed: null,
      dev: false,
      programs: {},
      metrics: null,
      lastGrade: null,
      status: null,
    });
    const canvas = document.createElement('canvas');
    // jsdom 28 has PointerEvent but no pointer capture, and the handler captures
    // the pointer as its first act: stub that gap so the drop is reachable.
    canvas.setPointerCapture = () => {};
    const detach = attachBoardInput(canvas, store, new CommandStack(), { onChange: () => {} });
    try {
      drop(store, canvas, 'level_input', 40, 40);
      drop(store, canvas, 'level_output', 400, 40);
    } finally {
      detach();
    }

    expect(store.get().graph.instances.map((inst) => [inst.id, inst.params.width])).toEqual([
      ['IN_a', 8],
      ['OUT', 8],
    ]);
  });
});

describe('io readout panel', () => {
  /** A level whose input is a byte, so a pin has more than one cell to draw. */
  function wideStore(): Store<AppState> {
    const level: LevelSpec = {
      ...getLevel('ch1-02-nand-gate'),
      id: 'test-wide-io',
      io: { inputs: [{ id: 'a', width: 8 }], outputs: [{ id: 'out', width: 8 }] },
    };
    return createStore<AppState>({
      level,
      graph: emptyGraph(level.id),
      registry,
      progress: emptyProgress(),
      camera: { x: 0, y: 0, zoom: 1 },
      selected: [],
      dragging: null,
      armed: null,
      dev: false,
      programs: {},
      metrics: null,
      lastGrade: null,
      status: null,
    });
  }

  function mount(
    store: Store<AppState>,
    overrides: Partial<IoPanelOptions> = {},
  ): { root: HTMLElement; toggled: Array<[string, number]> } {
    const root = document.createElement('div');
    const toggled: Array<[string, number]> = [];
    mountIoPanel(root, store, {
      vector: () => ({}),
      outputs: () => null,
      rate: () => '10Hz',
      tick: () => 0,
      onToggleBit: (pin, bit) => toggled.push([pin, bit]),
      onCycleRate: () => {},
      ...overrides,
    });
    return { root, toggled };
  }

  it('draws one cell per bit of every pin the level declares', () => {
    const { root } = mount(wideStore());
    const pins = [...root.querySelectorAll('.io-pin')];
    // one input and one output, both eight bits wide
    expect(pins).toHaveLength(2);
    expect(pins[0]!.querySelectorAll('.bit')).toHaveLength(8);
    expect(pins[1]!.querySelectorAll('.bit')).toHaveLength(8);
  });

  it('reports the bit a click flips, counting from the least significant end', () => {
    // The cells run most significant first, which is the order a byte is read
    // in; the bit index has to be the value's own, or the player toggles 128
    // when they clicked the 1s column.
    const { root, toggled } = mount(wideStore());
    const cells = root.querySelectorAll('.io-pin .bit');
    (cells[0] as HTMLElement).click();
    (cells[7] as HTMLElement).click();
    expect(toggled).toEqual([
      ['a', 7],
      ['a', 0],
    ]);
  });

  it('shows the driven value as a number as well as bits', () => {
    const { root } = mount(wideStore(), { vector: () => ({ a: 5 }) });
    const input = root.querySelectorAll('.io-pin')[0]!;
    expect(input.querySelector('.io-value')?.textContent).toBe('5');
    expect([...input.querySelectorAll('.bit')].map((b) => b.className)).toEqual([
      'bit bit-0',
      'bit bit-0',
      'bit bit-0',
      'bit bit-0',
      'bit bit-0',
      'bit bit-1',
      'bit bit-0',
      'bit bit-1',
    ]);
  });

  /**
   * Nothing has been simulated yet, so an output is not 0. Rendering it as 0
   * would tell the player their circuit drives the pin low, which is a claim the
   * app cannot make before it has run anything.
   */
  it('leaves outputs unknown until something has run', () => {
    const { root } = mount(wideStore());
    const output = root.querySelectorAll('.io-pin')[1]!;
    // A blank reading, and a dot per bit. Not `???`: the dots already say the
    // bits are unknown, and a dash is what an instrument shows for a number it
    // does not have.
    expect(output.querySelector('.io-value')?.textContent).toBe('—');
    expect(output.querySelectorAll('.bit-x')).toHaveLength(8);
  });

  it('keeps the clock and the collapse control apart', () => {
    const { root } = mount(wideStore(), { tick: () => 3, rate: () => '1Hz' });
    expect(root.querySelector('.card .io-value')?.textContent).toBe('3 拍 · 1Hz');
    const state = root.querySelectorAll('.card')[1]!;
    (root.querySelector('[aria-label="收起状态面板"]') as HTMLButtonElement).click();
    expect((state as HTMLElement).hidden).toBe(true);
  });
});

describe('toolbar', () => {
  function mount(): { root: HTMLElement; fired: string[]; render: (s: ToolbarState) => void } {
    const root = document.createElement('div');
    const fired: string[] = [];
    const toolbar = mountToolbar(root, {
      onZoom: (factor) => fired.push(`zoom:${factor}`),
      onToggleGrid: () => fired.push('grid'),
      onDeleteSelection: () => fired.push('delete'),
      onStep: () => fired.push('step'),
      onToggleRun: () => fired.push('run'),
      onStop: () => fired.push('stop'),
      onToggleTest: () => fired.push('test'),
    });
    return { root, fired, render: toolbar.render };
  }

  const press = (root: HTMLElement, label: string): void => {
    (root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
  };

  it('drives every tool it draws', () => {
    // No button here is decorative: a tool that looks live and does nothing is
    // only discovered by clicking it.
    const { root, fired, render } = mount();
    render({ running: false, grid: true, testing: false, rate: '10Hz' });
    const labels = [
      '放大',
      '缩小',
      '适应画面',
      '测试',
      '单步',
      '运行',
      '停止并复位',
      '网格',
      '删除选中',
    ];
    // The grid has an odd count, so one cell is a spacer element rather than a
    // button; this is what keeps a tenth, inert one from being added later.
    expect(root.querySelectorAll('button')).toHaveLength(labels.length);
    for (const label of labels) press(root, label);
    expect(fired).toEqual([
      'zoom:1.25',
      'zoom:0.8',
      // 0 is the toolbar's "fit it on screen", not a zoom factor
      'zoom:0',
      'test',
      'step',
      'run',
      'stop',
      'grid',
      'delete',
    ]);
  });

  it('shows the run button as paused while the clock is running', () => {
    const { root, render } = mount();
    render({ running: true, grid: false, testing: false, rate: '1Hz' });
    expect(root.querySelector('[aria-label="暂停"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="网格"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('turns the test button into a stop button while the cases play', () => {
    const { root, render } = mount();
    render({ running: false, grid: true, testing: true, rate: '10Hz' });
    expect(root.querySelector('[aria-label="停止测试"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="测试"]')).toBeNull();
  });

  it('starts with nothing pressed and no clock', () => {
    const { root, render } = mount();
    render({ running: false, grid: true, testing: false, rate: '10Hz' });
    expect(root.querySelector('[aria-label="运行"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('[aria-label="网格"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[aria-label="测试"]')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
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
      'ch1-01-humble-beginnings': {
        passed: true,
        best: { gate: 0, delay: 0, tick: 0 },
        stars: 3,
      },
    },
    programs: {},
  };

  it('shows one tile per level and disables the ones still locked', () => {
    const root = document.createElement('div');
    mountMap(root, mapStore('ch1-01-humble-beginnings'), () => {});
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
    mountMap(root, mapStore('ch1-01-humble-beginnings', passedLevel1), () => {});
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
    mountMap(root, mapStore('ch1-01-humble-beginnings', passedLevel1), (id) => picked.push(id));
    const tiles = [...root.querySelectorAll<HTMLButtonElement>('.map-tile')];
    tiles[1]!.click();
    tiles[2]!.click(); // still locked: a disabled button fires nothing
    expect(picked).toEqual(['ch1-02-nand-gate']);
  });

  it('re-renders when progress changes', () => {
    const store = mapStore('ch1-01-humble-beginnings');
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
