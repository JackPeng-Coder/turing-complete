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
import { nudgedInput } from './app/inputs';
import { composeRegistry, libraryClosure, libraryIds, referencedComponents } from './levels/blueprints';
import { mountBlueprintPanel } from './ui/blueprint';
import { applyWrap, planWrap, type WrapPlan } from './levels/wrap';
import { SANDBOX_ID, SANDBOX_LEVEL, boardPins, isSandbox } from './levels/sandbox';
import { circuitSignature, emptySandbox, loadSandbox, saveSandbox } from './persist/sandbox';
import { parseCircuit, serializeCircuit } from './persist/circuit';
import { LAYOUT_LIMITS, loadLayout, saveLayout, type Layout } from './persist/layout';
import { devModeFrom } from './app/dev';
import { iconSvg, mountShell, mountStatus, type IconName } from './ui/shell';
import { mountPalette } from './ui/palette';
import { mountTruthTable, TEST_DEMO_LIMIT } from './ui/truthTable';
import { mountIoPanel } from './ui/ioPanel';
import { showResult } from './ui/result';
import { mountToolbar } from './ui/toolbar';
import { mountSplitter, type SplitterOptions } from './ui/splitter';
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
import { mountFlashPanel, type FlashPanel } from './ui/flashPanel';
import type { LevelSpec } from './levels/spec';
/**
 * 组合根：把状态、界面、智能体与持久化装配成一个应用。
 *
 * 应用里几乎所有的“接线”都发生在这个文件：创建 store 与撤销栈、搭建工作台的
 * 五块停靠区、挂载各块面板，并把关卡、画板、运行实例、元件库、导入导出与智能体
 * 接到同一个 onChange 路径上。它依赖 ui、agent、persist、levels 等下层模块，
 * 而没有任何下层模块反过来依赖它。关键不变量：所有修改电路的路径最终都经过
 * store.set 与 onChange，因此“手改”和“智能体改”在测量、重绘、撤销与存档上完全同路。
 */

const registry = createRegistry(BASE_DEFS);
let progress: Progress = loadProgress();

/** ?dev=1 开发模式：全部关卡可达、清单里的元件全部开放。见 dev.ts。 */
let dev = devModeFrom(globalThis.location.search);

// Chapter 4 is experimental and hidden outside dev mode. A normal save that has
// already passed level 49 must not boot straight into level 50, and an old save
// that carries chapter-4 stars must not either: both clamp to the campaign's
// last visible level. `?dev=1` keeps the true resume point.
const resumed = getLevel(resumePointOf(progress, LEVEL_ORDER));
const level: LevelSpec =
  !dev && resumed.chapter === 4 ? getLevel('ch3-49-turing-complete') : resumed;

/**
 * 文档编译时使用的注册表：基础元件目录 + 玩家自定义元件。
 *
 * 基础注册表始终是基础注册表。上面的 registry 回答“游戏自带哪些元件”，
 * 也是 defs/index.ts 的测试所钉住的对象；这里的 composed 才是画板、检查器
 * 与元件托盘真正用于解析元件 id 的地方，且元件库一变就整体重建，而不是原地修改。
 * 详见 composeRegistry：玩家的元件永远不会进入那个单例注册表。
 */
let composed = composeRegistry(registry, progress.blueprints);

