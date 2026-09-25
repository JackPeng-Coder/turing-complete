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
import { mountMap } from './ui/map';
import { narrativeFor } from './ui/narrative';
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

  /**
   * Loads a level into the board; the chapter map calls this. The `before` text
   * is shown on arrival, every time -- entering a level is the narrative beat,
   * whether or not it has been passed before.
   */
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

  const mapRender = mountMap(mapScreen, store, openLevel);

  mountShell(app, store, {
    onOpenMap: () => {
      showScreen('map');
      mapRender.render();
    },
  });
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

  // The app opens on the resume point's level, so its briefing is the first
  // thing the player sees.
  showBriefing(narrativeFor(level.id).before);
  renderBoard(canvas, store, store.get().camera);
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
