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
}

export interface ToolbarState {
  readonly running: boolean;
  readonly grid: boolean;
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
  const step = button('单步', 'step', () => options.onStep());
  const run = button('运行', 'play', () => options.onToggleRun());
  const stop = button('停止并复位', 'stop', () => options.onStop());
  const trash = button('删除选中', 'trash', () => options.onDeleteSelection());
  grid.append(zoomIn, zoomOut, step, run, fit, stop, gridToggle, trash);

  return {
    render(state: ToolbarState): void {
      gridToggle.setAttribute('aria-pressed', String(state.grid));
      run.setAttribute('aria-pressed', String(state.running));
      run.replaceChildren(iconSvg(state.running ? 'pause' : 'play'));
      run.title = state.running ? `暂停 ${state.rate}` : `运行 ${state.rate}`;
      run.setAttribute('aria-label', state.running ? '暂停' : '运行');
    },
  };
}
