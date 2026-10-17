import './ui/style.css';
import { createRegistry } from './core/registry';
import { BASE_DEFS } from './core/defs/index';
import { emptyGraph, cloneGraph, validateGraph, type Graph } from './core/graph';
import { getLevel, LEVELS, LEVEL_ORDER } from './levels/index';
import { graphFromBoard } from './levels/board';
import { createStore, type AppState, type Store } from './app/store';
import { CommandStack } from './app/commands';
import { grade } from './levels/grader';
import { loadProgress, saveProgress } from './persist/storage';
import { applyGrade, offeredDefsFor, resumePointOf, type Progress } from './app/progress';
import { composeRegistry, libraryClosure, libraryIds, referencedComponents } from './levels/blueprints';
import { mountBlueprintPanel } from './ui/blueprint';
import { applyWrap, planWrap, type WrapPlan } from './levels/wrap';
import { SANDBOX_ID, SANDBOX_LEVEL, isSandbox } from './levels/sandbox';
import { circuitSignature, emptySandbox, loadSandbox, saveSandbox } from './persist/sandbox';
import { parseCircuit, serializeCircuit } from './persist/circuit';
import { devModeFrom } from './app/dev';
import { iconSvg, mountShell, mountStatus, type IconName } from './ui/shell';
import { mountPalette } from './ui/palette';
import { mountTruthTable, TEST_DEMO_LIMIT } from './ui/truthTable';
import { mountIoPanel } from './ui/ioPanel';
import { showResult } from './ui/result';
import { mountToolbar } from './ui/toolbar';
import { mountAgentPanel, type AgentPanel } from './ui/agent';
import { loadAgentConfig, type AgentConfig } from './agent/config';
import type { AgentHost, BoardSnapshot, TestOutcome } from './agent/host';
import { GRID } from './ui/theme';
import { mountMap } from './ui/map';
import { narrativeFor } from './ui/narrative';
import { renderBoard, type BoardView } from './ui/board/render';
import { attachBoardInput, deleteSelection, levelIoPlacement } from './ui/board/interact';
import { createDisplay, type DisplaySimulation, type SignalSnapshot } from './ui/board/signals';
import { instanceRect, screenToWorld, type Point } from './ui/board/view';
import { levelExpectsProgram, playerProgramFormat, testCases, type TestPlan } from './levels/checks';
import { createProgramRun, type ProgramRun } from './levels/run';
import { mountIde } from './ui/ide';
import { mountDebug } from './ui/debug';
import type { LevelSpec } from './levels/spec';

const registry = createRegistry(BASE_DEFS);
let progress: Progress = loadProgress();
const level: LevelSpec = getLevel(resumePointOf(progress, LEVEL_ORDER));

/**
 * The registry a document compiles against: the base catalog plus the player's
 * components.
 *
 * THE BASE REGISTRY STAYS THE BASE REGISTRY. `registry` above answers "what parts
 * does the game ship" and is what `defs/index.ts`'s tests pin; this one is what the
 * board, the checks and the palette actually resolve ids through, and it is
 * rebuilt whenever the library changes rather than mutated in place -- see
 * `composeRegistry` for why a player's part never enters the singleton.
 */
let composed = composeRegistry(registry, progress.blueprints);

/** `?dev=1`: every level reachable and every listed part on offer. See `dev.ts`. */
let dev = devModeFrom(globalThis.location.search);

const store: Store<AppState> = createStore<AppState>({
  level,
  // A level that ships a starting circuit opens on it; every other level opens on
  // an empty board. Either way what the player gets is an ordinary editable
  // `Graph` -- a starting circuit is a head start, not a fixture nobody can
  // touch, which is what keeps it a board rather than a built-in CPU.
  graph: level.board ? graphFromBoard(level.id, level.board) : emptyGraph(level.id),
  registry: composed,
  progress,
  camera: { x: 40, y: 40, zoom: 1 },
  selected: [],
  dragging: null,
  armed: null,
  dev,
  // The programs come out of the loaded save, so reopening the app restores the
  // text the player left on each level. The IDE writes them back as they are
  // typed (`onProgramEdit`), through `progress.programs` and `saveProgress`, so
  // the editor, the checks and the save all read the same text.
  programs: progress.programs,
  blueprints: progress.blueprints,
  editing: null,
  metrics: null,
  lastGrade: null,
  status: null,
});

const stack = new CommandStack();
const app = document.querySelector<HTMLDivElement>('#app');

/**
 * The signature of the sandbox circuit as it was last written to storage.
 *
 * Module-level because the sandbox outlives any one screen: the board screen is
 * hidden rather than unmounted when the player reads the map, so a closure-local
 * copy would be the one thing `openLevel` had to remember to carry. The empty
 * string means "not in the sandbox", which is also what keeps a level edit from
 * writing anything.
 */
let sandboxSignature = '';

/** A filename-safe stamp, so two exports of one circuit do not overwrite. */
function dateStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

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

/** What to say when a level's cases cannot be played one at a time. */const NO_CASES_NOTE = {
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
  /**
   * The sandbox, which has no cases BY DESIGN.
   *
   * Its own note rather than the `empty` one: a level with no cases is a level
   * something went wrong with, and the sandbox is the screen where nothing is
   * supposed to happen. Handing the player "graded directly" there would be the
   * app describing a verdict it is not going to give.
   */
  sandbox: {
    zh: '沙盒没有测试用例：电路一直在跑，门数与延迟就是你的读数',
    en: 'The sandbox has no test cases: the circuit runs, and the gate and delay counters are your own readings',
  },
} as const;

/** Clock rates the player can cycle through, fastest last. */
const RATES = [
  { label: '1Hz', ms: 1000 },
  { label: '10Hz', ms: 100 },
  { label: '60Hz', ms: 16 },
] as const;

