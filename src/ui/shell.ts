/**
 * 应用外壳：顶栏、状态栏和整套图标。
 *
 * 顶栏说明「你在哪里」——关卡地址与名字——并给出去章节地图的入口；
 * 状态栏报告画板上那件东西的代价与判定。两者都只从 store 读，不保存自己的状态。
 * 图标是只描边的 24×24 路径，颜色由按钮的 currentColor 驱动，
 * 所以 `ui/toolbar.ts`、`ui/ide.ts` 等处的图标按钮不必各自复制一份路径。
 */
import type { AppState, Store } from '../app/store';
import { scoreOf } from '../levels/grader';
import { isSandbox } from '../levels/sandbox';
import { THEME } from './theme';

export interface ShellOptions {
  /** 离开画板，显示章节地图。 */
  onOpenMap(): void;
  /** 再次显示本关简报。不提供时按钮不画。 */
  onShowBrief?(): void;
  /** 退出开发者模式。不提供时整个 DEV 指示灯都不出现。 */
  onExitDev?(): void;
}

/**
 * 顶栏：当前打开的是哪一关，以及回到章节地图的入口。
 *
 * 代价读数已经不在这里。界面变成停靠工作台时，它和应用的自身消息一起搬到了状态栏：
 * 顶栏说「你在哪里」，最后一行说画板上那件东西花多少。
 *
 * 它是应用容器的第一个 flex 子元素，好让下面的工作台拿走剩余高度。
 * 关卡名用仪器之声的青色居中，图标按钮在左，DEV 指示灯与提示在右——
 * 这是原作自己的排布，也是这根栏用三列网格而不是一行的原因：
 * flex 行里的居中标题会随两端宽度变化而漂移。
 *
 * 地图按钮在 DOM 顺序里是第一个。它是这根栏唯一的导航控件，
 * `panels.test.ts` 通过 `root.querySelector('button')` 找到并点击它；
 * 在它前面加一个图标，会让那个测试静悄悄地去驱动错误的控件。
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
  // 地址与名字是分开的节点，好让它们在屏幕上各司其职：
  // `1-4` 用操作者的洋红框起来，名字用仪器的青色拉开字距。
  // 关卡地址是玩家用来导航的东西，所以它被画成一个地址，而不是写进一句话里。
  const index = document.createElement('span');
  index.className = 'shell-index';
  const name = document.createElement('span');
  name.className = 'shell-name';
  title.append(index, name);

  const right = document.createElement('div');
  right.className = 'shell-right';
  const hintButton = iconButton('提示', 'bulb');
  // DEV 指示灯。一个能打开所有门的模式必须让人无法忘记：
  // 误入 `?dev=1` 的玩家会看到所有关卡全部解锁却没有任何解释。
  // 它紧挨着关卡名，因为它说的就是这件事；它本身是按钮，退出模式只需一次点击，
  // 而不必去改地址栏。
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
    // 沙盒没有地址。它不是一个章节，也没有序号，所以它规格里占位的 `0-0`
    // 会是玩家读地址的格子里一个毫无意义的地址。那里改放「沙盒」两个字，
    // 沿用同样的方框样式；它旁边的名字仍然在每屏名字所在的位置。
    index.textContent = isSandbox(level) ? '沙盒' : `${level.chapter}-${level.index}`;
    name.textContent = level.name.zh;
    if (!hint.hidden) hint.textContent = level.hint.zh;
  };
  store.subscribe(render);
  render();
  return { render };
}

/**
 * 状态栏：底部一行显示代价与判定，旁边是应用自己的消息。
 *
 * 为什么它不在顶栏：顶栏说你「在哪里」——关卡的地址与名字——
 * 而这一行说画板上那件东西花了多少。工作台把测量数字放在所有代码编辑器放的位置：
 * 最后一行、所有东西之下，用读数该有的字号而不是标题的字号。
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
    // 电路「花费多少」是持续测量的；它「是否正确」只有靠一次测试运行才知道，
    // 所以在玩家主动测试之前，后缀一直是「未测试」——用弱化的颜色，
    // 因为那是判定缺席，而不是一个坏判定。
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
 * 内容只有一个图标的栏按钮。
 *
 * 图标作为 SVG 子节点而不是文本，这让按钮的 `textContent` 保持为空：
 * 面板测试把 `textContent` 读成元件名，这里的字形会漏进那次读取。
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
   * 一个实心框里的虚线框：封装手势——把选中的东西变成一个元件。
   * 用虚线，因为提交之前选区仍然只是一堆松散的元件。
   */
  | 'wrap'
  | 'download'
  | 'upload'
  /** 各个停靠面板：助手、程序，以及设置齿轮。 */
  | 'agent'
  | 'terminal'
  | 'settings';

/** 只描边的 24×24 字形，颜色由按钮的 color 驱动整个图标。 */
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
  // 一块带勾的剪贴板：本关的用例，逐个播放。
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
