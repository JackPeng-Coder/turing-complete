import type { AppState, Store } from '../app/store';
import { scoreOf } from '../levels/grader';
import { isSandbox } from '../levels/sandbox';
import { THEME } from './theme';

export interface ShellOptions {
  /** Leave the board and show the chapter map. */
  onOpenMap(): void;
  /** Show the level's briefing again. Absent leaves the button out. */
  onShowBrief?(): void;
  /** Leave developer mode. Absent leaves the DEV light out entirely. */
  onExitDev?(): void;
}

/**
 * The top bar: which level is open and the way back to the chapter map.
 *
 * THE COST READOUT IS NOT HERE ANY MORE. It moved to the status bar along with
 * the application's own message when the chrome became a workbench of docks: the
 * bar says WHERE you are, the last row says what the thing on the board costs.
 *
 * It is the first flex child of the app container so the workbench below it gets
 * the remaining height. The level name is the original's rose, centred, with the
 * icon buttons left and the DEV light and hint right -- the original's own
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

  left.append(mapButton);
  if (options.onShowBrief) {
    const briefButton = iconButton('关卡说明', 'info');
    briefButton.addEventListener('click', () => options.onShowBrief?.());
    left.append(briefButton);
  }

  const title = document.createElement('h1');
  title.className = 'shell-title';
  // The address and the name are separate nodes so they can be separate things on
  // screen: `1-4` boxed in the operator's magenta, the name wide-tracked in the
  // instrument's cyan. The level's address is what a player navigates by, so it
  // is drawn as an address rather than written into a sentence.
  const index = document.createElement('span');
  index.className = 'shell-index';
  const name = document.createElement('span');
  name.className = 'shell-name';
  title.append(index, name);

  const right = document.createElement('div');
  right.className = 'shell-right';
  const hintButton = iconButton('提示', 'bulb');
  // THE DEV LIGHT. A mode that opens every gate has to be impossible to forget:
  // a player who wandered into `?dev=1` would otherwise see a game with all
  // forty-seven levels unlocked and no explanation. It sits next to the level
  // name because that is what it is about, and it is a button, so leaving the
  // mode is one click rather than an edit to the address bar.
  const dev = document.createElement('button');
  dev.type = 'button';
  dev.className = 'shell-dev';
  dev.textContent = 'DEV';
  dev.hidden = true;
  dev.title = '开发者模式：所有关卡已解锁 · 点击退出';
  dev.addEventListener('click', () => options.onExitDev?.());
  right.append(dev, hintButton);

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
    const { level, dev: devOn } = store.get();
    dev.hidden = !devOn;
    // THE SANDBOX HAS NO ADDRESS. It is not a chapter and has no index, so
    // `0-0` -- the numbers its spec carries as placeholders -- would be an
    // address that means nothing, in the slot a player reads addresses from. It
    // gets its own word there instead, in the same boxed style, and the name
    // beside it stays where every screen's name is.
    index.textContent = isSandbox(level) ? '沙盒' : `${level.chapter}-${level.index}`;
    name.textContent = level.name.zh;
    if (!hint.hidden) hint.textContent = level.hint.zh;
  };
  store.subscribe(render);
  render();
  return { render };
}

/**
 * The status bar: cost and verdict along the bottom, and the application's own
 * message beside them.
 *
 * WHY IT IS NOT IN THE TOP BAR. The top bar says where you are -- the level's
 * address and name -- while this line says what the thing on the board costs.
 * A workbench puts the measured numbers where every code editor puts them: on
 * the last row, under everything, at the size a readout wants rather than the
 * size a title wants.
 */
export function mountStatus(root: HTMLElement, store: Store<AppState>): { render(): void } {
  const bar = document.createElement('footer');
  bar.className = 'status-bar';
  const status = document.createElement('span');
  status.className = 'shell-status';
  const metrics = document.createElement('span');
  metrics.className = 'shell-metrics';
  bar.append(status, metrics);
  root.append(bar);

  const render = (): void => {
    const { lastGrade, metrics: measured, status: message } = store.get();
    status.textContent = message ? message.zh : '';
    if (!measured) {
      metrics.textContent = '尚未评测';
      metrics.style.color = THEME.textMuted;
      return;
    }
    // What the circuit COSTS is measured continuously; whether it is CORRECT is
    // only known from a test run, so the suffix stays 未测试 -- in the muted
    // colour, since it is the absence of a verdict and not a bad one -- until
    // the player asks for one.
    const verdict =
      lastGrade === null ? '未测试' : lastGrade.stars > 0 ? '★'.repeat(lastGrade.stars) : '未通过';
    metrics.textContent = `门 ${measured.gate} 个 · 延迟 ${measured.delay} · 拍 ${measured.tick} · 总开销 ${scoreOf(measured)} · ${verdict}`;
    metrics.style.color =
      lastGrade === null ? THEME.textMuted : lastGrade.passed ? THEME.success : THEME.error;
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
  | 'fit'
  /**
   * A dashed box inside a solid one: the wrap gesture -- take what is selected
   * and make one part of it. Dashed because the selection is still loose parts
   * until it is committed.
   */
  | 'wrap'
  | 'download'
  | 'upload'
  /** The docks: the assistant, a program, and the settings gear. */
  | 'agent'
  | 'terminal'
  | 'settings';

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
  wrap: 'M4 4h16v16H4zM8 9h8v6H8z',
  download: 'M12 4v11M8 11l4 4 4-4M5 20h14',
  upload: 'M12 16V5M8 9l4-4 4 4M5 20h14',
  agent: 'M4 6h16v9H9l-5 4z',
  terminal: 'M4 5h16v14H4zM7 10l3 2-3 2',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.1a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L5 10a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.1h5l.4-2.1a7 7 0 0 0 1.7-1l2.3 1 2-3.4L19 13a7 7 0 0 0 .1-1z',
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
