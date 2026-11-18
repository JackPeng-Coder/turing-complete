import type { AppState, Store } from '../app/store';
import { iconSvg, type IconName } from './shell';
import { THEME } from './theme';

/**
 * 汇编编辑器：玩家写的文本，以及它变成的东西。
 *
 * 它是什么：一个带行号槽、状态行、字节视图的 textarea，加上一个程序需要的四个控件：
 * 汇编（读文本）、单步（走一个时钟沿）、运行/停止（用定时器连续走沿）、
 * 测试（把本关自己的测试跑一遍）。这里不运行任何电路——`main.ts` 拥有 `ProgramRun`
 * 并通过 `IdeOptions` 回答问题，就像它替工具栏拥有画板时钟一样，
 * 所以本面板是「视图 + 控件」，它描述的那次运行只有一个所有者。
 *
 * 文本存在哪：存在 store 里、按关卡分开（`AppState.programs`），判定器评的就是它，
 * 存档保存的也是它。面板只从那里读，每次按键都通过 `onEdit` 写回；
 * 面板不保留自己的副本，因此刷新、切关或迁移存档都不会让编辑器显示关卡没有的文本。
 *
 * 字节视图按需出现：每次按键都汇编，会反复重建一个玩家还没写完的程序的十六进制转储，
 * 所以它只在玩家要求时出现——点「汇编」，或任何需要已加载程序的操作——文本一变就隐藏。
 * 不等的是状态行里的拒绝：`main.ts` 把运行自身的错误交过来，
 * 汇编不了的程序会在任何单步之前就说明原因。
 *
 * 键盘事件归编辑器管。画板的全局处理器（`ui/board/interact.ts`）把 Backspace 和 Delete
 * 当作「删除选中的元件」、把 Ctrl+Z 当作撤销，而且它监听在 `window` 上——
 * 于是 textarea 里的一次按键会去编辑电路。这里是唯一能区分两者的地方，
 * 它在按键离开 textarea 之前就停住传播。
 */
export interface IdeOptions {
  /** 本关的程序按哪种格式读。 */
  format(): 'asm' | 'bytes';
  /** 文本变了：`main.ts` 把它存起来，并丢弃用旧文本构建的运行。 */
  onEdit(text: string): void;
  /** 现在就把文本读成程序，并显示结果。 */
  onAssemble(): void;
  /** 开始或停止本关自己的测试运行。 */
  onTest(): void;
  /** 对程序运行走一个时钟沿。 */
  onStep(): void;
  /** 开始或停止用定时器连续单步程序。 */
  onToggleRun(): void;
  /** 程序正在被定时器连续单步时为真。 */
  running(): boolean;
  /** 本关自己的用例正在逐个播放时为真。 */
  testing(): boolean;
  /** 单步节奏，沿用既有词汇的写法（如 8×）。 */
  rate(): string;
  /** 在几档单步节奏之间循环。 */
  onCycleRate(): void;
  /** 当前运行持有什么；还没汇编过时为 `null`。 */
  result(): {
    readonly bytes: readonly number[];
    readonly errors: readonly string[];
    readonly ticks: number;
  } | null;
}

/**
 * 等宽编辑器按本关程序所用的阅读器给出的两个标签。
 *
 * 标签是玩家得知该写哪种语言的途径：打孔卡关卡读字节，其它关卡读汇编，
 * 而只给 placeholder 等于给一个玩家可能不会去看的提示。
 */
const LABELS: Record<'asm' | 'bytes', { editor: string; placeholder: string }> = {
  asm: { editor: '汇编程序编辑器', placeholder: 'move|inp|d1' },
  bytes: { editor: '二进制程序编辑器', placeholder: '10110001' },
};

