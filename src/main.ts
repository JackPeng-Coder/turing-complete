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
import { mountShell } from './ui/shell';
import { mountPalette } from './ui/palette';
import { mountTruthTable } from './ui/truthTable';
import { mountIoPanel } from './ui/ioPanel';
import { mountToolbar } from './ui/toolbar';
import { mountMap } from './ui/map';
import { narrativeFor } from './ui/narrative';
import { renderBoard, type BoardView } from './ui/board/render';
import { attachBoardInput, deleteSelection } from './ui/board/interact';
import { createDisplay, type DisplaySimulation } from './ui/board/signals';
import { instanceRect, screenToWorld } from './ui/board/view';
import type { LevelSpec } from './levels/spec';

const registry = createRegistry(BASE_DEFS);
let progress: Progress = loadProgress();
const level: LevelSpec = getLevel(resumePointOf(progress, LEVEL_ORDER));

const store: Store<AppState> = createStore<AppState>({
  level,
  graph: emptyGraph(level.id),
  registry,
  progress,
  camera: { x: 40, y: 40, zoom: 1 },
  selected: [],
  dragging: null,
  lastGrade: null,
  status: null,
});

const stack = new CommandStack();
const app = document.querySelector<HTMLDivElement>('#app');

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

  const paint = (): void => {
    if (!boardScreen.hidden) renderBoard(canvas, store, store.get().camera, view);
  };

  const paintTools = (): void => {
    toolbar.render({ running, grid: gridOn, rate: RATES[rateIndex]!.label });
  };

  /** Re-reads the display into `view`. Paints nothing: callers decide when. */
  const sample = (): void => {
    const snapshot = display?.read() ?? null;
    view = {
      outputs: snapshot?.outputs ?? new Map(),
      stable: snapshot?.stable ?? false,
      grid: gridOn,
    };
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
      const r = instanceRect(inst);
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

  const onPick = (defId: string): void => {
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
    vector = {};
    // The display is rebuilt from the store's *new* graph, so the store has to
    // be told about the level change first.
    store.set({
      level: next,
      graph: emptyGraph(next.id),
      selected: [],
      lastGrade: null,
      status: null,
      camera: { x: 40, y: 40, zoom: 1 },
    });
    rebuild();
    showScreen('board');
    showBriefing(narrativeFor(levelId).before);
  };

  const regrade = (): void => {
    const { graph, level: current, progress: current0 } = store.get();
    const result = grade(graph, registry, current);
    store.set({ lastGrade: result });
    if (result.passed) {
      progress = applyGrade(current0, current, result);
      saveProgress(progress);
      store.set({ progress });
      showBriefing(narrativeFor(current.id).after);
    }
  };

  /** Every board edit: the circuit changed, so the display and the grade did too. */
  const onChange = (): void => {
    rebuild();
    regrade();
  };

  const mapRender = mountMap(mapScreen, store, openLevel);

  mountShell(app, store, {
    onOpenMap: () => {
      showScreen('map');
      mapRender.render();
    },
    onShowBrief: () => showBriefing(narrativeFor(store.get().level.id).before),
  });
  // DOM order is visual order inside the stage, but every panel is an overlay:
  // the palette on the right, the readout on the left, the test cases along the
  // bottom, and the board underneath all of them.
  mountPalette(partsOverlay, store, onPick);
  mountTruthTable(testsOverlay, store);
  const io = mountIoPanel(stage, store, {
    vector: () => vector,
    outputs: () => {
      if (!display || !view.stable) return null;
      const snapshot = display.read();
      return Object.fromEntries(snapshot.levelOutputs);
    },
    rate: () => RATES[rateIndex]!.label,
    tick: () => display?.read().tick ?? 0,
    onToggleBit: (pinId, bit) => {
      vector = { ...vector, [pinId]: (vector[pinId] ?? 0) ^ (1 << bit) };
      display?.drive(vector);
      sample();
      paint();
      io.render();
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
  });

  attachBoardInput(canvas, store, stack, { onChange });

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
  const body = document.createElement('p');
  body.textContent = text.zh;
  body.lang = 'zh-CN';
  const start = document.createElement('button');
  start.type = 'button';
  start.textContent = '开始';
  start.addEventListener('click', () => panel.remove());
  panel.append(body, start);
  document.body.append(panel);
}
