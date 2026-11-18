/**
 * 程序编辑台的动作条：缩放、网格、走带、测试、封装与电路文件。
 *
 * 按钮只负责发事件，状态由调用方通过 `render(state)` 推入；
 * 图标来自 `./shell`，因此工具栏、顶栏和汇编编辑器共用同一套字形。
 * 动作条在空间不足时换行而不是滚动：一个看不见的控件等于不存在的控件。
 */
import { iconSvg, type IconName } from './shell';

export interface ToolbarOptions {
  /** 缩放倍数；传 `0` 表示「把电路装进屏幕」。 */
  onZoom(factor: number): void;
  onToggleGrid(): void;
  onDeleteSelection(): void;
  /** 走一个时钟沿。 */
  onStep(): void;
  /** 开始或停止时钟。 */
  onToggleRun(): void;
  /** 停止时钟并清空所有存储元件。 */
  onStop(): void;
  /** 开始或停止逐个播放本关的测试用例。 */
  onToggleTest(): void;
  /**
   * 把当前选区封装成一个元件。
   * 没有选中任何东西时按钮被禁用——一个按了却不能行动的可用控件，
   * 比一个说明自己为何不能的控件更糟。
   */
  onWrapSelection(): void;
  /**
   * 把画板上的电路写进文件，并读回一个。
   *
   * 放在工具网格上，而不是藏进菜单：电路文件是电路离开浏览器的唯一方式，
   * 而工具区正是玩家寻找「画板能做什么」的地方。回调缺席时两个按钮都不画，
   * 没有地方可写的调用方就是这样表达的。
   */
  onExportCircuit?(): void;
  onImportCircuit?(): void;
}

export interface ToolbarState {
  readonly running: boolean;
  readonly grid: boolean;
  /** 本关的测试用例正在播放。 */
  readonly testing: boolean;
  /** 时钟频率，按原作的写法：10Hz。 */
  readonly rate: string;
  /** 选中的画板实例数，封装按钮据此报出数量。 */
  readonly selected: number;
  /**
   * 沙盒中为 true：测试按钮在那里是禁用，而不是消失。
   *
   * 直接消失会更整洁，但也是错的：面板自己的「测试」按钮才是可被发现的入口，
   * 刚从关卡过来的玩家已经养成了点它的习惯。一个用标题说明原因的禁用按钮，
   * 才是会教人的版本。
   */
  readonly sandbox: boolean;
}

/**
 * 编辑台动作条里的工具按钮；动作条会换行而不是滚动：
 * 一个没人看得见的控件等于不存在的控件。
 *
 * 这里每个按钮都真的做事。原作的网格里还有选区开关、重命名铅笔和断点记录器；
 * 本复刻没有选区概念、没有逐元件标签、也没有断点，所以这三项是不画，
 * 而不是画出来却不响应——死控件比缺失的控件更糟，因为玩家只有点下去才会发现。
 *
 * 「测试」按钮这里有一个，测试面板里也有一个。面板里的那个更好被发现——
 * 它就在它播放的那几列旁边——但面板可以收起，把高度还给画板，
 * 那时运行仍必须可达。两个按钮调用同一个处理器。
 */
export function mountToolbar(
  root: HTMLElement,
  options: ToolbarOptions,
): { render(state: ToolbarState): void } {
  const wrap = document.createElement('div');
  wrap.className = 'editor-tools';
  const grid = document.createElement('div');
  grid.className = 'tools';
  wrap.append(grid);
  root.append(wrap);

  const button = (label: string, icon: IconName, onClick: () => void): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tool-btn';
    el.setAttribute('aria-label', label);
    el.title = label;
    el.append(iconSvg(icon));
    el.addEventListener('click', onClick);
    return el;
  };

  const zoomIn = button('放大', 'zoom-in', () => options.onZoom(1.25));
  const zoomOut = button('缩小', 'zoom-out', () => options.onZoom(1 / 1.25));
  const fit = button('适应画面', 'fit', () => options.onZoom(0));
  const gridToggle = button('网格', 'grid', () => options.onToggleGrid());
  const test = button('测试', 'test', () => options.onToggleTest());
  const step = button('单步', 'step', () => options.onStep());
  const run = button('运行', 'play', () => options.onToggleRun());
  const stop = button('停止并复位', 'stop', () => options.onStop());
  const trash = button('删除选中', 'trash', () => options.onDeleteSelection());
  // 垃圾箱是玩家寻找「怎么把这东西弄掉」的地方，
  // 所以画板自己的快捷键说明也放在这里。
  trash.title = '删除选中 · 在画板上右键可直接删除元件或导线';
  const wrapBtn = button('封装为元件', 'wrap', () => options.onWrapSelection());
  wrapBtn.title = '把选中的元件封装成一个自制元件（先按住 Ctrl 在画板上框选）';
  // 电路文件的两个按钮是同一个想法的两端——电路能离开浏览器，也能回来——
  // 所以它们相邻，排在作用于画板本身的那些工具之后。
  const exportBtn = options.onExportCircuit
    ? button('导出电路', 'download', () => options.onExportCircuit?.())
    : null;
  if (exportBtn) exportBtn.title = '把当前电路（含自制元件）存成 .json 文件';
  const importBtn = options.onImportCircuit
    ? button('导入电路', 'upload', () => options.onImportCircuit?.())
    : null;
  if (importBtn) importBtn.title = '读取一个电路文件，替换画板上的电路';
  grid.append(zoomIn, zoomOut, test, step, run, grow(), fit, stop, gridToggle, wrapBtn, trash);
  if (exportBtn && importBtn) grid.append(exportBtn, importBtn);

  return {
    render(state: ToolbarState): void {
      gridToggle.setAttribute('aria-pressed', String(state.grid));
      run.setAttribute('aria-pressed', String(state.running));
      run.replaceChildren(iconSvg(state.running ? 'pause' : 'play'));
      run.title = state.running ? `暂停 ${state.rate}` : `运行 ${state.rate}`;
      run.setAttribute('aria-label', state.running ? '暂停' : '运行');
      test.setAttribute('aria-pressed', String(state.testing));
      test.replaceChildren(iconSvg(state.testing ? 'stop' : 'test'));
      test.setAttribute('aria-label', state.testing ? '停止测试' : '测试');
      test.disabled = state.sandbox;
      test.title = state.sandbox
        ? '沙盒没有测试用例：电路一直在跑，门数与延迟是实时读数'
        : state.testing
          ? '停止测试'
          : '测试：逐个播放本关用例，最后给出判定';
      wrapBtn.disabled = state.selected === 0;
      wrapBtn.title =
        state.selected === 0
          ? '封装为元件：先在画板上按住 Ctrl 框选若干元件'
          : `把选中的 ${state.selected} 个元件封装成一个自制元件`;
    },
  };
}

/** 一个弹簧占位，免得落单的按钮在网格里被拉长。 */
function grow(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'tool-gap';
  return span;
}
