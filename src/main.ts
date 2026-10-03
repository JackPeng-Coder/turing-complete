import './ui/style.css';
import { createRegistry } from './core/registry';
import { BASE_DEFS } from './core/defs/index';
import { emptyGraph } from './core/graph';
import { getLevel, LEVEL_ORDER } from './levels/index';
import { createStore, type AppState, type Store } from './app/store';
import { CommandStack } from './app/commands';
import { grade } from './levels/grader';
import { loadProgress, saveProgress } from './persist/storage';
import { applyGrade, resumePointOf, type Progress } from './app/progress';
import { devModeFrom } from './app/dev';
import { mountShell } from './ui/shell';
import { mountPalette } from './ui/palette';
import { mountTruthTable, TEST_DEMO_LIMIT } from './ui/truthTable';
import { mountIoPanel } from './ui/ioPanel';
import { showResult } from './ui/result';
import { mountToolbar } from './ui/toolbar';
import { mountMap } from './ui/map';
import { narrativeFor } from './ui/narrative';
import { renderBoard, type BoardView } from './ui/board/render';
import { attachBoardInput, deleteSelection } from './ui/board/interact';
import { createDisplay, type DisplaySimulation, type SignalSnapshot } from './ui/board/signals';
import { instanceRect, screenToWorld } from './ui/board/view';
import { testCases, type TestPlan } from './levels/checks';
import type { LevelSpec } from './levels/spec';

const registry = createRegistry(BASE_DEFS);
let progress: Progress = loadProgress();
const level: LevelSpec = getLevel(resumePointOf(progress, LEVEL_ORDER));

/** `?dev=1`: every level reachable and every listed part on offer. See `dev.ts`. */
let dev = devModeFrom(globalThis.location.search);

const store: Store<AppState> = createStore<AppState>({
  level,
  graph: emptyGraph(level.id),
  registry,
  progress,
  camera: { x: 40, y: 40, zoom: 1 },
  selected: [],
  dragging: null,
  dev,
  metrics: null,
  lastGrade: null,
  status: null,
});

const stack = new CommandStack();
const app = document.querySelector<HTMLDivElement>('#app');

/**
 * How long the test run holds each case before moving to the next, by speed.
 *
 * The run is a demonstration, so the pace is the player's: a fifteen-row truth
 * table takes seven seconds at `2×` and a fuzz level's sixty-four rounds take
 * half a minute, which is either a lesson or a waste of time depending on what
 * the circuit is doing. Fastest last.
 */
const TEST_RATES = [
  { label: '1×', ms: 900 },
  { label: '2×', ms: 450 },
  { label: '4×', ms: 220 },
  { label: '8×', ms: 110 },
] as const;

/**
 * The pace a run starts at, as an index into `TEST_RATES`: `8×`.
 *
 * Fast by default, because the cases are a DEMONSTRATION and a demonstration is
 * usually watched once -- a player who wants to read a particular case presses
 * 停止 and then steps the pace down, which is one click, where waiting out a slow
 * run is thirty seconds nobody gets back.
 */
const DEFAULT_TEST_RATE = 3;

/** What to say when a level's cases cannot be played one at a time. */
const NO_CASES_NOTE = {
  program: {
    zh: '本关的用例是一次程序运行，无法逐个演示：已直接判定',
    en: 'This level’s cases are one program run, so they cannot be played one at a time: graded directly',
  },
  custom: {
    zh: '本关的用例由本关自己的检查器生成，无法逐个演示：已直接判定',
    en: 'This level generates its own cases, so they cannot be played one at a time: graded directly',
  },
  empty: {
    zh: '本关没有可演示的用例：已直接判定',
    en: 'This level declares no cases to play: graded directly',
  },
} as const;

/** Clock rates the player can cycle through, fastest last. */
const RATES = [
  { label: '1Hz', ms: 1000 },
  { label: '10Hz', ms: 100 },
  { label: '60Hz', ms: 16 },
] as const;

