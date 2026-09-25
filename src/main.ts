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
import { renderBoard } from './ui/board/render';
import { attachBoardInput } from './ui/board/interact';
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

  const canvas = document.createElement('canvas');
  canvas.className = 'board';

  const showScreen = (which: 'board' | 'map'): void => {
    boardScreen.hidden = which !== 'board';
    mapScreen.hidden = which !== 'map';
    // A hidden canvas has no box to draw into; repaint when it comes back.
    if (which === 'board') renderBoard(canvas, store, store.get().camera);
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

  /** Loads a level into the board; Task 12 calls this from the chapter map. */
  const openLevel = (levelId: string): void => {
    const next = getLevel(levelId);
    stack.clear();
    canvas.dataset.pendingDef = '';
    store.set({
      level: next,
      graph: emptyGraph(next.id),
      selected: [],
      lastGrade: null,
      status: null,
    });
    showScreen('board');
  };

  const regrade = (): void => {
    const { graph, level: current, progress: current0 } = store.get();
    const result = grade(graph, registry, current);
    store.set({ lastGrade: result });
    if (result.passed) {
      progress = applyGrade(current0, current, result);
      saveProgress(progress);
      store.set({ progress });
    }
  };

  // Task 12 replaces this placeholder with the real chapter map; `openLevel`
  // above is the entry point it will call.
  const openMap = (): void => {
    showScreen('map');
  };

  mountShell(app, store, { onOpenMap: openMap });
  // DOM order is visual order: the palette strip, then the board, then the
  // truth table at the bottom.
  mountPalette(boardScreen, store, onPick);
  boardScreen.append(canvas);
  mountTruthTable(boardScreen, store);
  attachBoardInput(canvas, store, stack, { onChange: regrade });

  // Render on state change only: a continuous rAF loop would repaint a static
  // board 60 times a second forever. Panning, zooming and dragging all go
  // through store.set, so they still repaint every frame they change something.
  store.subscribe(() => {
    if (!boardScreen.hidden) renderBoard(canvas, store, store.get().camera);
  });
  globalThis.addEventListener('resize', () => {
    if (!boardScreen.hidden) renderBoard(canvas, store, store.get().camera);
  });

  renderBoard(canvas, store, store.get().camera);
}
