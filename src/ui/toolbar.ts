import { iconSvg, type IconName } from './shell';

export interface ToolbarOptions {
  /** Multiply the zoom. `0` means "fit the circuit on screen". */
  onZoom(factor: number): void;
  onToggleGrid(): void;
  onDeleteSelection(): void;
  /** Apply one clock edge. */
  onStep(): void;
  /** Start or stop the clock. */
  onToggleRun(): void;
  /** Stop the clock and clear every storage element. */
  onStop(): void;
  /** Start or stop playing the level's test cases one at a time. */
  onToggleTest(): void;
  /**
   * Wrap the current selection into a component. `null` while nothing is
   * selected, which is also when the button is disabled -- an enabled control
   * that cannot act is worse than one that says why it cannot.
   */
  onWrapSelection(): void;
  /**
   * Write the circuit on the board to a file, and read one back.
   *
   * ON THE TOOL GRID rather than in a menu: a circuit file is the one way a
   * circuit leaves the browser, and the tools are where a player looks for what
   * the board can do. Absent leaves both buttons out, which is how a caller that
   * has nowhere to write says so.
   */
  onExportCircuit?(): void;
  onImportCircuit?(): void;
}

export interface ToolbarState {
  readonly running: boolean;
  readonly grid: boolean;
  /** True while the level's test cases are being played. */
  readonly testing: boolean;
  /** The clock's rate, as the original labels it: `10Hz`. */
  readonly rate: string;
  /** Board instances selected, so the wrap button can count them. */
  readonly selected: number;
  /**
   * True in the sandbox, where the test button is DISABLED rather than absent.
   *
   * Absent would be tidier and wrong: the panel's own 测试 button is the
   * discoverable one, and a player who has just come from a level has the habit.
   * A disabled button with a title that says why is the version that teaches.
   */
  readonly sandbox: boolean;
}

/**
 * The tool buttons in the editor's action strip, and the strip wraps rather than
 * scrolling: a control nobody can see is a control that does not exist.
 *
 * Every button here does something. The original's grid also carries a
 * region-select toggle, a rename pencil and a breakpoint recorder; this replica
 * has no notion of a selection region, no per-part label and no breakpoints, so
 * those three are absent rather than present and inert -- a dead control is
 * worse than a missing one, because the player only finds out by clicking it.
 *
 * THE TEST BUTTON LIVES HERE AND IN THE TEST PANEL. The panel's own button is
 * the discoverable one -- it sits on the columns it plays -- but the panel can be
 * collapsed to give the board its height back, and the run has to stay reachable
 * when it is. Both call the same handler.
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
  // The bin is where a player looks for "how do I get rid of this", so it is
  // where the board's own shortcut belongs.
  trash.title = '删除选中 · 在画板上右键可直接删除元件或导线';
  const wrapBtn = button('封装为元件', 'wrap', () => options.onWrapSelection());
  wrapBtn.title = '把选中的元件封装成一个自制元件（先按住 Ctrl 在画板上框选）';
  // The circuit file buttons are the two ends of one idea -- a circuit that can
  // leave the browser and come back -- so they sit next to each other, after the
  // tools that act on the board itself.
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

/** A spacer, so the odd button out does not stretch across the grid. */
function grow(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'tool-gap';
  return span;
}