if (app) {
  /**
   * THE WORKBENCH. Five docks, the shape a code editor uses: an activity bar at
   * the far left, the primary sidebar beside it, the editor in the middle, a
   * secondary sidebar on the right, and a bottom panel under the editor. The
   * board is the document; every panel is a tool beside it rather than a
   * translucent layer over it, so no panel can cover a wire a player is drawing.
   */
  const workspace = document.createElement('div');
  workspace.className = 'workspace secondary-collapsed';

  /** A rail button: an icon, with the name carried by the accessible label. */
  const dockButton = (label: string, icon: IconName): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'activity-btn';
    el.setAttribute('aria-label', label);
    el.title = label;
    el.append(iconSvg(icon));
    return el;
  };

  const activity = document.createElement('nav');
  activity.className = 'activity';
  const partsButton = dockButton('元件', 'grid');
  const componentsButton = dockButton('组件', 'wrap');
  const casesButton = dockButton('用例', 'test');
  const programButton = dockButton('程序', 'terminal');
  // The assistant's own rail button is created by the panel (it has the
  // configured state to draw); the slot keeps it in the rail's order.
  const agentSlot = document.createElement('div');
  agentSlot.className = 'activity-slot';
  const settingsButton = dockButton('设置', 'settings');
  activity.append(partsButton, componentsButton, casesButton, programButton, agentSlot, settingsButton);

  const primary = document.createElement('aside');
  primary.className = 'sidebar sidebar-primary';
  const primaryTabs = document.createElement('div');
  primaryTabs.className = 'sidebar-tabs';
  const tabButton = (label: string, name: string): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sidebar-tab';
    el.dataset.view = name;
    el.textContent = label;
    el.setAttribute('aria-pressed', 'false');
    return el;
  };
  const partsTab = tabButton('元件', 'parts');
  const componentsTab = tabButton('组件', 'components');
  primaryTabs.append(partsTab, componentsTab);
  const partsSection = document.createElement('div');
  partsSection.className = 'sidebar-section sidebar-parts';
  partsSection.dataset.view = 'parts';
  const componentsSection = document.createElement('div');
  componentsSection.className = 'sidebar-section sidebar-components';
  componentsSection.dataset.view = 'components';
  componentsSection.hidden = true;
  // The I/O readout is not a tab: driving a level's input bits is part of
  // wiring, so it stays in view while the palette does. It sits under the parts
  // tray, the way an outline sits under a file tree.
  const ioSection = document.createElement('div');
  ioSection.className = 'sidebar-section sidebar-io';
  primary.append(primaryTabs, partsSection, componentsSection, ioSection);

  const editor = document.createElement('main');
  editor.className = 'editor';
  const screens = document.createElement('div');
  screens.className = 'screens';
  const boardScreen = document.createElement('div');
  boardScreen.className = 'screen screen-board';
  const mapScreen = document.createElement('div');
  mapScreen.className = 'screen screen-map';
  mapScreen.hidden = true;
  screens.append(boardScreen, mapScreen);
  editor.append(screens);

  // The editor's action strip: the board's own controls, in flow above the
  // canvas, so they never cover a wire.
  const editorActions = document.createElement('div');
  editorActions.className = 'editor-actions';

  const stage = document.createElement('div');
  stage.className = 'board-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  stage.append(canvas);
  boardScreen.append(editorActions, stage);

  const secondary = document.createElement('aside');
  secondary.className = 'sidebar sidebar-secondary';

  const bottom = document.createElement('section');
  bottom.className = 'bottom-panel';
  const bottomTabs = document.createElement('div');
  bottomTabs.className = 'panel-tabs';
  const panelTab = (label: string, name: string): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'panel-tab';
    el.dataset.view = name;
    el.textContent = label;
    el.setAttribute('aria-pressed', 'false');
    return el;
  };
  const casesTab = panelTab('用例', 'cases');
  const programTab = panelTab('程序', 'program');
  const debugTab = panelTab('调试', 'debug');
  programTab.hidden = true;
  debugTab.hidden = true;
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.className = 'panel-toggle';
  collapse.textContent = '⌄';
  collapse.setAttribute('aria-label', '收起下方面板');
  bottomTabs.append(casesTab, programTab, debugTab, collapse);

  const bottomViews = document.createElement('div');
  bottomViews.className = 'panel-views';
  const panelView = (name: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'panel-view';
    el.dataset.view = name;
    el.hidden = name !== 'cases';
    bottomViews.append(el);
    return el;
  };
  const viewCases = panelView('cases');
  const viewProgram = panelView('program');
  const viewDebug = panelView('debug');
  bottom.append(bottomTabs, bottomViews);

  const panelTabs = [casesTab, programTab, debugTab];
  const panelViews = [viewCases, viewProgram, viewDebug];
  const showPanel = (name: string): void => {
    bottom.classList.remove('collapsed');
    for (const el of panelViews) el.hidden = el.dataset.view !== name;
    for (const el of panelTabs) el.setAttribute('aria-pressed', String(el.dataset.view === name));
  };
  const showSidebar = (name: string): void => {
    for (const el of [partsSection, componentsSection]) el.hidden = el.dataset.view !== name;
    for (const el of [partsTab, componentsTab]) el.setAttribute('aria-pressed', String(el.dataset.view === name));
  };

  casesTab.addEventListener('click', () => showPanel('cases'));
  programTab.addEventListener('click', () => showPanel('program'));
  debugTab.addEventListener('click', () => showPanel('debug'));
  partsTab.addEventListener('click', () => showSidebar('parts'));
  componentsTab.addEventListener('click', () => showSidebar('components'));
  partsButton.addEventListener('click', () => showSidebar('parts'));
  componentsButton.addEventListener('click', () => showSidebar('components'));
  casesButton.addEventListener('click', () => showPanel('cases'));
  programButton.addEventListener('click', () => {
    if (!programTab.hidden) showPanel('program');
  });
  settingsButton.addEventListener('click', () => agentPanel?.openSettings());
  collapse.addEventListener('click', () => {
    const collapsed = bottom.classList.toggle('collapsed');
    collapse.textContent = collapsed ? '⌃' : '⌄';
    collapse.setAttribute('aria-label', collapsed ? '展开下方面板' : '收起下方面板');
  });
  showPanel('cases');
  showSidebar('parts');

  workspace.append(activity, primary, editor, secondary, bottom);
  app.append(workspace);

  /**
   * What the board paints beyond the store: the live pin values and the view
   * flags. Rebuilt by `sample()` on every change to the circuit or the clock.
   */
  let view: BoardView = { outputs: new Map(), stable: false, grid: true, ghost: null };
  /**
   * Where the pointer is, in world units, or `null` when it is off the board.
   *
   * View state, not store state: it changes on every mouse move, and the only
   * thing that reads it is the ghost of the part armed in the palette. Reported
   * by the board only while something IS armed, so an unarmed hover costs
   * nothing at all.
   */
  let ghost: Point | null = null;
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
  /**
   * The program run the editor's step controls and the debugger drive, or `null`
   * on a level that grades no program the player wrote.
   *
   * A RUN IS A COMPILED CIRCUIT PLUS ITS STORAGE, so it cannot survive an edit --
   * exactly like `display`, and for the same reason. It is dropped (not rebuilt)
   * whenever the text or the graph changes, and rebuilt on the next control that
   * needs one, so a panel never shows state from a circuit that is no longer on
   * the board.
   */
  let playerRun: ProgramRun | null = null;
  /** What `playerRun` was built from; a different value means it must be rebuilt. */
  let playerRunKey = '';
  /** Bumped by every board edit: the run is compiled from a live graph, not a copy. */
  let graphRevision = 0;
  let ide: { render(): void } | null = null;
  let debug: { render(): void } | null = null;
  /** True while the program is being stepped on a timer. */
  let programRunning = false;
  let programTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * The pace the program steps at, as an index into `TEST_RATES`.
   *
   * The same vocabulary the test run's speed button uses, and its own index rather
   * than the shared one: watching a program execute and watching the level's cases
   * play are two different things to want at two different speeds.
   */
  let programRate = DEFAULT_TEST_RATE;

  const paint = (): void => {
    if (!boardScreen.hidden) renderBoard(canvas, store, store.get().camera, view);
  };

  const paintTools = (): void => {
    toolbar.render({
      running,
      grid: gridOn,
      testing,
      rate: RATES[rateIndex]!.label,
      selected: store.get().selected.length,
      sandbox: isSandbox(store.get().level),
    });
  };

  /** Re-reads the display into `view`. Paints nothing: callers decide when. */
  const sample = (): void => {
    snapshot = display?.read() ?? null;
    view = {
      outputs: snapshot?.outputs ?? new Map(),
      stable: snapshot?.stable ?? false,
      grid: gridOn,
      ghost,
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
    // The readout panel is the game's only input control, so the same vector goes
    // to the program run: a program that reads `inp` must see the byte the player
    // clicked, not a zero, and it is cheap here because a level with no program
    // run syncs nothing.
    syncPlayerInputs();
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

    const { graph, level: current, progress: current0, programs } = store.get();
    // The player's program goes into the verdict: a `program` check that reads the
    // player's buffer grades the text as it stands at the moment of the run, from
    // the same snapshot as the circuit. A level that has never been typed into
    // hands over an empty string, which the checker reports as `missing-program`
    // rather than running nothing.
    const result = grade(graph, store.get().registry, current, { text: programs[current.id] ?? '' });
    // One state change covers all three readers: the panel takes its verdict,
    // the bar takes the stars, and the board keeps the last case's vector.
    store.set({ lastGrade: result, metrics: result.metrics });
    paintTools();
    if (!result.passed) return;

    progress = applyGrade(current0, current, result);
    saveProgress(progress);
    store.set({ progress });

    closeResult();
    showResult(current, result, store.get().registry, {
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
   * level may declare hundreds of cases (513 on `ch2-38-little-box`), and at the
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
    //
    // A CASE RESET GOES THE WAY 停止并复位 DOES on a level that also grades a
    // program, and for the same reason: the display may be painting the run's own
    // machine, and clearing that simulation directly would empty the `ram_prog`
    // the run loaded. Dropping the run and rebuilding clears the circuit AND
    // loads the image back into the machine the board paints. A board with no
    // player program is reset in place, because rebuilding it would recompile the
    // graph for every one of a fuzz level's hundred cases.
    if (item.reset) {
      if (levelExpectsProgram(store.get().level)) {
        dropPlayerRun();
        rebuild();
      } else display?.reset();
    }
    if (demonstrating) driveTo(item.inputs);
    else driveQuiet(item.inputs);
    while ((snapshot?.tick ?? 0) < item.tick) {
      display?.tick();
      // THE FAST PHASE STILL HAS TO SAMPLE. The loop's own condition reads
      // `snapshot.tick`, so a fast phase that ticked without reading left the
      // snapshot on the old tick and the loop never ended: a script with more
      // than `TEST_DEMO_LIMIT` cases froze the tab at the first fast case
      // (513-step `ch2-38-little-box` at case 33). Painting is what the fast
      // phase skips, not reading -- and the case's recorded outputs need the
      // read too.
      sample();
      if (demonstrating) paint();
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

    const current = store.get().level;
    const planned = testCases(current);
    testResults = [];
    if (isSandbox(current)) {
      // NO VERDICT IN THE SANDBOX, and no dialog: `grade()` on a spec with no
      // checks reports `passed`, so the ordinary path would pop a 关卡完成 card
      // for a screen that has no levels. The button is disabled there anyway
      // (`ui/toolbar.ts`); this is the belt to that braces.
      store.set({ status: NO_CASES_NOTE.sandbox });
      paintTools();
      truth.render();
      return;
    }
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
   *
   * ONE MACHINE, NOT TWO. On a level that grades a program the player wrote, the
   * program has to be loaded in the circuit the board paints -- otherwise the io
   * panel's clock and its `out` row would be readings of a second compilation
   * whose `ram_prog` is 256 zeros, disagreeing with the debugger beside them. So
   * the run is built FIRST and its machine handed to the display. `machine` is
   * `null` while the circuit does not compile or while the program is refused, and
   * then the display is exactly what it always was: its own compilation of the
   * board, which is what a mid-edit circuit gets.
   */
  const rebuild = (): void => {
    const { graph, registry: reg, level: current } = store.get();
    display = createDisplay(graph, reg, current, vector, ensurePlayerRun()?.machine ?? null);
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
    // rebuild the readout for the level that is now open. Stopping the clocks is
    // NOT done here: leaving the board for the map is the one transition that has
    // to, and it says so where it happens (`onOpenMap`).
    if (which === 'board') {
      paint();
      refreshPanels();
    }
  };

  const onPickPart = (defId: string | null): void => {
    if (defId === null) {
      // The way back to holding nothing: with a part armed, dragging the board
      // places parts, so panning needs this state.
      store.set({ armed: null, status: null });
      return;
    }
    // The palette only offers ids the registry knows; the guard keeps the
    // "registry.get throws" contract local rather than implied.
    if (!store.get().registry.has(defId)) return;
    const def = store.get().registry.get(defId);
    store.set({
      armed: defId,
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
    // THE SANDBOX IS NOT IN THE LEVEL TABLE, so it is not looked up: `getLevel`
    // throws for an id no level has, and its spec is a constant (`levels/sandbox.ts`).
    // Everything after this point is the same for both -- one board, one set of
    // panels -- which is the whole reason the sandbox is a `LevelSpec`.
    const next = levelId === SANDBOX_ID ? SANDBOX_LEVEL : getLevel(levelId);
    stack.clear();
    running = false;
    stopClock();
    stopTest();
    // The old level's run is a circuit and a text that are no longer on screen,
    // and it has to go BEFORE the display is rebuilt: `rebuild` hands the display
    // whatever run exists, and a run of the previous level would paint the board
    // the player just left.
    dropPlayerRun();
    vector = {};
    plan = null;
    testResults = [];
    ghost = null;
    // The display is rebuilt from the store's *new* graph, so the store has to
    // be told about the level change first. The board, when the level ships one,
    // is read into that new graph the same way the initial one is: reopening a
    // level is a fresh attempt at its starting circuit, never a resume of what
    // was on the board before.
    store.set({
      level: next,
      graph:
        levelId === SANDBOX_ID
          ? (loadSandbox() ?? emptySandbox())
          : next.board
            ? graphFromBoard(next.id, next.board)
            : emptyGraph(next.id),
      selected: [],
      armed: null,
      lastGrade: null,
      metrics: null,
      status: null,
      camera: { x: 40, y: 40, zoom: 1 },
    });
    sandboxSignature = isSandbox(next) ? circuitSignature(store.get().graph) : '';
    rebuild();
    showScreen('board');
    // The bench follows the level: an editor on a level that grades no program,
    // or a debugger still reading the previous level's machine, would both be
    // describing something that is not on screen.
    mountBench();
    // A level that ships a circuit opens on a machine rather than on a corner of
    // one: the chapter-4 CPU spans a couple of thousand world units, so the
    // default camera would show its left third and a player would have to find
    // the fit button before they could see what they were handed.
    if (next.board) fitView();
    // The sandbox has no narrative: `narrativeFor` reads level data, and its own
    // brief is the one that says what the screen is for.
    if (levelId !== SANDBOX_ID) showBriefing(narrativeFor(levelId).before);
    measure();
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
    const { graph, level: current, programs } = store.get();
    // The same program text `finishTest` grades with, because the TICK metric is
    // read out of the checks: a `program` check that reads the player's buffer
    // walks the player's program, so measuring it against a different text -- or
    // against none -- would put a tick count on the bar that the test run could
    // never reproduce. What is measured is still only gate, delay and tick; the
    // verdict itself stays `finishTest`'s business.
    const player = { text: programs[current.id] ?? '' };
    store.set({
      metrics: grade(graph, store.get().registry, current, player).metrics,
      lastGrade: null,
    });
  };

  // -------------------------------------------------------------------------
  // the program run: the editor's step controls and the debugger
  // -------------------------------------------------------------------------

  /** The level's program text, as the app holds it. */
  const playerText = (): string => {
    const { level: current, programs } = store.get();
    return programs[current.id] ?? '';
  };

  /**
   * Drives the level's input vector onto the program run.
   *
   * THE READOUT PANEL IS THE INPUT CONTROL, on every level, and it drives the
   * board's display -- so a program that reads `inp` would read zeros in the
   * debugger while the panel beside it showed the byte the player set. The same
   * vector therefore goes to both, and it is re-applied whenever a run is built
   * because a fresh `Simulation` has no inputs in it.
   */
  const syncPlayerInputs = (): void => {
    if (playerRun === null) return;
    for (const pin of store.get().level.io.inputs) {
      playerRun.setInput(pin.id, vector[pin.id] ?? 0);
    }
  };

  /**
   * The run for the circuit and the text that are on screen right now.
   *
   * BUILT ON DEMAND, because a `ProgramRun` owns a compiled circuit: anything
   * that reads the machine's state -- a step, a readout, an assemble -- asks for
   * one here, and a run whose key no longer matches the store's text or graph is
   * rebuilt rather than reused. `null` on a level with no player program, which is
   * the same answer the bench's own mount takes.
   */
  const ensurePlayerRun = (): ProgramRun | null => {
    const { graph, level: current } = store.get();
    if (!levelExpectsProgram(current)) return null;
    const format = playerProgramFormat(current);
    const key = `${current.id}\u0000${graphRevision}\u0000${format}\u0000${playerText()}`;
    if (playerRun === null || playerRunKey !== key) {
      playerRun = createProgramRun(graph, store.get().registry, current, playerText(), format);
      playerRunKey = key;
      syncPlayerInputs();
    }
    return playerRun;
  };

  const stopProgramRun = (): void => {
    if (programTimer !== null) clearInterval(programTimer);
    programTimer = null;
    programRunning = false;
  };

  /** Starts the program clock at the current pace, replacing any timer already on. */
  const startProgramTimer = (): void => {
    stopProgramRun();
    programRunning = true;
    programTimer = setInterval(runProgramStep, TEST_RATES[programRate]!.ms);
  };

  /** Throws the run away: its circuit or its text is no longer the one on screen. */
  const dropPlayerRun = (): void => {
    stopProgramRun();
    playerRun = null;
    playerRunKey = '';
  };

  /** One tick of the program clock, and the end of it when there is nothing left to run. */
  const runProgramStep = (): void => {
    const target = ensurePlayerRun();
    if (target !== null) target.step();
    // A run that can no longer advance -- a refused program, or a circuit that
    // stopped settling under it -- must not leave a timer ticking at it forever.
    if (target === null || target.errors.length > 0) stopProgramRun();
    refreshBench();
  };

  const toggleProgramRun = (): void => {
    if (programRunning) {
      stopProgramRun();
      refreshBench();
      return;
    }
    const target = ensurePlayerRun();
    if (target === null || target.errors.length > 0) {
      // Nothing to run: the status line already says why, and a timer stepping a
      // refused program would be a control that lies about what it is doing.
      refreshBench();
      return;
    }
    startProgramTimer();
    // The test run steps as soon as it starts (`startTest` calls `runTestStep`),
    // so the first edge arrives with the click rather than a beat later.
    runProgramStep();
  };

  const refreshBench = (): void => {
    ide?.render();
    debug?.render();
  };

  /**
   * A keystroke in the editor: the text moves in both copies, and the verdict goes.
   *
   * ONE VALUE, THREE PLACES. `AppState.programs` is what the checks and the run
   * read, `Progress.programs` is what survives a refresh, and `saveProgress` is
   * written from the same object -- so the three cannot disagree, and `applyGrade`
   * (which rebuilds `Progress` around `progress.programs`) can only ever carry the
   * latest text, because every path that replaces `Progress` reads the one the
   * store holds.
   */
  const onProgramEdit = (text: string): void => {
    const { level: current, programs, progress: current0 } = store.get();
    const next = { ...programs, [current.id]: text };
    progress = { ...current0, programs: next };
    saveProgress(progress);
    // A verdict reached before the edit describes a different program, and a run
    // compiled from the old text describes a different circuit.
    dropPlayerRun();
    store.set({ programs: next, progress, lastGrade: null });
  };

  /**
   * The editor and the debugger, mounted while the level grades a program the
   * player wrote and removed when it does not.
   *
   * WHY IT IS NOT ALWAYS MOUNTED, hidden: the board screen is what chapters 1 to 3
   * were built and tested against, and a panel that appeared on level 4 would be a
   * screen nobody designed for. `levelExpectsProgram` is the level-data question;
   * this is where the DOM follows it.
   *
   * IT DOES NOT DROP THE RUN, and must not: on a program level `rebuild` has
   * already built the run whose machine the display is painting, and throwing it
   * away here would leave the panel reading a second machine -- exactly the
   * disagreement the shared machine exists to remove. `openLevel` drops the
   * previous level's run before the rebuild that replaces it.
   */
  const mountBench = (): void => {
    viewProgram.textContent = '';
    viewDebug.textContent = '';
    ide = null;
    debug = null;
    const wants = levelExpectsProgram(store.get().level);
    programTab.hidden = !wants;
    debugTab.hidden = !wants;
    programButton.hidden = !wants;
    if (!wants) {
      if (viewProgram.hidden === false || viewDebug.hidden === false) showPanel('cases');
      return;
    }
    // The bench is why this level is open: show its editor rather than making
    // the player find the tab.
    showPanel('program');

    ide = mountIde(viewProgram, store, {
      format: () => playerProgramFormat(store.get().level),
      onEdit: onProgramEdit,
      onAssemble: () => {
        ensurePlayerRun();
        // The tick metric is read out of the checks, and a player check walks the
        // player's program, so the bar is re-measured when the program is read --
        // not on every keystroke, where it would be a compile per character for a
        // number nobody reads mid-word.
        measure();
        refreshBench();
      },
      // The level's own run, the same handler the panel and the toolbar call: a
      // program level's cases cannot be played one at a time (`testCases` says
      // why), so this grades the circuit against the player's program.
      onTest: () => {
        ensurePlayerRun();
        toggleTest();
      },
      onStep: () => {
        const target = ensurePlayerRun();
        if (target === null) return;
        target.step();
        refreshBench();
      },
      onToggleRun: toggleProgramRun,
      running: () => programRunning,
      testing: () => testing,
      rate: () => TEST_RATES[programRate]!.label,
      onCycleRate: () => {
        programRate = (programRate + 1) % TEST_RATES.length;
        // A running program takes the new pace at once: a speed button that only
        // applied to the next run would be a control that did nothing while it
        // mattered.
        if (programRunning) startProgramTimer();
        refreshBench();
      },
      result: () =>
        playerRun === null
          ? null
          : { bytes: playerRun.bytes, errors: playerRun.errors, ticks: playerRun.ticks },
    });
    debug = mountDebug(viewDebug, {
      registers: () => playerRun?.readRegisters() ?? null,
      pc: () => playerRun?.readPc() ?? null,
      ram: () => playerRun?.readRam() ?? null,
      halt: () => playerRun?.readHalt() ?? null,
      ticks: () => playerRun?.ticks ?? 0,
    });
    // A run exists from the moment the bench does, so the debugger opens on the
    // machine's own state -- the counter at its first instruction, the registers
    // empty -- rather than on a card of dashes.
    ensurePlayerRun();
    refreshBench();
  };

  /** Every board edit: the circuit changed, so the display and the measurement did too. */
  const onChange = (): void => {
    if (testing) stopTest();
    // A run is a compiled circuit: this one was compiled from the graph as it was
    // before the edit, so it goes rather than being left to describe a circuit
    // nobody can see. It is rebuilt by the next control that asks for one.
    graphRevision += 1;
    dropPlayerRun();
    rebuild();
    // The columns keep their layout but lose their numbers: they were read from
    // the circuit as it was before this edit.
    testResults = [];
    activeCase = null;
    measure();
    refreshBench();
    // A body edit is also a library edit: the component the player is inside
    // holds the graph they are drawing, so the two move together.
    if (store.get().editing !== null) syncBody();
  };

  /**
   * The panel's handlers, kept in one object so the mount stays readable.
   *
   * They are built here rather than passed one by one because they share the
   * draft state above them: the confirm step is `commitWrap`, which needs BOTH the
   * plan the panel is showing and the name its inputs hold.
   */
  const blueprintOptions = {
    draft: (): WrapPlan | null => wrapDraft,
    selection: (): number => store.get().selected.length,
    draftName: (): { zh: string; en: string } => draftName,
    onDraftName: (name: { zh: string; en: string }): void => {
      draftName = name;
    },
    onConfirm: (): void => {
      if (wrapDraft) commitWrap(wrapDraft, draftName);
      blueprintPanel.render();
    },
    onCancel: (): void => {
      wrapDraft = null;
      blueprintPanel.render();
      paint();
    },
    onStartWrap: (): void => startWrap(),
    onRename: (id: string, name: { zh: string; en: string }): void => renameBlueprint(id, name),
    onDelete: (id: string): boolean => deleteBlueprint(id),
    onEnter: (id: string): void => enterBlueprint(id),
    onLeave: (): void => leaveBlueprint(),
  };

  // -------------------------------------------------------------------------
  // the player's own components
  // -------------------------------------------------------------------------

  /** The wrap being drafted in the panel, or `null`. Nothing has moved yet. */
  let wrapDraft: WrapPlan | null = null;
  let draftName = { zh: '', en: '' };

  /** The graph on the board right now and the library it is measured against. */
  const graphWithRegistry = (): {
    graph: Graph;
    blueprints: Progress['blueprints'];
  } => {
    const { graph, blueprints } = store.get();
    return { graph, blueprints };
  };

  /**
   * Writes a wrapped document into the app in one step.
   *
   * ONE COMMAND FOR TWO CHANGES. A wrap moves instances off the board and adds a
   * definition to the library, and those halves are useless apart -- an undo that
   * restored the board but left the component behind would be a state the player
   * cannot describe. `CommandStack` takes the library with the command for exactly
   * this, and `main.ts` is the only place that knows both values.
   */
  const commitWrap = (plan: WrapPlan, name: { zh: string; en: string }): void => {
    const { graph, blueprints } = graphWithRegistry();
    const next = applyWrap(graph, blueprints, { ...plan, component: { ...plan.component, name } });
    const beforeGraph = graph;
    const beforeLibrary = blueprints;
    const afterGraph = next.graph;
    const afterLibrary = next.library;

    stack.push(
      {
        label: `wrap ${plan.component.id}`,
        do: (g) => Object.assign(g, afterGraph),
        undo: (g) => Object.assign(g, beforeGraph),
        blueprints: afterLibrary,
        blueprintsBefore: beforeLibrary,
      },
      graph,
    );
    wrapDraft = null;
    draftName = { zh: '', en: '' };
    store.set({
      graph: afterGraph,
      registry: composeRegistry(registry, afterLibrary),
      blueprints: afterLibrary,
    });
    progress = { ...progress, blueprints: afterLibrary };
    saveProgress(progress);
    graphRevision += 1;
    dropPlayerRun();
    rebuild();
    measure();
    paintTools();
  };

  const startWrap = (): void => {
    const { graph, blueprints, selected } = store.get();
    const plan = planWrap(graph, store.get().registry, blueprints, selected);
    if (!plan) return;
    wrapDraft = plan;
    draftName = { ...plan.component.name };
    blueprintPanel.render();
  };

  /** Opens a component's body on the board: the same board, a different graph. */
  const enterBlueprint = (id: string): void => {
    const entry = store.get().blueprints[id];
    if (!entry) return;
    // The body is edited as a graph of its own, so it gets its own history and the
    // board's is dropped: a command from the board would be replayed against a
    // document it does not describe.
    stack.clear();
    graphRevision += 1;
    dropPlayerRun();
    store.set({
      graph: cloneGraph(entry.def.body),
      editing: id,
      selected: [],
      armed: null,
      metrics: null,
      lastGrade: null,
      status: null,
    });
    rebuild();
    fitView();
    measure();
    paintTools();
  };

  const syncBody = (): void => {
    const { editing, graph, blueprints } = store.get();
    if (editing === null) return;
    const entry = blueprints[editing];
    if (!entry) return;
    const nextLibrary = {
      ...blueprints,
      [editing]: { name: { ...entry.name }, def: { ...entry.def, body: graph } },
    };
    // THE REGISTRY IS LEFT ALONE HERE. Composing it per keystroke would be work
    // for nothing: the display on screen is the body being edited, and the
    // composed registry is rebuilt on the way out (`leaveBlueprint`) and on every
    // wrap, which is when a definition has to be resolvable again.
    store.set({ blueprints: nextLibrary });
    progress = { ...progress, blueprints: nextLibrary };
    saveProgress(progress);
  };

  const leaveBlueprint = (): void => {
    syncBody();
    // The registry is recomposed on the way out: a component edited while its own
    // body was on the board has a new circuit, and every instance of it on the
    // board has to resolve against the new one.
    store.set({ registry: composeRegistry(registry, store.get().blueprints) });
    stack.clear();
    graphRevision += 1;
    dropPlayerRun();
    store.set({
      graph: level.board ? graphFromBoard(level.id, level.board) : emptyGraph(level.id),
      editing: null,
      selected: [],
      armed: null,
      metrics: null,
      lastGrade: null,
    });
    rebuild();
    measure();
    paintTools();
  };

  const renameBlueprint = (id: string, name: { zh: string; en: string }): void => {
    const { blueprints } = store.get();
    const entry = blueprints[id];
    if (!entry) return;
    const nextLibrary = {
      ...blueprints,
      [id]: { name: { ...name }, def: { ...entry.def, name: { ...name } } },
    };
    store.set({ blueprints: nextLibrary, registry: composeRegistry(registry, nextLibrary) });
    progress = { ...progress, blueprints: nextLibrary };
    saveProgress(progress);
  };

  /**
   * Removes a component, refusing while the board still uses it.
   *
   * A REFUSAL RATHER THAN A CASCADE: deleting the instances that use it would be
   * the app deciding which parts of a circuit the player did not mean to keep. The
   * instance ids are what makes the check possible -- a component is referenced by
   * `inst.def`, so the answer is one scan.
   */
  const deleteBlueprint = (id: string): boolean => {
    const { blueprints, graph } = store.get();
    if (graph.instances.some((inst) => inst.def === id)) return false;
    const nextLibrary: Record<string, (typeof blueprints)[string]> = {};
    for (const [key, entry] of Object.entries(blueprints)) {
      if (key !== id) nextLibrary[key] = entry;
    }
    store.set({ blueprints: nextLibrary, registry: composeRegistry(registry, nextLibrary) });
    progress = { ...progress, blueprints: nextLibrary };
    saveProgress(progress);
    return true;
  };

  /**
   * The circuit file: out and back in.
   *
   * THE FILE CARRIES THE COMPONENTS IT NEEDS (`libraryClosure`), because a circuit
   * that references `bp1` and hopes the reader has one is a file that half the time
   * does not open. Importing merges what it brought into the library -- renaming
   * anything that clashes, since two players both have a `bp1` and they are
   * different circuits -- and then the board holds the imported circuit.
   */
  const exportCircuit = (): void => {
    const { graph, blueprints, level: current } = store.get();
    const text = serializeCircuit(
      graph,
      libraryClosure(blueprints, referencedComponents(graph)),
    );
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${current.id}-${dateStamp()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      store.set({
        status: { zh: `已导出 ${current.name.zh} 的电路`, en: 'Circuit exported' },
      });
    } catch {
      // A browser that refuses the download still gets a readable copy on screen.
      store.set({
        status: { zh: '无法下载文件：请在浏览器设置里允许下载', en: 'Download refused by the browser' },
      });
    }
  };

  const importCircuit = (): void => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.json,application/json';
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      if (!file) return;
      void file.text().then((text) => applyImportedFile(text));
    });
    picker.click();
  };

  /** The other half of `importCircuit`, split out so it is testable without a file. */
  const applyImportedFile = (text: string): void => {
    const parsed = parseCircuit(text, store.get().blueprints);
    if ('error' in parsed) {
      store.set({ status: parsed.error });
      return;
    }
    const { graph, blueprints } = parsed;
    stack.clear();
    graphRevision += 1;
    dropPlayerRun();
    store.set({
      graph,
      blueprints,
      registry: composeRegistry(registry, blueprints),
      editing: null,
      selected: [],
      armed: null,
      lastGrade: null,
      metrics: null,
      status: {
        zh: `已导入 ${graph.instances.length} 个元件、${graph.wires.length} 根导线`,
        en: `Imported ${graph.instances.length} parts and ${graph.wires.length} wires`,
      },
      camera: { x: 40, y: 40, zoom: 1 },
    });
    progress = { ...progress, blueprints };
    saveProgress(progress);
    rebuild();
    measure();
    paint();
    fitView();
  };

  const mapRender = mountMap(mapScreen, store, openLevel);

  mountShell(app, store, {
    onOpenMap: () => {
      // LEAVING THE BOARD STOPS ITS CLOCKS. The board screen is hidden rather
      // than unmounted, so both timers would otherwise keep stepping a circuit
      // nobody can see: a program left running while the player reads the map
      // comes back a hundred instructions further on, and only the pause button
      // would ever have said so. The panel and the toolbar are told as well, so
      // the play button does not come back pressed over a stopped clock.
      running = false;
      stopClock();
      stopProgramRun();
      paintTools();
      refreshBench();
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
  mountStatus(app, store);
  // Every panel is docked now: the palette and the component library in the
  // primary sidebar, the test cases and the bench in the bottom panel, the
  // assistant in the secondary sidebar.
  mountPalette(partsSection, store, onPickPart);
  const blueprintPanel = mountBlueprintPanel(componentsSection, store, blueprintOptions);
  const truth = mountTruthTable(viewCases, store, {
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
  const io = mountIoPanel(ioSection, store, {
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
  const toolbar = mountToolbar(editorActions, {
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
      // 停止并复位 CLEARS THE BOARD THE PLAYER IS LOOKING AT WITHOUT ERASING THE
      // PROGRAM. `rebuild` is the only place a display is bound to a run, and a
      // text edit drops the run without rebuilding -- so after any keystroke the
      // display is still painting the previous run's machine while
      // `ensurePlayerRun` hands back a different one. A reset sent to that run
      // would clear a machine nobody can see and leave the board on screen
      // exactly as it was. So the run goes and the display is rebuilt with it: a
      // fresh run is reset and its image loaded before it is handed over
      // (`levels/run.ts`), and a board with no run at all compiles its own
      // cleared circuit. Nothing typed is lost -- the player's text lives in
      // `state.programs`, and the next 汇编/单步/测试 rebuilds the same run and
      // reloads the same image.
      dropPlayerRun();
      rebuild();
      paint();
      io.render();
      refreshBench();
      paintTools();
    },
    onToggleTest: toggleTest,
    onWrapSelection: startWrap,
    onExportCircuit: exportCircuit,
    onImportCircuit: importCircuit,
  });

  // ---------------------------------------------------------------------------
  // the agent
  // ---------------------------------------------------------------------------

  /**
   * The natural-language assistant, wired to the application it operates.
   *
   * EVERYTHING HERE IS A HAND'S ROUTE. `apply` pushes onto the player's own undo
   * stack and then calls `onChange`, which is exactly what a mouse edit does --
   * so an agent edit is measured, repainted, undoable and saved by the same code
   * as a hand edit, and there is no second way to change a circuit that could
   * drift from the first. `run`/`pause`/`stepOnce`/`reset` are the toolbar's
   * buttons; `test` is 测试; `circuitText` and `loadCircuit` are 导出/导入.
   *
   * The palette it may place is the palette the PLAYER has: `offeredDefIds` calls
   * the same two functions the parts tray does, so `?dev=1` and the sandbox open
   * everything up and an ordinary level still hands the agent only the parts that
   * level allows. That is what keeps "the agent can do what a person can do" from
   * quietly becoming "the agent can do more".
   */
  let agentConfig: AgentConfig | null = loadAgentConfig();

  const offeredDefIds = (): string[] => {
    const { level: current, progress: prog, registry: reg, dev: devOn, blueprints } = store.get();
    // The same function the parts tray calls, so "what the agent may place" is
    // "what the player is being offered" by construction rather than by intent.
    return offeredDefsFor(prog, LEVELS, current, devOn, reg, libraryIds(blueprints)).filter((defId) =>
      reg.has(defId),
    );
  };

  /**
   * Plays the level's cases and resolves with the verdict.
   *
   * The run is a demonstration with timers, so this waits for it instead of
   * returning "started": an agent told only that a run began would go on to
   * "fix" a circuit it has no verdict about. The subscription is set up BEFORE
   * `startTest`, because a level whose cases cannot be played finishes inside
   * that call -- after it, there would be no notification left to wait for.
   */
  const agentTest = (): Promise<TestOutcome> => {
    const current = store.get().level;
    if (isSandbox(current)) {
      store.set({ status: NO_CASES_NOTE.sandbox });
      paintTools();
      return Promise.resolve({
        ran: false,
        passed: null,
        summary: NO_CASES_NOTE.sandbox.zh,
        failures: [],
      });
    }
    return new Promise<TestOutcome>((resolve) => {
      let done = false;
      let unsubscribe: () => void = () => {};
      const finish = (): void => {
        if (done) return;
        done = true;
        unsubscribe();
        const grade = store.get().lastGrade;
        const summary =
          grade === null
            ? '没有拿到判定'
            : grade.passed
              ? `通过：门数 ${grade.metrics.gate}，延迟 ${grade.metrics.delay}，${grade.stars} 星`
              : `未通过：${grade.failures.length} 个用例不符`;
        // WHICH CASES, AND BY HOW MUCH. The count alone is a verdict with no
        // information in it: expected-versus-actual is what turns "wrong" into an
        // edit. Capped, because a fuzz level can fail hundreds of cases and the
        // first few carry the pattern.
        const failures = (grade?.failures ?? []).slice(0, 8).map((failure) => ({
          inputs: failure.inputs,
          expected: failure.expected,
          actual: failure.actual,
          tick: failure.tick,
          ...(failure.detail === undefined ? {} : { detail: failure.detail }),
        }));
        resolve({ ran: true, passed: grade?.passed ?? null, summary, failures });
      };
      unsubscribe = store.subscribe(() => {
        if (!testing) finish();
      });
      startTest();
      if (!testing) finish();
    });
  };

  const agentHost: AgentHost = {
    graph: () => store.get().graph,
    parts: () => {
      const reg = store.get().registry;
      return offeredDefIds().map((defId) => {
        const def = reg.get(defId);
        return {
          id: def.id,
          nameZh: def.name.zh,
          nameEn: def.name.en,
          category: def.category,
          hidden: def.hidden === true,
          inputs: def.inputs,
          outputs: def.outputs,
        };
      });
    },
    snapshot: (): BoardSnapshot => {
      const state = store.get();
      const open = state.level;
      // Only the ERRORS: a half-built circuit is full of dangling-input warnings
      // by design, and reciting them every step would bury the one thing an agent
      // needs to know -- whether what it just did made the circuit invalid.
      const issues = validateGraph(state.graph, state.registry)
        .filter((issue) => issue.severity === 'error')
        .map((issue) => ({ severity: 'error' as const, message: issue.message.zh }));
      return {
        mode: isSandbox(open) ? 'sandbox' : 'level',
        dev: state.dev,
        level: { id: open.id, nameZh: open.name.zh, nameEn: open.name.en },
        editing: state.editing,
        parts: state.graph.instances.map((inst) => ({
          id: inst.id,
          def: inst.def,
          nameZh: state.registry.has(inst.def) ? state.registry.get(inst.def).name.zh : inst.def,
          x: inst.x,
          y: inst.y,
          params: inst.params,
        })),
        wires: state.graph.wires.map((wire) => ({
          id: wire.id,
          from: { ...wire.from },
          to: { ...wire.to },
        })),
        selected: [...state.selected],
        running,
        testing,
        metrics:
          state.metrics === null
            ? null
            : { gates: state.metrics.gate, delay: state.metrics.delay },
        grade:
          state.lastGrade === null
            ? null
            : {
                passed: state.lastGrade.passed,
                summary: `${state.lastGrade.failures.length} 个用例不符`,
              },
        issues,
        status: state.status,
        briefZh: narrativeFor(open.id).before.zh,
        components: Object.entries(state.blueprints).map(([id, entry]) => ({
          id,
          nameZh: entry.name.zh,
          nameEn: entry.name.en,
          inputs: entry.def.inputs.map((pin) => pin.id),
          outputs: entry.def.outputs.map((pin) => pin.id),
          instances: state.graph.instances.filter((inst) => inst.def === id).length,
        })),
        inputs: open.io.inputs.map((pin) => ({
          id: pin.id,
          width: pin.width,
          value: vector[pin.id] ?? 0,
        })),
        // What the circuit is supposed to DRIVE, with whatever the last settle
        // read there -- the other half of "what does this level want", and the
        // half a session that could only see its inputs went looking for in the
        // wrong place.
        outputs: open.io.outputs.map((pin) => {
          const live = levelOutputs();
          const value = live === null ? undefined : live[pin.id];
          return { id: pin.id, width: pin.width, value: value === undefined ? null : value };
        }),
        program: state.programs[open.id] ?? '',
        expectsProgram: levelExpectsProgram(open),
      };
    },
    // The grid is the theme's, not this module's: the agent layer may not import
    // `ui/`, so the one number it needs is handed to it here.
    snap: (x, y) => ({ x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID }),
    // A level binds its pins to instances named `IN_<pin>` / `OUT`, and the rule
    // that hands those names out lives in `ui/board/interact.ts` -- the agent gets
    // the same answer a hand gets, or `null`.
    connectorFor: (defId) =>
      levelIoPlacement(store.get().level, store.get().graph, defId) ?? null,
    apply: (command, focus) => {
      stack.push(command, store.get().graph);
      // Selecting what just changed is what makes a step WATCHABLE: the magenta
      // ring says which part of the board the last action touched. Not an edit,
      // so it is not on the undo stack.
      if (focus !== undefined) store.set({ selected: [...focus] });
      onChange();
    },
    undo: () => {
      const undone = stack.undo(store.get().graph);
      if (undone) onChange();
      return undone;
    },
    redo: () => {
      const redone = stack.redo(store.get().graph);
      if (redone) onChange();
      return redone;
    },
    select: (ids) => store.set({ selected: [...ids] }),
    // The wrap is done the way the panel does it: plan first, then the one
    // command that moves the circuit and the library together. `null` is
    // `planWrap`'s own refusal, passed through rather than guessed at.
    wrapSelection: (name) => {
      const { graph, registry: reg, blueprints, selected } = store.get();
      const plan = planWrap(graph, reg, blueprints, selected);
      if (plan === null) return null;
      const id = plan.component.id;
      commitWrap(plan, { zh: name.zh, en: name.en });
      return id;
    },
    enterComponent: (id) => {
      if (store.get().blueprints[id] === undefined) return false;
      enterBlueprint(id);
      return true;
    },
    leaveComponent: () => {
      leaveBlueprint();
    },
    renameComponent: (id, name) => {
      if (store.get().blueprints[id] === undefined) return false;
      renameBlueprint(id, { zh: name.zh, en: name.en });
      return true;
    },
    // The refusal is `deleteBlueprint`'s: it is the same scan that keeps a hand
    // from deleting a component the board is still using.
    deleteComponent: (id) => deleteBlueprint(id),
    setInput: (pinId, value) => {
      driveTo({ ...vector, [pinId]: value });
    },
    setProgram: (text) => {
      onProgramEdit(text);
    },
    run: () => {
      running = true;
      startClock();
      paintTools();
    },
    pause: () => {
      running = false;
      stopClock();
      paintTools();
    },
    stepOnce: step,
    reset: () => {
      running = false;
      stopClock();
      dropPlayerRun();
      rebuild();
      paint();
      io.render();
      refreshBench();
      paintTools();
    },
    test: agentTest,
    circuitText: () =>
      serializeCircuit(
        store.get().graph,
        libraryClosure(store.get().blueprints, referencedComponents(store.get().graph)),
      ),
    loadCircuit: (text) => {
      const parsed = parseCircuit(text, store.get().blueprints);
      if ('error' in parsed) return { ok: false, error: parsed.error.zh };
      // The same path the toolbar's 导入 uses, so an imported circuit is treated
      // identically however it arrived.
      applyImportedFile(text);
      return { ok: true, parts: parsed.graph.instances.length, wires: parsed.graph.wires.length };
    },
  };

  let agentPanel: AgentPanel | null = null;
  agentPanel = mountAgentPanel(
    { toggle: agentSlot, sidebar: secondary },
    {
      host: agentHost,
      config: () => agentConfig,
      onSave: (config) => {
        agentConfig = config;
        agentPanel?.render();
      },
      onClear: () => {
        agentConfig = null;
        agentPanel?.render();
      },
      // The secondary sidebar is a dock, not a floating card: opening the panel
      // claims its column, closing it gives the column back to the board.
      onVisibility: (open) => {
        workspace.classList.toggle('secondary-collapsed', !open);
      },
    },
  );

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

  attachBoardInput(canvas, store, stack, {
    onChange,
    onPick: onPickInstance,
    onHover: (at) => {
      ghost = at;
      view = { ...view, ghost };
      paint();
    },
  });

  // Render on state change only: a continuous rAF loop would repaint a static
  // board 60 times a second forever. Panning, zooming and dragging all go
  // through store.set, so they still repaint every frame they change something.
  // The bench rides along: its panels read the store (the level's text, the
  // verdict) and are not subscribers of their own, so one edit repaints all three
  // in the order they are laid out over the board.
  store.subscribe(() => {
    paint();
    refreshBench();
    // The toolbar's wrap button counts the selection, and the marquee commits it
    // through the store -- so the count has to follow a selection change, which is
    // not a board edit and so does not come through `onChange`.
    paintTools();
    // THE SANDBOX CIRCUIT IS SAVED AS IT IS DRAWN, and only when the CIRCUIT
    // changed: the store notifies on every change, including each frame of a pan
    // and every click that selects something, and neither of those is worth a
    // `localStorage` write. The signature is what tells the two apart.
    if (isSandbox(store.get().level)) {
      const graph = store.get().graph;
      const signature = circuitSignature(graph);
      if (signature !== sandboxSignature) {
        sandboxSignature = signature;
        saveSandbox(graph);
      }
    }
  });
  globalThis.addEventListener('resize', paint);

  // The app opens on the resume point's level, so its briefing is the first
  // thing the player sees.
  rebuild();
  showBriefing(narrativeFor(level.id).before);
  paint();
  refreshPanels();
  mountBench();
  // ...and the level it opened on gets the same framing `openLevel` gives it.
  if (level.board) fitView();
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