export function mountIde(
  root: HTMLElement,
  store: Store<AppState>,
  options: IdeOptions,
): { render(): void } {
  const panel = document.createElement('section');
  panel.className = 'ide';

  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('span');
  title.textContent = '程序';
  const gap = document.createElement('span');
  gap.className = 'ide-gap';
  const rate = document.createElement('button');
  rate.type = 'button';
  rate.className = 'ide-rate';
  rate.setAttribute('aria-label', '切换汇编速度');
  const assemble = document.createElement('button');
  assemble.type = 'button';
  assemble.className = 'ide-assemble';
  assemble.textContent = '汇编';
  assemble.setAttribute('aria-label', '汇编');
  assemble.title = '汇编：把当前文本读成程序映像';
  head.append(title, gap, rate, assemble);

  // 行号槽是同一段文本的第二列：`main.ts` 的 textarea 会滚动，
  // 下面的 `scroll` 处理器让数字跟着它一起滚。
  const editor = document.createElement('div');
  editor.className = 'ide-editor';
  const gutter = document.createElement('div');
  gutter.className = 'ide-gutter';
  // 装饰性内容：它里面的每个数字旁边文本里都有对应的一行；
  // 让屏幕阅读器在程序之前先读 1、2、3，等于在读标点。
  gutter.setAttribute('aria-hidden', 'true');
  const code = document.createElement('textarea');
  code.className = 'ide-code';
  code.spellcheck = false;
  code.wrap = 'off';
  editor.append(gutter, code);

  const status = document.createElement('div');
  status.className = 'ide-status';
  status.setAttribute('role', 'status');
  const bytes = document.createElement('div');
  bytes.className = 'ide-bytes';
  bytes.hidden = true;

  const test = iconButton('测试', 'test', 'ide-test', () => {
    options.onTest();
    render();
  });
  const step = iconButton('单步', 'step', 'ide-step', () => {
    options.onStep();
    render();
  });
  const run = iconButton('运行', 'play', 'ide-run', () => {
    options.onToggleRun();
    render();
  });
  const actions = document.createElement('div');
  actions.className = 'ide-actions';
  actions.append(test, step, run);

  panel.append(head, editor, status, bytes, actions);
  root.append(panel);

  rate.addEventListener('click', () => {
    options.onCycleRate();
    render();
  });
  assemble.addEventListener('click', () => {
    // 汇编才会让这次运行变成「当前」的，所以面板在回调之后才渲染：
    // 它显示的字节数和十六进制正是刚刚产出的那一份。
    options.onAssemble();
    render();
  });
  code.addEventListener('input', () => {
    options.onEdit(code.value);
    render();
  });
  code.addEventListener('scroll', () => {
    gutter.scrollTop = code.scrollTop;
  });
  // 画板的处理器挂在 `window` 上：在这里止住事件，
  // 编辑器里的 Backspace 才不会删掉电路里选中的元件。
  code.addEventListener('keydown', (event) => {
    event.stopPropagation();
  });

  /** 本关的文本，以应用持有的那份为准：store 是唯一的副本。 */
  const text = (): string => {
    const { level, programs } = store.get();
    return programs[level.id] ?? '';
  };

  /**
   * 面板两处「昂贵」的部分上一次是依据什么构建的。
   *
   * 面板重渲染不等于程序被编辑：`main.ts` 在任何 store 变化时都会重渲染，
   * 而平移、缩放、点选元件都要经过 store——没有这两个缓存，行号槽和十六进制视图
   * 会为一个根本没动过的程序每秒重建几十次。
   * 真正决定「有没有新东西要画」的只有两样：文本（字符串）和映像（运行持有的数组，
   * 用引用相等来判断才是诚实的）。
   */
  let shownText: string | null = null;
  let shownBytes: readonly number[] | null = null;

  const render = (): void => {
    const current = text();
    const labels = LABELS[options.format()];
    code.setAttribute('aria-label', labels.editor);
    code.placeholder = labels.placeholder;
    // 只在玩家不在输入框里时才写回值：替换一个已聚焦 textarea 的 value，
    // 会让下一次按键把光标跳到末尾。
    if (document.activeElement !== code && code.value !== current) code.value = current;
    if (shownText !== current) {
      shownText = current;
      renderGutter(gutter, current);
    }
    gutter.scrollTop = code.scrollTop;

    rate.textContent = options.rate();
    rate.title = `汇编速度 ${options.rate()}`;

    test.setAttribute('aria-pressed', String(options.testing()));
    test.setAttribute('aria-label', options.testing() ? '停止测试' : '测试');
    test.title = options.testing() ? '停止测试' : '测试：逐个播放本关用例，最后给出判定';
    run.setAttribute('aria-pressed', String(options.running()));
    run.replaceChildren(iconSvg(options.running() ? 'stop' : 'play'));
    run.setAttribute('aria-label', options.running() ? '停止' : '运行');
    run.title = options.running() ? '停止：不再单步' : `运行：每 ${options.rate()} 单步一次`;

    const result = options.result();
    const error = result?.errors[0];
    // 被拒绝的程序不能单步，按钮直接禁用而不是按了没反应：
    // 正上方的状态行会说明是哪一行错了。文本只是「还没汇编」时控件仍然可用，
    // 因为请求单步本身会先触发汇编。
    const refused = result !== null && result.errors.length > 0;
    step.disabled = refused;
    run.disabled = refused;
    if (result === null) {
      status.textContent = '尚未汇编';
      status.style.color = THEME.textMuted;
    } else if (error !== undefined) {
      // 阅读器自己给出的句子，会指明出错的行：拒绝不是程序，所以旁边没有字节数可显示。
      status.textContent = error;
      status.style.color = THEME.error;
    } else {
      status.textContent = `${result.bytes.length} 字节 · ${result.ticks} 拍`;
      status.style.color = THEME.textMuted;
    }

    const showBytes = result !== null && error === undefined && result.bytes.length > 0;
    bytes.hidden = !showBytes;
    if (!showBytes) {
      // 没有可显示的东西：格子随视图一起清掉，免得下一个程序挨着上一个程序的残留画出来。
      if (shownBytes !== null) {
        bytes.replaceChildren();
        shownBytes = null;
      }
    } else if (result.bytes !== shownBytes) {
      shownBytes = result.bytes;
      bytes.replaceChildren(...result.bytes.map(byteCell));
    }
  };

  render();
  return { render };
}

