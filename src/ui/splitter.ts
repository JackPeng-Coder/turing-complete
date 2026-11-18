/**
 * 两个停靠面板之间可拖动的边。
 *
 * 分割条自己不拥有任何度量。它只报告指针在哪里，由调用方决定那意味着什么：
 * 主侧栏在指针右移时变宽，次侧栏在指针左移时变宽（它的边界是左边框），
 * 底部面板在其上边框上移时变高。于是三个方向共用同一个 `sign`，而不是三份实现。
 *
 * 它同时也是一个键盘控件。手柄是获得焦点的 `separator`，方向键可以微调面板；
 * 没有这一点，一个只能靠鼠标拖动的控件就是一半玩家用不了的控件。按住 Shift 时步进更大。
 */
export interface SplitterOptions {
  /** `x` 表示竖直的边（调宽度），`y` 表示水平的边（调高度）。 */
  readonly axis: 'x' | 'y';
  /** 向右/向下拖动会让面板变大时为 `+1`，变小时为 `-1`。 */
  readonly sign: 1 | -1;
  /** 面板当前的度量值（CSS 像素）。 */
  readonly value: () => number;
  /** 面板允许的最小值。 */
  readonly min: () => number;
  /** 面板允许的最大值。 */
  readonly max: () => number;
  /** 指针移动时（以及每次按键微调时）调用。 */
  readonly onChange: (value: number) => void;
  /** 拖动结束或按键微调结束时调用，用于持久化。 */
  readonly onCommit?: () => void;
}

/** 按一次方向键移动多少像素；按住 Shift 时按一次移动多少像素。 */
const NUDGE = 12;
const NUDGE_LARGE = 48;

/**
 * 把一个元素挂成可拖动、可用键盘操作的分割条。
 *
 * @param element 作为分割条的 DOM 元素；会补上样式类以及无障碍所需的 role 与 tabIndex。
 * @param options 轴向、方向符号、当前值与上下限，以及变化与提交回调。
 * @returns 无返回值；副作用是给元素绑定指针与键盘监听器。
 *
 * 拖动过程中只报告取值，夹取统一在 `apply` 里做：先四舍五入，再用 min/max 夹住，
 * 调用方收到的永远是一个合法的整数像素值。
 */
export function mountSplitter(element: HTMLElement, options: SplitterOptions): void {
  element.classList.add('splitter', options.axis === 'x' ? 'splitter-x' : 'splitter-y');
  element.setAttribute('role', 'separator');
  element.setAttribute('aria-orientation', options.axis === 'x' ? 'vertical' : 'horizontal');
  element.tabIndex = 0;

  let dragging = false;
  let start = 0;
  let from = 0;

  const apply = (next: number): void => {
    const value = Math.min(options.max(), Math.max(options.min(), Math.round(next)));
    options.onChange(value);
  };

  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    start = options.axis === 'x' ? event.clientX : event.clientY;
    from = options.value();
    element.classList.add('dragging');
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  element.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const now = options.axis === 'x' ? event.clientX : event.clientY;
    apply(from + (now - start) * options.sign);
  });

  const stop = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    element.classList.remove('dragging');
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture?.(event.pointerId);
    options.onCommit?.();
  };
  element.addEventListener('pointerup', stop);
  element.addEventListener('pointercancel', stop);

  element.addEventListener('keydown', (event) => {
    const forward = options.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const back = options.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    if (event.key !== forward && event.key !== back) return;
    event.preventDefault();
    const step = (event.shiftKey ? NUDGE_LARGE : NUDGE) * options.sign;
    apply(options.value() + (event.key === forward ? step : -step));
    options.onCommit?.();
  });
}