if (app) {
  // The shell bar is prepended into #app and the screens fill what is left, so
  // the screens go in first and the bar ends up above them.
  const screens = document.createElement('div');
  screens.className = 'screens';
  const boardScreen = document.createElement('div');
  boardScreen.className = 'screen screen-board';
  const mapScreen = document.createElement('div');
  mapScreen.className = 'screen screen-map';
  mapScreen.hidden = true;
  screens.append(boardScreen, mapScreen);
  app.append(screens);

  // The board is the stage; every panel floats over it, which is how the
  // original composes its screen. ONLY THE CANVAS IS IN FLOW: a panel left in
  // flow would make the stage a scroll container, and a scroll into view would
  // slide the board out from under the pointer coordinates.
  const stage = document.createElement('div');
  stage.className = 'board-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  stage.append(canvas);

  const partsOverlay = document.createElement('div');
  partsOverlay.className = 'overlay overlay-parts';
  const testsOverlay = document.createElement('div');
  testsOverlay.className = 'overlay overlay-tests';
  const toggleOverlay = document.createElement('div');
  toggleOverlay.className = 'overlay overlay-toggle';
  stage.append(partsOverlay, testsOverlay, toggleOverlay);
  boardScreen.append(stage);

  // The original's chevron: the test panel takes a fifth of the board, and a
  // player wiring a big circuit wants it back. Collapsing sets `--test-h` to
  // zero on the stage, which moves this button down with it and lets the parts
  // panel grow into the space -- one class, three consequences.
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.className = 'panel-toggle';
  collapse.textContent = '⌄';
  collapse.setAttribute('aria-label', '收起用例面板');
  collapse.addEventListener('click', () => {
    const collapsed = stage.classList.toggle('collapsed');
    collapse.textContent = collapsed ? '⌃' : '⌄';
    collapse.setAttribute('aria-label', collapsed ? '展开用例面板' : '收起用例面板');
  });
  toggleOverlay.append(collapse);

  /**
   * What the board paints beyond the store: the live pin values and the view
   * flags. Rebuilt by `sample()` on every change to the circuit or the clock.
   */
  let view: BoardView = { outputs: new Map(), stable: false, grid: true };
  /** The running display, or `null` while the circuit cannot be compiled. */
  let display: DisplaySimulation | null = null;
  /** What the level's input pins are driven with while the player builds. */
  let vector: Readonly<Record<string, number>> = {};
  let gridOn = true;
  let running = false;
  let rateIndex = 1;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** The last settle's values, shared by everything that reads them. */
  let snapshot: SignalSnapshot | null = null;
  /** The cases the run is playing, and where in them it has got to. */
  let plan: TestPlan | null = null;
  let testStep = 0;
  let testRate = DEFAULT_TEST_RATE;
  /** The case the board is currently driven with, or `null` when none is. */
  let activeCase: number | null = null;
  let testing = false;
  let testTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * What each case read off the board, so the columns keep their numbers after
   * the run has moved on. The grade cannot supply them: it records the cases
   * that FAILED, and a table that goes blank wherever the circuit was right
   * tells a player nothing about the ones they got wrong.
   */
  let testResults: (Readonly<Record<string, number>> | null)[] = [];

  const paint = (): void => {
    if (!boardScreen.hidden) renderBoard(canvas, store, store.get().camera, view);
  };

  const paintTools = (): void => {
    toolbar.render({ running, grid: gridOn, testing, rate: RATES[rateIndex]!.label });
  };

  /** Re-reads the display into `view`. Paints nothing: callers decide when. */
  const sample = (): void => {
    snapshot = display?.read() ?? null;
    view = {
      outputs: snapshot?.outputs ?? new Map(),
      stable: snapshot?.stable ?? false,
      grid: gridOn,
    };
  };

  /**
   * The level's output pins as they stand right now, or `null` when nothing is
   * running. Read from the cached snapshot rather than by calling `read()` again:
   * the panel and the readout both ask, and each call builds two maps.
   */
  const levelOutputs = (): Readonly<Record<string, number>> | null =>
    snapshot?.stable ? Object.fromEntries(snapshot.levelOutputs) : null;

  /**
   * Drives one input vector onto the board and re-reads it, painting nothing.
   *
   * The run's fast phase drives hundreds of vectors back to back, and repainting
   * the canvas and two panels per vector is what would make it slow rather than
   * the simulation.
   */
  const driveQuiet = (values: Readonly<Record<string, number>>): void => {
    vector = { ...values };
    display?.drive(vector);
    sample();
  };

  /** Drives one input vector onto the board and repaints everything that shows it. */
  const driveTo = (values: Readonly<Record<string, number>>): void => {
    driveQuiet(values);
    paint();
    io.render();
    truth.render();
  };

  const stopTestTimer = (): void => {
    if (testTimer !== null) clearTimeout(testTimer);
    testTimer = null;
  };

  /**
   * The end of a run, and the only place a level is passed.
   *
   * The verdict is the END of a demonstration the player asked for, not a
   * background process: a level that graded itself after every wire spent the
   * whole build telling a player they were wrong. The run's own `grade()` is the
   * one that counts, so nothing here is computed twice.
   */
  const finishTest = (): void => {
    stopTestTimer();
    testing = false;
    activeCase = null;
    plan = null;

    const { graph, level: current, progress: current0 } = store.get();
    const result = grade(graph, registry, current);
    // One state change covers all three readers: the panel takes its verdict,
    // the bar takes the stars, and the board keeps the last case's vector.
    store.set({ lastGrade: result, metrics: result.metrics });
    paintTools();
    if (!result.passed) return;

    progress = applyGrade(current0, current, result);
    saveProgress(progress);
    store.set({ progress });

    closeResult();
    showResult(current, result, registry, {
      onContinue: closeResult,
      onNext: () => {
        closeResult();
        const next = nextLevelId();
        if (next) openLevel(next);
      },
      hasNext: nextLevelId() !== null,
    });
  };

  /**
   * One case per tick of the run: drive it, clock it, paint it, remember what it
   * read, and light up that case's column so the reader's eye follows the board.
   *
   * PAST `TEST_DEMO_LIMIT` THE RUN HURRIES, and the panel's note says so. A
   * level may declare hundreds of cases (513 on `ch2-37-little-box`), and at the
   * pace a fifteen-row table wants that is minutes of watching a counter count.
   * The cases still ALL run -- only the painting stops, and only where there is
   * nothing left to see: past the thirty-second case no column on screen changes
   * at all, because the table shows twenty.
   */
  const runTestStep = (): void => {
    const current = plan;
    if (!testing || current === null || current.kind !== 'cases') return;
    const item = current.cases[testStep];
    if (item === undefined) {
      finishTest();
      return;
    }

    const demonstrating = testStep < TEST_DEMO_LIMIT;
    activeCase = testStep;
    // A case's own `reset` says whether it starts from a cleared circuit: a
    // truth table's rows each do, and only a script's FIRST step does -- step 3
    // reads a register step 2 clocked. The checker does exactly this.
    if (item.reset) display?.reset();
    if (demonstrating) driveTo(item.inputs);
    else driveQuiet(item.inputs);
    while ((snapshot?.tick ?? 0) < item.tick) {
      display?.tick();
      if (demonstrating) {
        sample();
        paint();
      }
    }
    testResults[testStep] = levelOutputs();
    testStep += 1;
    // The fast phase has no column left to light up -- the table shows twenty --
    // but the heading counts the cases, so it is repainted now and then rather
    // than showing a total the run left behind.
    if (demonstrating || (testStep & 7) === 0) truth.render();
    testTimer = setTimeout(runTestStep, demonstrating ? TEST_RATES[testRate]!.ms : 0);
  };

  /**
   * The test button: play the level's cases, then judge the circuit.
   *
   * A level whose cases the checker generates privately, and a board that will
   * not compile at all, have nothing to play -- but pressing 测试 must always
   * produce a verdict, so both go straight to `finishTest`.
   */
  const startTest = (): void => {
    stopTestTimer();
    // The run drives its own clock edges; a ticking clock underneath it would
    // step the same storage twice per case and show a circuit nobody built.
    running = false;
    stopClock();

    const planned = testCases(store.get().level);
    testResults = [];
    if (planned.kind === 'none' || display === null) {
      if (planned.kind === 'none') store.set({ status: NO_CASES_NOTE[planned.reason] });
      plan = null;
      activeCase = null;
      finishTest();
      return;
    }

    plan = planned;
    testing = true;
    testStep = 0;
    activeCase = null;
    paintTools();
    truth.render();
    runTestStep();
  };

  /** The stop button: abandon the run without judging anything. */
  const stopTest = (): void => {
    stopTestTimer();
    testing = false;
    activeCase = null;
    plan = null;
    paintTools();
    truth.render();
  };

  const toggleTest = (): void => {
    if (testing) stopTest();
    else startTest();
  };

  /**
   * Rebuilds the display for the current graph.
   *
   * A display is a compiled circuit plus its storage, so it cannot survive an
   * edit: every change to the graph gets a new one, which is also why the
   * simulation is not held in the store -- it is a cache of the store's graph,
   * not part of the application's state.
   */
  const rebuild = (): void => {
    const { graph, registry: reg, level: current } = store.get();
    display = createDisplay(graph, reg, current, vector);
    sample();
  };

  const refreshPanels = (): void => {
    io.render();
    paintTools();
  };

  const step = (): void => {
    display?.tick();
    sample();
    paint();
    io.render();
  };

  const stopClock = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const startClock = (): void => {
    stopClock();
    timer = setInterval(step, RATES[rateIndex]!.ms);
  };

  const onZoom = (factor: number): void => {
    const camera = store.get().camera;
    if (factor === 0) {
      fitView();
      return;
    }
    const zoom = Math.min(4, Math.max(0.25, camera.zoom * factor));
    // Keep the world point under the middle of the board pinned while the scale
    // changes, so a zoom does not throw the circuit off screen.
    const middle = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const before = screenToWorld(camera, middle);
    const next = { ...camera, zoom };
    const after = screenToWorld(next, middle);
    store.set({
      camera: { zoom, x: next.x + (after.x - before.x), y: next.y + (after.y - before.y) },
    });
  };

  /** Frames the whole circuit, or returns to the default camera on an empty board. */
  const fitView = (): void => {
    const { graph } = store.get();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (graph.instances.length === 0) {
      store.set({ camera: { x: 40, y: 40, zoom: 1 } });
      return;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const inst of graph.instances) {
      if (!store.get().registry.has(inst.def)) continue;
      const r = instanceRect(inst, store.get().registry.get(inst.def));
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    const pad = 48;
    const zoom = Math.min(
      2,
      Math.max(
        0.25,
        Math.min(
          (w - pad * 2) / Math.max(1, maxX - minX),
          (h - pad * 2) / Math.max(1, maxY - minY),
        ),
      ),
    );
    store.set({
      camera: {
        zoom,
        x: w / (2 * zoom) - (minX + maxX) / 2,
        y: h / (2 * zoom) - (minY + maxY) / 2,
      },
    });
  };

  const showScreen = (which: 'board' | 'map'): void => {
    boardScreen.hidden = which !== 'board';
    mapScreen.hidden = which !== 'map';
    // A hidden canvas has no box to draw into; repaint when it comes back, and
    // rebuild the readout for the level that is now open.
    if (which === 'board') {
      paint();
      refreshPanels();
    }
  };

  const onPickPart = (defId: string): void => {
    // The palette only offers ids the registry knows; the guard keeps the
    // "registry.get throws" contract local rather than implied.
    if (!registry.has(defId)) return;
    canvas.dataset.pendingDef = defId;
    const def = registry.get(defId);
    store.set({
      status: {
        zh: `已选 ${def.name.zh} — 点击画板放置，Esc 取消`,
        en: `${def.name.en} selected — click the board to place, Esc to cancel`,
      },
    });
  };

  /**
   * Loads a level into the board; the chapter map calls this. The `before` text
   * is shown on arrival, every time -- entering a level is the narrative beat,
   * whether or not it has been passed before.
   */
  const openLevel = (levelId: string): void => {
    const next = getLevel(levelId);
    stack.clear();
    canvas.dataset.pendingDef = '';
    running = false;
    stopClock();
    stopTest();
    vector = {};
    plan = null;
    testResults = [];
    // The display is rebuilt from the store's *new* graph, so the store has to
    // be told about the level change first.
    store.set({
      level: next,
      graph: emptyGraph(next.id),
      selected: [],
      lastGrade: null,
      metrics: null,
      status: null,
      camera: { x: 40, y: 40, zoom: 1 },
    });
    rebuild();
    showScreen('board');
    showBriefing(narrativeFor(levelId).before);
  };

  /** The next level in the shipped order, or `null` on the last one. */
  const nextLevelId = (): string | null => {
    const index = LEVEL_ORDER.indexOf(store.get().level.id);
    return index >= 0 && index + 1 < LEVEL_ORDER.length ? LEVEL_ORDER[index + 1]! : null;
  };

  const closeResult = (): void => {
    document.querySelector('.result')?.remove();
  };

  /**
   * Measures the circuit that is on the board right now.
   *
   * A MEASUREMENT, NOT A VERDICT. The gate count, the delay and the cost are
   * what the original's own bar shows while a circuit is being drawn, and they
   * are recomputed on every edit. Whether the circuit is CORRECT is
   * `finishTest`'s business, and the verdict is dropped here rather than
   * recomputed: a result reached before the last wire moved describes a circuit
   * that is no longer on the board.
   */
  const measure = (): void => {
    const { graph, level: current } = store.get();
    store.set({ metrics: grade(graph, registry, current).metrics, lastGrade: null });
  };

  /** Every board edit: the circuit changed, so the display and the measurement did too. */
  const onChange = (): void => {
    if (testing) stopTest();
    rebuild();
    // The columns keep their layout but lose their numbers: they were read from
    // the circuit as it was before this edit.
    testResults = [];
    activeCase = null;
    measure();
  };

  const mapRender = mountMap(mapScreen, store, openLevel);

  mountShell(app, store, {
    onOpenMap: () => {
      showScreen('map');
      mapRender.render();
    },
    onShowBrief: () => showBriefing(narrativeFor(store.get().level.id).before),
    onExitDev: () => {
      // Live rather than through a reload: the map and the palette read `dev`
      // from the store, so switching it off re-renders them where they stand --
      // and the address bar is cleaned up so a refresh does not bring it back.
      dev = false;
      store.set({ dev });
      const url = new URL(globalThis.location.href);
      url.searchParams.delete('dev');
      globalThis.history.replaceState(null, '', url);
    },
  });
  // DOM order is visual order inside the stage, but every panel is an overlay:
  // the palette on the right, the readout on the left, the test cases along the
  // bottom, and the board underneath all of them.
  mountPalette(partsOverlay, store, onPickPart);
  const truth = mountTruthTable(testsOverlay, store, {
    live: levelOutputs,
    active: () => activeCase,
    results: () => testResults,
    testing: () => testing,
    rate: () => TEST_RATES[testRate]!.label,
    onToggleTest: toggleTest,
    onCycleRate: () => {
      testRate = (testRate + 1) % TEST_RATES.length;
      truth.render();
    },
  });
  const io = mountIoPanel(stage, store, {
    vector: () => vector,
    outputs: levelOutputs,
    rate: () => RATES[rateIndex]!.label,
    tick: () => snapshot?.tick ?? 0,
    onToggleBit: (pinId, bit) => {
      driveTo({ ...vector, [pinId]: (vector[pinId] ?? 0) ^ (1 << bit) });
    },
    onCycleRate: () => {
      rateIndex = (rateIndex + 1) % RATES.length;
      if (running) startClock();
      io.render();
      paintTools();
    },
  });
  const toolbar = mountToolbar(stage, {
    onZoom,
    onToggleGrid: () => {
      gridOn = !gridOn;
      view = { ...view, grid: gridOn };
      paint();
      paintTools();
    },
    onDeleteSelection: () => deleteSelection(store, stack, onChange),
    onStep: step,
    onToggleRun: () => {
      running = !running;
      if (running) startClock();
      else stopClock();
      paintTools();
    },
    onStop: () => {
      running = false;
      stopClock();
      display?.reset();
      sample();
      paint();
      io.render();
      paintTools();
    },
    onToggleTest: toggleTest,
  });

  /**
   * A click on a level input flips what it drives.
   *
   * One bit toggles; a wider pin counts up and wraps, because a click is a
   * nudge and not a way to type a byte -- exact values are the readout panel's
   * job, and it has a cell per bit. Doing nothing for every other part is
   * deliberate: a click on a gate means select, and always has.
   */
  const onPickInstance = (instId: string): void => {
    if (!instId.startsWith('IN_')) return;
    const pinId = instId.slice(3);
    const pin = store.get().level.io.inputs.find((candidate) => candidate.id === pinId);
    if (!pin) return;
    const max = pin.width >= 31 ? Number.MAX_SAFE_INTEGER : 2 ** pin.width - 1;
    const current = vector[pinId] ?? 0;
    driveTo({ ...vector, [pinId]: current >= max ? 0 : current + 1 });
  };

  attachBoardInput(canvas, store, stack, { onChange, onPick: onPickInstance });

  // Render on state change only: a continuous rAF loop would repaint a static
  // board 60 times a second forever. Panning, zooming and dragging all go
  // through store.set, so they still repaint every frame they change something.
  store.subscribe(() => paint());
  globalThis.addEventListener('resize', paint);

  // The app opens on the resume point's level, so its briefing is the first
  // thing the player sees.
  rebuild();
  showBriefing(narrativeFor(level.id).before);
  paint();
  refreshPanels();
}

/**
 * The briefing overlay: a level's `before` text on arrival, its `after` text
 * when a graded attempt passes. It is pure narrative -- it never grades, never
 * writes to the store and never reaches the level data, so it cannot influence
 * a result.
 *
 * Only one is ever on screen: a second call replaces the first rather than
 * stacking a panel the player would have to dismiss twice.
 */
function showBriefing(text: { zh: string; en: string }): void {
  document.querySelector('.briefing')?.remove();
  const panel = document.createElement('div');
  panel.className = 'briefing';
  // The overlay covers the whole board, so it has to say what it is: without a
  // label it is indistinguishable from a dialog that wants an answer.
  const tag = document.createElement('div');
  tag.className = 'briefing-tag';
  tag.textContent = '任务简报';
  const body = document.createElement('p');
  body.textContent = text.zh;
  body.lang = 'zh-CN';
  const start = document.createElement('button');
  start.type = 'button';
  start.textContent = '开始';
  start.addEventListener('click', () => panel.remove());
  panel.append(tag, body, start);
  document.body.append(panel);
}