const store: Store<AppState> = createStore<AppState>({
  level,
  // 自带起始电路的关卡从该电路开始，其余关卡从空画板开始。
  // 两种情况下玩家拿到的都是一张普通的、可编辑的 Graph：
  // 起始电路只是“提前搭好的一段”，不是谁都不能碰的固定装置；
  // 这正是它仍是一张画板、而不是内置 CPU 的原因。
  graph: level.board ? graphFromBoard(level.id, level.board) : emptyGraph(level.id),
  registry: composed,
  progress,
  camera: { x: 40, y: 40, zoom: 1 },
  selected: [],
  dragging: null,
  armed: null,
  dev,
  // 程序文本来自加载的存档，因此重新打开应用时会恢复玩家在各关卡留下的文本。
  // IDE 在每次输入时（onProgramEdit）通过 progress.programs 与 saveProgress 写回，
  // 于是编辑器、检查器与存档读到的是同一份文本。
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
 * 沙盒电路上一次写入存储时的签名。
 *
 * 放在模块级，是因为沙盒的生命周期长于任何一屏：玩家去看关卡地图时，
 * 画板屏幕只是被隐藏而不是卸载；若签名放在闭包里，openLevel 就得记着把它一起带走。
 * 空字符串表示“当前不在沙盒”，它同时也保证关卡里的编辑不会写进沙盒存档。
 */
let sandboxSignature = '';

/** 文件名安全的时间戳：同一电路导出两次不会互相覆盖。 */
function dateStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * 演示用例时每个用例停留多久，按速度档位给出。
 *
 * 因为测试跑的是演示，节奏归玩家：十五行真值表在 2× 下约七秒，
 * 而模糊测试关卡的六十四轮约半分钟——对理解有帮助还是纯浪费时间，
 * 取决于电路在做什么。数组按从慢到快排列。
 */
const TEST_RATES = [
  { label: '1×', ms: 900 },
  { label: '2×', ms: 450 },
  { label: '4×', ms: 220 },
  { label: '8×', ms: 110 },
] as const;

/**
 * 演示开始时的默认档位，作为 TEST_RATES 的下标：即 8×。
 *
 * 默认快，因为用例只是演示，通常也只看一遍；想细读某个用例的玩家
 * 会按停止再逐档调慢，那只要一次点击；而干等一轮慢速演示所花掉的三十秒，
 * 是再也拿不回来的。
 */
const DEFAULT_TEST_RATE = 3;

/** 无法逐个演示用例时给出的提示文案：按原因分为 program、custom、empty、sandbox 四种。 */const NO_CASES_NOTE = {
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
   * 沙盒专用的提示：它按设计就没有测试用例。
   *
   * 为什么不用 empty 那一条：没有用例的关卡意味着某处出了问题，
   * 而沙盒是“本就不该发生任何判定”的屏幕。在这里对玩家说“已直接判定”，
   * 等于让应用描述一个它根本不会给出的结论。
   */
  sandbox: {
    zh: '沙盒没有测试用例：电路一直在跑，门数与延迟就是你的读数',
    en: 'The sandbox has no test cases: the circuit runs, and the gate and delay counters are your own readings',
  },
} as const;

/** 玩家可循环切换的时钟频率，按从慢到快排列。 */
const RATES = [
  { label: '1Hz', ms: 1000 },
  { label: '10Hz', ms: 100 },
  { label: '60Hz', ms: 16 },
] as const;

/**
 * 沙盒连接器循环切换的位宽序列。
 *
 * 常用位宽排在前面：沙盒电路是字节宽（8 位）的次数与 1 位差不多，
 * 所以阶梯从 1 → 8 开始，之后才轮到自己发行引脚的其他位宽：
 * 宽总线家族都是 8 位，译码器的选择引脚是 1/2/3 位，指令字段是 2/3/6 位，
 * 16/32 位则是将来分级位宽家族（createWideDefs）会落到的位置。
 * 关卡引脚从不使用这个序列——它们的位宽是关卡契约，见 IoPanelOptions.onCycleWidth。
 */
const PIN_WIDTHS: readonly number[] = [1, 8, 16, 32, 2, 3, 4, 6];

if (app) {
  /**
   * 工作台。五块停靠区，形状照搬代码编辑器：最左是活动栏，
   * 旁边是主侧边栏，中间是编辑区，右侧是次侧边栏，编辑区下方是底部面板。
   * 画板就是“文档”，每块面板都是它旁边的工具，而不是盖在它上面的半透明浮层，
   * 所以没有任何面板会挡住玩家正在画的导线。
   */
  const workspace = document.createElement('div');
  workspace.className = 'workspace';

  /** 活动栏按钮：只画图标，名称由无障碍标签与 tooltip 承载。 */
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
  // 智能体自己的活动栏按钮由面板创建（只有它持有配置状态可供绘制）；
  // 这里先留一个槽位，用来保持活动栏的顺序。
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
  const collapseSidebar = document.createElement('button');
  collapseSidebar.type = 'button';
  collapseSidebar.className = 'sidebar-collapse';
  collapseSidebar.textContent = '«';
  collapseSidebar.title = '收起侧栏';
  collapseSidebar.setAttribute('aria-label', '收起侧栏');
  primaryTabs.append(partsTab, componentsTab, collapseSidebar);
  const partsSection = document.createElement('div');
  partsSection.className = 'sidebar-section sidebar-parts';
  partsSection.dataset.view = 'parts';
  const componentsSection = document.createElement('div');
  componentsSection.className = 'sidebar-section sidebar-components';
  componentsSection.dataset.view = 'components';
  componentsSection.hidden = true;
  // I/O 读数区不是标签页：驱动关卡的输入位属于接线的一部分，
  // 因此它和元件托盘一起常驻显示。它放在元件托盘下方，
  // 就像代码编辑器把大纲放在文件树下方一样。
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

  // 编辑区的操作条：画板自己的控件参与布局、排在画布上方，因此永远不会盖住导线。
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
  // 开发板面板是沙盒工具：关卡的引脚本身就是谜题，buildImage 也出于同样的理由
  // 拒绝关卡画板。它只在沙盒打开时显示，正如程序类标签页只在需要写程序的关卡显示。
  const boardTab = panelTab('开发板', 'board');
  programTab.hidden = true;
  debugTab.hidden = true;
  boardTab.hidden = true;
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.className = 'panel-toggle';
  collapse.textContent = '⌄';
  collapse.setAttribute('aria-label', '收起下方面板');
  bottomTabs.append(casesTab, programTab, debugTab, boardTab, collapse);

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
  const viewBoard = panelView('board');
  bottom.append(bottomTabs, bottomViews);

  const panelTabs = [casesTab, programTab, debugTab, boardTab];
  const panelViews = [viewCases, viewProgram, viewDebug, viewBoard];

  // ---------------------------------------------------------------- 布局 --
  // 各停靠区的尺寸保存在 tc.layout.v1：玩家把元件托盘拉宽，希望下次启动时仍然宽；
  // 把智能体侧边栏收起，也希望它保持收起。applyLayout 是唯一写网格 CSS 变量的地方，
  // 因此拖拽条、折叠按钮和一份存档三者不可能对“某条边在哪里”给出互相矛盾的说法。
  let layout = loadLayout();

  /**
   * 网格尺寸变化后调用。
   *
   * 画布是网格唯一不替我们定尺寸的东西：它的后备位图在 renderBoard 里按
   * clientWidth/clientHeight 分配，所以一次只移动 CSS 轨道的拖拽会让位图停在旧尺寸，
   * 再由浏览器拉伸到新盒子里——网格上每个方格都变成矩形，直到别的事情触发重绘。
   * 窗口缩放本来就会重绘；布局变化现在通过这里重绘。
   * 它初始是空函数，因为 paint 定义在更下面，而本函数在启动阶段就先被应用了一次，
   * 那时画板还不存在。
   */
  let onLayoutResize: () => void = () => {};

  /**
   * 挂载之后的 Arduino 面板。
   *
   * 布局代码知道它的标签页是否显示，但面板在布局代码下面很远的地方才挂载；
   * 一个可变的句柄就是衔接点（与 onLayoutResize 留给画板的是同一种做法）。
   */
  let flashPanel: FlashPanel | null = null;

  /** 活动栏图标既指示当前显示哪个视图，也指示对应的停靠区是否展开。 */
  const syncRail = (): void => {
    partsButton.setAttribute('aria-pressed', String(!layout.primaryCollapsed && !partsSection.hidden));
    componentsButton.setAttribute('aria-pressed', String(!layout.primaryCollapsed && !componentsSection.hidden));
    casesButton.setAttribute('aria-pressed', String(!layout.panelCollapsed && !viewCases.hidden));
    programButton.setAttribute('aria-pressed', String(!layout.panelCollapsed && !viewProgram.hidden));
  };

  const applyLayout = (): void => {
    workspace.style.setProperty('--primary-w', layout.primaryCollapsed ? '0px' : `${layout.primaryW}px`);
    workspace.style.setProperty('--p-split-w', layout.primaryCollapsed ? '0px' : '4px');
    workspace.style.setProperty('--secondary-w', layout.secondaryCollapsed ? '0px' : `${layout.secondaryW}px`);
    workspace.style.setProperty('--s-split-w', layout.secondaryCollapsed ? '0px' : '4px');
    workspace.style.setProperty('--panel-h', `${layout.panelH}px`);
    workspace.style.setProperty('--h-split-h', layout.panelCollapsed ? '0px' : '4px');
    workspace.classList.toggle('primary-collapsed', layout.primaryCollapsed);
    workspace.classList.toggle('secondary-collapsed', layout.secondaryCollapsed);
    workspace.classList.toggle('panel-collapsed', layout.panelCollapsed);
    bottom.classList.toggle('collapsed', layout.panelCollapsed);
    collapse.textContent = layout.panelCollapsed ? '⌃' : '⌄';
    collapse.setAttribute('aria-label', layout.panelCollapsed ? '展开下方面板' : '收起下方面板');
    syncRail();
    // 隐藏的面板不做任何工作：画板面板只响应 store，且只在它那一页显示时重绘。
    flashPanel?.setVisible(!layout.panelCollapsed && !viewBoard.hidden);
    onLayoutResize();
  };

  const setLayout = (patch: Partial<Layout>): void => {
    layout = { ...layout, ...patch };
    applyLayout();
    saveLayout(layout);
  };

  const showPanel = (name: string, expand = true): void => {
    if (expand && layout.panelCollapsed) {
      layout = { ...layout, panelCollapsed: false };
      saveLayout(layout);
    }
    for (const el of panelViews) el.hidden = el.dataset.view !== name;
    for (const el of panelTabs) el.setAttribute('aria-pressed', String(el.dataset.view === name));
    applyLayout();
    // 打开该标签页时，会按“此刻”的电路生成报告，而不是显示上次编辑之前的数字。
    // 隐藏的面板则从不生成报告。
    if (name === 'board') flashPanel?.reveal();
  };

  const showSidebar = (name: string, expand = true): void => {
    if (expand && layout.primaryCollapsed) {
      layout = { ...layout, primaryCollapsed: false };
      saveLayout(layout);
    }
    for (const el of [partsSection, componentsSection]) el.hidden = el.dataset.view !== name;
    for (const el of [partsTab, componentsTab]) el.setAttribute('aria-pressed', String(el.dataset.view === name));
    applyLayout();
  };

  casesTab.addEventListener('click', () => showPanel('cases'));
  programTab.addEventListener('click', () => showPanel('program'));
  debugTab.addEventListener('click', () => showPanel('debug'));
  boardTab.addEventListener('click', () => showPanel('board'));
  partsTab.addEventListener('click', () => showSidebar('parts'));
  componentsTab.addEventListener('click', () => showSidebar('components'));
  // 点击“已经是当前视图”的活动栏按钮，会把侧边栏折叠起来——这是代码编辑器养成的快捷习惯。
  partsButton.addEventListener('click', () => {
    if (!layout.primaryCollapsed && !partsSection.hidden) setLayout({ primaryCollapsed: true });
    else showSidebar('parts');
  });
  componentsButton.addEventListener('click', () => {
    if (!layout.primaryCollapsed && !componentsSection.hidden) setLayout({ primaryCollapsed: true });
    else showSidebar('components');
  });
  // 点击“已经是当前视图”的活动栏按钮，会把那个停靠区折叠起来——代码编辑器养成的快捷习惯。
  // 对底部面板来说，“已经是当前视图”指的是它当前所在的标签页：用例页折叠它、程序页折叠它，
  // 而两者再次点击时都会把面板重新打开到自己那一页。
  casesButton.addEventListener('click', () => {
    if (!layout.panelCollapsed && !viewCases.hidden) setLayout({ panelCollapsed: true });
    else showPanel('cases');
  });
  programButton.addEventListener('click', () => {
    if (programTab.hidden) return;
    if (!layout.panelCollapsed && !viewProgram.hidden) setLayout({ panelCollapsed: true });
    else showPanel('program');
  });
  settingsButton.addEventListener('click', () => agentPanel?.openSettings());
  collapseSidebar.addEventListener('click', () => setLayout({ primaryCollapsed: true }));
  collapse.addEventListener('click', () => setLayout({ panelCollapsed: !layout.panelCollapsed }));

  // 拖拽把手：网格里 4px 宽的轨道就是那条边，所以拖拽元素与它所在的间隙是同一个东西。
  const addSplitter = (classes: string, options: SplitterOptions): void => {
    const el = document.createElement('div');
    el.className = `splitter ${classes}`;
    workspace.append(el);
    mountSplitter(el, options);
  };
  /** 侧边栏最宽能到多少：再宽画板就窄得没法工作了。 */
  const maxSidebar = (): number => Math.max(LAYOUT_LIMITS.primaryW.min, globalThis.innerWidth - 48 - 8 - 360);
  addSplitter('p-split', {
    axis: 'x',
    sign: 1,
    value: () => layout.primaryW,
    min: () => LAYOUT_LIMITS.primaryW.min,
    max: () => Math.min(LAYOUT_LIMITS.primaryW.max, maxSidebar()),
    onChange: (value) => {
      layout = { ...layout, primaryW: value };
      applyLayout();
    },
    onCommit: () => saveLayout(layout),
  });
  addSplitter('s-split', {
    axis: 'x',
    sign: -1,
    value: () => layout.secondaryW,
    min: () => LAYOUT_LIMITS.secondaryW.min,
    max: () => Math.min(LAYOUT_LIMITS.secondaryW.max, maxSidebar()),
    onChange: (value) => {
      layout = { ...layout, secondaryW: value };
      applyLayout();
    },
    onCommit: () => saveLayout(layout),
  });
  addSplitter('h-split', {
    axis: 'y',
    sign: -1,
    value: () => layout.panelH,
    min: () => LAYOUT_LIMITS.panelH.min,
    max: () => Math.min(LAYOUT_LIMITS.panelH.max, Math.max(LAYOUT_LIMITS.panelH.min, globalThis.innerHeight * 0.55)),
    onChange: (value) => {
      layout = { ...layout, panelH: value };
      applyLayout();
    },
    onCommit: () => saveLayout(layout),
  });

  // 首次布局“不展开”：存档可能把某个停靠区收起了，而启动并不等于一次打开它的点击。
  showPanel('cases', false);
  showSidebar('parts', false);
  applyLayout();

  workspace.append(activity, primary, editor, secondary, bottom);
  app.append(workspace);

  /**
   * 画板在 store 之外还要额外绘制的信息：实时引脚值与视图开关。
   * 每当电路或时钟变化，sample() 就重建它。
   */
  let view: BoardView = { outputs: new Map(), stable: false, grid: true, ghost: null };
  /**
   * 指针在世界坐标中的位置；指针不在画板上时为 null。
   *
   * 这是视图状态而不是 store 状态：它每次鼠标移动都变，而唯一读取它的
   * 是托盘中“手持”元件的幽灵预览。只有确实有元件被手持时画板才会上报它，
   * 因此空手悬停完全不产生开销。
   */
  let ghost: Point | null = null;
  /** 正在运行的显示器（编译后的电路加上它的存储）；电路无法编译时为 null。 */
  let display: DisplaySimulation | null = null;
  /** 玩家搭建期间，关卡输入引脚被驱动的电平向量：引脚 id → 值。 */
  let vector: Readonly<Record<string, number>> = {};
  let gridOn = true;
  let running = false;
  let rateIndex = 1;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** 最近一次结算得到的引脚值，供所有读取者共享。 */
  let snapshot: SignalSnapshot | null = null;
  /** 本轮演示要播放的用例，以及已经播到第几个。 */
  let plan: TestPlan | null = null;
  let testStep = 0;
  let testRate = DEFAULT_TEST_RATE;
  /** 画板当前被哪个用例驱动，没有则为 null。 */
  let activeCase: number | null = null;
  let testing = false;
  let testTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 每个用例从画板上读到的输出，好让演示继续往后跑时，已经播过的列仍保留数字。
   * 判定结果无法提供这些数字：它只记录“失败”的用例，
   * 而一个在电路算对的位置就空白的表格，无法告诉玩家哪里做错了。
   */
  let testResults: (Readonly<Record<string, number>> | null)[] = [];
  /**
   * 编辑器单步控件与调试器共同驱动的程序运行实例；在判定玩家程序的关卡上为 null。
   *
   * 一次运行 = 编译好的电路 + 它的存储，因此无法跨越一次编辑存活——与 display 同理。
   * 文本或图一变就丢弃（而不是重建），等下一个需要它的控件再按需重建，
   * 这样面板永远不会显示已经不在画板上的电路的状态。
   */
  let playerRun: ProgramRun | null = null;
  /** playerRun 是依据什么建出来的；值不同就说明必须重建。 */
  let playerRunKey = '';
  /** 每次画板编辑都自增：运行实例编译自“活的”图，而不是某份拷贝。 */
  let graphRevision = 0;
  let ide: { render(): void } | null = null;
  let debug: { render(): void } | null = null;
  /** 程序正被定时器自动单步执行时为 true。 */
  let programRunning = false;
  let programTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * 程序单步的节奏，作为 TEST_RATES 的下标。
   *
   * 与测试演示的速度按钮共用同一套档位名，但使用独立的下标：
   * 观看程序执行和观看关卡用例演示是两件不同的事，想要的速度也可能不同。
   */
  let programRate = DEFAULT_TEST_RATE;

  const paint = (): void => {
    if (!boardScreen.hidden) renderBoard(canvas, store, store.get().camera, view);
  };
  // 停靠区尺寸是 CSS 变量，而画布是位图。每次会移动网格的拖拽都经由这里重绘，
  // 于是后备位图按盒子重新分配尺寸，而不是被拉伸进盒子（见 onLayoutResize）。
  onLayoutResize = paint;

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

  /** 把显示器的读数刷新到 view。本函数不绘制，由调用方决定何时绘制。 */
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
   * 关卡输出引脚“此刻”的值；没有任何东西正在运行时为 null。
   * 这里从缓存的 snapshot 读取，而不是再调一次 read()：
   * 面板和读数区都会来问，而每调一次都要新建两张 Map。
   */
  const levelOutputs = (): Readonly<Record<string, number>> | null =>
    snapshot?.stable ? Object.fromEntries(snapshot.levelOutputs) : null;

  /**
   * 把一个输入向量驱动到画板上并重新读数，但不绘制。
   *
   * 演示的快速阶段会连续驱动成百上千个向量；若每个向量都重绘画布和两块面板，
   * 拖慢速度的将是绘制，而不是仿真。
   */
  const driveQuiet = (values: Readonly<Record<string, number>>): void => {
    vector = { ...values };
    display?.drive(vector);
    sample();
    // 读数面板是游戏唯一的输入控件，因此同一个向量也要送给程序运行实例：
    // 读取 inp 的程序必须看到玩家点下的那个字节，而不是 0。
    // 这一步开销很小，因为不判定程序的关卡根本不会同步任何东西。
    syncPlayerInputs();
  };

  /** 把一个输入向量驱动到画板上，并重绘所有显示它的地方。 */
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
   * 一次演示的终点，也是唯一判定关卡通过的地方。
   *
   * 判定是玩家主动请求的演示的“结尾”，不是后台进程：若每接一根线就自动判定，
   * 整个搭建过程都会在对玩家说“你错了”。真正算数的是本轮演示自己调用的
   * grade()，所以这里不会把同一件事再算一遍。
   */
  const finishTest = (): void => {
    stopTestTimer();
    testing = false;
    activeCase = null;
    plan = null;

    const { graph, level: current, progress: current0, programs } = store.get();
    // 玩家的程序也参与判定：读取玩家缓冲区的 program 检查会在运行的那一刻
    // 按同一份快照判定电路与“当时的文本”。从未输入过的关卡给出空字符串，
    // 检查器会报告 missing-program，而不是什么也不跑。
    const result = grade(graph, store.get().registry, current, { text: programs[current.id] ?? '' });
    // 一次状态变更同时喂饱三个读取者：结果面板拿判定结果，工具栏拿星数，
    // 画板保留最后一个用例的输入向量。
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
   * 演示的一个节拍：驱动一个用例、打时钟、绘制、记下读数，
   * 并点亮该用例所在的列，让读者的视线跟着画板走。
   *
   * 超过 TEST_DEMO_LIMIT 之后演示会加速，面板上的说明也会如实写出。
   * 关卡可以声明几百个用例（ch2-38-little-box 有 513 个），
   * 若仍按十五行真值表想要的节奏播放，那就是几分钟盯着计数器跳动。
   * 用例仍然全部会跑——只是停止绘制，而且只停在没有东西可看的地方：
   * 第 32 个用例之后，屏幕上没有任何一列还会变化，因为表格只显示二十列。
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
    // 每个用例自己的 reset 说明它是否从清零的电路开始：真值表每一行都要清零，
    // 而脚本只有第一步清零——第 3 步要读第 2 步打过时钟的寄存器。检查器就是这么做的。
    //
    // 用例复位的路径与“停止并复位”按钮一致（在同时判定程序的关卡上）：
    // 显示器可能在绘制运行实例自己的机器，直接清空那个仿真会清掉运行载入的 ram_prog。
    // 丢弃运行再重建，既清空电路，又把程序镜像装回画板正在绘制的那台机器。
    // 没有玩家程序的画板就地复位，因为重建会为模糊测试关卡的每个用例重新编译整张图。
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
      // 快速阶段仍然必须采样。循环条件读的是 snapshot.tick，
      // 若快速阶段只打时钟不读数，snapshot 会停在旧节拍上，循环永不结束：
      // 用例数超过 TEST_DEMO_LIMIT 的脚本会在第一个快速用例处卡死标签页
      // （513 步的 ch2-38-little-box 卡在第 33 个用例）。快速阶段跳过的是绘制而不是读数，
      // 而且用例要记录的输出也需要这次读数。
      sample();
      if (demonstrating) paint();
    }
    testResults[testStep] = levelOutputs();
    testStep += 1;
    // 快速阶段已经没有列可以点亮了（表格只显示二十列），但标题里还在计数，
    // 所以每过一段时间重绘一次，而不是一直显示演示中途留下的旧总数。
    if (demonstrating || (testStep & 7) === 0) truth.render();
    testTimer = setTimeout(runTestStep, demonstrating ? TEST_RATES[testRate]!.ms : 0);
  };

  /**
   * 测试按钮：播放本关用例，然后判定电路。
   *
   * 用例由检查器私下生成、或画板根本编译不了的关卡没有可播放的内容——
   * 但按下“测试”必须总能给出一个结论，因此这两种情况都直接进入 finishTest。
   */
  const startTest = (): void => {
    stopTestTimer();
    // 本轮演示自己驱动时钟边沿；若底下还有时钟在跑，每个用例会把同一份存储
    // 多走一步，显示出来的电路就不是任何人搭的那一张。
    running = false;
    stopClock();

    const current = store.get().level;
    const planned = testCases(current);
    testResults = [];
    if (isSandbox(current)) {
      // 沙盒里不判定也不弹窗：对没有检查项的规格调用 grade() 会返回 passed，
      // 于是普通路径会为一个没有关卡的屏幕弹出“关卡完成”卡片。
      // 该按钮在沙盒里本来就是禁用的（ui/toolbar.ts）；这里是第二道保险。
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

  /** 停止按钮：放弃本轮演示，不做任何判定。 */
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
   * 为当前图重建显示器。
   *
   * 显示器 = 编译后的电路 + 存储，因此无法跨越编辑存活：图一变就换一个新的。
   * 这也解释了为什么仿真不放进 store——它只是 store 中图的缓存，不是应用状态的一部分。
   *
   * 一台机器，不是两台。在判定玩家程序的关卡上，程序必须被载入画板正在绘制的电路，
   * 否则 I/O 面板的时钟和 out 行读的会是“第二份编译结果”（其中 ram_prog 是 256 个 0），
   * 与旁边的调试器互相矛盾。所以先构建运行实例，再把它的 machine 交给显示器。
   * 电路编译失败或程序被拒绝时 machine 为 null，此时显示器就是它一贯的样子：
   * 自己对画板编译一份——正在编辑中的电路得到的正是这个。
   */
  const rebuild = (): void => {
    const { graph, registry: reg, level: current } = store.get();
    // 沙盒的引脚随连接器来去。vector 以引脚 id 为键，
    // 而放置会复用被释放的 IN_<n>——于是被删连接器留下的值会出现在下一个接手该名字的连接器上。
    // 关卡引脚是固定数据，因此这段在关卡里是空操作。
    const known = new Set(boardPins(current, graph, reg).inputs.map((pin) => pin.id));
    if (Object.keys(vector).some((id) => !known.has(id))) {
      vector = Object.fromEntries(Object.entries(vector).filter(([id]) => known.has(id)));
    }
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
    // 缩放时钉住画板中心下的世界点，避免缩放把电路甩出屏幕。
    const middle = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const before = screenToWorld(camera, middle);
    const next = { ...camera, zoom };
    const after = screenToWorld(next, middle);
    store.set({
      camera: { zoom, x: next.x + (after.x - before.x), y: next.y + (after.y - before.y) },
    });
  };

  /** 把整张电路框进视野；空画板则回到默认相机。 */
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
    // 隐藏的画布没有可绘制的盒子；切回来时重绘，并为当前打开的关卡重建读数区。
    // 停止时钟不在这里做：离开画板去看地图是唯一必须停表的切换，
    // 它在发生的地方明确写了（onOpenMap）。
    if (which === 'board') {
      paint();
      refreshPanels();
    }
  };

  const onPickPart = (defId: string | null): void => {
    if (defId === null) {
      // 回到“空手”的路径：手上有元件时拖动画板就是放置元件，所以平移需要这个状态。
      store.set({ armed: null, status: null });
      return;
    }
    // 托盘只会给出注册表认识的 id；这个守卫把“registry.get 会抛异常”的约定收在本地，
    // 而不是隐式依赖它。
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
   * 把关卡载入画板；章节地图调用它。到达时总是显示 before 文本——
   * 进入关卡本身就是叙事的一拍，无论此前是否已经通过。
   */
  const openLevel = (levelId: string): void => {
    // 沙盒不在关卡表里，所以不走查找：getLevel 对任何关卡都没有的 id 会抛异常，
    // 而沙盒的规格是一个常量（levels/sandbox.ts）。
    // 从这里往后两者完全相同——同一张画板、同一组面板——这正是沙盒也被做成 LevelSpec 的原因。
    const next = levelId === SANDBOX_ID ? SANDBOX_LEVEL : getLevel(levelId);
    stack.clear();
    running = false;
    stopClock();
    stopTest();
    // 旧关卡的运行实例由一张电路和一份文本组成，二者都已不在屏幕上，
    // 并且必须在重建显示器之前丢掉：rebuild 会把“现存的”运行交给显示器，
    // 若留着上一关的运行，它就会把玩家刚离开的那张画板画出来。
    dropPlayerRun();
    vector = {};
    plan = null;
    testResults = [];
    ghost = null;
    // 显示器要从 store 的“新”图重建，所以要先让 store 知道换了关卡。
    // 关卡自带起始电路时，按初始化时同样的方式把它读进新图：
    // 重新进入关卡永远是“从起始电路重新开始一次”，而不是恢复上次画板上的内容。
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
    // 工作台跟着关卡走：在不判定程序的关卡上摆一个编辑器，或让调试器继续读上一关的机器，
    // 二者描述的东西都不在屏幕上。
    mountBench();
    // 自带电路的关卡一进来就该对准整台机器，而不是机器的一角：
    // 第 4 章的 CPU 横跨约两千个世界单位，默认相机会只显示左边三分之一，
    // 玩家得先找到“适应视图”按钮才能看见发到手里的东西。
    if (next.board) fitView();
    // 沙盒没有叙事：narrativeFor 读的是关卡数据，
    // 而沙盒自己的说明文字才是解释这块屏幕用途的那一份。
    if (levelId !== SANDBOX_ID) showBriefing(narrativeFor(levelId).before);
    measure();
  };

  /** 发行顺序中的下一关；已经是最后一关、或下一关属于隐藏的实验章节时返回 null。 */
  const nextLevelId = (): string | null => {
    const index = LEVEL_ORDER.indexOf(store.get().level.id);
    if (index < 0 || index + 1 >= LEVEL_ORDER.length) return null;
    const next = LEVEL_ORDER[index + 1]!;
    return !dev && getLevel(next).chapter === 4 ? null : next;
  };

  const closeResult = (): void => {
    document.querySelector('.result')?.remove();
  };

  /**
   * 测量“此刻”画板上的电路。
   *
   * 这是测量，不是判定。门数、延迟与代价是工具栏在画电路时也会显示的数字，
   * 每次编辑都重新计算。电路“是否正确”是 finishTest 的事；
   * 这里还会把旧判定丢掉而不是重算——因为最后一根线移动之前得出的结论，
   * 描述的是已经不在画板上的电路。
   */
  const measure = (): void => {
    const { graph, level: current, programs } = store.get();
    // 与 finishTest 判定时用同一份程序文本，因为 TICK 指标是从检查项里读出来的：
    // 读取玩家缓冲区的 program 检查会走玩家的程序，若用别的文本（或干脆不传）来测量，
    // 工具栏上就会出现一个演示永远复现不了的节拍数。
    // 这里测量的仍然只有门、延迟和节拍；判定本身依旧归 finishTest。
    const player = { text: programs[current.id] ?? '' };
    store.set({
      metrics: grade(graph, store.get().registry, current, player).metrics,
      lastGrade: null,
    });
  };

  // -------------------------------------------------------------------------
  // 程序运行：编辑器的单步控件与调试器
  // -------------------------------------------------------------------------

  /** 关卡的程序文本，即应用此刻持有的那一份。 */
  const playerText = (): string => {
    const { level: current, programs } = store.get();
    return programs[current.id] ?? '';
  };

  /**
   * 把关卡的输入向量驱动到程序运行实例上。
   *
   * 读数面板在每个关卡上都是输入控件，而它驱动的是画板上的显示器——
   * 于是读取 inp 的程序会在调试器里读到 0，而旁边的面板显示玩家设的字节。
   * 因此同一个向量要送给两边；并且每次新建运行都要重新应用一次，
   * 因为全新的 Simulation 里没有任何输入值。
   */
  const syncPlayerInputs = (): void => {
    if (playerRun === null) return;
    for (const pin of store.get().level.io.inputs) {
      playerRun.setInput(pin.id, vector[pin.id] ?? 0);
    }
  };

  /**
   * 为“此刻”屏幕上的电路和文本准备一个运行实例。
   *
   * 按需构建：ProgramRun 拥有一份编译后的电路，因此任何要读机器状态的操作
   * （单步、读数、汇编）都在这里要一个；键与 store 里的文本或图不再匹配时
   * 重建而不是复用。不判定玩家程序的关卡返回 null，
   * 这与工作台自己的挂载条件给出同一个答案。
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

  /** 以当前节奏启动程序时钟，替换掉已经在跑的定时器。 */
  const startProgramTimer = (): void => {
    stopProgramRun();
    programRunning = true;
    programTimer = setInterval(runProgramStep, TEST_RATES[programRate]!.ms);
  };

  /** 丢弃运行实例：它的电路或文本已经不是屏幕上那一份了。 */
  const dropPlayerRun = (): void => {
    stopProgramRun();
    playerRun = null;
    playerRunKey = '';
  };

  /** 程序时钟的一个节拍；没有可执行的东西时就此结束计时。 */
  const runProgramStep = (): void => {
    const target = ensurePlayerRun();
    if (target !== null) target.step();
    // 已经无法前进的运行——程序被拒绝，或其下电路不再结算到稳定——
    // 不能留下一个定时器永远戳它。
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
      // 没有可运行的东西：状态栏已经说明了原因，
      // 而用定时器去单步一个被拒绝的程序，是一个对自己行为撒谎的控件。
      refreshBench();
      return;
    }
    startProgramTimer();
    // 测试演示一开始就立即走一步（startTest 直接调用 runTestStep），
    // 因此第一个时钟边沿随点击到来，而不是慢半拍。
    runProgramStep();
  };

  const refreshBench = (): void => {
    ide?.render();
    debug?.render();
  };

  /**
   * 编辑器里的一次按键：文本同时更新到两处，旧判定作废。
   *
   * 一个值，三个地方。AppState.programs 是检查器与运行实例读的，
   * Progress.programs 是刷新后仍能活下来的，而 saveProgress 写的是同一个对象——
   * 三者因此不可能互相矛盾；applyGrade（它围绕 progress.programs 重建 Progress）
   * 也只可能带上最新文本，因为每条替换 Progress 的路径读的都是 store 持有的那一份。
   */
  const onProgramEdit = (text: string): void => {
    const { level: current, programs, progress: current0 } = store.get();
    const next = { ...programs, [current.id]: text };
    progress = { ...current0, programs: next };
    saveProgress(progress);
    // 编辑之前得出的判定描述的是另一个程序；由旧文本编译出的运行实例描述的是另一张电路。
    dropPlayerRun();
    store.set({ programs: next, progress, lastGrade: null });
  };

  /**
   * 编辑器与调试器：只在关卡判定玩家自己写的程序时挂载，否则移除。
   *
   * 为什么不是“一直挂载、只在需要时隐藏”：画板屏幕是第 1 到第 3 章搭建与测试的对象，
   * 一个到第 4 关才出现的面板会变成没人设计过的屏幕。
   * levelExpectsProgram 回答“关卡数据要不要程序”，这里让 DOM 跟上它。
   *
   * 它不丢弃运行实例，也绝不能丢：在程序关卡上，rebuild 已经建好了显示器正在绘制的
   * 那台机器对应的运行；在这里把它扔掉，会让面板去读第二台机器——
   * 正是“共用一台机器”要消除的那种不一致。上一关的运行由 openLevel 在替换它的重建之前丢弃。
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
    // 开发板面板只属于沙盒：关卡的引脚就是谜题，buildImage 自己也会拒绝关卡画板。
    const sandbox = isSandbox(store.get().level);
    boardTab.hidden = !sandbox;
    if (!sandbox && !viewBoard.hidden) showPanel('cases');
    if (!wants) {
      if (viewProgram.hidden === false || viewDebug.hidden === false) showPanel('cases');
      return;
    }
    // 开放这个关卡的理由就是工作台：直接显示它的编辑器，别让玩家自己去找标签页。
    showPanel('program');

    ide = mountIde(viewProgram, store, {
      format: () => playerProgramFormat(store.get().level),
      onEdit: onProgramEdit,
      onAssemble: () => {
        ensurePlayerRun();
        // TICK 指标是从检查项里读出来的，而玩家程序检查会走玩家的程序，
        // 所以“读到程序”时才重新测量一次工具栏——不是每次按键都测，
        // 否则会变成每个字符编译一次，只为算一个没人会在一词中间读的数字。
        measure();
        refreshBench();
      },
      // 关卡自己的那套运行，与结果面板和工具栏调用的是同一个处理函数：
      // 程序类关卡的用例无法逐个演示（testCases 里说明了原因），
      // 因此这里是按玩家的程序判定电路。
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
        // 正在运行的程序立刻采用新节奏：一个只在“下一次运行”生效的速度按钮，
        // 会在它真正有用的时候什么也不做。
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
    // 工作台一出现就存在一个运行实例，于是调试器打开时看到的是机器自己的状态
    // （计数器指向第一条指令、寄存器为空），而不是一屏破折号。
    ensurePlayerRun();
    refreshBench();
  };

  /** 任何一次画板编辑：电路变了，显示器和测量结果也变了。 */
  const onChange = (): void => {
    if (testing) stopTest();
    // 运行实例是编译后的电路：这一份编译自编辑前的图，所以只能丢弃，
    // 不能留着去描述一张没人看得见的电路。下一个需要它的控件会重建它。
    graphRevision += 1;
    dropPlayerRun();
    rebuild();
    // 各列保留布局但清空数字：它们是从本次编辑之前的电路读出来的。
    testResults = [];
    activeCase = null;
    measure();
    refreshBench();
    // 编辑元件内部也是一次库编辑：玩家正身处其中的元件持有他正在画的图，两者必须一起更新。
    if (store.get().editing !== null) syncBody();
  };

  /**
   * 蓝图面板的处理函数，集中在一个对象里，让挂载处保持可读。
   *
   * 之所以在这里统一构造而不是逐个传参：它们共享上面的草稿状态——
   * 确认步骤是 commitWrap，它同时需要面板正在显示的 plan 和输入框里的名字。
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
  // 玩家自己的元件
  // -------------------------------------------------------------------------

  /** 正在面板里起草的封装计划；此时还没有任何东西被移动。 */
  let wrapDraft: WrapPlan | null = null;
  let draftName = { zh: '', en: '' };

  /** 画板上此刻的图，以及衡量它所用的元件库。 */
  const graphWithRegistry = (): {
    graph: Graph;
    blueprints: Progress['blueprints'];
  } => {
    const { graph, blueprints } = store.get();
    return { graph, blueprints };
  };

  /**
   * 一步之内把封装好的文档写入应用。
   *
   * 两个变化共用一条命令。封装会把若干实例移出画板、并向元件库添加一个定义，
   * 这两半分开就毫无意义——撤销只恢复画板却留下元件，会得到一个玩家无法描述的状态。
   * CommandStack 正是为此让命令可以携带元件库，而 main.ts 是唯一同时知道这两个值的地方。
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

  /** 在画板上打开某个元件的内部：同一张画板，另一张图。 */
  const enterBlueprint = (id: string): void => {
    const entry = store.get().blueprints[id];
    if (!entry) return;
    // 元件的内部按“一张独立的图”编辑，因此它有自己的历史，画板的历史要清空：
    // 画板上的命令若被重放到一份它并不描述的文档上，只会出错。
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
    // 这里不重组注册表。每次按键都重组是没有意义的工作：
    // 屏幕上显示器正在绘制的就是被编辑的内部；组合注册表会在离开时
    // （leaveBlueprint）以及每次封装时重建——那才是定义需要重新可解析的时刻。
    store.set({ blueprints: nextLibrary });
    progress = { ...progress, blueprints: nextLibrary };
    saveProgress(progress);
  };

  const leaveBlueprint = (): void => {
    syncBody();
    // 离开时重新组合注册表：元件在自己的内部被编辑期间换了电路，
    // 画板上它的每一个实例都必须按新电路解析。
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
   * 删除一个元件；画板仍在使用它时拒绝删除。
   *
   * 选择“拒绝”而不是级联删除：删掉用到它的实例，等于由应用替玩家决定
   * 电路的哪一部分他并不想保留。能这样检查，是因为引用关系很明确——
   * 元件由 inst.def 引用，所以答案只需要扫一遍。
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
   * 电路文件：导出与导入。
   *
   * 文件会带上它自己需要的元件（libraryClosure），因为一个引用了 bp1
   * 却指望对方恰好也有 bp1 的文件，有一半概率打不开。
   * 导入会把文件带来的元件合并进库——重命名所有冲突项，
   * 因为两个玩家都可能有一个 bp1，而它们是不同的电路——
   * 之后画板上放的才是导入进来的电路。
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
      // 浏览器拒绝下载时给出说明，让玩家知道去哪里允许下载。
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

  /** importCircuit 的另一半，单独拆出来，以便不依赖文件也能测试。 */
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
      // 离开画板就停掉它的时钟。画板屏幕只是被隐藏而不是卸载，
      // 否则两个定时器都会继续给一张没人看得见的电路打节拍：
      // 玩家看地图期间程序若继续跑，回来时就已前进上百条指令，
      // 而只有暂停按钮会体现这件事。面板和工具栏也会被告知，
      // 以免播放按钮带着“按下”的状态回到已经停住的时钟上。
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
      // 就地生效，而不是刷新页面：地图和元件托盘从 store 读 dev，
      // 所以关掉它就会原地重绘；同时清理地址栏，避免刷新后它又回来。
      dev = false;
      store.set({ dev });
      // 如果退出时正站在实验章节里，把那块板子也收回去：正常模式没有
      // 通往第 4 章的入口，不能把玩家留在一张地图上找不到的关卡上。
      if (store.get().level.chapter === 4) openLevel('ch3-49-turing-complete');
      const url = new URL(globalThis.location.href);
      url.searchParams.delete('dev');
      globalThis.history.replaceState(null, '', url);
    },
  });
  mountStatus(app, store);
  // 现在所有面板都各归其位：元件托盘与元件库在主侧边栏，
  // 测试用例与工作台在底部面板，智能体在次侧边栏。
  mountPalette(partsSection, store, onPickPart);
  const blueprintPanel = mountBlueprintPanel(componentsSection, store, blueprintOptions);
  // Arduino 面板是沙盒工具；它的标签页在其他关卡由 mountBench 隐藏。
  // 它从 store（而不是本闭包里的副本）读电路与关卡，“同步输入”时才惰性读取 vector。
  flashPanel = mountFlashPanel(viewBoard, store);
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
  /**
   * 循环切换沙盒中某个连接器的引脚位宽。
   *
   * 关卡引脚的位宽是关卡契约，面板不为它们画位宽控件。沙盒里连接器本身就是引脚，
   * 所以位宽由玩家决定——而且必须可调，否则用 8 位家族搭的电路就驱动不了：
   * 一个 1 位连接器接 add8，就是另一种形式的“没有输出”故障。
   *
   * 它通过玩家自己的撤销栈完成，因此 Ctrl+Z 能像其他编辑一样撤回。
   */
  const cyclePinWidth = (pinId: string): void => {
    const state = store.get();
    if (!isSandbox(state.level)) return;
    const inst = state.graph.instances.find((entry) => entry.id === pinId);
    if (inst === undefined) return;
    const def = state.registry.get(inst.def);
    const declared =
      def.id === 'level_output' ? (def.inputs[0]?.width ?? 1) : (def.outputs[0]?.width ?? 1);
    const current = inst.params.width ?? declared;
    const next = PIN_WIDTHS[(PIN_WIDTHS.indexOf(current) + 1) % PIN_WIDTHS.length] ?? 1;
    if (next === current) return;
    stack.push(
      {
        label: `set width ${pinId} to ${next}`,
        do: (g) => {
          const target = g.instances.find((entry) => entry.id === pinId);
          if (target !== undefined) target.params.width = next;
        },
        undo: (g) => {
          const target = g.instances.find((entry) => entry.id === pinId);
          if (target === undefined) return;
          // 声明的位宽代表“没有覆盖值”，而不是被钉死的值。
          if (current === declared) delete target.params.width;
          else target.params.width = current;
        },
      },
      state.graph,
    );
    onChange();
  };

  const io = mountIoPanel(ioSection, store, {
    // 用画板的引脚而不是关卡的引脚：沙盒的引脚就是玩家放置的连接器，
    // 同一个辅助函数也服务于显示器和智能体。
    pins: () => boardPins(store.get().level, store.get().graph, store.get().registry),
    onCycleWidth: (pinId) => cyclePinWidth(pinId),
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
      // “停止并复位”会清空玩家眼前的画板，但不擦掉程序。
      // rebuild 是唯一把显示器绑定到运行实例的地方，而改文本会丢弃运行却不重建——
      // 于是任何一次按键之后，显示器仍在绘制上一次运行的机器，而 ensurePlayerRun
      // 交回来的是另一台。向那个运行发送复位，只会清空一台没人看得见的机器，
      // 屏幕上的画板丝毫不变。所以这里丢弃运行并连同它一起重建：
      // 全新的运行会先复位、载入镜像，然后再被交出（levels/run.ts）；
      // 完全没有运行的画板则自行编译一份清零的电路。输入的东西不会丢——
      // 玩家的文本存在 state.programs 里，下一次“汇编/单步/测试”会重建同一个运行、
      // 载入同一份镜像。
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
  // 智能体
  // ---------------------------------------------------------------------------

  /**
   * 自然语言助手，接到它所操作的这个应用上。
   *
   * 这里的一切都是“一只手”的路径。apply 把命令压进玩家自己的撤销栈，
   * 然后调用 onChange——与鼠标编辑完全一样——因此智能体的一步同样会被测量、重绘、
   * 可撤销并保存，不存在第二条可能与第一条走偏的修改电路之路。
   * run/pause/stepOnce/reset 是工具栏上的按钮；test 是“测试”；
   * circuitText 与 loadCircuit 是“导出/导入”。
   *
   * 它能放置的托盘就是“玩家的”托盘：offeredDefIds 调用与元件托盘相同的两个函数，
   * 于是 ?dev=1 与沙盒会全部开放，而普通关卡仍然只把该关允许的元件交给智能体。
   * 这就是“智能体能做人能做的事”没有悄悄变成“智能体能做更多”的原因。
   */
  let agentConfig: AgentConfig | null = loadAgentConfig();

  const offeredDefIds = (): string[] => {
    const { level: current, progress: prog, registry: reg, dev: devOn, blueprints } = store.get();
    // 与元件托盘调用同一个函数，因此“智能体能放什么”在构造上就等于“玩家被提供什么”，
    // 而不只是意图上相同。
    return offeredDefsFor(prog, LEVELS, current, devOn, reg, libraryIds(blueprints)).filter((defId) =>
      reg.has(defId),
    );
  };

  /**
   * 播放本关用例，并带着判定结果结束这个 Promise。
   *
   * 演示是带定时器的过程，所以这里等它结束，而不是返回“已开始”：
   * 若只被告知“跑起来了”，智能体会接着去“修”一张它还没有结论的电路。
   * 订阅必须在 startTest 之前建立，因为无法逐例演示的关卡会在那次调用内部就结束——
   * 放在之后就没有通知可等了。
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
        // 哪些用例错、差多少。只给数量，等于一个有结论却没有信息的判定：
        // 期望值与实际值才把“错了”变成“可以修改”。这里封顶，
        // 因为模糊测试关卡可能错几百个用例，而前几个就足以体现规律。
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
      // 只取“错误”：半成品电路按设计到处是悬空输入警告，
      // 每步都复述它们会淹没智能体唯一需要知道的事——它刚做的事是否让电路无效。
      const issues = validateGraph(state.graph, state.registry)
        .filter((issue) => issue.severity === 'error')
        .map((issue) => ({ severity: 'error' as const, message: issue.message.zh }));
      // 画板读取与发布的内容：关卡声明的引脚，或沙盒里放置的连接器。
      // 走同一个辅助函数，让助手的 read_board 命名与侧边栏完全相同的引脚。
      const pins = boardPins(open, state.graph, state.registry);
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
        inputs: pins.inputs.map((pin) => ({
          id: pin.id,
          width: pin.width,
          value: vector[pin.id] ?? 0,
        })),
        // 电路“应该”驱动什么，以及上一次结算在那里读到的值——
        // 这是“本关想要什么”的另一半，也是只会看输入的会话曾去错误地方寻找的那一半。
        outputs: pins.outputs.map((pin) => {
          const live = levelOutputs();
          const value = live === null ? undefined : live[pin.id];
          return { id: pin.id, width: pin.width, value: value === undefined ? null : value };
        }),
        program: state.programs[open.id] ?? '',
        expectsProgram: levelExpectsProgram(open),
      };
    },
    // 网格尺寸来自主题而不是本模块：智能体层不能引入 ui/，
    // 所以它需要的那个数字在这里传给它。
    snap: (x, y) => ({ x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID }),
    // 关卡把引脚绑定到名为 IN_<pin> / OUT 的实例上，而分发这些名字的规则
    // 住在 ui/board/interact.ts——智能体得到的答案与手操作相同，否则为 null。
    connectorFor: (defId) =>
      levelIoPlacement(store.get().level, store.get().graph, defId) ?? null,
    apply: (command, focus) => {
      stack.push(command, store.get().graph);
      // 选中刚变化的部分，才让每一步“看得见”：品红描边指出上一次操作碰了画板哪里。
      // 选中不是编辑，因此不进撤销栈。
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
    // 封装按面板的做法完成：先计划，再用同一条命令一起移动电路与元件库。
    // null 是 planWrap 自己的拒绝，原样传出而不是猜一个结果。
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
    // 拒绝来自 deleteBlueprint：它用同一次扫描，防止手操作删掉画板还在使用的元件。
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
      // 与工具栏的“导入”走同一条路径，因此无论电路怎么来的，导入后的处理完全一致。
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
      // 次侧边栏是一个停靠区，不是浮动卡片：打开面板就占用这一列，
      // 关闭就把这一列还给画板——这个选择与其他停靠区尺寸一起被记住。
      onVisibility: (open) => setLayout({ secondaryCollapsed: !open }),
    },
  );
  // 存档的布局可能把助手的停靠区留成打开状态。面板自身默认隐藏
  // （首次运行什么都不打开），所以这里直接打开它，而不是留一列空白等玩家去点活动栏。
  if (!layout.secondaryCollapsed) agentPanel.open();

  /**
   * 点击输入连接器会微调它驱动的值。
   *
   * 1 位的翻转；更宽的引脚则递增并回绕，因为点击是“推一下”，
   * 不是输入一个字节的方式——精确值由读数面板负责，它有每一位的单元格。
   * 对其他元件什么都不做是刻意的：点门就是选中，一直如此。
   *
   * 引脚查找交给 nudgedInput，而不是从实例 id 里切字符串：
   * 关卡引脚是 IN_<pinId>，沙盒连接器的引脚 id 就是实例 id，只有 boardPins
   * 知道当前开的是哪种画板。此前在这里直接解析名字，导致沙盒的 IN_1 点不动，
   * 而关卡里的箭头却能点。
   */
  const onPickInstance = (instId: string): void => {
    const state = store.get();
    const nudged = nudgedInput(
      boardPins(state.level, state.graph, state.registry),
      instId,
      vector,
    );
    if (nudged === null) return;
    driveTo({ ...vector, [nudged.pinId]: nudged.value });
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

  // 只在状态变化时渲染：持续的 rAF 循环会让一张静态画板永远每秒重画 60 次。
  // 平移、缩放和拖拽都经过 store.set，因此它们在改变东西的每一帧仍会重绘。
  // 工作台也一起走：它的面板读 store（关卡文本、判定结果）而自己不是订阅者，
  // 于是一次编辑就按它们在画板上的布局顺序重绘三者。
  store.subscribe(() => {
    paint();
    refreshBench();
    // 工具栏的封装按钮会数选中数量，而框选是通过 store 提交选中的——
    // 所以数量必须跟着选择变化走，而选择变化不是画板编辑，不会经过 onChange。
    paintTools();
    // 沙盒电路边画边存，而且只在电路变化时存：store 对每次变更都发通知，
    // 包括平移的每一帧和每次点击选中，这两者都不值得写一次 localStorage。
    // 用签名来区分两者。
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

  // 应用打开在存档的续玩关卡，因此它的简报是玩家看到的第一件东西。
  rebuild();
  showBriefing(narrativeFor(level.id).before);
  paint();
  refreshPanels();
  mountBench();
  // ……并且启动所在的那个关卡，也会得到 openLevel 给它的同样取景。
  if (level.board) fitView();
}

/**
 * 简报浮层：到达关卡时显示 before 文本，判定通过后显示 after 文本。
 * 它纯粹是叙事——从不判定、从不写 store、也从不接触关卡数据，
 * 因此不可能影响任何判定结果。
 *
 * 屏幕上永远只有一个：第二次调用会替换第一个，而不是叠出一个要关两次的面板。
 */
function showBriefing(text: { zh: string; en: string }): void {
  document.querySelector('.briefing')?.remove();
  const panel = document.createElement('div');
  panel.className = 'briefing';
  // 浮层盖住整块画板，因此必须说明自己是什么：没有标签的话，
  // 它看起来和一个“等你回答”的对话框没有区别。
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
