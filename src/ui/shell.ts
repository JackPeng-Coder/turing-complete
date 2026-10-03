import type { AppState, Store } from '../app/store';
import { THEME } from './theme';

export interface ShellOptions {
  /** Leave the board and show the chapter map. */
  onOpenMap(): void;
  /** Show the level's briefing again. Absent leaves the button out. */
  onShowBrief?(): void;
}

/**
 * The top bar: which level is open, what the player has armed in the palette,
 * the last grade, and the way back to the chapter map.
 *
 * It is the first flex child of the app container so the screens below it get
 * the remaining height. The level name is the original's rose, centred, with the
 * icon buttons left and the gate/delay readout right -- the original's own
 * arrangement, and the reason the bar is a three-column grid rather than a row:
 * a centred title in a flex row drifts as the two ends change width.
 *
 * THE MAP BUTTON IS FIRST IN DOM ORDER. It is the bar's only navigation control
 * and `panels.test.ts` reaches for `root.querySelector('button')` to click it;
 * adding an icon ahead of it would silently make that test drive the wrong
 * control.
 */
export function mountShell(
  root: HTMLElement,
  store: Store<AppState>,
  options: ShellOptions,
): { render(): void } {
  const bar = document.createElement('header');
  bar.className = 'shell-bar';

  const left = document.createElement('div');
  left.className = 'shell-left';

  const mapButton = iconButton('章节地图', 'menu');
  mapButton.addEventListener('click', () => options.onOpenMap());

  const status = document.createElement('span');
  status.className = 'shell-status';

  left.append(mapButton);
  if (options.onShowBrief) {
    const briefButton = iconButton('关卡说明', 'info');
    briefButton.addEventListener('click', () => options.onShowBrief?.());
    left.append(briefButton);
  }
  left.append(status);

  const title = document.createElement('h1');
  title.className = 'shell-title';

  const right = document.createElement('div');
  right.className = 'shell-right';
  const metrics = document.createElement('span');
  metrics.className = 'shell-metrics';
  const hintButton = iconButton('提示', 'bulb');
  right.append(metrics, hintButton);

  const hint = document.createElement('p');
  hint.className = 'shell-hint';
  hint.hidden = true;

  hintButton.addEventListener('click', () => {
    hint.hidden = !hint.hidden;
    hint.textContent = hint.hidden ? '' : store.get().level.hint.zh;
  });

  bar.append(left, title, right, hint);
  root.prepend(bar);

  const render = (): void => {
    const { level, lastGrade, status: message } = store.get();
    title.textContent = `${level.chapter}-${level.index} ${level.name.zh}`;
    status.textContent = message ? message.zh : '';
    if (!hint.hidden) hint.textContent = level.hint.zh;

    if (!lastGrade) {
      metrics.textContent = '尚未评测';
      metrics.style.color = THEME.textMuted;
      return;
    }
    const stars = lastGrade.stars > 0 ? '★'.repeat(lastGrade.stars) : '未通过';
    metrics.textContent = `门 ${lastGrade.metrics.gate} 个 · 延迟 ${lastGrade.metrics.delay} · 拍 ${lastGrade.metrics.tick} · 总开销 ${lastGrade.score} · ${stars}`;
    metrics.style.color = lastGrade.passed ? THEME.success : THEME.error;
  };
  store.subscribe(render);
  render();
  return { render };
}

/**
 * A bar button whose whole content is an icon.
 *
 * The icon is an SVG child rather than text, which keeps the button's
 * `textContent` empty: the panel tests read `textContent` as a part's name, and
 * a glyph here would leak into that reading.
 */
function iconButton(label: string, icon: IconName): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shell-icon';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(iconSvg(icon));
  return button;
}

export type IconName =
  | 'menu'
  | 'info'
  | 'bulb'
  | 'zoom-in'
  | 'zoom-out'
  | 'step'
  | 'play'
  | 'pause'
  | 'back'
  | 'stop'
  | 'grid'
  | 'trash'
  | 'test'
  | 'fit';

/** Stroke-only 24x24 glyphs, so a button's colour drives the whole icon. */
const ICON_PATHS: Record<IconName, string> = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8h.01M11 12h1v5h1',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z',
  'zoom-in': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4M11 8v6M8 11h6',
  'zoom-out': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4M8 11h6',
  step: 'M8 5l9 7-9 7z',
  play: 'M7 4l12 8-12 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  back: 'M16 5l-9 7 9 7z',
  stop: 'M6 6h12v12H6z',
  grid: 'M4 8h16M4 16h16M8 4v16M16 4v16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  // A clipboard with a tick on it: the level's cases, run one at a time.
  test: 'M9 4h6v3H9zM7 5H5v15h14V5h-2M9 13l2 2 4-4',
  fit: 'M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5',
};

export function iconSvg(name: IconName): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}