/** 映像视图中的一个字节，显示为两位十六进制数字。 */
function byteCell(value: number): HTMLElement {
  const cell = document.createElement('span');
  cell.className = 'ide-byte';
  cell.textContent = value.toString(16).toUpperCase().padStart(2, '0');
  return cell;
}

/**
 * 文本每行一个数字，顺序与文本一致。
 *
 * 行号槽整体重建而不做差量：一个程序最多几百行，
 * 做 diff 反而会让两列多出一个可能对不上的地方。
 */
function renderGutter(gutter: HTMLElement, text: string): void {
  const count = text.split('\n').length;
  gutter.replaceChildren(
    ...Array.from({ length: count }, (_, index) => {
      const line = document.createElement('div');
      line.className = 'ide-line';
      line.textContent = String(index + 1);
      return line;
    }),
  );
}

/**
 * 走带控件之一，只显示图标。
 *
 * 沿用画板工具栏的同一套词汇：图标来自外壳（`测试`、`单步`、`运行`/`停止`），
 * 跑过画板时钟的玩家已经知道它们的意思。标签放在 `aria-label` 和 `title` 上，
 * 工具栏也是这么做的，原因相同——面板按钮的文字若是字形，就会漏进任何读取面板文本的地方。
 */
function iconButton(
  label: string,
  icon: IconName,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  // 直接用 `tool-btn` 而不是复制一份样式：这些就是工具栏画的那几个走带控件，
  // 只隔了一个面板；再维护一套尺寸与状态，就是第二个需要与之同步的东西。
  button.className = `tool-btn ${className}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(iconSvg(icon));
  button.addEventListener('click', onClick);
  return button;
}
