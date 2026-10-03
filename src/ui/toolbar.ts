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
}

export interface ToolbarState {
  readonly running: boolean;
  readonly grid: boolean;
  /** True while the level's test cases are being played. */
  readonly testing: boolean;
  /** The clock's rate, as the original labels it: `10Hz`. */
  readonly rate: string;
}

/**
 * The tool buttons down the left, in the original's two-column grid.
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
  wrap.className = 'overlay overlay-tools';
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
  grid.append(zoomIn, zoomOut, test, step, run, grow(), fit, stop, gridToggle, trash);

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
      test.title = state.testing ? '停止测试' : '测试：逐个播放本关用例，最后给出判定';
    },
  };
}

/** A spacer, so the odd button out does not stretch across the grid. */
function grow(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'tool-gap';
  return span;
}
